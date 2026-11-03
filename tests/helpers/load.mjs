// NoSlop test loader: runs the plain extension scripts inside a jsdom window via vm.createContext.
// Usage: const { window, document, NoSlop } = await loadScripts(['rules.js','lib/dom.js',...], { url, html, browser: true })
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { after } from 'node:test';

// Every jsdom window created here is closed when the test file finishes, so its timers
// (engine sweep, background setInterval) cannot keep the test process alive.
const openWindows = new Set();
after(() => { for (const w of openWindows) { try { w.close(); } catch (_) { /* ignore */ } } openWindows.clear(); });

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RESOURCES = path.join(ROOT, 'Extension/Resources');

export const CORE_FILES = ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js'];

export function readRules() {
  return JSON.parse(fs.readFileSync(path.join(RESOURCES, 'rules.json'), 'utf8'));
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/**
 * A fake `browser` object: storage.local (+ onChanged), runtime.onMessage/sendMessage (dispatching to the
 * listeners registered in the same context, supporting both sendResponse+return true and returned Promises),
 * runtime.sendNativeMessage (opts.native(msg) or rejects), optional alarms.
 */
export function makeFakeBrowser(opts = {}) {
  const data = new Map();
  const onChanged = new Set();
  const onMessage = new Set();
  const nativeLog = [];
  const fake = {
    __data: data, __nativeLog: nativeLog, __native: opts.native || null,
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [keys];
          for (const k of list) { if (data.has(k)) out[k] = clone(data.get(k)); else if (keys && typeof keys === 'object' && !Array.isArray(keys) && keys[k] !== undefined) out[k] = clone(keys[k]); }
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set(obj, cb) {
          const changes = {};
          for (const [k, v] of Object.entries(obj || {})) { changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) }; data.set(k, clone(v)); }
          for (const l of onChanged) { try { l(clone(changes), 'local'); } catch (_) { /* ignore */ } }
          if (cb) cb();
          return Promise.resolve();
        },
        remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) data.delete(k); if (cb) cb(); return Promise.resolve(); },
        clear(cb) { data.clear(); if (cb) cb(); return Promise.resolve(); }
      },
      onChanged: { addListener(fn) { onChanged.add(fn); }, removeListener(fn) { onChanged.delete(fn); }, hasListener(fn) { return onChanged.has(fn); } }
    },
    runtime: {
      id: 'noslop-fake',
      lastError: undefined,
      getManifest() { return { version: '0.1.0-test' }; },
      onMessage: { addListener(fn) { onMessage.add(fn); }, removeListener(fn) { onMessage.delete(fn); }, hasListener(fn) { return onMessage.has(fn); } },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      sendMessage(msg, cb) {
        const sender = { id: 'noslop-fake', url: opts.senderUrl || 'https://www.youtube.com/' };
        const p = new Promise((resolve, reject) => {
          if (!onMessage.size) { reject(new Error('no onMessage listener')); return; }
          let settled = false;
          const done = (v) => { if (!settled) { settled = true; resolve(clone(v)); } };
          for (const l of onMessage) {
            let ret;
            try { ret = l(clone(msg), sender, done); } catch (e) { reject(e); return; }
            if (ret && typeof ret.then === 'function') { ret.then(done, reject); return; }
            if (ret === true) return; // async sendResponse
          }
          // No listener claimed the message: resolve undefined (like the real API).
          setTimeout(() => done(undefined), 0);
        });
        if (cb) p.then(cb, () => cb(undefined));
        return p;
      },
      sendNativeMessage(app, msg) {
        nativeLog.push(clone(msg));
        if (typeof fake.__native === 'function') { try { return Promise.resolve(fake.__native(clone(msg))); } catch (e) { return Promise.reject(e); } }
        return Promise.reject(new Error('sendNativeMessage unavailable'));
      }
    }
  };
  if (opts.alarms) {
    const listeners = new Set();
    fake.alarms = {
      __alarms: new Map(),
      create(name, info) { fake.alarms.__alarms.set(name, info); },
      onAlarm: { addListener(fn) { listeners.add(fn); } },
      __fire(name) { for (const l of listeners) l({ name }); }
    };
  }
  return fake;
}

/**
 * Load plain scripts (paths relative to Extension/Resources, or absolute) into a fresh jsdom window.
 * Returns { window, document, NoSlop, browser, dom, load(moreFiles), tick(ms) }.
 */
export async function loadScripts(files, options = {}) {
  const {
    url = 'https://www.youtube.com/',
    html = '<!doctype html><html><head></head><body></body></html>',
    browser = false,
    pretendToBeVisual = true,
    beforeScripts = null
  } = options;
  // jsdom has no media playback: video.pause() logs a 'not implemented' jsdomError; keep real console output, drop those.
  const virtualConsole = new VirtualConsole();
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual, virtualConsole });
  const window = dom.window;
  openWindows.add(window);
  const ctx = dom.getInternalVMContext();
  let fake = null;
  if (browser) { fake = browser === true ? makeFakeBrowser({ senderUrl: url }) : browser; window.browser = fake; }
  if (typeof beforeScripts === 'function') beforeScripts(window, ctx);
  const load = (list) => {
    for (const f of (Array.isArray(list) ? list : [list])) {
      const file = path.isAbsolute(f) ? f : path.join(RESOURCES, f);
      const code = fs.readFileSync(file, 'utf8');
      vm.runInContext(code, ctx, { filename: file });
    }
    return window.NoSlop;
  };
  load(files || []);
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, NoSlop: window.NoSlop, browser: fake, dom, load, tick, ctx };
}

/** Flush microtasks + a macrotask so engine timers (setTimeout 0) run. */
export async function settle(n = 3) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
