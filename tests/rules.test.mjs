// rules.js <-> rules.json sync, manifest sanity, and background.js / host-extension.js over a fake `browser`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// Values produced inside the jsdom vm context have another realm's prototypes; compare structurally.
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, makeFakeBrowser, RESOURCES, ROOT, settle } from './helpers/load.mjs';
import { buildRulesJs } from '../tools/build-rules.mjs';

describe('rules.js generation', () => {
  test('rules.js is in sync with rules.json (run `npm run build:rules`)', () => {
    const json = fs.readFileSync(path.join(RESOURCES, 'rules.json'), 'utf8');
    const js = fs.readFileSync(path.join(RESOURCES, 'rules.js'), 'utf8');
    assert.equal(js, buildRulesJs(json), 'rules.js differs from what build-rules.mjs generates');
  });
  test('rules.js is a classic script that defines NoSlop.rules equal to rules.json', async () => {
    const { NoSlop } = await loadScripts(['rules.js']);
    const json = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'rules.json'), 'utf8'));
    deq(NoSlop.rules, json);
    assert.equal(NoSlop.rules.version, json.version);
    assert.ok(!/\b(?:import|export)\b/.test(fs.readFileSync(path.join(RESOURCES, 'rules.js'), 'utf8').split('\n').slice(0, 5).join('\n')));
  });
  test('package.json has the build:rules script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['build:rules'], 'node tools/build-rules.mjs');
  });
  test('rules.json carries the required sections and the research label strings', () => {
    const r = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'rules.json'), 'utf8'));
    for (const k of ['version', 'scoring', 'labels', 'disclosure', 'hashtags', 'toolNames', 'chatbotResidue', 'promptMetadata', 'style', 'accounts', 'sites', 'platformActions']) assert.ok(k in r, k);
    deq(r.scoring.modes.strict, { hide: 0.8, dim: 0.4 });
    deq(r.scoring.modes.balanced, { hide: 1.0, dim: 0.6 });
    assert.equal(r.scoring.styleCap, 0.6);
    assert.ok(r.labels.tiktok.text.includes('AI-generated') && r.labels.tiktok.text.includes('Creator labeled as AI-generated'));
    assert.ok(r.labels.tiktok.jsonKeys.includes('aigcLabelType') && r.labels.tiktok.selectors.includes('[data-e2e="aigc-tag"]'));
    deq(r.labels.youtube.badgeText, ['AI']);
    assert.ok(r.labels.youtube.watchSection.includes('how-this-was-made-section-view-model'));
    for (const s of ['AI info', 'Imagined with AI', 'AI-generated profile']) assert.ok(r.labels.instagram.text.includes(s), s);
    assert.ok(r.labels.facebook.text.includes('AI info'));
    assert.ok(r.labels.x.text.includes('Made with AI') && r.labels.x.grokHref === '/i/grok/share/');
    for (const site of ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin']) assert.ok(r.sites[site] && r.sites[site].hideStrategy, site);
    assert.ok(r.sites.youtube.desktop.item.includes('ytd-rich-item-renderer') && r.sites.youtube.mobile.item.includes('ytm-rich-item-renderer'));
    assert.equal(r.sites.x.cell, '[data-testid="cellInnerDiv"]');
    assert.equal(r.sites.x.article, 'article[data-testid="tweet"]');
    assert.equal(r.sites.reddit.post, 'shreddit-post');
    assert.ok(r.accounts.reddit.subreddits.length >= 200);
    assert.ok(r.platformActions.xMutedWords.length && r.platformActions.instagramHiddenWords.length);
  });
});

describe('manifest.json', () => {
  test('MV3 Safari manifest with the §2 script order, css, permissions and action', () => {
    const m = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'manifest.json'), 'utf8'));
    assert.equal(m.manifest_version, 3);
    deq(m.background, { scripts: ['background.js'], persistent: false });
    assert.equal(m.content_scripts.length, 1);
    const cs = m.content_scripts[0];
    deq(cs.js, ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js', 'adapters/youtube.js', 'adapters/x.js', 'adapters/instagram.js', 'adapters/facebook.js', 'adapters/tiktok.js', 'adapters/reddit.js', 'adapters/linkedin.js', 'content.js']);
    deq(cs.css, ['content.css']);
    assert.equal(cs.run_at, 'document_start'); assert.equal(cs.all_frames, false);
    for (const h of ['youtube', 'x', 'twitter', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin']) {
      assert.ok(cs.matches.includes(`*://*.${h}.com/*`), h);
      assert.ok(m.host_permissions.includes(`*://*.${h}.com/*`), h);
    }
    deq(m.permissions, ['storage', 'unlimitedStorage', 'nativeMessaging', 'alarms']);
    assert.equal(m.action.default_popup, 'popup/popup.html');
    assert.ok(m.action.default_icon['48']);
    assert.equal(m.browser_specific_settings.safari.strict_min_version, '17.0');
    for (const f of [...cs.js, ...cs.css, ...m.background.scripts, ...Object.values(m.icons)]) assert.ok(fs.existsSync(path.join(RESOURCES, f)), 'missing ' + f);
  });
  test('every extension script is a classic script (no import/export) that parses', () => {
    const m = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'manifest.json'), 'utf8'));
    for (const f of [...m.content_scripts[0].js, 'background.js', 'adapters/_template.js']) {
      const src = fs.readFileSync(path.join(RESOURCES, f), 'utf8');
      assert.ok(!/^\s*(?:import|export)\b/m.test(src), f + ' uses modules');
      assert.doesNotThrow(() => new Function(src), f);
    }
  });
});

describe('background.js', () => {
  async function bg(opts = {}) {
    const browser = makeFakeBrowser(Object.assign({ alarms: true }, opts));
    const c = await loadScripts(['background.js'], { browser });
    await c.NoSlop.bg.startupPromise;
    return Object.assign(c, { browser });
  }
  test('defaults match host-extension.js defaults and settings are migrated on load', async () => {
    const c = await bg();
    const h = await loadScripts(['lib/host-extension.js']);
    deq(c.NoSlop.bg.defaultSettings(), h.NoSlop.defaultSettings());
    const s = c.NoSlop.bg.settings;
    assert.equal(s.version, 1); deq(s.sites.tiktok, { mode: 'balanced' });
    await c.browser.storage.local.set({ settings: { enabled: false, sites: { x: { mode: 'strict' } }, blockedAccounts: { x: 'bad' } } });
    const m = await c.NoSlop.bg.loadSettings();
    assert.equal(m.enabled, false); assert.equal(m.sites.x.mode, 'strict'); assert.equal(m.sites.youtube.mode, 'balanced');
    deq(m.blockedAccounts.x, []); assert.equal(m.version, 1);
  });
  test('onMessage: getSettings / patchSettings (updatedAt bumps, pushes to native) / ping / unknown', async () => {
    const native = [];
    const c = await bg({ native: (msg) => { native.push(msg); return msg.type === 'ping' ? { ok: true, version: '1', platform: 'macos' } : { ok: true }; } });
    const send = (m) => c.browser.runtime.sendMessage(m);
    const got = await send({ type: 'getSettings' });
    assert.equal(got.settings.enabled, true);
    const before = Date.now();
    const p = await send({ type: 'patchSettings', patch: { showStubs: false } });
    assert.equal(p.settings.showStubs, false); assert.ok(p.settings.updatedAt >= before);
    assert.equal((await c.browser.storage.local.get('settings')).settings.showStubs, false);
    await settle();
    assert.ok(native.some((m) => m.type === 'putSharedSettings' && m.settings.showStubs === false), 'pushed to native');
    const ping = await send({ type: 'ping' });
    assert.equal(ping.ok, true); assert.equal(ping.platform, 'macos');
    assert.match((await send({ type: 'nope' })).error, /unknown/);
  });
  test('native bridge absent (Chrome): everything still works', async () => {
    const browser = makeFakeBrowser();
    delete browser.runtime.sendNativeMessage;
    const c = await loadScripts(['background.js'], { browser });
    await c.NoSlop.bg.startupPromise;
    assert.equal(await c.NoSlop.bg.native({ type: 'ping' }), null);
    const r = await browser.runtime.sendMessage({ type: 'patchSettings', patch: { showStubs: false } });
    assert.equal(r.settings.showStubs, false);
    assert.equal((await browser.runtime.sendMessage({ type: 'popupOpened' })).settings.showStubs, false);
  });
  test('shared settings: pulled on startup and on popupOpened with last-writer-wins', async () => {
    let shared = { settings: JSON.stringify({ version: 1, showStubs: false, updatedAt: 5000 }) };
    const native = [];
    const c = await bg({ native: (msg) => { native.push(msg); if (msg.type === 'getSharedSettings') return shared; return { ok: true }; } });
    assert.equal(c.NoSlop.bg.settings.showStubs, false, 'newer shared settings adopted on startup');
    assert.equal(c.NoSlop.bg.settings.updatedAt, 5000);
    assert.ok(!native.some((m) => m.type === 'putSharedSettings'), 'no echo back');
    // local change is newer -> popupOpened pushes local instead of pulling
    const p = await c.browser.runtime.sendMessage({ type: 'patchSettings', patch: { showStubs: true } });
    shared = { settings: { version: 1, showStubs: false, updatedAt: 5000 } };
    const r = await c.browser.runtime.sendMessage({ type: 'popupOpened' });
    assert.equal(r.settings.showStubs, true);
    assert.ok(native.some((m) => m.type === 'putSharedSettings' && m.settings.updatedAt === p.settings.updatedAt));
    // a newer native write wins on the next popup open
    shared = { settings: { version: 1, showStubs: false, updatedAt: p.settings.updatedAt + 10 } };
    const r2 = await c.browser.runtime.sendMessage({ type: 'popupOpened' });
    assert.equal(r2.settings.showStubs, false);
  });
  test('reportStats merges into stats[day][site] and flushes the pending delta to native on the alarm', async () => {
    const native = [];
    const c = await bg({ native: (msg) => { native.push(msg); return { ok: true }; } });
    await c.browser.runtime.sendMessage({ type: 'reportStats', events: [
      { type: 'stats', site: 'youtube', action: 'hide', reason: 'label:youtube_badge', count: 2 },
      { type: 'stats', site: 'youtube', action: 'dim', reason: 'style:contrast_pivot' },
      { type: 'stats', site: 'x', action: 'hide', reason: 'hashtag:#aiart' }
    ] });
    const { stats } = await c.browser.runtime.sendMessage({ type: 'getStats' });
    const day = Object.keys(stats)[0];
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    deq(stats[day].youtube, { hide: 2, dim: 1, reasons: { 'label:youtube_badge': 2, 'style:contrast_pivot': 1 } });
    deq(stats[day].x, { hide: 1, dim: 0, reasons: { 'hashtag:#aiart': 1 } });
    assert.ok(c.browser.alarms.__alarms.has('noslop-flush-stats'));
    c.browser.alarms.__fire('noslop-flush-stats');
    await settle(5);
    const rec = native.find((m) => m.type === 'recordStats');
    assert.ok(rec); assert.equal(rec.stats[day].youtube.hide, 2);
    deq((await c.browser.storage.local.get('noslop:statsPending'))['noslop:statsPending'], {}, 'pending delta cleared after ack');
  });
  test('falls back to setInterval when alarms are missing', async () => {
    const browser = makeFakeBrowser({ alarms: false });
    const c = await loadScripts(['background.js'], { browser });
    await c.NoSlop.bg.startupPromise;
    assert.equal(browser.alarms, undefined);
    assert.equal(typeof c.NoSlop.bg.flushStatsToNative, 'function');
  });
  test('fetchText: https + youtube/tiktok hosts only, same-site as the sender, 10 s timeout', async () => {
    const c = await bg();
    const calls = [];
    c.window.fetch = async (url, init) => { calls.push({ url, init }); if (/hang/.test(url)) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))); return { ok: true, status: 200, text: async () => '<html>ok</html>' }; };
    const ok = await c.browser.runtime.sendMessage({ type: 'fetchText', url: 'https://www.youtube.com/watch?v=abc', timeout: 500 });
    deq(ok, { ok: true, text: '<html>ok</html>' });
    assert.equal(calls[0].init.credentials, 'include');
    for (const bad of ['http://www.youtube.com/', 'https://evil.com/', 'https://youtube.com.evil.com/', 'not a url']) {
      const r = await c.browser.runtime.sendMessage({ type: 'fetchText', url: bad });
      assert.equal(r.ok, false, bad);
    }
    const cross = await c.NoSlop.bg.fetchText('https://www.tiktok.com/x', 1000, { url: 'https://www.youtube.com/' }).catch((e) => e.message);
    assert.match(cross, /cross-site/);
    const t0 = Date.now();
    const to = await c.browser.runtime.sendMessage({ type: 'fetchText', url: 'https://www.youtube.com/hang', timeout: 1000 });
    assert.equal(to.ok, false); assert.ok(Date.now() - t0 >= 900 && Date.now() - t0 < 5000);
  });
  test('storage.onChanged from another writer pushes to native', async () => {
    const native = [];
    const c = await bg({ native: (msg) => { native.push(msg); return { ok: true }; } });
    await c.browser.storage.local.set({ settings: Object.assign(c.NoSlop.bg.defaultSettings(), { updatedAt: 777, showStubs: false }) });
    await settle();
    assert.ok(native.some((m) => m.type === 'putSharedSettings' && m.settings.updatedAt === 777));
    assert.equal(c.NoSlop.bg.settings.showStubs, false);
  });
  test('background.js has no DOM/window references (service-worker safe)', () => {
    const src = fs.readFileSync(path.join(RESOURCES, 'background.js'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bdocument\b|\bwindow\b|\blocalStorage\b/.test(src));
  });
});

describe('host-extension.js over the runtime', () => {
  test('talks to background.js through runtime.sendMessage and storage.onChanged in the same context', async () => {
    const browser = makeFakeBrowser({ native: () => ({ ok: true }) });
    const c = await loadScripts(['background.js', 'lib/host-extension.js'], { browser });
    await c.NoSlop.bg.startupPromise;
    const host = c.NoSlop.host;
    assert.equal(host.__memory, false);
    const s = await host.getSettings();
    assert.equal(s.sites.youtube.mode, 'balanced');
    let changed = null; const off = host.onSettingsChanged((n) => { changed = n; });
    const p = await host.patchSettings({ dimInsteadOfHide: true });
    assert.equal(p.dimInsteadOfHide, true);
    await settle();
    assert.equal(changed.dimInsteadOfHide, true);
    off();
    await host.storageSet({ 'verdicts:youtube': [['a', 1]] });
    deq(await host.storageGet('verdicts:youtube'), { 'verdicts:youtube': [['a', 1]] });
    assert.ok(browser.__data.has('noslop:verdicts:youtube'), 'namespaced key');
    c.window.fetch = async () => ({ ok: true, status: 200, text: async () => 'page' });
    assert.equal(await host.fetchText('https://www.youtube.com/watch?v=1', { timeout: 2000 }), 'page');
    await assert.rejects(host.fetchText('https://evil.com/'));
    host.report({ type: 'stats', site: 'youtube', action: 'hide', reason: 'label:youtube_badge', count: 3 });
    host.report({ type: 'stats', site: 'youtube', action: 'dim', reason: 'style:closer' });
    await host.flush();
    const { stats } = await browser.runtime.sendMessage({ type: 'getStats' });
    const day = Object.keys(stats)[0];
    assert.equal(stats[day].youtube.hide, 3); assert.equal(stats[day].youtube.dim, 1);
  });
  test('falls back to storage when the background is unreachable', async () => {
    const browser = makeFakeBrowser();
    const c = await loadScripts(['lib/host-extension.js'], { browser });
    const s = await c.NoSlop.host.getSettings();
    assert.equal(s.version, 1);
    const p = await c.NoSlop.host.patchSettings({ showStubs: false });
    assert.equal(p.showStubs, false);
    assert.equal((await browser.storage.local.get('settings')).settings.showStubs, false);
  });
});
