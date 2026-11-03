// NoSlop — host shim for the web-extension runtime (docs/DESIGN.md §6). Plain classic script.
// Implements NoSlop.host over browser.storage.local + browser.runtime.sendMessage (to background.js).
// When no extension runtime exists (unit tests, plain pages) it falls back to an in-memory store and
// sets NoSlop.host.__memory = true. A WKWebView shim (host-webview.js) implements the same surface.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const SETTINGS_VERSION = 1;
  const SITES = ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin'];

  // Keep in sync with background.js defaultSettings() (tests assert equality).
  function defaultSettings() {
    const sites = {}, blocked = {}, allowed = {};
    for (const s of SITES) { sites[s] = { mode: 'balanced' }; blocked[s] = []; allowed[s] = []; }
    return {
      version: SETTINGS_VERSION, enabled: true, updatedAt: 0,
      sites,
      surfaces: { hideShorts: false, hideReels: false, hideGrokPosts: true, hideTikTokForYou: false, hideAds: false, hideRedditRecommended: false },
      youtubePrefetch: true, youtubePrefetchConcurrency: 2,
      reelsAutoAdvance: true, tiktokJsonRelay: true,
      showStubs: true, dimInsteadOfHide: false,
      blockedAccounts: blocked, allowedAccounts: allowed,
      customPhrases: [], customHashtags: [],
      autoPromote: { enabled: true, hits: 3 }, rulesOverride: null
    };
  }

  /** Fill missing keys from defaults (shallow for scalars, per-key for the site maps). Never throws. */
  function migrateSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign({}, d, s);
    out.version = SETTINGS_VERSION;
    out.sites = Object.assign({}, d.sites, s.sites || {});
    for (const k of SITES) { if (!out.sites[k] || typeof out.sites[k] !== 'object') out.sites[k] = { mode: 'balanced' }; if (!out.sites[k].mode) out.sites[k].mode = 'balanced'; }
    // per-site opt-ins (sites.reddit.flagAppAccounts) survive as extra keys on the site object; booleans only
    if (out.sites.reddit && out.sites.reddit.flagAppAccounts != null) out.sites.reddit.flagAppAccounts = !!out.sites.reddit.flagAppAccounts;
    if (typeof out.reelsAutoAdvance !== 'boolean') out.reelsAutoAdvance = d.reelsAutoAdvance;
    if (typeof out.tiktokJsonRelay !== 'boolean') out.tiktokJsonRelay = d.tiktokJsonRelay;
    out.surfaces = Object.assign({}, d.surfaces, s.surfaces || {});
    out.blockedAccounts = Object.assign({}, d.blockedAccounts, s.blockedAccounts || {});
    out.allowedAccounts = Object.assign({}, d.allowedAccounts, s.allowedAccounts || {});
    for (const k of SITES) { if (!Array.isArray(out.blockedAccounts[k])) out.blockedAccounts[k] = []; if (!Array.isArray(out.allowedAccounts[k])) out.allowedAccounts[k] = []; }
    out.autoPromote = Object.assign({}, d.autoPromote, s.autoPromote || {});
    if (!Array.isArray(out.customPhrases)) out.customPhrases = [];
    if (!Array.isArray(out.customHashtags)) out.customHashtags = [];
    if (typeof out.updatedAt !== 'number') out.updatedAt = 0;
    return out;
  }

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  NS.defaultSettings = defaultSettings;
  NS.migrateSettings = migrateSettings;
  NS.SITES = SITES;

  const b = (typeof browser !== 'undefined' && browser && browser.runtime && browser.storage) ? browser
    : (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.storage) ? chrome : null;

  if (!b || !b.storage.local) {
    // ---------------- in-memory host (tests / no runtime) ----------------
    const store = new Map();
    let settings = defaultSettings();
    const listeners = new Set();
    const reports = [];
    const host = {
      __memory: true, __reports: reports, __store: store,
      getSettings() { return Promise.resolve(clone(settings)); },
      onSettingsChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      patchSettings(partial) {
        settings = migrateSettings(Object.assign({}, settings, partial || {}, { updatedAt: Date.now() }));
        const snap = clone(settings);
        listeners.forEach((cb) => { try { cb(clone(snap)); } catch (e) { /* ignore */ } });
        return Promise.resolve(snap);
      },
      __setSettings(s) { return host.patchSettings(s); },
      storageGet(keys) {
        const out = {};
        const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [keys];
        for (const k of list) { if (store.has(k)) out[k] = clone(store.get(k)); else if (keys && typeof keys === 'object' && !Array.isArray(keys) && keys[k] !== undefined) out[k] = clone(keys[k]); }
        return Promise.resolve(out);
      },
      storageSet(obj) { for (const [k, v] of Object.entries(obj || {})) store.set(k, clone(v)); return Promise.resolve(); },
      storageRemove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)); return Promise.resolve(); },
      fetchText(url, opts) {
        if (typeof host.__fetchText === 'function') return Promise.resolve(host.__fetchText(url, opts));
        if (typeof globalThis.fetch === 'function') return globalThis.fetch(url).then((r) => r.text());
        return Promise.reject(new Error('fetchText unavailable in memory host'));
      },
      report(event) { reports.push(event); },
      flush() { return Promise.resolve(); }
    };
    NS.host = host;
    return;
  }

  // ---------------- extension host ----------------
  const NSKEY = 'noslop:';

  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        const fail = (e) => { if (!settled) { settled = true; reject(e); } };
        const r = b.runtime.sendMessage(msg, (resp) => {
          const err = b.runtime && b.runtime.lastError;
          if (err) fail(new Error(err.message || String(err))); else done(resp);
        });
        if (r && typeof r.then === 'function') r.then(done, fail);
      } catch (e) { reject(e); }
    });
  }

  function storageCall(method, arg) {
    return new Promise((resolve, reject) => {
      try {
        const r = b.storage.local[method](arg, (v) => {
          const err = b.runtime && b.runtime.lastError;
          if (err) reject(new Error(err.message || String(err))); else resolve(v);
        });
        if (r && typeof r.then === 'function') r.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  const reportQueue = [];
  let reportTimer = null;
  function flushReports() {
    reportTimer = null;
    if (!reportQueue.length) return Promise.resolve();
    const events = reportQueue.splice(0, reportQueue.length);
    return send({ type: 'reportStats', events }).catch(() => { /* background asleep; drop */ });
  }

  const host = {
    __memory: false,
    getSettings() {
      return send({ type: 'getSettings' })
        .then((r) => (r && r.settings) ? migrateSettings(r.settings) : storageCall('get', 'settings').then((v) => migrateSettings(v && v.settings)))
        .catch(() => storageCall('get', 'settings').then((v) => migrateSettings(v && v.settings)).catch(() => defaultSettings()));
    },
    onSettingsChanged(cb) {
      const fn = (changes, area) => {
        if (area && area !== 'local') return;
        if (changes && changes.settings && changes.settings.newValue) { try { cb(migrateSettings(changes.settings.newValue)); } catch (e) { /* ignore */ } }
      };
      if (b.storage.onChanged && b.storage.onChanged.addListener) b.storage.onChanged.addListener(fn);
      return () => { try { b.storage.onChanged.removeListener(fn); } catch (_) { /* ignore */ } };
    },
    patchSettings(partial) {
      return send({ type: 'patchSettings', patch: partial || {} }).then((r) => {
        if (r && r.settings) return migrateSettings(r.settings);
        throw new Error((r && r.error) || 'patchSettings failed');
      }).catch(() => storageCall('get', 'settings').then((v) => {
        const next = migrateSettings(Object.assign({}, migrateSettings(v && v.settings), partial || {}, { updatedAt: Date.now() }));
        return storageCall('set', { settings: next }).then(() => next);
      }));
    },
    storageGet(keys) {
      const list = Array.isArray(keys) ? keys : keys == null ? null : typeof keys === 'object' ? Object.keys(keys) : [keys];
      const nsKeys = list ? list.map((k) => NSKEY + k) : null;
      return storageCall('get', nsKeys).then((v) => {
        const out = {};
        for (const [k, val] of Object.entries(v || {})) if (k.startsWith(NSKEY)) out[k.slice(NSKEY.length)] = val;
        return out;
      });
    },
    storageSet(obj) {
      const o = {};
      for (const [k, v] of Object.entries(obj || {})) o[NSKEY + k] = v;
      return storageCall('set', o);
    },
    storageRemove(keys) { return storageCall('remove', (Array.isArray(keys) ? keys : [keys]).map((k) => NSKEY + k)); },
    fetchText(url, opts) {
      const timeout = (opts && opts.timeout) || 10000;
      return send({ type: 'fetchText', url: String(url), timeout }).then((r) => {
        if (r && r.ok && typeof r.text === 'string') return r.text;
        throw new Error((r && r.error) || 'fetchText failed');
      });
    },
    report(event) {
      if (!event) return;
      reportQueue.push(event);
      if (!reportTimer) reportTimer = setTimeout(flushReports, 1000);
    },
    flush() { if (reportTimer) { clearTimeout(reportTimer); reportTimer = null; } return flushReports(); }
  };
  NS.host = host;
})();
