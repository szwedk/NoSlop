// NoSlop — small DOM helpers shared by adapters and the engine. Plain classic script (no modules).
// Runs in Safari 17+ (iOS/macOS) and Chrome 121+. Attaches to globalThis.NoSlop.dom.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});

  const HASHTAG_RE = /#([\p{L}\p{N}_]{2,64})/gu;
  const URL_RE = /(?:https?:\/\/|www\.)\S+/gi; // a URL fragment (#aiart in https://site/page#aiart) is not a hashtag
  const HANDLE_RE = /^@?([A-Za-z0-9_.-]{1,64})$/;

  /** Visible text of an element (or of the first match of `selector` under it), collapsed whitespace. */
  function text(el, selector) {
    if (!el) return '';
    const node = selector ? el.querySelector(selector) : el;
    if (!node) return '';
    const raw = node.innerText != null && typeof node.innerText === 'string' && node.innerText.length ? node.innerText : node.textContent || '';
    return raw.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  /** textContent of every match, joined by newline (cheap; ignores visibility). */
  function texts(el, selector) {
    if (!el) return '';
    const out = [];
    el.querySelectorAll(selector).forEach((n) => { const t = (n.textContent || '').trim(); if (t) out.push(t); });
    return out.join('\n');
  }

  /** Attribute of an element or its first `selector` match, or ''. */
  function attr(el, selector, name) {
    if (!el) return '';
    const node = selector ? el.querySelector(selector) : el;
    return (node && node.getAttribute && node.getAttribute(name)) || '';
  }

  /** Element.closest with a null-safe target (text nodes allowed). */
  function closest(node, selector) {
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el && el.closest ? el.closest(selector) : null;
  }

  /** Cheap visibility test: attached, not display:none/visibility:hidden, and has a box. */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden) return false;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (view && view.getComputedStyle) {
      const cs = view.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    if (typeof el.getClientRects === 'function') {
      const rects = el.getClientRects();
      // jsdom reports empty rects for everything; treat "no layout engine" as visible.
      if (rects.length === 0 && view && view.navigator && /jsdom/i.test(view.navigator.userAgent || '')) return true;
      return rects.length > 0;
    }
    return true;
  }

  /** Lower-cased, de-duplicated hashtags found in a string (keeps the leading #). */
  function hashtags(str) {
    const out = new Set();
    if (!str) return [];
    const src = String(str).replace(URL_RE, ' ');
    for (const m of src.matchAll(HASHTAG_RE)) out.add('#' + m[1].toLowerCase());
    return [...out];
  }

  /** Normalise an author handle: strip @, leading/trailing slashes, lower-case. */
  function handle(str) {
    if (!str) return '';
    let s = String(str).trim();
    try { if (/^https?:\/\//i.test(s)) s = new URL(s).pathname; } catch (_) { /* ignore */ }
    s = s.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
    const m = HANDLE_RE.exec(s);
    return m ? m[1].toLowerCase() : s.replace(/^@/, '').toLowerCase();
  }

  /** Hrefs of all anchors under el (absolute when possible). */
  function links(el) {
    if (!el) return [];
    const out = [];
    el.querySelectorAll('a[href]').forEach((a) => { try { out.push(a.href || a.getAttribute('href')); } catch (_) { out.push(a.getAttribute('href')); } });
    return out;
  }

  /** First element whose trimmed text equals one of `strings` (case-insensitive), searching `selector` matches. */
  function findByText(root, selector, strings) {
    if (!root) return null;
    const wanted = new Set((strings || []).map((s) => String(s).trim().toLowerCase()));
    const nodes = root.querySelectorAll(selector || '*');
    for (const n of nodes) {
      const t = (n.textContent || '').trim().toLowerCase();
      if (t && wanted.has(t)) return n;
    }
    return null;
  }

  /** Does the subtree contain a text node equal to one of `strings` (exact, trimmed, case-insensitive)? */
  function hasExactText(root, strings) {
    if (!root || !strings || !strings.length) return false;
    const wanted = new Set(strings.map((s) => String(s).trim().toLowerCase()));
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.nodeValue || '').trim().toLowerCase();
      if (t && wanted.has(t)) return true;
    }
    return false;
  }

  /** Pause and mute every <video>/<audio> under el (CSS hiding does not stop playback).
   *  Returns the previous state per element ([{el, muted, paused}]) so a later un-hide can restore `muted`. */
  function stopMedia(el) {
    const prev = [];
    if (!el || !el.querySelectorAll) return prev;
    el.querySelectorAll('video, audio').forEach((v) => {
      try {
        prev.push({ el: v, muted: !!v.muted, paused: v.paused !== false });
        v.muted = true;
        if (typeof v.pause === 'function') v.pause();
      } catch (_) { /* ignore */ }
    });
    return prev;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  NS.dom = { text, texts, attr, closest, visible, hashtags, handle, links, findByText, hasExactText, stopMedia, escapeHtml };
})();
