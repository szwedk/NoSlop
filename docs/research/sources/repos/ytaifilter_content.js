// ─── Constants ──────────────────────────────────────────────────────────────
const AI_LABEL_STRINGS = [
  "altered or synthetic content",
  "how this was made",
  "ai-generated",
  "ai generated",
  "synthetic content",
  "generated with ai",
  "made with ai",
  "unrealistic content",      
];

const BADGE_CONTAINER_SELECTORS = [
  "ytd-video-primary-info-renderer",    
  "ytd-shorts-player-renderer",        
  "#description-text",                 
  "#description-inner",
  "ytd-badge-supported-renderer",      
  "yt-badge-shape",                    
  "[class*='badge-shape']",
  "[class*='disclosure']",
  "[class*='ai-label']",
];

const LABEL_TEXT_SELECTORS = [
  "yt-formatted-string",
  "span",
  "div",
  "[class*='badge']",
  "[class*='label']",
  "[aria-label]",
  "[title]",
];

const CARD_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-reel-item-renderer",     // Shorts shelf
  "ytd-playlist-video-renderer",
].join(", ");

// ─── State ──────────────────────────────────────────────────────────────────

let enabled = true;
let hiddenCount = 0;
let processedCards = new WeakSet();
let observer = null;
let debounceTimer = null;

function querySelectorAllDeep(root, selector) {
  const results = [];
  // Direct query on root
  const elements = root.querySelectorAll(selector);
  results.push(...elements);

  // Recursively traverse shadow roots
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.shadowRoot && node.shadowRoot.mode === "open") {
        results.push(...querySelectorAllDeep(node.shadowRoot, selector));
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {}
  return results;
}


function hasAILabel(container) {
  const badgeCandidates = querySelectorAllDeep(container, BADGE_CONTAINER_SELECTORS.join(", "));
  if (BADGE_CONTAINER_SELECTORS.some(sel => container.matches?.(sel))) {
    badgeCandidates.push(container);
  }

  for (const candidate of badgeCandidates) {
    const textElements = querySelectorAllDeep(candidate, LABEL_TEXT_SELECTORS.join(", "));
    for (const el of textElements) {
      const text = el.textContent?.toLowerCase().trim() || "";
      if (AI_LABEL_STRINGS.some(s => text.includes(s))) {
        return true;
      }
      const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
      const title = el.getAttribute("title")?.toLowerCase() || "";
      if (AI_LABEL_STRINGS.some(s => aria.includes(s) || title.includes(s))) {
        return true;
      }
    }
  }

  return false;
}

// ─── Hide / restore ─────────────────────────────────────────────────────────

function hideElement(el) {
  if (processedCards.has(el)) return;
  processedCards.add(el);
  el.style.setProperty("display", "none", "important");
  hiddenCount++;
  updateBadge();
}

function restoreAll() {
  document.querySelectorAll(CARD_SELECTORS).forEach(card => {
    card.style.removeProperty("display");
  });
  const shorts = document.querySelector("ytd-shorts-player-renderer");
  if (shorts) shorts.style.removeProperty("display");
  BADGE_CONTAINER_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.style.removeProperty("display"));
  });
  processedCards = new WeakSet(); // reassign
  hiddenCount = 0;
  updateBadge();
}

// ─── Scanning logic ──────────────────────────────────────────────────────────

function scanCard(card) {
  if (!enabled || processedCards.has(card)) return false;
  if (hasAILabel(card)) {
    hideElement(card);
    return true;
  }
  return false;
}

function scanShortsPlayer() {
  if (!enabled) return;
  const player = document.querySelector("ytd-shorts-player-renderer");
  if (player && !processedCards.has(player) && hasAILabel(player)) {
    hideElement(player);
  }
}

function scanAll() {
  if (!enabled) return;
  const cards = document.querySelectorAll(CARD_SELECTORS);
  for (const card of cards) {
    scanCard(card);
  }
  scanShortsPlayer();

function processMutations(mutations) {
  if (!enabled) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const addedNodes = new Set();
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          addedNodes.add(node);
        }
      }
    }
    for (const node of addedNodes) {
      if (node.matches?.(CARD_SELECTORS)) {
        scanCard(node);
      } else {
        const cards = node.querySelectorAll?.(CARD_SELECTORS);
        if (cards) {
          for (const card of cards) {
            scanCard(card);
          }
        }
        if (node.matches?.("ytd-shorts-player-renderer") || node.querySelector?.("ytd-shorts-player-renderer")) {
          scanShortsPlayer();
        }
      }
    }
    scanShortsPlayer();
  }, 150); // 150ms 
}

function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(processMutations);
  // Observe the main content area to reduce noise
  const target = document.querySelector("#contents") || document.documentElement;
  observer.observe(target, {
    childList: true,
    subtree: true,
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(debounceTimer);
}

// ─── Badge update ──────────────────────────────────────────────────────────

function updateBadge() {
  chrome.runtime.sendMessage({ type: "UPDATE_COUNT", count: hiddenCount }).catch(() => {});
}

// ─── Toggle on/off ─────────────────────────────────────────────────────────

function setEnabled(value) {
  enabled = value;
  if (enabled) {
    processedCards = new WeakSet();
    hiddenCount = 0;
    scanAll();
    startObserver();
    updateBadge();
  } else {
    stopObserver();
    restoreAll();
    updateBadge();
  }
}

// ─── Message listener ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SET_ENABLED") {
    setEnabled(msg.enabled);
    sendResponse({ success: true });
  }
  if (msg.type === "GET_COUNT") {
    sendResponse({ count: hiddenCount });
  }
  return true; // async
});

// ─── Init ──────────────────────────────────────────────────────────────────

chrome.storage.sync.get({ enabled: true }, ({ enabled: savedEnabled }) => {
  enabled = savedEnabled;
  if (enabled) {
    requestIdleCallback(() => {
      scanAll();
      startObserver();
    }, { timeout: 2000 });
  } else {
  }
});
}