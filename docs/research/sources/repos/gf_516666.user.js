// ==UserScript==
// @name         Reddit Advanced Content Filter
// @namespace    https://greasyfork.org/en/users/567951-stuart-saddler
// @version      3.2.0
// @description  Hide Reddit posts by keyword or subreddit, with whitelist overrides, regular plural matching, remembered blocks, searchable full-session history, backups, and themed settings.
// @author       Stuart Saddler (locally revised)
// @license      MIT
// @match        *://www.reddit.com/*
// @match        *://old.reddit.com/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @downloadURL https://update.greasyfork.org/scripts/516666/Reddit%20Advanced%20Content%20Filter.user.js
// @updateURL https://update.greasyfork.org/scripts/516666/Reddit%20Advanced%20Content%20Filter.meta.js
// ==/UserScript==
// Source: https://github.com/thepick/userscripts

(async function () {
    'use strict';

    const CSS = `
.raf-filtered{display:none!important}
.raf-dialog{--raf-bg:#fff;--raf-fg:#172b3a;--raf-muted:#4c6170;--raf-field:#f4f7fa;--raf-border:#718899;--raf-accent:#0067b4;--raf-on-accent:#fff;--raf-danger:#a51d25;color-scheme:light;background:var(--raf-bg);color:var(--raf-fg);box-sizing:border-box;width:min(860px,calc(100% - 24px));max-width:none;max-height:calc(100dvh - 24px);padding:0;border:1px solid var(--raf-border);border-radius:12px;box-shadow:0 16px 48px #0005;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.raf-dialog[data-raf-theme="dark"]{--raf-bg:#15202b;--raf-fg:#edf4f9;--raf-muted:#b5c8d7;--raf-field:#1e3040;--raf-border:#61798b;--raf-accent:#8acaff;--raf-on-accent:#102536;--raf-danger:#ffb0b5;color-scheme:dark}
.raf-dialog::backdrop{background:#0009}.raf-dialog *{box-sizing:border-box}
.raf-shell{display:flex;flex-direction:column;max-height:calc(100dvh - 26px)}
.raf-head,.raf-actions{flex:none;padding:16px 22px}.raf-head{border-bottom:1px solid var(--raf-border);display:flex;align-items:center;justify-content:space-between;gap:16px}
.raf-dialog h2{font-size:1.3rem;margin:0}.raf-dialog h3{font-size:1.05rem;margin:0 0 10px}
.raf-body{overflow:auto;padding:20px 22px;min-height:0;overscroll-behavior:contain}
.raf-section + .raf-section{margin-top:26px;padding-top:22px;border-top:1px solid var(--raf-border)}
.raf-editors{display:grid;grid-template-columns:1fr 1fr;gap:22px}.raf-editor{min-width:0}
.raf-dialog label{display:block;font-weight:600;margin-bottom:6px}
.raf-dialog textarea,.raf-dialog input[type="search"],.raf-dialog input[type="text"]{display:block;width:100%;color:var(--raf-fg);background:var(--raf-field);border:1px solid var(--raf-border);border-radius:6px;padding:10px;font:inherit;caret-color:var(--raf-accent)}
.raf-dialog textarea{min-height:220px;resize:vertical;line-height:1.5}
.raf-dialog input::placeholder{color:var(--raf-muted);opacity:1}
.raf-dialog .raf-help{font-size:.875rem;color:var(--raf-muted);margin:6px 0 10px;overflow-wrap:anywhere}
.raf-dialog button{min-height:40px;padding:8px 13px;border:1px solid var(--raf-border);border-radius:6px;font:inherit;color:var(--raf-fg);background:var(--raf-field);cursor:pointer}
.raf-dialog button:hover{border-color:var(--raf-accent)}.raf-dialog button:active{filter:brightness(.94)}.raf-dialog button:disabled{opacity:.6;cursor:default}
.raf-dialog button.raf-primary{background:var(--raf-accent);color:var(--raf-on-accent);border-color:transparent;font-weight:600}
.raf-dialog :focus-visible{outline:3px solid var(--raf-accent);outline-offset:3px}.raf-dialog ::selection{background:var(--raf-accent);color:var(--raf-on-accent)}
.raf-dialog a{color:var(--raf-accent);text-underline-offset:3px}
.raf-row,.raf-find,.raf-actions,.raf-pager{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.raf-find{flex-wrap:nowrap;margin-top:10px}.raf-find input{min-width:0}.raf-find button{flex-shrink:0}
.raf-status{margin:0;color:var(--raf-muted);font-size:.875rem;white-space:pre-line;overflow-wrap:anywhere}.raf-status[data-error="true"]{color:var(--raf-danger)}
.raf-actions{justify-content:flex-end;border-top:1px solid var(--raf-border);background:var(--raf-bg)}.raf-actions .raf-status{flex:1 1 180px;max-height:4.5em;overflow:auto}
.raf-history{list-style:none;padding:0;margin:12px 0}.raf-history li{border-bottom:1px solid var(--raf-border);padding:12px 0;overflow-wrap:anywhere}.raf-history p{margin:4px 0}.raf-history .raf-help{margin:4px 0}.raf-pager{justify-content:space-between}
.raf-notice{position:fixed;bottom:16px;right:16px;z-index:1000000;max-width:min(380px,calc(100% - 32px));padding:12px 16px;border:1px solid #8ba3b5;border-radius:8px;background:#172b3a;color:white;font:14px/1.4 system-ui,sans-serif;cursor:pointer}
@media(max-width:620px){.raf-editors{grid-template-columns:1fr}.raf-head,.raf-actions{padding:12px 16px}.raf-body{padding:16px}.raf-dialog textarea{min-height:180px}}
`;

    const postSelector = 'article, div[data-testid="post-container"], shreddit-post, .thing.link';
    const textAreas = '[slot="text-body"], [data-testid="post-text-container"], .usertext-body, .md';
    const interfaceText = 'button, [role="button"], time, .score, .midcol, .rank, .buttons, .live-timestamp, a[data-click-id="comments"], a.bylink, a.comments, [data-testid="post-vote-container"], [data-testid="comment-count"], [slot="comment-count"]';
    const settingsKey = 'rafSettingsV1', cacheKey = 'rafBlockedCacheV1';
    const cacheLimit = 5000, cacheAge = 30 * 86400000, historyPageSize = 100;
    const pendingPosts = new Set(), blockedPosts = new Map(), remembered = new Map(), pendingMemory = new Map(), issues = new Map();
    let postStates = new WeakMap(), postChanges = new WeakMap();
    let blocklistArr = [], whitelistArr = [], blocklistSet = new Set(), blockRules = [], whiteRules = [];
    let processing = false, menuCommand = null, counterTimer = null, refreshHistory = null, refreshStatus = null;
    let ruleEpoch = 0, ruleContext = '', contextReady = Promise.resolve(), settingsRevision = '';
    let memoryTimer = null, memoryGeneration = 0, memoryWrites = Promise.resolve(), storageRefresh = null;
    let configurationEpoch = 0, refreshAgain = false;
    let dialogElement = null;
    const canRemember = !!globalThis.crypto?.subtle;

    function normalizeList(value) {
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Use a list of text entries.');
        return [...new Set(value.map(item => item.trim().toLowerCase()).filter(Boolean))];
    }

    function validateConfig(value) {
        if (!value || typeof value !== 'object') throw new Error('The settings are not a valid object.');
        return { blocklist: normalizeList(value.blocklist), whitelist: normalizeList(value.whitelist) };
    }

    function reportIssue(key, message) {
        if (issues.get(key) === message) return;
        issues.set(key, message);
        updateCounterSoon();
        if (refreshStatus) refreshStatus();
    }

    function clearIssue(key) {
        if (issues.delete(key)) updateCounterSoon();
        if (refreshStatus) refreshStatus();
    }

    async function readConfiguration() {
        const snapshot = await GM.getValue(settingsKey, null);
        const config = { blocklist: blocklistArr, whitelist: whitelistArr }, warnings = [];
        if (snapshot !== null) {
            if (!snapshot || snapshot.version !== 1) {
                warnings.push('Saved settings are invalid. Their original data has not been overwritten. Restore a backup or correct the lists before saving.');
                return { ...config, revision: 'invalid:' + JSON.stringify(snapshot), warnings };
            }
            const revision = typeof snapshot.revision === 'string' ? snapshot.revision : 'invalid:' + JSON.stringify(snapshot);
            if (typeof snapshot.revision !== 'string') warnings.push('The saved settings record needs repair. Available lists were recovered; export a backup, then save to repair the record.');
            for (const key of ['blocklist', 'whitelist']) {
                try { config[key] = normalizeList(snapshot[key]); }
                catch (_) { warnings.push('The saved ' + key + ' is invalid. Other settings were recovered; correct this list before saving.'); }
            }
            return { ...config, revision, warnings };
        }
        const legacy = await Promise.all([GM.getValue('blocklist', []), GM.getValue('whitelist', [])]);
        for (const [index, key] of ['blocklist', 'whitelist'].entries()) {
            try { config[key] = normalizeList(legacy[index]); }
            catch (_) { warnings.push('The saved ' + key + ' is invalid. Its original data has not been overwritten. Restore a backup or correct this list before saving.'); }
        }
        return { ...config, revision: 'legacy:' + JSON.stringify(legacy), warnings };
    }

    async function fingerprint(value) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function setRules(blocklist, whitelist) {
        blocklistArr = normalizeList(blocklist);
        whitelistArr = normalizeList(whitelist);
        blocklistSet = new Set(blocklistArr);
        blockRules = compileRules(blocklistArr);
        whiteRules = compileRules(whitelistArr);
        const epoch = ++ruleEpoch;
        postStates = new WeakMap();
        contextReady = (canRemember ? fingerprint(JSON.stringify([1, blocklistArr, whitelistArr])) : Promise.resolve('')).then(context => {
            if (epoch === ruleEpoch) ruleContext = context;
        });
        return contextReady;
    }

    async function refreshConfiguration() {
        if (storageRefresh) { refreshAgain = true; return storageRefresh; }
        storageRefresh = (async () => {
            do {
                refreshAgain = false;
                const epoch = configurationEpoch;
                try {
                    const value = await readConfiguration();
                    if (epoch !== configurationEpoch) { refreshAgain = true; continue; }
                    if (value.warnings.length) reportIssue('settings', value.warnings.join('\n'));
                    else clearIssue('settings');
                    if (value.revision !== settingsRevision) {
                        settingsRevision = value.revision;
                        await setRules(value.blocklist, value.whitelist);
                        if (epoch !== configurationEpoch) { refreshAgain = true; continue; }
                        if (document.body) collectPosts(document.body);
                        dialogElement?.dispatchEvent(new Event('raf-remote-settings'));
                    }
                    clearIssue('load');
                } catch (_) {
                    reportIssue('load', 'Could not read saved filters. Your last valid filters are unchanged. Check userscript storage and retry.');
                }
            } while (refreshAgain);
        })();
        try { await storageRefresh; } finally { storageRefresh = null; if (refreshAgain) void refreshConfiguration(); }
    }

    function updateMenuEntry() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        try {
            if (menuCommand !== null) {
                if (typeof GM_unregisterMenuCommand !== 'function') return;
                GM_unregisterMenuCommand(menuCommand);
            }
            menuCommand = GM_registerMenuCommand('Configure Filter (' + blockedPosts.size + ' blocked' + (issues.size ? '; needs attention' : '') + ')', showConfig);
        } catch (error) { console.warn('[Reddit Filter] Could not update menu:', error); }
    }

    function updateCounterSoon() {
        if (counterTimer !== null) return;
        counterTimer = setTimeout(() => {
            counterTimer = null;
            updateMenuEntry();
            if (refreshHistory) refreshHistory();
            if (refreshStatus) refreshStatus();
            let notice = document.querySelector('.raf-notice');
            if (issues.size && document.body) {
                if (!notice) {
                    notice = document.createElement('button'); notice.className = 'raf-notice'; notice.dataset.redditFilterUi = 'true';
                    notice.addEventListener('click', showConfig); document.body.append(notice);
                }
                notice.textContent = 'Reddit Filter needs attention. Open settings for details.';
            } else notice?.remove();
        }, 100);
    }

    function safePostURL(value) {
        if (!value) return '';
        try {
            const url = new URL(value, location.href);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
            if (url.hostname !== 'reddit.com' && !url.hostname.endsWith('.reddit.com')) return '';
            if (!/\/comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname)) return '';
            url.search = ''; url.hash = '';
            return url.href;
        } catch (_) { return ''; }
    }

    function platformPostID(node) {
        for (const value of [node.getAttribute('data-fullname'), node.id, node.getAttribute('name')]) {
            const match = (value || '').match(/^t3_([a-z0-9]+)$/i);
            if (match) return match[1].toLowerCase();
        }
        return '';
    }

    function postMetadata(post) {
        if (post.matches('shreddit-post, .thing.link, [data-testid="post-container"]')) return post;
        const ownID = platformPostID(post);
        const candidates = [...post.querySelectorAll('shreddit-post')].filter(node => !node.closest(textAreas));
        return (ownID ? candidates.find(node => platformPostID(node) === ownID) : candidates[0]) || post;
    }

    function getPostIdentity(post) {
        const metadata = postMetadata(post);
        for (const node of [post, metadata]) {
            const id = platformPostID(node);
            if (id) return { id };
        }
        for (const value of [metadata.getAttribute('permalink'), metadata.getAttribute('content-href')]) {
            const url = safePostURL(value), match = url && new URL(url).pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
            if (match) return { id: match[1].toLowerCase() };
        }
        for (const link of post.querySelectorAll('a[data-click-id="comments"], a.bylink, a.comments')) {
            if (link.closest(textAreas)) continue;
            const url = safePostURL(link.getAttribute('href')), match = url && new URL(url).pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
            if (match) return { id: match[1].toLowerCase() };
        }
        return null;
    }

    function getPostLink(post, identity = getPostIdentity(post)) {
        const metadata = postMetadata(post);
        const candidates = [metadata.getAttribute('permalink'), metadata.getAttribute('content-href')];
        for (const link of post.querySelectorAll('a[data-click-id="comments"], a.bylink, a.comments')) if (!link.closest(textAreas)) candidates.push(link.getAttribute('href'));
        for (const value of candidates) {
            const url = safePostURL(value);
            if (url && (!identity || new URL(url).pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1].toLowerCase() === identity.id)) return url;
        }
        return identity ? 'https://' + (location.hostname === 'old.reddit.com' ? 'old.reddit.com' : 'www.reddit.com') + '/comments/' + identity.id + '/' : '';
    }

    function getSubreddit(post) {
        const metadata = postMetadata(post);
        let value = metadata.getAttribute('subreddit-prefixed-name') || metadata.getAttribute('subreddit-name');
        if (!value) {
            const link = [...post.querySelectorAll('a[data-click-id="subreddit"], .tagline a.subreddit, a[href^="/r/"]')].find(element => !element.closest(textAreas));
            value = link?.textContent || '';
        }
        return value.trim().toLowerCase().replace(/^r\//, '');
    }

    function getPostText(post) {
        const parts = [];
        function visit(node) {
            if (node.nodeType === 3) { parts.push(node.data); return; }
            if (node.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE)$/.test(node.tagName) || node.matches(interfaceText)) return;
            // Separate block text without breaking words split by inline formatting.
            const boundary = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/.test(node.tagName);
            if (boundary) parts.push(' ');
            for (const child of node.childNodes) visit(child);
            if (boundary) parts.push(' ');
        }
        visit(post);
        return parts.join('').toLowerCase();
    }

    function filterDecision(title, content, subreddit) {
        if (matchBlock(title.toLowerCase() + ' ' + content + ' r/' + subreddit, whiteRules) !== null) return null;
        if (subreddit && (blocklistSet.has(subreddit) || blocklistSet.has('r/' + subreddit))) return { source: 'subreddit', trigger: subreddit };
        const titleTrigger = matchBlock(title.toLowerCase(), blockRules);
        if (titleTrigger) return { source: 'title', trigger: titleTrigger };
        const trigger = matchBlock(content, blockRules);
        return trigger ? { source: 'content', trigger } : null;
    }

    async function processPost(post) {
        if (!post.isConnected) return;
        const epoch = ruleEpoch, changes = postChanges.get(post) || 0;
        await contextReady;
        if (epoch !== ruleEpoch) { queuePost(post); return; }
        if (!blockRules.length) { post.classList.remove('raf-filtered'); return; }
        const title = getPostTitle(post), content = getPostText(post), subreddit = getSubreddit(post), identity = getPostIdentity(post), url = getPostLink(post, identity);
        const signature = JSON.stringify([title, content, subreddit]), old = postStates.get(post);
        const key = identity ? 'post:' + identity.id : old?.key || Symbol('post');
        if (old && old.signature === signature && old.key === key && old.url === url && old.epoch === epoch) {
            post.classList.toggle('raf-filtered', old.filtered); return;
        }
        const context = ruleContext, hash = canRemember && identity ? await fingerprint(signature) : '';
        if (!post.isConnected || epoch !== ruleEpoch || changes !== (postChanges.get(post) || 0)) return;
        const memoryKey = identity && canRemember ? context + ':' + identity.id : '', cached = memoryKey && remembered.get(memoryKey);
        const decision = cached && cached.fingerprint === hash && Date.now() - cached.at < cacheAge ? { source: cached.source, trigger: cached.trigger } : filterDecision(title, content, subreddit);
        const provisional = !identity;
        if (old?.provisional && old.key !== key && old.signature === signature) blockedPosts.delete(old.key);
        if (decision) {
            blockedPosts.set(key, { title, url, subreddit, ...decision });
            // shortcut: triggers over 5,000 characters are rechecked; use rule references if long-phrase caching becomes necessary.
            if (memoryKey && decision.trigger.length <= 5000 && (!cached || cached.fingerprint !== hash)) rememberBlock(memoryKey, { fingerprint: hash, ...decision, at: Date.now() });
        }
        postStates.set(post, { signature, key, url, epoch, provisional, filtered: !!decision });
        post.classList.toggle('raf-filtered', !!decision);
        updateCounterSoon();
    }

    function validCacheEntries(value) {
        if (!value || value.version !== 1 || !Array.isArray(value.entries)) throw new Error('Invalid remembered decisions.');
        return value.entries.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && /^[a-f0-9]{64}:[a-z0-9]+$/.test(entry[0]) && entry[1] && /^[a-f0-9]{64}$/.test(entry[1].fingerprint) && ['title', 'content', 'subreddit'].includes(entry[1].source) && typeof entry[1].trigger === 'string' && entry[1].trigger.length <= 5000 && Number.isFinite(entry[1].at) && entry[1].at <= Date.now() && Date.now() - entry[1].at < cacheAge).sort((a, b) => a[1].at - b[1].at).slice(-cacheLimit);
    }

    async function loadMemory() {
        if (!canRemember) { reportIssue('cache', 'Remembered blocks need a secure connection. Normal filtering still works; use HTTPS Reddit to enable memory.'); return; }
        try { for (const [key, value] of validCacheEntries(await GM.getValue(cacheKey, { version: 1, entries: [] }))) remembered.set(key, value); }
        catch (_) { reportIssue('cache', 'Remembered decisions could not be loaded. Normal filtering still works; clear remembered decisions in settings to rebuild them.'); }
    }

    function rememberBlock(key, value) {
        remembered.delete(key); remembered.set(key, value); pendingMemory.set(key, value);
        for (const map of [remembered, pendingMemory]) while (map.size > cacheLimit) map.delete(map.keys().next().value);
        if (memoryTimer === null) memoryTimer = setTimeout(() => void flushMemory(), 300);
    }

    function flushMemory() {
        clearTimeout(memoryTimer); memoryTimer = null;
        if (!pendingMemory.size) return memoryWrites;
        const additions = new Map(pendingMemory), generation = memoryGeneration; pendingMemory.clear();
        const operation = memoryWrites.then(async () => {
            if (generation !== memoryGeneration) return;
            let merged;
            try { merged = new Map(validCacheEntries(await GM.getValue(cacheKey, { version: 1, entries: [] }))); }
            catch (_) { merged = new Map(); }
            for (const [key, value] of additions) merged.set(key, value);
            const entries = [...merged].sort((a, b) => a[1].at - b[1].at).slice(-cacheLimit);
            if (generation !== memoryGeneration) return;
            await GM.setValue(cacheKey, { version: 1, entries });
            clearIssue('cache-save'); clearIssue('cache');
        });
        memoryWrites = operation.catch(() => {
            if (generation !== memoryGeneration) return;
            for (const [key, value] of additions) if (!pendingMemory.has(key)) pendingMemory.set(key, value);
            while (pendingMemory.size > cacheLimit) pendingMemory.delete(pendingMemory.keys().next().value);
            reportIssue('cache-save', 'Remembered blocks could not be saved. Normal filtering still works; saving will be retried when more blocks are found or you leave the page.');
        });
        return memoryWrites;
    }

    async function clearMemory() {
        memoryGeneration++; clearTimeout(memoryTimer); memoryTimer = null; pendingMemory.clear(); remembered.clear();
        const operation = memoryWrites.then(() => GM.setValue(cacheKey, { version: 1, entries: [] }));
        memoryWrites = operation.catch(() => {});
        await operation;
        clearIssue('cache'); clearIssue('cache-save');
    }

    function queuePost(post) {
        if (!post || !post.isConnected || (!blockRules.length && !post.classList.contains('raf-filtered'))) return;
        postChanges.set(post, (postChanges.get(post) || 0) + 1); pendingPosts.add(post);
        if (!processing) { processing = true; setTimeout(() => void processPostsBatch(), 0); }
    }

    function collectPosts(node) {
        if (node.nodeType !== 1 || node.closest('[data-reddit-filter-ui]')) return;
        queuePost(findPost(node)); node.querySelectorAll(postSelector).forEach(post => queuePost(findPost(post)));
    }

    async function processPostsBatch() {
        const started = performance.now(); let count = 0;
        try {
            for (const post of pendingPosts) {
                pendingPosts.delete(post);
                try { await processPost(post); } catch (error) { console.error('[Reddit Filter] Could not process a post:', error); }
                if (++count >= 50 || performance.now() - started > 8) break;
            }
        } finally {
            if (pendingPosts.size) setTimeout(() => void processPostsBatch(), 0);
            else processing = false;
        }
    }

    function observePosts() {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
                if (!target || target.closest('[data-reddit-filter-ui]')) continue;
                if (mutation.attributeName === 'class') {
                    if (dialogElement && (target === document.documentElement || target === document.body)) dialogElement.dataset.rafTheme = currentTheme();
                    const cached = postStates.get(target);
                    if (cached && target.classList.contains('raf-filtered') !== cached.filtered) queuePost(target);
                    else if (!cached && target.matches(postSelector)) queuePost(findPost(target));
                    continue;
                }
                if (target.closest(interfaceText)) continue;
                queuePost(findPost(target));
                for (const node of mutation.addedNodes) collectPosts(node);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['post-title', 'subreddit-prefixed-name', 'subreddit-name', 'permalink', 'content-href', 'href', 'id', 'data-fullname', 'name', 'slot', 'data-testid', 'class'] });
        return observer;
    }

    async function main() {
        if (!document.documentElement) await new Promise(resolve => { const observer = new MutationObserver(() => { if (document.documentElement) { observer.disconnect(); resolve(); } }); observer.observe(document, { childList: true }); });
        const style = document.createElement('style'); style.dataset.redditFilter = 'true'; style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
        await refreshConfiguration(); await loadMemory();
        if (!document.body) await new Promise(resolve => { const observer = new MutationObserver(() => { if (document.body) { observer.disconnect(); resolve(); } }); observer.observe(document.documentElement, { childList: true, subtree: true }); });
        updateMenuEntry(); observePosts(); collectPosts(document.body);
        if (typeof GM.addValueChangeListener === 'function') {
            try { await GM.addValueChangeListener(settingsKey, (_key, _old, _new, remote) => { if (remote) void refreshConfiguration(); }); }
            catch (_) { console.warn('[Reddit Filter] Live settings sync is unavailable; settings refresh when the page regains focus.'); }
        }
        window.addEventListener('focus', () => void refreshConfiguration());
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (dialogElement) dialogElement.dataset.rafTheme = currentTheme(); });
        window.addEventListener('pagehide', () => void flushMemory());
        document.addEventListener('visibilitychange', () => { if (document.hidden) void flushMemory(); else { void refreshConfiguration(); collectPosts(document.body); } });
    }

    function escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function compileRules(entries) {
        return entries.map(entry => {
            if (entry.includes(' ')) return { phrase: entry };
            const variants = [entry];
            // shortcut: regular English plurals only; enter irregular forms separately.
            if (/^[a-z]+$/.test(entry)) {
                if (/[^aeiou]y$/.test(entry)) variants.push(entry.slice(0, -1) + 'ies');
                else if (/(s|x|z|ch|sh)$/.test(entry)) variants.push(entry + 'es');
                else variants.push(entry + 's');
            }
            return { regex: new RegExp('(^|[^\\p{L}\\p{N}_])(' +
                variants.map(escapeRegex).join('|') + ')(?=$|[^\\p{L}\\p{N}_])', 'iu') };
        });
    }

    function matchBlock(text, rules) {
        for (const rule of rules) {
            if (rule.phrase !== undefined) {
                if (text.includes(rule.phrase)) return rule.phrase;
            } else {
                const match = rule.regex.exec(text);
                if (match) return match[2];
            }
        }
        return null;
    }

    function getPostTitle(post) {
        const attribute = postMetadata(post).getAttribute('post-title');
        if (attribute && attribute.trim()) return attribute.trim();
        for (const selector of ['[slot="title"]', 'span[data-testid="post-title"]', 'a.title',
            'h1, h2, h3, h4, h5, h6', 'a[data-click-id="body"]', 'div[data-adclicklocation="title"]']) {
            const element = post.querySelector(selector);
            if (element && element.textContent.trim()) {
                const text = element.textContent.trim();
                return selector === 'a[data-click-id="body"]' ? text.split('\n')[0].trim() : text;
            }
        }
        return '(Untitled)';
    }

    function findPost(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (!element || element.closest('[data-reddit-filter-ui]')) return null;
        let post = element.closest(postSelector);
        // Reddit can wrap one shreddit-post in an article: process the outer card once.
        for (let parent = post && post.parentElement && post.parentElement.closest(postSelector);
            parent; parent = post.parentElement && post.parentElement.closest(postSelector)) post = parent;
        return post;
    }


    function uiNode(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function currentTheme() {
        for (const node of [document.documentElement, document.body]) {
            if (!node) continue;
            if (node.matches('.theme-dark, .nightmode, [data-theme="dark"]')) return 'dark';
            if (node.matches('.theme-light, [data-theme="light"]')) return 'light';
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    async function showConfig() {
        if (dialogElement) { dialogElement.focus(); return; }
        await refreshConfiguration();
        createConfig();
    }

    function createConfig() {
        if (dialogElement) return;
        const previousFocus = document.activeElement, dialog = document.createElement('dialog');
        dialogElement = dialog;
        dialog.dataset.redditFilterUi = 'true'; dialog.dataset.rafTheme = currentTheme(); dialog.className = 'raf-dialog';
        dialog.setAttribute('aria-labelledby', 'raf-heading');
        // Static markup only; all saved values and post text use value/textContent.
        dialog.innerHTML = `
            <div class="raf-shell">
                <header class="raf-head"><h2 id="raf-heading" tabindex="-1">Reddit Filter: Settings</h2><button type="button" id="raf-close" aria-label="Close settings">Close</button></header>
                <div class="raf-body">
                    <p id="raf-errors" class="raf-status" role="alert" data-error="true" hidden></p>
                    <section class="raf-section raf-editors">
                        <div class="raf-editor"><label for="raf-blocklist">Blocklist</label><p class="raf-help" id="raf-block-help">One keyword, phrase, or subreddit per line. Use news or r/news to block a subreddit.</p>
                            <textarea id="raf-blocklist" spellcheck="false" aria-describedby="raf-block-help raf-block-count"></textarea><p class="raf-help" id="raf-block-count" aria-live="polite"></p>
                            <div class="raf-find"><input type="search" id="raf-block-search" aria-label="Find in blocklist" placeholder="Find in blocklist"><button type="button" id="raf-block-next">Next match</button></div></div>
                        <div class="raf-editor"><label for="raf-whitelist">Whitelist overrides</label><p class="raf-help" id="raf-white-help">One entry per line. A matching keyword, phrase, or subreddit overrides blocking.</p>
                            <textarea id="raf-whitelist" spellcheck="false" aria-describedby="raf-white-help raf-white-count"></textarea><p class="raf-help" id="raf-white-count" aria-live="polite"></p>
                            <div class="raf-find"><input type="search" id="raf-white-search" aria-label="Find in whitelist" placeholder="Find in whitelist"><button type="button" id="raf-white-next">Next match</button></div></div>
                    </section>
                    <section class="raf-section"><h3>Check a matching rule</h3><p class="raf-help">Single words match whole words and common regular plurals: city matches cities, and cat does not match cater. Phrases match literal substrings. Enter irregular forms separately.</p>
                        <label for="raf-preview">Sample title or text</label><input type="text" id="raf-preview"><p id="raf-preview-result" class="raf-help" role="status">Enter sample text to check the lists above. Subreddit metadata is checked separately on real posts.</p></section>
                    <section class="raf-section"><h3>Local memory and backup</h3><p id="raf-memory-status" class="raf-help"></p>
                        <div class="raf-row"><button type="button" id="raf-clear-memory">Clear remembered decisions</button><button type="button" id="raf-export">Export settings</button><button type="button" id="raf-import">Import settings</button><input type="file" id="raf-import-file" accept="application/json,.json" hidden></div>
                        <p class="raf-help">Backups contain your lists only. Imports fill these editors for review before saving. Remembered decisions stay in local userscript storage; post bodies are not saved.</p></section>
                    <section class="raf-section"><h3 id="raf-history-heading">Blocked posts this session</h3><label for="raf-history-search">Search blocked history</label><input type="search" id="raf-history-search" placeholder="Title, subreddit, or reason">
                        <ul id="raf-history" class="raf-history"></ul><div class="raf-pager"><button type="button" id="raf-previous">Previous</button><span id="raf-page" class="raf-help" role="status"></span><button type="button" id="raf-next">Next</button></div>
                        <p class="raf-help">All records from this page session remain available, including earlier blocks after settings change. History clears when the page reloads.</p></section>
                </div>
                <footer class="raf-actions"><p id="raf-save-status" class="raf-status" role="status" aria-live="polite"></p><button type="button" id="raf-cancel">Close</button><button type="button" id="raf-save" class="raf-primary">Save changes</button></footer>
            </div>`;
        const find = id => dialog.querySelector('#' + id), blockInput = find('raf-blocklist'), whiteInput = find('raf-whitelist');
        blockInput.value = blocklistArr.join('\n'); whiteInput.value = whitelistArr.join('\n');
        let baseRevision = settingsRevision, page = 0, saving = false, dirty = false, previewTimer = null;
        let previewSignature = '', previewBlock = [], previewWhite = [];
        const draft = () => validateConfig({ blocklist: blockInput.value.split('\n'), whitelist: whiteInput.value.split('\n') });
        function status(message, error = false) { find('raf-save-status').textContent = message; find('raf-save-status').dataset.error = String(error); }

        refreshStatus = () => {
            if (dialogElement !== dialog) return;
            const message = [...issues.values()].join('\n'), errors = find('raf-errors');
            errors.hidden = !message;
            if (errors.textContent !== message) errors.textContent = message;
            if (message && !find('raf-save-status').textContent) status('Some settings need attention. See the details above.', true);
            const text = 'Remembered decisions: ' + remembered.size.toLocaleString() + '. Keeps up to ' + cacheLimit.toLocaleString() + ' recent blocks for 30 days. Changed content or lists are rechecked.';
            if (find('raf-memory-status').textContent !== text) find('raf-memory-status').textContent = text;
        };

        refreshHistory = () => {
            if (dialogElement !== dialog) return;
            const query = find('raf-history-search').value.trim().toLowerCase();
            const rows = [...blockedPosts.values()].reverse().filter(row => !query || [row.title, row.subreddit, row.source, row.trigger].join(' ').toLowerCase().includes(query));
            const pages = Math.max(1, Math.ceil(rows.length / historyPageSize)); page = Math.min(page, pages - 1);
            const fragment = document.createDocumentFragment();
            for (const row of rows.slice(page * historyPageSize, (page + 1) * historyPageSize)) {
                const item = uiNode('li'), url = safePostURL(row.url), title = uiNode(url ? 'a' : 'span', '', row.title);
                if (url) { title.href = url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
                item.append(title, uiNode('p', 'raf-help', (row.subreddit ? 'r/' + row.subreddit + ' · ' : '') + row.source + ': “' + row.trigger + '”'));
                fragment.append(item);
            }
            if (!rows.length) fragment.append(uiNode('li', 'raf-help', query ? 'No blocked posts match this search.' : 'No posts blocked yet. New blocks will appear here.'));
            find('raf-history').replaceChildren(fragment);
            find('raf-history-heading').textContent = 'Blocked posts this session (' + blockedPosts.size.toLocaleString() + ')';
            find('raf-page').textContent = 'Matching posts: ' + rows.length.toLocaleString() + ' · Page ' + (page + 1) + ' of ' + pages;
            find('raf-previous').disabled = saving || page === 0; find('raf-next').disabled = saving || page + 1 >= pages;
        };

        function renderPreview() {
            const text = find('raf-preview').value.toLowerCase();
            if (!text) { find('raf-preview-result').textContent = 'Enter sample text to check the lists above. Subreddit metadata is checked separately on real posts.'; return; }
            try {
                const value = draft(), signature = JSON.stringify(value);
                if (signature !== previewSignature) { previewBlock = compileRules(value.blocklist); previewWhite = compileRules(value.whitelist); previewSignature = signature; }
                const white = matchBlock(text, previewWhite), block = matchBlock(text, previewBlock);
                find('raf-preview-result').textContent = white ? 'Allowed by whitelist match “' + white + '”.' : block ? 'Blocked by keyword match “' + block + '”.' : 'No keyword rule matches this sample.';
            } catch (error) { status(error.message, true); }
        }

        function setupEditor(prefix, editor) {
            const search = find(prefix + '-search'), next = find(prefix + '-next');
            const update = () => {
                try {
                    const entries = normalizeList(editor.value.split('\n')), query = search.value.toLowerCase(), count = query ? entries.filter(entry => entry.includes(query)).length : 0;
                    find(prefix + '-count').textContent = 'Unique entries: ' + entries.length.toLocaleString() + (query ? ' · Matching entries: ' + count.toLocaleString() : '');
                    next.disabled = saving || !query || !count;
                } catch (error) { status(error.message, true); }
            };
            editor.addEventListener('input', () => { update(); clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 100); });
            search.addEventListener('input', update);
            next.addEventListener('click', () => {
                const query = search.value.toLowerCase(), text = editor.value.toLowerCase();
                let index = text.indexOf(query, editor.selectionEnd); if (index < 0) index = text.indexOf(query);
                if (index >= 0) { editor.focus(); editor.setSelectionRange(index, index + query.length); editor.scrollTop = (editor.value.slice(0, index).split('\n').length - 1) * parseFloat(getComputedStyle(editor).lineHeight); }
            });
            update(); return update;
        }
        const updateBlock = setupEditor('raf-block', blockInput), updateWhite = setupEditor('raf-white', whiteInput);
        function beginOperation(message) {
            if (saving || dialogElement !== dialog) return null;
            saving = true;
            const states = new Map([...dialog.querySelectorAll('input, textarea, button')].map(control => [control, control.disabled]));
            for (const control of states.keys()) control.disabled = true;
            status(message);
            return states;
        }
        function endOperation(states) {
            saving = false;
            if (dialogElement !== dialog) return;
            for (const [control, disabled] of states) control.disabled = disabled;
            updateBlock(); updateWhite(); refreshHistory();
        }
        find('raf-preview').addEventListener('input', renderPreview);
        dialog.addEventListener('input', event => { if (event.target.matches('textarea')) { dirty = true; status('Unsaved changes.'); } });
        const close = () => { if (!saving) dialog.close(); };
        find('raf-close').addEventListener('click', close); find('raf-cancel').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const controls = [...dialog.querySelectorAll('input, textarea, button, a[href]')].filter(control => !control.disabled && control.getClientRects().length);
            const first = controls[0], last = controls.at(-1), active = document.activeElement;
            if ((event.shiftKey && (active === first || !controls.includes(active))) || (!event.shiftKey && active === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        });
        dialog.addEventListener('close', () => {
            clearTimeout(previewTimer); dialog.remove();
            if (dialogElement === dialog) { dialogElement = null; refreshHistory = refreshStatus = null; }
            if (previousFocus?.isConnected) previousFocus.focus();
        });
        dialog.addEventListener('raf-remote-settings', () => status(dirty ? 'Settings changed in another tab. Export these edits, then close and reopen before saving.' : 'Settings changed in another tab. Close and reopen to see the latest lists.', true));
        find('raf-history-search').addEventListener('input', () => { page = 0; refreshHistory(); });
        find('raf-previous').addEventListener('click', () => { page--; refreshHistory(); }); find('raf-next').addEventListener('click', () => { page++; refreshHistory(); });
        find('raf-clear-memory').addEventListener('click', async () => {
            const states = beginOperation('Clearing remembered decisions…'); if (!states) return;
            try { await clearMemory(); refreshStatus(); status('Remembered decisions cleared. Your lists and session history were kept.'); }
            catch (_) { status('Could not clear remembered decisions. Check userscript storage and try again.', true); }
            finally { endOperation(states); }
        });
        find('raf-export').addEventListener('click', () => {
            try {
                const value = { format: 'reddit-advanced-content-filter-settings', version: 1, ...draft() };
                const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = uiNode('a');
                link.href = url; link.download = 'reddit-filter-settings.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                status('Settings exported. Unsaved list edits are included.');
            } catch (error) { status('Could not export. ' + error.message, true); }
        });
        find('raf-import').addEventListener('click', () => find('raf-import-file').click());
        find('raf-import-file').addEventListener('change', async event => {
            const file = event.target.files[0]; if (!file) return;
            const states = beginOperation('Reading settings backup…'); if (!states) return;
            try {
                if (file.size > 2 * 1024 * 1024) throw new Error('Choose a settings file smaller than 2 MB.');
                const value = JSON.parse(await file.text());
                if (dialogElement !== dialog) return;
                if (value.format !== 'reddit-advanced-content-filter-settings' || value.version !== 1) throw new Error('Choose a Reddit Filter settings backup.');
                const imported = validateConfig(value);
                blockInput.value = imported.blocklist.join('\n'); whiteInput.value = imported.whitelist.join('\n');
                dirty = true; updateBlock(); updateWhite(); renderPreview(); status('Backup loaded into the editors. Review it, then choose Save changes.');
            } catch (error) { status('Import failed. ' + error.message + ' Your lists were kept.', true); }
            finally { event.target.value = ''; endOperation(states); }
        });
        find('raf-save').addEventListener('click', async () => {
            if (saving) return;
            let controlStates;
            try {
                const value = draft();
                controlStates = beginOperation('Checking saved settings…'); if (!controlStates) return;
                configurationEpoch++;
                const current = await readConfiguration();
                if (current.revision !== baseRevision) throw new Error('Settings changed in another tab. Export these edits, then close and reopen before saving.');
                status('Saving changes…');
                const revision = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
                await GM.setValue(settingsKey, { version: 1, revision, ...value });
                configurationEpoch++;
                settingsRevision = baseRevision = revision;
                await setRules(value.blocklist, value.whitelist);
                clearIssue('settings'); clearIssue('load'); collectPosts(document.body);
                dirty = false;
                status(settingsRevision === revision ? 'Saved. Filters updated without reloading the page.' : 'Saved, but newer settings arrived from another tab. Close and reopen to review them.', settingsRevision !== revision);
                updateCounterSoon();
            } catch (error) { status('Could not save. ' + error.message + ' Your edits are still here.', true); }
            finally { if (controlStates) endOperation(controlStates); }
        });
        document.body.append(dialog); dialog.showModal(); find('raf-heading').focus(); refreshHistory(); refreshStatus();
    }

    main();
})();
