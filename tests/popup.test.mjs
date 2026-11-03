// Popup tests: popup/popup.html + popup/popup.js inside jsdom with a mocked `browser` (runtime, tabs, storage).
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, RESOURCES, settle } from './helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

const POPUP_HTML = fs.readFileSync(path.join(RESOURCES, 'popup/popup.html'), 'utf8');
const FILES = ['rules.js', 'popup/popup.js'];

function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function baseSettings(over = {}) {
  const sites = {}, blocked = {}, allowed = {};
  for (const s of ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin']) { sites[s] = { mode: 'balanced' }; blocked[s] = []; allowed[s] = []; }
  return Object.assign({
    version: 1, enabled: true, updatedAt: 1, sites,
    surfaces: { hideShorts: false, hideReels: false, hideGrokPosts: true, hideTikTokForYou: false, hideAds: false },
    youtubePrefetch: true, youtubePrefetchConcurrency: 2, showStubs: true, dimInsteadOfHide: false,
    blockedAccounts: blocked, allowedAccounts: allowed, customPhrases: [], customHashtags: [],
    autoPromote: { enabled: true, hits: 3 }, rulesOverride: null
  }, over);
}

const sampleItems = (n = 3) => Array.from({ length: n }, (_, i) => ({
  id: 'v' + i, action: i % 3 === 2 ? 'dim' : 'hide', author: i === 1 ? '' : '@slopper' + i,
  reason: i === 1 ? 'style:contrast_pivot' : 'label:youtube_badge', title: 'Video ' + i, text: 'some text ' + i, ts: 1000 + i
}));

/**
 * Mock browser: runtime.sendMessage -> opts.background(msg) (default: a tiny settings/stats server);
 * tabs.query -> [opts.tab]; tabs.sendMessage -> opts.content(msg) (reject when opts.content is 'unreachable').
 * `style: 'callback'` makes sendMessage callback-only (Chrome-style), otherwise promise+callback (Safari-style).
 */
function mockBrowser(opts = {}) {
  const log = { bg: [], tab: [] };
  let settings = baseSettings(opts.settings);
  const stats = opts.stats || {};
  const onChanged = new Set();
  const platform = 'platform' in opts ? opts.platform : 'macos';
  const defaultBg = async (msg) => {
    switch (msg.type) {
      case 'popupOpened': return { settings, platform };
      case 'getSettings': return { settings };
      case 'patchSettings': settings = Object.assign({}, settings, msg.patch, { updatedAt: settings.updatedAt + 1 }); return { settings };
      case 'getStats': return { stats };
      default: return { error: 'unknown message type: ' + msg.type };
    }
  };
  const bg = opts.background || defaultBg;
  const content = opts.content || (async (msg) => {
    if (msg.type === 'getRecentHidden') return { site: 'youtube', items: sampleItems(3).slice(0, msg.limit) };
    if (msg.type === 'showItem') return { ok: true };
    return undefined;
  });
  const wrap = (p, cb) => {
    if (opts.style === 'callback') { p.then((v) => cb && cb(v), () => { fake.runtime.lastError = { message: 'boom' }; try { cb && cb(undefined); } finally { fake.runtime.lastError = undefined; } }); return undefined; }
    if (cb) p.then(cb, () => {});
    return p;
  };
  const fake = {
    __log: log, get __settings() { return settings; },
    runtime: {
      id: 'noslop-fake', lastError: undefined,
      getManifest() { return { version: '0.1.0-test' }; },
      getURL(p) { return (opts.scheme || 'safari-web-extension') + '://abc/' + p; },
      sendMessage(msg, cb) { log.bg.push(J(msg)); return wrap(Promise.resolve().then(() => bg(J(msg))), cb); }
    },
    tabs: {
      query(q, cb) { const p = Promise.resolve('tab' in opts ? (opts.tab ? [opts.tab] : []) : [{ id: 7, url: 'https://www.youtube.com/', active: true }]); return wrap(p, cb); },
      sendMessage(tabId, msg, cb) {
        log.tab.push({ tabId, msg: J(msg) });
        const p = content === 'unreachable' ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) : Promise.resolve().then(() => content(J(msg)));
        return wrap(p, cb);
      },
      create() {}
    },
    storage: {
      local: { get(k, cb) { const r = {}; if (cb) cb(r); return Promise.resolve(r); }, set(o, cb) { if (cb) cb(); return Promise.resolve(); } },
      onChanged: { addListener(fn) { onChanged.add(fn); }, removeListener(fn) { onChanged.delete(fn); }, __fire(changes) { for (const l of onChanged) l(changes, 'local'); } }
    }
  };
  return fake;
}

let ctx;
async function boot(opts = {}) {
  const browser = mockBrowser(opts);
  ctx = await loadScripts(FILES, { url: 'safari-web-extension://abc/popup/popup.html', html: POPUP_HTML, browser });
  const inst = ctx.NoSlop.popup.instance;
  assert.ok(inst, 'popup auto-initialised');
  await inst.state.ready;
  await settle();
  return Object.assign(ctx, { inst, b: browser, $: (id) => ctx.document.getElementById(id) });
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.popup.instance) ctx.NoSlop.popup.instance.destroy(); });

// ------------------------------------------------------------------ pure helpers
describe('popup helpers', () => {
  test('siteFor maps hostnames exactly like the adapters', async () => {
    const { NoSlop } = await loadScripts(FILES, { html: POPUP_HTML });
    const f = NoSlop.popup.siteFor;
    assert.equal(f('https://www.youtube.com/watch?v=1'), 'youtube');
    assert.equal(f('https://m.youtube.com/'), 'youtube');
    assert.equal(f('https://x.com/home'), 'x');
    assert.equal(f('https://twitter.com/home'), 'x');
    assert.equal(f('https://www.instagram.com/reels/'), 'instagram');
    assert.equal(f('https://www.facebook.com/'), 'facebook');
    assert.equal(f('https://www.tiktok.com/foryou'), 'tiktok');
    assert.equal(f('https://old.reddit.com/r/x'), 'reddit');
    assert.equal(f('https://www.linkedin.com/feed/'), 'linkedin');
    assert.equal(f('https://notyoutube.com/'), null);
    assert.equal(f('https://youtube.com.evil.net/'), null);
    assert.equal(f('about:blank'), null);
    assert.equal(f(''), null);
    assert.equal(f(undefined), null);
  });
  test('countsFor sums today for one site and all sites', async () => {
    const { NoSlop } = await loadScripts(FILES, { html: POPUP_HTML });
    const day = todayKey();
    const stats = { [day]: { youtube: { hide: 3, dim: 2, reasons: {} }, x: { hide: 5, dim: 0, reasons: {} }, junk: null }, '2000-01-01': { youtube: { hide: 99, dim: 99 } } };
    deq(NoSlop.popup.countsFor(stats, 'youtube', day), { site: { hide: 3, dim: 2 }, all: { hide: 8, dim: 2 } });
    deq(NoSlop.popup.countsFor(stats, 'reddit', day), { site: { hide: 0, dim: 0 }, all: { hide: 8, dim: 2 } });
    deq(NoSlop.popup.countsFor({}, 'youtube', day), { site: { hide: 0, dim: 0 }, all: { hide: 0, dim: 0 } });
    deq(NoSlop.popup.countsFor(null, null, day), { site: { hide: 0, dim: 0 }, all: { hide: 0, dim: 0 } });
    assert.equal(NoSlop.popup.todayKey(new Date(2026, 10, 2)), '2026-11-02');
  });
  test('normHandle and humanizeReason match lib/scorer.js', async () => {
    const popup = (await loadScripts(FILES, { html: POPUP_HTML })).NoSlop.popup;
    const scorer = (await loadScripts(['rules.js', 'lib/dom.js', 'lib/scorer.js'])).NoSlop.scorer;
    for (const h of ['@Alice', ' alice ', 'https://x.com/Alice/', '/r/Pics/', 'user/Bob', 'channel/UC123', '', null, 'UCabc']) {
      assert.equal(popup.normHandle(h), scorer.normHandle(h), 'normHandle ' + h);
    }
    for (const r of ['label:youtube_badge', 'hashtag:#aiart', 'account:block', 'account:seed', 'tool:midjourney', 'style:contrast_pivot', 'custom:foo', 'ad', '']) {
      assert.equal(popup.humanizeReason(r), scorer.humanizeReason(r), 'humanizeReason ' + r);
    }
  });
  test('withBlocked adds / removes without duplicates and never mutates', async () => {
    const { NoSlop } = await loadScripts(FILES, { html: POPUP_HTML });
    const s = baseSettings({ blockedAccounts: { youtube: ['@Old'] } });
    const added = NoSlop.popup.withBlocked(s, 'youtube', '@slop', true);
    deq(added.youtube, ['@Old', '@slop']);
    deq(s.blockedAccounts.youtube, ['@Old'], 'input untouched');
    deq(NoSlop.popup.withBlocked({ blockedAccounts: added }, 'youtube', 'SLOP', true).youtube, ['@Old', '@slop'], 'dedupe by normalised handle');
    deq(NoSlop.popup.withBlocked({ blockedAccounts: added }, 'youtube', 'old', false).youtube, ['@slop']);
    assert.ok(Array.isArray(added.linkedin), 'all site keys present');
    assert.equal(NoSlop.popup.isBlocked({ blockedAccounts: added }, 'youtube', 'Slop'), true);
    assert.equal(NoSlop.popup.isBlocked({ blockedAccounts: added }, 'x', 'Slop'), false);
    assert.equal(NoSlop.popup.isBlocked(s, 'youtube', ''), false);
  });
});

// ------------------------------------------------------------------ boot / render
describe('popup boot', () => {
  test('sends popupOpened first, then renders settings, site mode, counts, surfaces and recent items', async () => {
    const day = todayKey();
    const { $, b, document } = await boot({
      settings: { sites: Object.assign(baseSettings().sites, { youtube: { mode: 'strict' } }), surfaces: { hideShorts: true, hideReels: false, hideGrokPosts: true, hideTikTokForYou: false, hideAds: true } },
      stats: { [day]: { youtube: { hide: 4, dim: 1, reasons: {} }, x: { hide: 2, dim: 3, reasons: {} } } }
    });
    assert.equal(b.__log.bg[0].type, 'popupOpened', 'first message triggers the settings pull');
    assert.ok(b.__log.bg.some((m) => m.type === 'getStats'));
    deq(b.__log.tab, [{ tabId: 7, msg: { type: 'getRecentHidden', limit: 20 } }]);
    assert.equal($('popup').getAttribute('data-state'), 'ready');
    assert.equal($('master-toggle').checked, true);
    assert.equal($('master-label').textContent, 'On');
    assert.equal($('site-name').textContent, 'YouTube');
    assert.equal($('site-unsupported').hidden, true);
    assert.equal($('mode-group').hidden, false);
    assert.equal(document.querySelector('input[name="mode"]:checked').value, 'strict');
    assert.match($('mode-hint').textContent, /Strict/);
    assert.equal($('count-site-hide').textContent, '4');
    assert.equal($('count-site-dim').textContent, '1');
    assert.equal($('count-all-hide').textContent, '6');
    assert.equal($('count-all-dim').textContent, '4');
    const sf = (k) => document.querySelector(`#surfaces input[data-surface="${k}"]`).checked;
    assert.equal(sf('hideShorts'), true); assert.equal(sf('hideReels'), false); assert.equal(sf('hideGrokPosts'), true); assert.equal(sf('hideAds'), true);
    const items = document.querySelectorAll('#recent-list .recent__item');
    assert.equal(items.length, 3);
    assert.equal($('recent-empty').hidden, true);
    assert.equal(items[0].querySelector('.recent__author').textContent, '@slopper0');
    assert.equal(items[0].querySelector('.recent__action').textContent, 'Hidden');
    assert.match(items[0].querySelector('.recent__reason').textContent, /platform AI label \(youtube badge\)/);
    assert.equal(items[0].querySelector('button[data-act="show"]').textContent, 'Show again');
    assert.equal(items[0].querySelector('button[data-act="never"]').textContent, 'Never show @slopper0');
    assert.equal(items[1].querySelector('button[data-act="never"]'), null, 'no author -> no block button');
    assert.equal(items[1].querySelector('.recent__author').textContent, 'Video 1', 'title shown when author unknown');
    assert.equal(items[2].querySelector('.recent__action').textContent, 'Dimmed');
    assert.equal($('open-app').hidden, false, 'macOS: app link visible');
    assert.equal($('open-app').getAttribute('href'), 'noslop://open');
    assert.match($('version').textContent, /0\.1\.0-test/);
    assert.match($('version').textContent, /rules \d{4}-\d{2}-\d{2}/);
  });
  test('falls back to getSettings when popupOpened fails', async () => {
    const { $, b } = await boot({
      background: async (msg) => {
        if (msg.type === 'popupOpened') throw new Error('asleep');
        if (msg.type === 'getSettings') return { settings: baseSettings({ enabled: false }) };
        if (msg.type === 'getStats') return { stats: {} };
        return {};
      }
    });
    deq(b.__log.bg.slice(0, 2).map((m) => m.type), ['popupOpened', 'getSettings']);
    assert.equal($('master-toggle').checked, false);
    assert.equal($('popup').getAttribute('data-disabled'), 'true');
  });
  test('unsupported tab: mode control hidden, site counts hidden, content script not asked', async () => {
    const { $, b, document } = await boot({ tab: { id: 3, url: 'https://example.com/' } });
    assert.equal($('site-name').textContent, 'Unsupported site');
    assert.equal($('site-unsupported').hidden, false);
    assert.equal($('mode-group').hidden, true);
    assert.equal(b.__log.tab.length, 0);
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 0);
    assert.equal($('recent-empty').hidden, false);
    assert.match($('recent-empty').textContent, /supported site/);
    assert.equal(document.querySelectorAll('#counts .counts__cell')[0].hidden, true);
    assert.equal(document.querySelectorAll('#counts .counts__cell')[2].hidden, false);
  });
  test('no active tab at all still renders', async () => {
    const { $ } = await boot({ tab: null });
    assert.equal($('site-name').textContent, 'No active tab');
    assert.equal($('popup').getAttribute('data-state'), 'ready');
  });
  test('content script unreachable: empty list with a reload hint, rest of the popup works', async () => {
    const { $, document } = await boot({ content: 'unreachable' });
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 0);
    assert.match($('recent-empty').textContent, /not running on this tab/);
    assert.equal($('site-name').textContent, 'YouTube');
    assert.equal($('popup').getAttribute('data-state'), 'ready');
  });
  test('caps the recent list at 20 and asks for 20', async () => {
    const { b, document } = await boot({ content: async (msg) => ({ items: sampleItems(30) }) });
    assert.equal(b.__log.tab[0].msg.limit, 20);
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 20);
  });
  test('Chrome build: callback-only runtime works and the app link is hidden with a hint', async () => {
    const { $, b } = await boot({ style: 'callback', platform: null, scheme: 'chrome-extension' });
    assert.equal($('popup').getAttribute('data-state'), 'ready');
    assert.equal($('site-name').textContent, 'YouTube');
    assert.equal($('open-app').hidden, true);
    assert.equal($('open-app-hint').hidden, false);
    assert.equal(b.__log.bg[0].type, 'popupOpened');
  });
  test('Safari without a native ping (platform null) still shows the app link', async () => {
    const { $ } = await boot({ platform: null, scheme: 'safari-web-extension' });
    assert.equal($('open-app').hidden, false);
  });
});

// ------------------------------------------------------------------ interactions
describe('popup interactions', () => {
  const patches = (b) => b.__log.bg.filter((m) => m.type === 'patchSettings').map((m) => m.patch);

  test('master switch patches enabled and greys out the site controls', async () => {
    const { $, b, window } = await boot();
    const t = $('master-toggle');
    t.checked = false; t.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    deq(patches(b), [{ enabled: false }]);
    assert.equal($('popup').getAttribute('data-disabled'), 'true');
    assert.equal($('master-label').textContent, 'Off');
    assert.equal(b.__settings.enabled, false);
  });
  test('mode radio patches the whole sites map with this site changed', async () => {
    const { b, document, window, $ } = await boot();
    const off = document.querySelector('input[name="mode"][value="off"]');
    off.checked = true; off.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    const p = patches(b);
    assert.equal(p.length, 1);
    assert.equal(p[0].sites.youtube.mode, 'off');
    assert.equal(p[0].sites.x.mode, 'balanced', 'other sites preserved (background merge is shallow)');
    assert.equal(Object.keys(p[0].sites).length, 7);
    assert.match($('mode-hint').textContent, /Off/);
  });
  test('surface checkbox patches the whole surfaces map', async () => {
    const { b, document, window } = await boot();
    const cb = document.querySelector('#surfaces input[data-surface="hideShorts"]');
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    deq(patches(b), [{ surfaces: { hideShorts: true, hideReels: false, hideGrokPosts: true, hideTikTokForYou: false, hideAds: false } }]);
  });
  test('Never show @author adds to blockedAccounts[site]; the button flips to Unblock and removes again', async () => {
    const { b, document, $ } = await boot({ settings: { blockedAccounts: Object.assign(baseSettings().blockedAccounts, { x: ['@keep'] }) } });
    document.querySelector('#recent-list button[data-act="never"]').click();
    await settle();
    let p = patches(b);
    deq(p[0].blockedAccounts.youtube, ['@slopper0']);
    deq(p[0].blockedAccounts.x, ['@keep'], 'other sites preserved');
    assert.equal($('toast').hidden, false);
    assert.match($('toast').textContent, /Blocked @slopper0/);
    const btn = document.querySelector('#recent-list .recent__item[data-id="v0"] button[data-act="unblock"]');
    assert.ok(btn, 'button now offers to unblock');
    assert.equal(btn.textContent, 'Unblock @slopper0');
    btn.click();
    await settle();
    p = patches(b);
    deq(p[1].blockedAccounts.youtube, []);
    assert.ok(document.querySelector('#recent-list .recent__item[data-id="v0"] button[data-act="never"]'));
  });
  test('Show again sends showItem to the tab and drops the row; a failure shows a toast and keeps it', async () => {
    const calls = [];
    const { b, document, $ } = await boot({
      content: async (msg) => { calls.push(msg); if (msg.type === 'getRecentHidden') return { items: sampleItems(2) }; return msg.id === 'v0' ? { ok: true } : { ok: false, error: 'not found' }; }
    });
    document.querySelector('#recent-list .recent__item[data-id="v0"] button[data-act="show"]').click();
    await settle();
    deq(calls[1], { type: 'showItem', id: 'v0' });
    assert.equal(b.__log.tab[1].tabId, 7);
    assert.equal(document.querySelector('#recent-list .recent__item[data-id="v0"]'), null);
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 1);
    assert.match($('toast').textContent, /Shown again/);
    document.querySelector('#recent-list .recent__item[data-id="v1"] button[data-act="show"]').click();
    await settle();
    assert.ok(document.querySelector('#recent-list .recent__item[data-id="v1"]'), 'row kept on failure');
    assert.match($('toast').textContent, /not found/);
  });
  test('Refresh re-asks the content script', async () => {
    let n = 0;
    const { b, document, $ } = await boot({ content: async (msg) => ({ items: sampleItems(++n) }) });
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 1);
    $('recent-refresh').click();
    await settle();
    assert.equal(b.__log.tab.filter((c) => c.msg.type === 'getRecentHidden').length, 2);
    assert.equal(document.querySelectorAll('#recent-list .recent__item').length, 2);
  });
  test('settings changed elsewhere (storage.onChanged) re-render the popup', async () => {
    const { b, $, document } = await boot();
    b.storage.onChanged.__fire({ settings: { newValue: baseSettings({ enabled: false, sites: Object.assign(baseSettings().sites, { youtube: { mode: 'strict' } }) }) } });
    await settle();
    assert.equal($('master-toggle').checked, false);
    assert.equal(document.querySelector('input[name="mode"]:checked').value, 'strict');
  });
  test('a failed patch shows a toast and reloads the real settings', async () => {
    let fail = false;
    const { b, $ } = await boot({
      background: async (msg) => {
        if (msg.type === 'popupOpened' || msg.type === 'getSettings') return { settings: baseSettings(), platform: 'ios' };
        if (msg.type === 'getStats') return { stats: {} };
        if (msg.type === 'patchSettings') { if (fail) return { error: 'nope' }; return { settings: Object.assign(baseSettings(), msg.patch) }; }
        return {};
      }
    });
    fail = true;
    await ctx.inst.setEnabled(false);
    await settle();
    assert.match($('toast').textContent, /Could not save/);
    assert.equal($('master-toggle').checked, true, 'reverted to the stored value');
    assert.ok(b.__log.bg.filter((m) => m.type === 'popupOpened').length >= 2, 'settings re-pulled');
  });
});

// ------------------------------------------------------------------ accessibility / markup
describe('popup markup', () => {
  test('every interactive control is a native element with an accessible name', async () => {
    const { document } = await boot();
    const controls = [...document.querySelectorAll('button, input, a[href], [role="switch"]')];
    assert.ok(controls.length >= 10);
    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      assert.ok(['button', 'input', 'a'].includes(tag), 'native control: ' + el.outerHTML.slice(0, 60));
      const labelled = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.textContent.trim();
      assert.ok(labelled, 'has a name: ' + el.outerHTML.slice(0, 80));
    }
    assert.equal(document.querySelectorAll('[onclick]').length, 0);
    assert.equal(document.querySelector('#mode-group legend').textContent.length > 0, true);
    assert.equal(document.querySelector('#toast').getAttribute('role'), 'status');
    assert.ok(document.querySelector('meta[name="color-scheme"]'), 'dark mode declared');
  });
  test('popup.html references only files that exist and loads no modules or remote assets', async () => {
    const refs = [...POPUP_HTML.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(noslop:|https?:|#)/.test(u));
    assert.ok(refs.length >= 3);
    for (const r of refs) assert.ok(fs.existsSync(path.join(RESOURCES, 'popup', r)), 'missing ' + r);
    assert.equal(/type="module"/.test(POPUP_HTML), false);
    assert.equal(/https?:\/\//.test(POPUP_HTML.replace(/<!--[\s\S]*?-->/g, '')), false, 'no remote assets');
    const css = fs.readFileSync(path.join(RESOURCES, 'popup/popup.css'), 'utf8');
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /focus-visible/);
    const js = fs.readFileSync(path.join(RESOURCES, 'popup/popup.js'), 'utf8');
    assert.equal(/\b(import|export)\s/.test(js.replace(/\/\/.*$/gm, '')), false, 'classic script');
  });
  test('does not auto-init without an extension runtime', async () => {
    const { NoSlop } = await loadScripts(FILES, { html: POPUP_HTML });
    assert.equal(NoSlop.popup.instance, null);
    assert.equal(typeof NoSlop.popup.createPopup, 'function');
  });
});
