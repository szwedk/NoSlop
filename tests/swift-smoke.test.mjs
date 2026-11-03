// Smoke tests for the swift-app agent's files: project spec, entitlements, scripts, and the
// Clean Feeds host shim (lib/host-webview.js) against a fake window.webkit bridge.
// No Xcode needed; the real builds are exercised by scripts/test.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync, readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('project.yml: four targets, app group on every target, Debug-only clean-feeds flag, WebExtension folder reference', () => {
  const yml = read('project.yml');
  for (const t of ['NoSlop-iOS:', 'NoSlop-Extension-iOS:', 'NoSlop-macOS:', 'NoSlop-Extension-macOS:']) assert.ok(yml.includes(t), t);
  assert.equal((yml.match(/com\.apple\.security\.application-groups/g) || []).length, 4);
  assert.equal((yml.match(/-D NOSLOP_CLEAN_FEEDS/g) || []).length, 2, 'flag only on the two app targets');
  assert.ok(!/Extension-\w+:[\s\S]*?NOSLOP_CLEAN_FEEDS/.test(yml.split('NoSlop-macOS:')[0].split('NoSlop-Extension-iOS:')[1] || ''), 'extension target has no clean-feeds flag');
  assert.equal((yml.match(/path: App\/WebExtension\n\s+type: folder/g) || []).length, 2);
  assert.equal(readlinkSync(path.join(root, 'App/WebExtension')), '../Extension/Resources');
});

test('entitlements files carry the app group (iOS: group.*, macOS: team-prefixed)', () => {
  assert.ok(read('App/iOS/NoSlop.entitlements').includes('<string>group.com.szwedk.noslop</string>'));
  assert.ok(read('Extension/iOS/NoSlop-Extension.entitlements').includes('<string>group.com.szwedk.noslop</string>'));
  assert.ok(read('App/macOS/NoSlop.entitlements').includes('<string>5DDNFER638.group.com.szwedk.noslop</string>'));
  assert.ok(read('Extension/macOS/NoSlop-Extension.entitlements').includes('<string>5DDNFER638.group.com.szwedk.noslop</string>'));
  assert.ok(read('App/macOS/NoSlop.entitlements').includes('com.apple.security.app-sandbox'));
  assert.ok(!read('App/iOS/NoSlop-NoAppGroup.entitlements').includes('application-groups'));
});

test('app icon set has the iOS 1024 and the ten macOS sizes', () => {
  const c = JSON.parse(read('App/Shared/Assets.xcassets/AppIcon.appiconset/Contents.json'));
  assert.equal(c.images.length, 11);
  for (const img of c.images) assert.ok(existsSync(path.join(root, 'App/Shared/Assets.xcassets/AppIcon.appiconset', img.filename)), img.filename);
  assert.ok(c.images.some((i) => i.platform === 'ios' && i.size === '1024x1024'));
});

test('scripts are executable and use the verified signing recipes', () => {
  for (const s of ['build-mac.sh', 'build-ios.sh', 'install-iphone.sh', 'test.sh']) {
    assert.ok(statSync(path.join(root, 'scripts', s)).mode & 0o111, `${s} executable`);
  }
  const mac = read('scripts/build-mac.sh');
  assert.ok(mac.includes('CODE_SIGN_STYLE=Manual') && mac.includes('PROVISIONING_PROFILE_SPECIFIER=""'));
  const ios = read('scripts/build-ios.sh');
  assert.ok(ios.includes('generic/platform=iOS') && ios.includes('-allowProvisioningUpdates') && ios.includes('83Z56LMU9Y'));
  assert.ok(read('scripts/install-iphone.sh').includes('devicectl device install app'));
});

test('native handler implements the §7 message types', () => {
  const swift = read('Extension/Shared/SafariWebExtensionHandler.swift');
  for (const t of ['"ping"', '"getSharedSettings"', '"putSharedSettings"', '"recordStats"', '"classify"']) assert.ok(swift.includes(t), t);
  assert.ok(swift.includes('"platform": platform'));
});

function loadHostShim({ bridge }) {
  const sandbox = { console, setTimeout, clearTimeout, navigator: { userAgent: 'test' } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.document = { addEventListener() {}, hidden: false };
  sandbox.addEventListener = () => {};
  if (bridge) sandbox.webkit = { messageHandlers: { noslop: bridge } };
  vm.createContext(sandbox);
  vm.runInContext(read('Extension/Resources/lib/host-webview.js'), sandbox, { filename: 'host-webview.js' });
  return sandbox.NoSlop;
}

test('host-webview.js exposes the §6 host over the webkit bridge', async () => {
  const sent = [];
  const settings = { enabled: true, updatedAt: 1, sites: { youtube: { mode: 'balanced' } } };
  const bridge = {
    postMessage: async (msg) => {
      sent.push(msg);
      switch (msg.type) {
        case 'getSettings': return settings;
        case 'patchSettings': return { ...settings, ...msg.partial, updatedAt: 2 };
        case 'fetchText': return '<html>ok</html>';
        case 'storageGet': return { verdicts: { a: 1 } };
        case 'storageSet': return { ok: true };
        case 'report': return { ok: true, count: msg.events.length };
        default: throw new Error('unknown ' + msg.type);
      }
    },
  };
  const NoSlop = loadHostShim({ bridge });
  const host = NoSlop.host;
  for (const fn of ['getSettings', 'onSettingsChanged', 'patchSettings', 'storageGet', 'storageSet', 'fetchText', 'report']) {
    assert.equal(typeof host[fn], 'function', fn);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(await host.getSettings())), settings);
  const seen = [];
  host.onSettingsChanged((s) => seen.push(s));
  const patched = await host.patchSettings({ enabled: false });
  assert.equal(patched.enabled, false);
  assert.equal(seen.length, 1, 'listener fired on patch');
  assert.equal(await host.fetchText('https://example.com', { timeout: 500 }), '<html>ok</html>');
  assert.equal(sent.find((m) => m.type === 'fetchText').timeout, 500);
  assert.deepEqual(JSON.parse(JSON.stringify(await host.storageGet(["verdicts"]))), { verdicts: { a: 1 } });
  await host.storageSet({ verdicts: { b: 2 } });
  // report batches: nothing sent synchronously, flushed after the 2 s timer or at 32 events
  for (let i = 0; i < 32; i++) host.report({ type: 'stats', site: 'youtube', action: 'hide', reason: 'label:youtube_badge' });
  await new Promise((r) => setTimeout(r, 0));
  const report = sent.find((m) => m.type === 'report');
  assert.ok(report && report.events.length === 32);
  // Swift pushes settings with _emitSettings
  host._emitSettings({ enabled: true, updatedAt: 3 });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].updatedAt, 3);
});

test('host-webview.js degrades to in-memory behaviour without the bridge', async () => {
  const host = loadHostShim({ bridge: null }).host;
  const s = await host.patchSettings({ enabled: false });
  assert.equal(s.enabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(await host.getSettings())), { enabled: false });
  await host.storageSet({ k: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(await host.storageGet(["k"]))), { k: 1 });
  await assert.rejects(host.fetchText('https://example.com'));
});
