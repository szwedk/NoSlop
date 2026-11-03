// NoSlop — TikTok MAIN-world JSON relay (owner: adapter:tiktok). Plain classic script, NO NoSlop namespace:
// it runs in the PAGE world, injected by adapters/tiktok.js as <script src="browser.runtime.getURL('lib/tiktok-main.js')">
// (needs manifest web_accessible_resources: lib/tiktok-main.js for *://*.tiktok.com/*). Safari's manifest `world`
// key is unreliable (docs/research/ios-safari-extension-limits.md §1), hence the element injection.
//
// What it does: wraps window.fetch and XMLHttpRequest, and for the feed item-list endpoints copies the per-item
// AIGC fields out of the JSON and posts them to the isolated world:
//   window.postMessage({ source: 'noslop-tiktok', v: 1, items: [{ id, aigcLabelType, moderationAigcLabelType, IsAigc,
//                        AIGCDescription, ShowAIGC, isAd, author: { uniqueId, nickname, id } }] }, location.origin)
// Sources: endpoint + keys `itemList.[-].aigcLabelType / moderationAigcLabelType` on `/item_list` = Stevoisiak
// GenAI-Blocklist line 4404 (uBO json-prune-fetch-response rule, REAL); `/api/recommend/item_list/` = rules.json
// labels.tiktok.jsonEndpoint; `IsAigc` / `AIGCDescription` / `ShowAIGC` = page source capture in
// tests/fixtures/tiktok/notes.md (REAL); `ad_info` = Stevoisiak line 4407. `/api/post/item_list` (profile feed) is
// from the NoSlop task spec and `/api/explore/item_list`, `/api/related/item_list` are UNVERIFIED guesses that
// only widen the match — a miss costs nothing, the DOM path still runs.
// It never modifies a response (clone() for fetch, a 'load' listener for XHR) and swallows every error.
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__noslopTiktokMain) return;
  window.__noslopTiktokMain = true;

  var SOURCE = 'noslop-tiktok';
  var ENDPOINT_RE = /\/api\/(?:recommend|post|explore|related)\/item_list\b/i;
  var MAX_ITEMS = 200;

  function noop() { /* ignore */ }

  function str(v) { return v == null ? '' : String(v); }

  function pick(it) {
    var author = it.author;
    var a = {};
    if (author && typeof author === 'object') {
      a.uniqueId = str(author.uniqueId || author.unique_id || '');
      a.nickname = str(author.nickname || author.nick_name || '');
      a.id = str(author.id || author.uid || '');
    } else if (typeof author === 'string') {
      a.uniqueId = author; // some responses carry author as the bare uniqueId string
      a.id = str(it.authorId || '');
      a.nickname = str(it.nickname || '');
    }
    return {
      id: str(it.id || it.itemId || it.aweme_id || ''),
      aigcLabelType: it.aigcLabelType === undefined ? undefined : str(it.aigcLabelType),
      moderationAigcLabelType: it.moderationAigcLabelType === undefined ? undefined : str(it.moderationAigcLabelType),
      IsAigc: it.IsAigc === true || it.isAigc === true,
      AIGCDescription: str(it.AIGCDescription || it.aigcDescription || ''),
      ShowAIGC: it.ShowAIGC === true,
      isAd: !!(it.ad_info || it.adInfo || it.isAd === true),
      author: a
    };
  }

  function relay(json) {
    try {
      if (!json || typeof json !== 'object') return;
      var list = json.itemList || json.item_list || json.items || json.data;
      if (!Array.isArray(list)) return;
      var items = [];
      for (var i = 0; i < list.length && items.length < MAX_ITEMS; i++) {
        var it = list[i];
        if (!it || typeof it !== 'object') continue;
        var p = pick(it);
        if (p.id) items.push(p);
      }
      if (items.length) window.postMessage({ source: SOURCE, v: 1, items: items }, window.location.origin);
    } catch (e) { /* ignore */ }
  }

  function matches(url) {
    try { return ENDPOINT_RE.test(str(url)); } catch (e) { return false; }
  }

  // ---- fetch ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    var wrapped = function fetch(input, init) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || str(input); } catch (e) { url = ''; }
      var p = origFetch.apply(this, arguments);
      if (matches(url) && p && typeof p.then === 'function') {
        p.then(function (res) {
          try { var c = res && typeof res.clone === 'function' ? res.clone() : null; if (c) c.json().then(relay, noop); } catch (e) { /* ignore */ }
        }, noop);
      }
      return p;
    };
    try { window.fetch = wrapped; } catch (e) { /* ignore */ }
  }

  // ---- XMLHttpRequest ----
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var origOpen = XHR.prototype.open, origSend = XHR.prototype.send;
    if (typeof origOpen === 'function' && typeof origSend === 'function') {
      XHR.prototype.open = function (method, url) {
        try { this.__noslopUrl = str(url); } catch (e) { /* ignore */ }
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        try {
          if (matches(this.__noslopUrl)) {
            this.addEventListener('load', function () {
              try {
                var rt = this.responseType;
                var body = (rt === '' || rt === 'text') ? this.responseText : this.response;
                relay(typeof body === 'string' ? JSON.parse(body) : body);
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return origSend.apply(this, arguments);
      };
    }
  }
})();
