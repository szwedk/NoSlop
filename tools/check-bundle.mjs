#!/usr/bin/env node
// NoSlop — verifies that a built app bundle carries the complete Safari web extension.
//
//   node tools/check-bundle.mjs build/NoSlop.app          (macOS: Contents/PlugIns/*.appex/Contents/Resources)
//   node tools/check-bundle.mjs build/NoSlop-iOS.app      (iOS:   PlugIns/*.appex)
//   node tools/check-bundle.mjs                          (checks every bundle that exists under build/)
//
// Checks: exactly one .appex; its Resources hold manifest.json; every file the manifest references
// (content scripts, css, background scripts, icons, popup, web_accessible_resources) exists; each
// script byte-matches Extension/Resources (so a stale folder reference is caught); the app also
// carries the WebExtension folder reference (Clean Feeds) with the same manifest.
// Exit 1 with a problem list on any failure. Plain ESM, Node 20+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'Extension/Resources');

function exists(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }

/** Every relative path a Safari/Chrome MV3 manifest can point at inside the extension folder. */
export function referencedFiles(m) {
  const refs = new Set();
  const add = (v) => { if (typeof v === 'string' && v && !/^(https?:|chrome:|\*)/.test(v)) refs.add(v.replace(/^\.?\//, '')); };
  const addMap = (o) => { if (o && typeof o === 'object') Object.values(o).forEach(add); };
  addMap(m.icons);
  if (m.background) { add(m.background.service_worker); (m.background.scripts || []).forEach(add); add(m.background.page); }
  for (const cs of m.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
  if (m.action) { add(m.action.default_popup); addMap(m.action.default_icon); }
  if (m.options_ui) add(m.options_ui.page);
  add(m.options_page);
  for (const w of m.web_accessible_resources || []) {
    if (typeof w === 'string') add(w);
    else (w.resources || []).forEach((r) => { if (!/[*?]/.test(r)) add(r); });
  }
  if (m.default_locale) refs.add(`_locales/${m.default_locale}/messages.json`);
  return [...refs].sort();
}

/** Resources folder of the single .appex inside an app bundle (macOS or iOS layout). */
export function findAppex(app) {
  const candidates = [path.join(app, 'Contents/PlugIns'), path.join(app, 'PlugIns')];
  for (const dir of candidates) {
    if (!isDir(dir)) continue;
    const appexes = fs.readdirSync(dir).filter((n) => n.endsWith('.appex'));
    if (appexes.length !== 1) return { error: `${path.relative(ROOT, dir)} holds ${appexes.length} .appex bundles (expected 1)` };
    const appex = path.join(dir, appexes[0]);
    const res = isDir(path.join(appex, 'Contents/Resources')) ? path.join(appex, 'Contents/Resources') : appex;
    return { appex, resources: res };
  }
  return { error: `no PlugIns folder in ${path.relative(ROOT, app)}` };
}

/** Popup html references (relative script/css/img) so a missing popup asset is caught too. */
function popupAssets(resources, popupRel) {
  const out = [];
  const abs = path.join(resources, ...popupRel.split('/'));
  if (!exists(abs)) return out;
  const html = fs.readFileSync(abs, 'utf8');
  const dir = path.posix.dirname(popupRel);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:|data:|#|noslop:|mailto:)/.test(v)) continue;
    out.push(path.posix.normalize(path.posix.join(dir, v)));
  }
  return out;
}

export function checkExtensionFolder(resources, { compareTo = SOURCE, label = resources } = {}) {
  const problems = [];
  const manifestPath = path.join(resources, 'manifest.json');
  if (!exists(manifestPath)) return { ok: false, problems: [`${label}: manifest.json missing`], referenced: [] };
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { return { ok: false, problems: [`${label}: manifest.json invalid: ${e.message}`], referenced: [] }; }
  const referenced = referencedFiles(m);
  if (m.action && m.action.default_popup) referenced.push(...popupAssets(resources, m.action.default_popup));
  for (const rel of [...new Set(referenced)].sort()) {
    const abs = path.join(resources, ...rel.split('/'));
    if (!exists(abs)) { problems.push(`${label}: referenced file missing: ${rel}`); continue; }
    if (compareTo && /\.(js|css|json|html)$/.test(rel)) {
      const src = path.join(compareTo, ...rel.split('/'));
      if (exists(src) && fs.readFileSync(src).compare(fs.readFileSync(abs)) !== 0) problems.push(`${label}: ${rel} differs from Extension/Resources (stale copy)`);
    }
  }
  // Content scripts must be classic scripts: a quick syntax sanity check with the real parser.
  for (const cs of m.content_scripts || []) for (const js of cs.js || []) {
    const abs = path.join(resources, ...js.split('/'));
    if (!exists(abs)) continue;
    try { new Function(fs.readFileSync(abs, 'utf8')); } catch (e) { problems.push(`${label}: ${js} does not parse: ${e.message}`); }
  }
  return { ok: problems.length === 0, problems, referenced: [...new Set(referenced)].sort(), manifest: m };
}

export function checkBundle(app) {
  const problems = [];
  if (!isDir(app)) return { ok: false, problems: [`${app}: not a directory`] };
  const found = findAppex(app);
  if (found.error) return { ok: false, problems: [found.error] };
  const label = path.relative(ROOT, found.resources);
  const ext = checkExtensionFolder(found.resources, { label });
  problems.push(...ext.problems);
  // Info.plist of the appex must declare the Safari web-extension point.
  const plist = isDir(path.join(found.appex, 'Contents')) ? path.join(found.appex, 'Contents/Info.plist') : path.join(found.appex, 'Info.plist');
  if (!exists(plist)) problems.push(`${label}: appex Info.plist missing`);
  else {
    const txt = fs.readFileSync(plist);
    if (!txt.includes('com.apple.Safari.web-extension')) problems.push(`${label}: appex Info.plist lacks NSExtensionPointIdentifier com.apple.Safari.web-extension`);
  }
  // Clean Feeds: the app itself carries the WebExtension folder reference (same manifest + scripts).
  const appRes = isDir(path.join(app, 'Contents/Resources')) ? path.join(app, 'Contents/Resources') : app;
  const webext = path.join(appRes, 'WebExtension');
  if (isDir(webext)) {
    const w = checkExtensionFolder(webext, { label: path.relative(ROOT, webext) });
    problems.push(...w.problems);
    if (!exists(path.join(webext, 'lib/host-webview.js'))) problems.push(`${path.relative(ROOT, webext)}: lib/host-webview.js missing (Clean Feeds host shim)`);
  } else {
    problems.push(`${path.relative(ROOT, appRes)}: WebExtension folder reference missing (Clean Feeds webviews cannot load the scripts)`);
  }
  return { ok: problems.length === 0, problems, app, appex: found.appex, referenced: ext.referenced };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let apps = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (!apps.length) apps = ['build/NoSlop.app', 'build/NoSlop-iOS.app'].map((p) => path.join(ROOT, p)).filter(isDir);
  if (!apps.length) { console.error('[check-bundle] no app bundle given and none found under build/'); process.exit(2); }
  let failed = false;
  for (const app of apps) {
    const r = checkBundle(path.resolve(app));
    if (r.ok) console.log(`[check-bundle] OK ${path.relative(ROOT, r.app) || r.app}: ${path.basename(r.appex)} carries manifest.json + ${r.referenced.length} referenced files`);
    else { failed = true; console.error(`[check-bundle] FAILED ${app}:\n  - ${r.problems.join('\n  - ')}`); }
  }
  process.exit(failed ? 1 : 0);
}
