// NoSlop host shim for the in-app Clean Feeds WKWebView (DESIGN.md §6 / §8).
// Classic script; attaches NoSlop.host backed by window.webkit.messageHandlers.noslop
// (Swift: FeedHost, a WKScriptMessageHandlerWithReply registered in WKContentWorld.defaultClient).
// Loaded FIRST, before rules.js / lib/*.js, so NoSlop.host exists when the engine starts.
// Falls back to in-memory behaviour when the bridge is absent (e.g. opened in a plain browser).
(function () {
  'use strict';
  var NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  var bridge = (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers &&
                window.webkit.messageHandlers.noslop) ? window.webkit.messageHandlers.noslop : null;

  var memory = { settings: null, storage: {} };
  var listeners = [];
  var pendingEvents = [];
  var flushTimer = null;

  function call(type, payload) {
    var msg = Object.assign({ type: type }, payload || {});
    if (!bridge) { return Promise.reject(new Error('NoSlop host bridge unavailable')); }
    try {
      return Promise.resolve(bridge.postMessage(msg));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function cloneSettings(s) { return s ? JSON.parse(JSON.stringify(s)) : s; }

  function flush() {
    flushTimer = null;
    if (!pendingEvents.length) { return; }
    var batch = pendingEvents.splice(0, pendingEvents.length);
    call('report', { events: batch }).catch(function () { /* fail-open: stats are best-effort */ });
  }

  var host = {
    kind: 'webview',

    getSettings: function () {
      return call('getSettings').then(function (s) {
        memory.settings = s || memory.settings;
        return cloneSettings(memory.settings);
      }, function () { return cloneSettings(memory.settings); });
    },

    onSettingsChanged: function (cb) {
      if (typeof cb === 'function') { listeners.push(cb); }
      return function () { listeners = listeners.filter(function (f) { return f !== cb; }); };
    },

    patchSettings: function (partial) {
      return call('patchSettings', { partial: partial || {} }).then(function (s) {
        memory.settings = s || memory.settings;
        host._emitSettings(memory.settings);
        return cloneSettings(memory.settings);
      }, function () {
        memory.settings = Object.assign({}, memory.settings || {}, partial || {});
        host._emitSettings(memory.settings);
        return cloneSettings(memory.settings);
      });
    },

    storageGet: function (keys) {
      var list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      return call('storageGet', { keys: list }).then(function (obj) {
        return obj || {};
      }, function () {
        var out = {};
        list.forEach(function (k) { if (k in memory.storage) { out[k] = memory.storage[k]; } });
        return out;
      });
    },

    storageSet: function (obj) {
      var items = obj || {};
      Object.keys(items).forEach(function (k) { memory.storage[k] = items[k]; });
      return call('storageSet', { items: items }).then(function () { return undefined; }, function () { return undefined; });
    },

    fetchText: function (url, opts) {
      var timeout = (opts && opts.timeout) || 8000;
      // No userAgent is forwarded: the iPhone UA makes www.youtube.com 302 to m.youtube.com, whose watch HTML carries
      // no AI-label JSON; FeedHost.swift sends a desktop Safari UA so the webview path gets the same HTML as the Mac.
      return call('fetchText', { url: String(url), timeout: timeout });
    },

    report: function (event) {
      if (!event || typeof event !== 'object') { return; }
      pendingEvents.push(event);
      if (pendingEvents.length >= 32) { flush(); return; }
      if (!flushTimer) { flushTimer = setTimeout(flush, 2000); }
    },

    // Called by Swift (FeedController.pushSettings) via evaluateJavaScript in the defaultClient world.
    _emitSettings: function (settings) {
      memory.settings = settings || memory.settings;
      var snapshot = cloneSettings(memory.settings);
      listeners.slice().forEach(function (cb) {
        try { cb(snapshot); } catch (e) { console.error('NoSlop onSettingsChanged listener failed', e); }
      });
    }
  };

  NS.host = host;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () { if (document.hidden) { flush(); } });
    window.addEventListener('pagehide', flush);
  }
})();
