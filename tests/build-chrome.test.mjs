// tools/build-chrome.mjs — Extension/Resources -> dist/chrome (docs/DESIGN.md §9).
// Covers: manifest rewrite, sw.js shell, idempotent polyfill, reference validation, CLI exit codes,
// and that the polyfilled content scripts + the service worker actually run with only `chrome` defined.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { loadScripts, makeFakeBrowser, RESOURCES, ROOT } from './helpers/load.mjs';
import {
  buildChrome, rewriteManifest, referencedFiles, validateOutput, addPolyfill, hasPolyfill, swSource,
  POLYFILL, POLYFILL_LINE, POLYFILL_MARK, SW_FILE, MIN_CHROME, DEFAULT_SRC, DEFAULT_OUT
} from '../tools/build-chrome.mjs';

const TOOL = path.join(ROOT, 'tools/build-chrome.mjs');
const tmpRoots = [];
function tmpdir(name = 'noslop-chrome-') { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); tmpRoots.push(d); return d; }
after(() => { for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true }); });

function write(dir, rel, text) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')));

// A minimal SYNTHETIC Safari-shaped extension folder (same manifest shape as Extension/Resources/manifest.json).
function syntheticSource(overrides = {}) {
  const src = tmpdir('noslop-chrome-src-');
  const manifest = {
    manifest_version: 3, name: 'NoSlop', version: '0.1.0', description: 'synthetic',
    icons: { 48: 'images/icon-48.png', 128: 'images/icon-128.png' },
    background: { scripts: ['background.js'], persistent: false },
    content_scripts: [{
      matches: ['*://*.youtube.com/*'],
      js: ['rules.js', 'lib/dom.js', 'content.js'], css: ['content.css'], run_at: 'document_start', all_frames: false
    }],
    permissions: ['storage', 'nativeMessaging', 'alarms'],
    host_permissions: ['*://*.youtube.com/*'],
    action: { default_popup: 'popup/popup.html', default_title: 'NoSlop', default_icon: { 48: 'images/icon-48.png' } },
    browser_specific_settings: { safari: { strict_min_version: '17.0' } },
    ...overrides
  };
  write(src, 'manifest.json', JSON.stringify(manifest, null, 2));
  write(src, 'images/icon-48.png', 'png');
  write(src, 'images/icon-128.png', 'png');
  write(src, 'background.js', "(function(){ 'use strict'; const b = typeof browser !== 'undefined' ? browser : chrome; b.runtime.onMessage.addListener(() => {}); })();\n");
  write(src, 'rules.js', 'globalThis.NoSlop = globalThis.NoSlop || {};\nNoSlop.rules = { version: "synthetic" };\n');
  write(src, 'lib/dom.js', "'use strict';\n// strict-mode file\nglobalThis.NoSlop.dom = { ok: true, browserIsChrome: () => globalThis.browser === globalThis.chrome };\n");
  write(src, 'content.js', '// bootstrap\n(function(){ globalThis.NoSlop.started = typeof browser; })();\n');
  write(src, 'content.css', '.noslop-dim{opacity:.5}\n');
  write(src, 'popup/popup.html', '<!doctype html><script src="popup.js"></script>');
  write(src, 'popup/popup.js', "(function(){ 'use strict'; globalThis.__popupBrowser = browser; })();\n");
  write(src, '.DS_Store', 'junk');
  return src;
}

// Run sw.js the way Chrome would: a worker-ish global with `chrome` and `importScripts`, no `browser`.
function runServiceWorker(out, fake) {
  const sandbox = { chrome: fake, console, setTimeout, clearTimeout, setInterval, clearInterval };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const f of files) vm.runInContext(read(out, f), ctx, { filename: path.join(out, f) });
  };
  vm.runInContext(read(out, SW_FILE), ctx, { filename: path.join(out, SW_FILE) });
  return sandbox;
}

describe('package.json', () => {
  test('has the build:chrome script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['build:chrome'], 'node tools/build-chrome.mjs');
  });
  test('defaults point at Extension/Resources and dist/chrome', () => {
    assert.equal(DEFAULT_SRC, RESOURCES);
    assert.equal(DEFAULT_OUT, path.join(ROOT, 'dist/chrome'));
  });
});

describe('polyfill', () => {
  test('is exactly the DESIGN.md §9 line, marked, one line', () => {
    assert.equal(POLYFILL_LINE, 'globalThis.browser ??= chrome;');
    assert.ok(POLYFILL.includes(POLYFILL_MARK) && POLYFILL.includes(POLYFILL_LINE));
    assert.equal(POLYFILL.split('\n').length, 2); // one line + trailing newline
  });
  test('prepends to a plain script and is idempotent', () => {
    const src = '// hello\n(function(){})();\n';
    const once = addPolyfill(src);
    assert.ok(once.startsWith(POLYFILL), once.slice(0, 80));
    assert.equal(once.slice(POLYFILL.length), src, 'original text untouched after the polyfill');
    assert.equal(addPolyfill(once), once, 'second application is a no-op');
    assert.ok(hasPolyfill(once) && !hasPolyfill(src));
  });
  test('keeps a top-level "use strict" directive in prologue position', () => {
    for (const head of ["'use strict';\n", '"use strict";\n', "'use strict'\n", "// c\n/* d */\n'use strict';\n"]) {
      const src = head + 'var x = 1;\n';
      const out = addPolyfill(src);
      const idx = out.indexOf(POLYFILL_LINE);
      assert.ok(idx > out.indexOf('use strict'), `polyfill after the directive: ${JSON.stringify(out)}`);
      assert.ok(out.endsWith('var x = 1;\n'));
      assert.equal(addPolyfill(out), out);
      // Still a valid script whose directive still applies (assignment to undeclared var throws in strict mode).
      const g = { chrome: { id: 1 } }; g.globalThis = g;
      vm.runInContext(out, vm.createContext(g));
      assert.equal(g.browser, g.chrome);
    }
  });
  test('an IIFE-internal "use strict" (the repo style) is not a prologue; polyfill goes first', () => {
    const src = "(function () {\n  'use strict';\n})();\n";
    assert.ok(addPolyfill(src).startsWith(POLYFILL));
  });
  test('polyfilled text is valid JS and sets browser only when missing', () => {
    const code = addPolyfill('globalThis.after = typeof browser;\n');
    const a = { chrome: { tag: 'chrome' } }; a.globalThis = a;
    vm.runInContext(code, vm.createContext(a));
    assert.equal(a.browser, a.chrome); assert.equal(a.after, 'object');
    const b = { chrome: { tag: 'chrome' }, browser: { tag: 'browser' } }; b.globalThis = b;
    vm.runInContext(code, vm.createContext(b));
    assert.equal(b.browser.tag, 'browser', 'an existing browser global is never overwritten');
  });
});

describe('rewriteManifest', () => {
  const src = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'manifest.json'), 'utf8'));
  test('background.scripts -> service_worker sw.js; content_scripts untouched; safari block dropped', () => {
    const { manifest: m, backgroundScripts } = rewriteManifest(src);
    assert.deepEqual(m.background, { service_worker: SW_FILE });
    assert.deepEqual(backgroundScripts, src.background.scripts);
    assert.deepEqual(m.content_scripts, src.content_scripts);
    assert.ok(!('browser_specific_settings' in m));
    assert.ok(!('browser_action' in m));
    assert.equal(m.manifest_version, 3);
    assert.equal(m.minimum_chrome_version, MIN_CHROME);
    assert.deepEqual(m.icons, src.icons);
    assert.equal(m.action.default_popup, 'popup/popup.html');
    assert.ok(m.action.default_icon && Object.keys(m.action.default_icon).length);
    assert.ok(!m.permissions.includes('nativeMessaging'), 'no native host in Chrome');
    assert.ok(m.permissions.includes('storage') && m.permissions.includes('alarms'));
    assert.deepEqual(m.host_permissions, src.host_permissions);
    assert.deepEqual(src.background, { scripts: ['background.js'], persistent: false }, 'input not mutated');
  });
  test('ensures action + icons when the source lacks them', () => {
    const bare = { ...src }; delete bare.action; delete bare.icons;
    const { manifest: m } = rewriteManifest(bare);
    assert.equal(m.action.default_popup, 'popup/popup.html');
    assert.equal(m.action.default_title, 'NoSlop');
    assert.deepEqual(m.action.default_icon, { 48: 'images/icon-48.png', 96: 'images/icon-96.png', 128: 'images/icon-128.png' });
    assert.ok(Object.keys(m.icons).length >= 3);
  });
  test('rejects MV2 and manifests without content_scripts', () => {
    assert.throws(() => rewriteManifest({ ...src, manifest_version: 2 }), /manifest_version/);
    assert.throws(() => rewriteManifest({ ...src, content_scripts: [] }), /content_scripts/);
  });
  test('a manifest that is already a service_worker one is normalised to sw.js importing it', () => {
    const { manifest: m, backgroundScripts } = rewriteManifest({ ...src, background: { service_worker: 'background.js' } });
    assert.deepEqual(m.background, { service_worker: SW_FILE });
    assert.deepEqual(backgroundScripts, ['background.js']);
    const again = rewriteManifest(m);
    assert.deepEqual(again.backgroundScripts, ['background.js'], 'does not import sw.js from itself');
  });
  test('swSource polyfills BEFORE importScripts of every background script', () => {
    const s = swSource(['a.js', 'b.js']);
    assert.ok(s.indexOf(POLYFILL_LINE) < s.indexOf('importScripts'));
    assert.ok(s.includes('importScripts("a.js", "b.js");'));
  });
});

describe('referencedFiles / validateOutput', () => {
  test('collects every file path a Chrome manifest can point at', () => {
    const refs = referencedFiles({
      icons: { 16: 'i16.png' }, background: { service_worker: 'sw.js' },
      content_scripts: [{ js: ['a.js', './b.js'], css: ['c.css'] }],
      action: { default_popup: 'popup/p.html', default_icon: { 16: 'i16.png', 32: 'i32.png' } },
      options_ui: { page: 'options.html' }, side_panel: { default_path: 'panel.html' },
      web_accessible_resources: [{ resources: ['wa.js', 'img/*.png'], matches: ['<all_urls>'] }],
      declarative_net_request: { rule_resources: [{ id: 'r', enabled: true, path: 'rules/dnr.json' }] },
      default_locale: 'en'
    });
    assert.deepEqual(refs, ['_locales/en/messages.json', 'a.js', 'b.js', 'c.css', 'i16.png', 'i32.png', 'options.html', 'panel.html', 'popup/p.html', 'rules/dnr.json', 'sw.js', 'wa.js']);
  });
  test('flags a missing referenced file, surviving safari block and unpolyfilled content script', () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    buildChrome({ src, out });
    assert.ok(validateOutput(out).ok);
    fs.unlinkSync(path.join(out, 'images/icon-128.png'));
    let v = validateOutput(out);
    assert.ok(!v.ok && v.problems.some((p) => p.includes('referenced file missing: images/icon-128.png')), v.problems.join('; '));
    write(out, 'images/icon-128.png', 'png');
    write(out, 'content.js', '// stripped\n');
    v = validateOutput(out);
    assert.ok(v.problems.some((p) => p.includes('content script without polyfill: content.js')));
    const m = JSON.parse(read(out, 'manifest.json'));
    m.browser_specific_settings = { safari: {} };
    write(out, 'manifest.json', JSON.stringify(m));
    assert.ok(validateOutput(out).problems.some((p) => /browser_specific_settings/.test(p)));
    write(out, 'manifest.json', '{ not json');
    v = validateOutput(out);
    assert.ok(!v.ok && /not valid JSON/.test(v.problems[0]));
  });
});

describe('buildChrome on a synthetic source tree', () => {
  test('copies, rewrites, polyfills content scripts + popup js, writes sw.js, validates', () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    const r = buildChrome({ src, out });
    assert.ok(r.ok && r.problems.length === 0);
    assert.ok(!exists(out, '.DS_Store'));
    for (const f of ['manifest.json', SW_FILE, 'background.js', 'rules.js', 'lib/dom.js', 'content.js', 'content.css', 'popup/popup.html', 'popup/popup.js', 'images/icon-48.png']) assert.ok(exists(out, f), f);
    assert.deepEqual(r.polyfilled, ['content.js', 'lib/dom.js', 'popup/popup.js', 'rules.js']);
    assert.ok(!hasPolyfill(read(out, 'background.js')), 'background.js is left alone; sw.js sets browser before importScripts');
    assert.equal(read(out, 'content.css'), read(src, 'content.css'));
    assert.equal(read(out, 'popup/popup.html'), read(src, 'popup/popup.html'));
    const m = JSON.parse(read(out, 'manifest.json'));
    assert.deepEqual(m.background, { service_worker: SW_FILE });
    assert.ok(!('browser_specific_settings' in m));
    assert.deepEqual(m.content_scripts, JSON.parse(read(src, 'manifest.json')).content_scripts);
    assert.equal(read(out, SW_FILE), swSource(['background.js']));
    // the source tree is untouched
    assert.ok(!hasPolyfill(read(src, 'content.js')) && !exists(src, SW_FILE));
    assert.ok('browser_specific_settings' in JSON.parse(read(src, 'manifest.json')));
  });
  test('is deterministic and idempotent: rebuild gives identical bytes, polyfill never doubles', () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    buildChrome({ src, out });
    const snap = (d) => Object.fromEntries(['manifest.json', SW_FILE, 'content.js', 'lib/dom.js', 'popup/popup.js', 'rules.js'].map((f) => [f, read(d, f)]));
    const first = snap(out);
    buildChrome({ src, out });
    assert.deepEqual(snap(out), first);
    for (const [f, text] of Object.entries(first)) if (f !== 'manifest.json') assert.equal(text.split(POLYFILL_LINE).length <= 2, true, `${f} has at most one polyfill`);
    // Building FROM a built tree (someone points --src at dist) does not double the polyfill either.
    const out2 = tmpdir('noslop-chrome-out2-');
    buildChrome({ src: out, out: out2 });
    for (const f of ['content.js', 'lib/dom.js', 'popup/popup.js', 'rules.js']) assert.equal(read(out2, f), first[f]);
    assert.equal(read(out2, SW_FILE), first[SW_FILE]);
  });
  test('the polyfilled content scripts run with only `chrome` defined (no `browser`)', async () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    buildChrome({ src, out });
    const fake = makeFakeBrowser();
    // Use the loader's own path form (absolute) so the scripts run inside the jsdom context.
    const { NoSlop: NS, window: w2 } = await loadScripts(
      ['rules.js', 'lib/dom.js', 'content.js'].map((f) => path.join(out, f)),
      { beforeScripts: (w) => { w.chrome = fake; } }
    );
    assert.equal(w2.browser, fake, 'polyfill made browser === chrome');
    assert.equal(NS.rules.version, 'synthetic');
    assert.ok(NS.dom.browserIsChrome());
    assert.equal(NS.started, 'object');
  });
  test('sw.js sets browser then importScripts background.js, which registers its listeners', () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    buildChrome({ src, out });
    const listeners = [];
    const fake = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
    const g = runServiceWorker(out, fake);
    assert.equal(g.browser, fake);
    assert.equal(listeners.length, 1);
  });
  test('fails loudly when the manifest references a file that does not exist', () => {
    const src = syntheticSource();
    fs.unlinkSync(path.join(src, 'popup/popup.html'));
    const out = tmpdir('noslop-chrome-out-');
    assert.throws(() => buildChrome({ src, out }), /referenced file missing: popup\/popup\.html/);
  });
  test('fails on a source manifest that is not JSON, and refuses out === src', () => {
    const src = syntheticSource();
    write(src, 'manifest.json', '{ nope');
    assert.throws(() => buildChrome({ src, out: tmpdir('noslop-chrome-out-') }), /JSON/);
    const ok = syntheticSource();
    assert.throws(() => buildChrome({ src: ok, out: ok }), /output folder/);
    assert.throws(() => buildChrome({ src: tmpdir('noslop-chrome-empty-'), out: tmpdir('noslop-chrome-out-') }), /no manifest\.json/);
  });
});

describe('CLI', () => {
  test('exit 0 with a summary on success, exit 1 with the problem list on failure', () => {
    const src = syntheticSource();
    const out = tmpdir('noslop-chrome-out-');
    let r = spawnSync(process.execPath, [TOOL, '--src', src, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /files copied/);
    assert.match(r.stdout, /OK/);
    assert.ok(exists(out, SW_FILE));
    fs.unlinkSync(path.join(src, 'images/icon-48.png'));
    r = spawnSync(process.execPath, [TOOL, `--src=${src}`, `--out=${out}`, '--quiet'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /referenced file missing: images\/icon-48\.png/);
    r = spawnSync(process.execPath, [TOOL, '--bogus'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});

describe('the real Extension/Resources tree', () => {
  const popupPresent = fs.existsSync(path.join(RESOURCES, 'popup/popup.html'));
  test('builds into a temp dir and every manifest reference resolves', { skip: popupPresent ? false : 'popup/popup.html not landed yet (popup agent); build correctly refuses' }, async () => {
    const out = tmpdir('noslop-chrome-real-');
    const r = buildChrome({ src: RESOURCES, out });
    assert.ok(r.ok, r.problems.join('; '));
    const srcManifest = JSON.parse(fs.readFileSync(path.join(RESOURCES, 'manifest.json'), 'utf8'));
    const m = JSON.parse(read(out, 'manifest.json'));
    assert.deepEqual(m.content_scripts, srcManifest.content_scripts);
    assert.deepEqual(m.background, { service_worker: SW_FILE });
    const allJs = srcManifest.content_scripts.flatMap((c) => c.js);
    for (const f of allJs) assert.ok(hasPolyfill(read(out, f)), `${f} polyfilled`);
    assert.ok(allJs.every((f) => r.polyfilled.includes(f)));
    assert.ok(!hasPolyfill(read(out, 'background.js')));
    // Every JS file in the output parses as a classic script.
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    for (const f of walk(out)) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }), f);
    // Content scripts boot on a youtube page with only `chrome` present (the Chrome world).
    const fake = makeFakeBrowser({ senderUrl: 'https://www.youtube.com/' });
    const { window, NoSlop } = await loadScripts(allJs.map((f) => path.join(out, f)), { url: 'https://www.youtube.com/', beforeScripts: (w) => { w.chrome = fake; } });
    assert.equal(window.browser, fake);
    assert.ok(NoSlop && NoSlop.rules && NoSlop.engine && NoSlop.host && NoSlop.adapters, 'namespace assembled');
    assert.ok(window.__noslopStarted, 'content.js started the engine');
    // The service worker shell loads the real background.js and registers a message listener.
    const swFake = makeFakeBrowser({ alarms: true });
    const g = runServiceWorker(out, swFake);
    assert.equal(g.browser, swFake);
    // A round-trip through the fake runtime proves background.js registered an onMessage listener.
    const res = await swFake.runtime.sendMessage({ type: 'getSettings' }).catch((e) => ({ error: e.message }));
    assert.ok(!(res && res.error === 'no onMessage listener'), `background.js registered no onMessage listener: ${JSON.stringify(res)}`);
  });
  test('without popup/popup.html the build refuses (documents the popup-agent dependency)', { skip: popupPresent ? 'popup present' : false }, () => {
    assert.throws(() => buildChrome({ src: RESOURCES, out: tmpdir('noslop-chrome-real-') }), /referenced file missing: popup\/popup\.html/);
  });
});
