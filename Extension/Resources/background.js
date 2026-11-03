// NoSlop — background script (docs/DESIGN.md §6 settings, §7 native protocol).
// Valid both as a Safari MV3 non-persistent background script and inside a Chrome service worker
// (tools/build-chrome.mjs importScripts this file): no DOM, no window, listeners registered at top level.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const b = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser
    : (typeof chrome !== 'undefined' && chrome && chrome.runtime) ? chrome : null;

  const SETTINGS_VERSION = 1;
  const SITES = ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin'];
  const NATIVE_APP_ID = 'application.id'; // Safari ignores the id and routes to the containing app's extension handler
  const FETCH_TIMEOUT_MS = 10000;
  const FETCH_HOSTS = [/(?:^|\.)youtube\.com$/i, /(?:^|\.)tiktok\.com$/i];
  const STATS_KEEP_DAYS = 90;
  const PENDING_KEY = 'noslop:statsPending';
  const NATIVE_FLUSH_MINUTES = 1;

  // Keep in sync with lib/host-extension.js defaultSettings() (tests assert equality).
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

  function migrateSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    // version 0 / unversioned -> 1: same shape, just fill defaults. Future migrations go here.
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

  NS.bgDefaultSettings = defaultSettings;
  NS.bgMigrateSettings = migrateSettings;
  if (!b) return; // plain page without a runtime: nothing to do

  // ---------------------------------------------------------------- storage (promise + callback APIs)
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
  const getLocal = (keys) => storageCall('get', keys);
  const setLocal = (obj) => storageCall('set', obj);

  // ---------------------------------------------------------------- settings
  let settingsCache = null;
  let lastPushedAt = 0; // never push untouched defaults (updatedAt 0) over the native copy

  async function loadSettings() {
    const r = await getLocal('settings');
    const raw = r && r.settings;
    const s = migrateSettings(raw);
    if (JSON.stringify(raw) !== JSON.stringify(s)) await setLocal({ settings: s });
    settingsCache = s;
    return s;
  }

  async function patchSettings(patch, opts) {
    const fromNative = !!(opts && opts.fromNative);
    const cur = settingsCache || await loadSettings();
    const next = migrateSettings(Object.assign({}, cur, patch || {}));
    next.updatedAt = fromNative && patch && typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now();
    if (fromNative) lastPushedAt = next.updatedAt; // do not echo back what native just sent
    await setLocal({ settings: next });
    settingsCache = next;
    if (!fromNative) pushShared(next);
    return next;
  }

  // ---------------------------------------------------------------- native bridge (absent in Chrome)
  let platform = null;
  async function native(msg) {
    try {
      if (!b.runtime || typeof b.runtime.sendNativeMessage !== 'function') return null;
      const r = b.runtime.sendNativeMessage(NATIVE_APP_ID, msg);
      const v = (r && typeof r.then === 'function') ? await r : r;
      return v == null ? null : v;
    } catch (_) { return null; }
  }

  async function pingNative() {
    const r = await native({ type: 'ping' });
    if (r && r.ok) platform = r.platform || null;
    return r;
  }

  async function pullShared() {
    const r = await native({ type: 'getSharedSettings' });
    if (!r || r.settings == null) return null;
    let s = r.settings;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { return null; } }
    if (!s || typeof s !== 'object') return null;
    const cur = settingsCache || await loadSettings();
    const theirs = typeof s.updatedAt === 'number' ? s.updatedAt : 0;
    const mine = typeof cur.updatedAt === 'number' ? cur.updatedAt : 0;
    if (theirs > mine) return patchSettings(s, { fromNative: true });   // last-writer-wins
    if (mine > theirs) pushShared(cur);
    return cur;
  }

  async function pushShared(s) {
    const at = typeof s.updatedAt === 'number' ? s.updatedAt : 0;
    if (!s || at <= lastPushedAt) return null; // only newer local writes go out
    lastPushedAt = at;
    return native({ type: 'putSharedSettings', settings: s });
  }

  // ---------------------------------------------------------------- stats
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function mergeEvent(stats, ev) {
    const day = today();
    const site = ev.site || 'unknown';
    const n = Math.max(1, Number(ev.count) || 1);
    const s = stats[day] || (stats[day] = {});
    const ss = s[site] || (s[site] = { hide: 0, dim: 0, reasons: {} });
    if (ev.action === 'hide' || ev.action === 'dim') ss[ev.action] = (ss[ev.action] || 0) + n;
    if (ev.reason) ss.reasons[ev.reason] = (ss.reasons[ev.reason] || 0) + n;
  }

  function pruneDays(stats) {
    const keys = Object.keys(stats).sort();
    while (keys.length > STATS_KEEP_DAYS) delete stats[keys.shift()];
    return stats;
  }

  let statsChain = Promise.resolve();
  function recordStats(events) {
    const list = Array.isArray(events) ? events : events ? [events] : [];
    if (!list.length) return statsChain;
    statsChain = statsChain.then(async () => {
      const r = await getLocal(['stats', PENDING_KEY]);
      const stats = (r && r.stats) || {};
      const pending = (r && r[PENDING_KEY]) || {};
      for (const ev of list) { if (ev && typeof ev === 'object') { mergeEvent(stats, ev); mergeEvent(pending, ev); } }
      await setLocal({ stats: pruneDays(stats), [PENDING_KEY]: pending });
    }).catch(() => { /* ignore */ });
    return statsChain;
  }

  async function flushStatsToNative() {
    await statsChain;
    const r = await getLocal(PENDING_KEY);
    const pending = r && r[PENDING_KEY];
    if (!pending || !Object.keys(pending).length) return null;
    const res = await native({ type: 'recordStats', stats: pending });
    if (res && res.ok) await setLocal({ [PENDING_KEY]: {} });
    return res;
  }

  // ---------------------------------------------------------------- fetch proxy (youtube enrich)
  function registrable(host) { const p = String(host || '').toLowerCase().split('.'); return p.slice(-2).join('.'); }

  async function fetchText(url, timeout, sender) {
    let u;
    try { u = new URL(String(url)); } catch (_) { throw new Error('bad url'); }
    if (u.protocol !== 'https:') throw new Error('https only');
    if (!FETCH_HOSTS.some((re) => re.test(u.hostname))) throw new Error('host not allowed');
    if (sender && sender.url) {
      let su = null;
      try { su = new URL(sender.url); } catch (_) { su = null; }
      if (su && registrable(su.hostname) !== registrable(u.hostname)) throw new Error('cross-site fetch refused');
    }
    const ms = Math.min(Math.max(Number(timeout) || FETCH_TIMEOUT_MS, 1000), FETCH_TIMEOUT_MS);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms);
    try {
      const res = await fetch(u.href, { signal: ctrl ? ctrl.signal : undefined, credentials: 'include', redirect: 'follow' });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.text();
    } finally { clearTimeout(timer); }
  }

  // ---------------------------------------------------------------- message handling
  async function handle(msg, sender) {
    if (!msg || typeof msg !== 'object') return { error: 'bad message' };
    switch (msg.type) {
      case 'ping': return { ok: true, version: (b.runtime.getManifest && b.runtime.getManifest().version) || '0', platform };
      case 'getSettings': return { settings: settingsCache || await loadSettings() };
      case 'patchSettings': return { settings: await patchSettings(msg.patch || msg.settings || {}) };
      case 'fetchText':
        try { return { ok: true, text: await fetchText(msg.url, msg.timeout, sender) }; }
        catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
      case 'reportStats': await recordStats(msg.events || msg.event || []); return { ok: true };
      case 'getStats': { const r = await getLocal('stats'); return { stats: (r && r.stats) || {} }; }
      case 'popupOpened': { const s = await pullShared(); return { settings: s || settingsCache || await loadSettings(), platform }; }
      case 'flushStats': return { result: await flushStatsToNative() };
      case 'classify': { const r = await native({ type: 'classify', items: (msg.items || []).slice(0, 32) }); return { verdicts: (r && r.verdicts) || [] }; }
      default: return { error: 'unknown message type: ' + msg.type };
    }
  }

  if (b.runtime.onMessage && b.runtime.onMessage.addListener) {
    b.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      handle(msg, sender).then((r) => { try { sendResponse(r); } catch (_) { /* port closed */ } },
        (e) => { try { sendResponse({ error: e && e.message ? e.message : String(e) }); } catch (_) { /* ignore */ } });
      return true; // async response (works in Safari and Chrome)
    });
  }

  // Settings written directly to storage by another extension page (popup) -> push to native.
  if (b.storage && b.storage.onChanged && b.storage.onChanged.addListener) {
    b.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (changes && changes.settings && changes.settings.newValue) {
        settingsCache = migrateSettings(changes.settings.newValue);
        pushShared(settingsCache);
      }
    });
  }

  // ---------------------------------------------------------------- startup + periodic native flush
  async function startup() {
    try { await loadSettings(); } catch (_) { /* ignore */ }
    try { await pingNative(); } catch (_) { /* ignore */ }
    try { await pullShared(); } catch (_) { /* ignore */ }
  }
  if (b.runtime.onInstalled && b.runtime.onInstalled.addListener) b.runtime.onInstalled.addListener(() => { startup(); });
  if (b.runtime.onStartup && b.runtime.onStartup.addListener) b.runtime.onStartup.addListener(() => { startup(); });
  const startupPromise = startup();

  if (b.alarms && b.alarms.create && b.alarms.onAlarm) {
    try {
      b.alarms.create('noslop-flush-stats', { periodInMinutes: NATIVE_FLUSH_MINUTES });
      b.alarms.onAlarm.addListener((a) => { if (a && a.name === 'noslop-flush-stats') periodic(); });
    } catch (_) { setInterval(periodic, NATIVE_FLUSH_MINUTES * 60000); }
  } else {
    setInterval(periodic, NATIVE_FLUSH_MINUTES * 60000);
  }
  // Once a minute: pull settings the Mac/iOS app may have changed (a no-op unless its updatedAt is newer — the app
  // has no way to signal a long-lived background page), then push pending stats.
  async function periodic() {
    try { await pullShared(); } catch (_) { /* ignore */ }
    try { await flushStatsToNative(); } catch (_) { /* ignore */ }
  }

  NS.bg = {
    handle, defaultSettings, migrateSettings, native, pingNative, pullShared, pushShared, flushStatsToNative, recordStats, fetchText,
    loadSettings, patchSettings, startupPromise,
    get platform() { return platform; }, get settings() { return settingsCache; }
  };
})();
