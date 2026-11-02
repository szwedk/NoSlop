// StopTheSlop - Core Logic
// Shared functionality for AI content detection across platforms

class BaseAIDetector {
  constructor(platformName) {
    this.platformName = platformName;
    this.processedElements = new WeakSet();
    this.buttonAddedElements = new WeakSet();
    this.analysisCache = new Map();
    this.settings = { ...StopTheSlopConfig.DEFAULT_SETTINGS };

    this.analysisQueue = [];
    this.activeRequests = 0;
    this.isProcessingQueue = false;
    this.visibilityObserver = null;
    this.visibleElements = new Set();
    this.domChangeTimeout = null;
  }

  async init() {
    await this.loadSettings();

    console.log(`StopTheSlop: Initializing ${this.platformName}`);

    if (this.settings.enabled) {
      this.setupVisibilityObserver();
      this.observeDOM();
      this.addScanButtonsToExistingPosts();
    }

    this.setupSettingsListener();
    this.setupMessageListener();
  }

  setupSettingsListener() {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        const oldEnabled = this.settings.enabled;
        const oldEnableMinLength = this.settings.enableMinLength;
        const oldMinTextLength = this.settings.minTextLength;
        const oldShowCertainty = this.settings.showCertainty;
        const oldShowReasoning = this.settings.showReasoning;
        const oldModelProvider = this.settings.modelProvider;
        const oldOpenaiModel = this.settings.openaiModel;
        const oldClaudeModel = this.settings.claudeModel;
        const oldLmStudioModel = this.settings.lmStudioModel;
        const oldOpenrouterModel = this.settings.openrouterModel;
        const oldGeminiModel = this.settings.geminiModel;
        this.settings = { ...this.settings, ...changes.settings.newValue };

        // Handle extension being disabled
        if (!this.settings.enabled && oldEnabled) {
          this.removeAllScanButtons();
          this.buttonAddedElements = new WeakSet();
          this.processedElements = new WeakSet();
          return;
        }

        // Handle extension being re-enabled
        if (this.settings.enabled && !oldEnabled) {
          this.addScanButtonsToExistingPosts();
          return;
        }

        if (this.settings.enabled) {
          if (this.settings.enableMinLength !== oldEnableMinLength ||
            this.settings.minTextLength !== oldMinTextLength) {
            this.removeAllScanButtons(true); // Keep existing indicators (pending or finished) visible
            this.buttonAddedElements = new WeakSet();
          }
          this.addScanButtonsToExistingPosts();
        }

        // Refresh tooltips if certainty, reasoning, or model settings changed
        if (this.settings.showCertainty !== oldShowCertainty ||
          this.settings.showReasoning !== oldShowReasoning ||
          this.settings.modelProvider !== oldModelProvider ||
          this.settings.openaiModel !== oldOpenaiModel ||
          this.settings.claudeModel !== oldClaudeModel ||
          this.settings.lmStudioModel !== oldLmStudioModel ||
          this.settings.openrouterModel !== oldOpenrouterModel ||
          this.settings.geminiModel !== oldGeminiModel) {
          this.refreshAllTooltips();
        }
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'scanPage') {
        this.scanExistingPosts();
        sendResponse({ success: true });
      } else if (message.action === 'getStats') {
        sendResponse({
          processed: document.querySelectorAll('.sts-indicator').length,
          aiDetected: document.querySelectorAll('.sts-indicator.sts-high').length,
          queued: this.analysisQueue.length,
          cached: this.analysisCache.size
        });
      }
    });
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
    } catch (error) {
      console.error('StopTheSlop: Error loading settings:', error);
    }
  }

  setupVisibilityObserver() {
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.visibleElements.add(entry.target);
            this.boostVisibleItemsPriority();
          } else {
            this.visibleElements.delete(entry.target);
          }
        });
      },
      { rootMargin: '100px', threshold: 0.1 }
    );
  }

  boostVisibleItemsPriority() {
    if (this.analysisQueue.length === 0) return;

    this.analysisQueue.sort((a, b) => {
      const aVisible = this.visibleElements.has(a.element);
      const bVisible = this.visibleElements.has(b.element);

      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      return a.priority - b.priority;
    });
  }

  isContextValid() {
    try {
      // Accessing chrome.runtime.id is usually safe, but calling an API 
      // like getURL or sendMessage will throw if the context is invalidated.
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  observeDOM() {
    let pendingNodes = [];
    const observer = new MutationObserver((mutations) => {
      if (!this.settings.enabled) return;
      
      if (!this.isContextValid()) {
        console.debug('StopTheSlop: Extension context invalidated, stopping observer.');
        observer.disconnect();
        return;
      }

      // Accumulate all added nodes across debounced batches
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            pendingNodes.push(node);
          }
        });
      });

      clearTimeout(this.domChangeTimeout);
      this.domChangeTimeout = setTimeout(() => {
        const nodesToProcess = pendingNodes;
        pendingNodes = [];
        nodesToProcess.forEach((node) => {
          this.processNewContent(node);
        });
      }, 250);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  processNewContent(element) {
    const posts = this.findPosts(element);
    posts.forEach((post) => this.addScanButton(post));
  }

  addScanButtonsToExistingPosts() {
    if (!this.settings.enabled) return;
    const posts = this.findPosts(document.body);
    posts.forEach((post) => this.addScanButton(post));
  }

  removeAllScanButtons(keepIndicators = false) {
    // Remove scan buttons
    document.querySelectorAll('.sts-scan-btn').forEach(btn => btn.remove());

    if (keepIndicators) {
      // If keeping indicators, we still want to clean up tooltips that aren't attached to them
      // (e.g. tooltips from the scan buttons we just removed)
      const activeTooltips = new Set(
        Array.from(document.querySelectorAll('.sts-indicator'))
          .map(ind => ind._tooltipEl)
          .filter(Boolean)
      );

      document.querySelectorAll('body > .sts-tooltip').forEach(tip => {
        if (!activeTooltips.has(tip)) {
          tip.remove();
        }
      });
      return;
    }

    // Remove result/in-progress indicators (and their attached tooltips)
    document.querySelectorAll('.sts-indicator').forEach(indicator => {
      if (indicator._tooltipEl) {
        indicator._tooltipEl.remove();
      }
      indicator.remove();
    });

    // Remove any orphaned tooltips still attached to body
    document.querySelectorAll('body > .sts-tooltip').forEach(tip => tip.remove());
  }

  getProviderDisplayName() {
    const provider = this.settings.modelProvider || 'lmstudio';
    let modelName = provider;

    if (provider === 'openai') {
      modelName = this.settings.openaiModel || 'GPT-3.5 Turbo';
    } else if (provider === 'claude') {
      const rawModel = this.settings.claudeModel || 'claude-3-5-sonnet';
      modelName = rawModel
        .replace(/-/g, ' ')
        .replace(/\bclaude\b/i, 'Claude')
        .replace(/\b(\d)\s+(\d)\b/g, '$1.$2') // e.g. 3 5 -> 3.5
        .replace(/\bsonnet\b/i, 'Sonnet')
        .replace(/\bhaiku\b/i, 'Haiku')
        .replace(/\bopus\b/i, 'Opus')
        .replace(/\s\d{8}$/, ''); // Remove date suffix if present

      // Capitalize first letter of each word if not already done
      modelName = modelName.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
      // Fix "Claude" capitalization explicitly just in case
      modelName = modelName.replace(/claude/i, 'Claude').replace(/gpt/i, 'GPT');
    } else if (provider === 'gemini') {
      modelName = this.settings.geminiModel || 'Gemini Model';
      modelName = modelName
        .replace(/-/g, ' ')
        .replace(/\bgemini\b/i, 'Gemini')
        .replace(/\bflash\b/i, 'Flash')
        .replace(/\bpro\b/i, 'Pro');
      modelName = modelName.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
    } else if (provider === 'openrouter') {
      modelName = this.settings.openrouterModel || 'OpenRouter Model';
    } else if (provider === 'lmstudio') {
      let rawLocal = this.settings.lmStudioModel || 'Local Model';
      rawLocal = rawLocal.replace(/\.gguf$|\.bin$/i, '');
      modelName = rawLocal;
    }

    return modelName;
  }

  countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  isValidForAnalysis(text) {
    if (!text) return false;
    const wordCount = this.countWords(text);
    if (this.settings.enableMinLength) {
      return wordCount >= this.settings.minTextLength;
    }
    // If min length check is disabled, still enforce a baseline of at least 2 words
    return wordCount >= 2;
  }

  addScanButton(postData, retryCount = 0) {
    if (!this.settings.enabled) return;
    const { element, type } = postData;

    if (this.buttonAddedElements.has(element)) return;
    if (element.querySelector('.sts-indicator')) return;
    if (element.querySelector('.sts-scan-btn')) return;

    // Extract text once — needed for both the min-length check and the cache lookup
    const text = this.extractText(postData);

    if (!this.isValidForAnalysis(text)) {
      return;
    }

    // If this post was already analysed, restore the cached indicator instead of
    // showing a new scan button (e.g. after the extension is toggled off then on).
    const textHash = this.hashText(text);
    if (this.analysisCache.has(textHash)) {
      const cachedResult = this.analysisCache.get(textHash);
      const score = typeof cachedResult === 'object' ? cachedResult.score : cachedResult;
      const model = typeof cachedResult === 'object' ? cachedResult.model : null;
      this.processedElements.add(element);
      this.buttonAddedElements.add(element);
      this.showIndicator(element, type, score, true, null, cachedResult, model, null, textHash);
      return;
    }

    this.buttonAddedElements.add(element);

    // Safety check for extension context
    if (!this.isContextValid()) return;

    const iconUrl = chrome.runtime.getURL('icons/slopmoji.png');
    if (iconUrl.includes('invalid')) {
      console.debug('StopTheSlop: Invalid extension URL detected, aborting button creation.');
      return;
    }

    const button = document.createElement('button');
    button.className = 'sts-scan-btn';
    button.innerHTML = `<img src="${iconUrl}" class="sts-btn-img" alt="Check AI">`;

    const providerName = this.getProviderDisplayName();
    const tooltip = document.createElement('div');
    tooltip.className = 'sts-tooltip';
    tooltip.textContent = `Scan for AI-generated content (with ${providerName})`;
    document.body.appendChild(tooltip);

    const showTooltip = () => {
      // Update provider name on hover in case it changed
      tooltip.textContent = `Scan for AI-generated content (with ${this.getProviderDisplayName()})`;
      const rect = button.getBoundingClientRect();

      // Check if tooltip fits above (visual top edge > 0)
      // We calculate where the top would be: rect.top - 8 - height
      const tooltipHeight = tooltip.offsetHeight;
      const spaceAbove = rect.top - 8 - tooltipHeight;

      if (spaceAbove < 10) {
        // Show below
        tooltip.style.top = `${rect.bottom + 8}px`;
        tooltip.style.transform = 'translate(-50%, 0)';
        tooltip.classList.add('sts-tooltip-bottom');
      } else {
        // Show above (default)
        tooltip.style.top = `${rect.top - 8}px`;
        tooltip.style.transform = 'translate(-50%, -100%)';
        tooltip.classList.remove('sts-tooltip-bottom');
      }

      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.opacity = '1';
      tooltip.style.visibility = 'visible';
    };

    const hideTooltip = () => {
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
    };

    button.addEventListener('mouseenter', showTooltip);
    button.addEventListener('mouseleave', hideTooltip);

    // Clean up tooltip when button is removed
    const observer = new MutationObserver(() => {
      if (!document.contains(button)) {
        tooltip.remove();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    button.addEventListener('click', (e) => {
      tooltip.remove();
      observer.disconnect();
      e.preventDefault();
      e.stopPropagation();
      button.remove();
      this.buttonAddedElements.delete(element);
      this.queueAnalysis(postData, 0);
    });

    const success = this.positionScanButton(element, type, button);
    if (!success) {
      // Injection failed (no valid target found) - clean up and release lock
      button.remove();
      tooltip.remove();
      observer.disconnect();
      this.buttonAddedElements.delete(element);

      // Retry logic for dynamic content
      if (retryCount < 5) {
        // console.log(`StopTheSlop: Injection failed, retrying... (${retryCount + 1}/5)`);
        setTimeout(() => {
          this.addScanButton(postData, retryCount + 1);
        }, 1000);
      }
    }
  }

  scanExistingPosts() {
    const posts = this.findPosts(document.body);

    const sortedPosts = posts.sort((a, b) => {
      const aRect = a.element.getBoundingClientRect();
      const bRect = b.element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      const aInViewport = aRect.top < viewportHeight && aRect.bottom > 0;
      const bInViewport = bRect.top < viewportHeight && bRect.bottom > 0;

      if (aInViewport && !bInViewport) return -1;
      if (!aInViewport && bInViewport) return 1;
      return aRect.top - bRect.top;
    });

    sortedPosts.forEach((post, index) => {
      const rect = post.element.getBoundingClientRect();
      const inViewport = rect.top < window.innerHeight && rect.bottom > 0;
      const priority = inViewport ? 0 : index + 1;
      this.queueAnalysis(post, priority);
    });
  }

  queueAnalysis(postData, priority = 5) {
    const { element, type } = postData;

    if (this.processedElements.has(element)) return;
    if (this.analysisQueue.some(item => item.element === element)) return;

    const text = this.extractText(postData);

    if (!this.isValidForAnalysis(text)) {
      console.log('StopTheSlop: Text too short or invalid, skipping');
      return;
    }

    this.processedElements.add(element);

    const textHash = this.hashText(text);
    if (this.analysisCache.has(textHash)) {
      const cachedResult = this.analysisCache.get(textHash);
      const score = typeof cachedResult === 'object' ? cachedResult.score : cachedResult;
      const model = typeof cachedResult === 'object' ? cachedResult.model : null;
      // Pass the full cachedResult as details to support new structure (conclusion, signals)
      // and fallback to old structure (reasoning) if necessary
      this.showIndicator(element, type, score, true, null, cachedResult, model, null, textHash);
      return;
    }

    const currentModel = this.getProviderDisplayName();
    this.showIndicator(element, type, null, false, 'pending', null, currentModel, null, textHash);

    this.analysisQueue.push({ element, type, text, textHash, priority });

    if (this.visibilityObserver) {
      this.visibilityObserver.observe(element);
    }

    this.analysisQueue.sort((a, b) => {
      const aVisible = this.visibleElements.has(a.element);
      const bVisible = this.visibleElements.has(b.element);
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      return a.priority - b.priority;
    });

    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.analysisQueue.length > 0 && this.activeRequests < this.settings.maxConcurrent) {
      const item = this.analysisQueue.shift();
      if (!item) break;

      this.activeRequests++;

      this.analyzeItem(item).finally(() => {
        this.activeRequests--;
        if (this.analysisQueue.length > 0) {
          setTimeout(() => this.processQueue(), 0);
        }
      });
    }

    this.isProcessingQueue = false;
  }

  async analyzeItem(item) {
    const { element, type, text, textHash } = item;

    try {
      const result = await this.detectAI(text);
      this.analysisCache.set(textHash, result);
      // Pass the whole result object as details
      this.showIndicator(element, type, result.score, false, null, result, result.model, null, textHash);

      // Record scan to persistent history
      try {
        chrome.runtime.sendMessage({
          action: 'recordScan',
          score: result.score,
          platform: this.platformName
        });
      } catch (statsError) {
        console.debug('StopTheSlop: Could not record scan stats:', statsError);
      }
    } catch (error) {
      console.error('StopTheSlop: Analysis error:', error);
      const currentModel = this.getProviderDisplayName();
      this.showIndicator(element, type, null, false, 'error', null, currentModel, error.message, textHash);
    }
  }

  async detectAI(text, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'analyzeText',
          text: text,
          platform: this.platformName
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return {
          score: response.score,
          conclusion: response.conclusion,
          humanSignals: response.humanSignals,
          aiSignals: response.aiSignals,
          legacySignals: response.legacySignals,
          model: response.model
        };
      } catch (error) {
        if (error.message.includes('Receiving end does not exist') ||
          error.message.includes('Could not establish connection')) {
          if (i < retries - 1) {
            console.log(`StopTheSlop: Connection failed, retrying... (${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error('Failed to connect after multiple retries');
  }

  // Helper to build list DOM
  buildSignalList(signals, parent) {
    if (!signals || signals.length === 0) return;
    const ul = document.createElement('ul');
    ul.className = 'sts-signal-list';
    signals.forEach(sig => {
      const li = document.createElement('li');
      li.className = 'sts-signal-item';
      li.textContent = sig;
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }

  getIndicatorContent(score, isCached) {
    const aiCertainty = Math.round(score * 100);
    const humanCertainty = Math.round((1 - score) * 100);
    const showPercent = this.settings.showCertainty;
    const cachedSuffix = isCached ? ' (cached result)' : '';

    let icon, statusClass, basicTooltip;

    const anchors = this.settings.anchors || {
      highAi: 0.85,
      likelyAi: 0.7,
      ambiguous: 0.5,
      likelyHuman: 0.2
    };

    // AI-content score sensitivity thresholds
    if (score >= anchors.highAi) {
      icon = '🤖';
      statusClass = 'sts-high';
      basicTooltip = `Very likely AI-generated`;
      if (showPercent) basicTooltip += ` (${aiCertainty}% certain)`;
    } else if (score >= anchors.likelyAi) {
      icon = '🤖';
      statusClass = 'sts-likely-ai'; // Orange
      basicTooltip = `Likely AI-generated`;
      if (showPercent) basicTooltip += ` (${aiCertainty}% certain)`;
    } else if (score >= anchors.ambiguous) {
      icon = '🤔';
      statusClass = 'sts-medium'; // Yellow
      basicTooltip = `Ambiguous / Possibly AI-assisted`;
      if (showPercent) basicTooltip += ` (${aiCertainty}% certain)`;
    } else if (score > anchors.likelyHuman) {
      icon = '👤';
      statusClass = 'sts-low'; // Green
      basicTooltip = `Likely human`;
      if (showPercent) basicTooltip += ` (${humanCertainty}% certain)`;
    } else {
      icon = '👤';
      statusClass = 'sts-low'; // Green
      basicTooltip = `Clearly human`;
      if (showPercent) basicTooltip += ` (${humanCertainty}% certain)`;
    }

    basicTooltip += cachedSuffix;
    return { icon, statusClass, basicTooltip };
  }

  showIndicator(element, type, score, isCached, status = null, details = null, model = null, errorMessage = null, textHash = null) {
    const existingIndicator = element.querySelector('.sts-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    const indicator = document.createElement('div');
    indicator.className = 'sts-indicator';

    let icon, statusClass, basicTooltip;

    if (status === 'pending') {
      let slopmojiUrl = '';
      if (this.isContextValid()) {
        slopmojiUrl = chrome.runtime.getURL('icons/slopmoji.png');
        if (slopmojiUrl.includes('invalid')) slopmojiUrl = '';
      }
      
      icon = slopmojiUrl 
        ? `<img src="${slopmojiUrl}" class="sts-btn-img" alt="Analyzing">`
        : '⏳';
      statusClass = 'sts-pending';
      basicTooltip = 'Analyzing...';
    } else if (status === 'error') {
      icon = '⚠️';
      statusClass = 'sts-error';
      basicTooltip = errorMessage || 'Error analyzing content.';
      if (basicTooltip.toLowerCase().includes('rate limit') || basicTooltip.toLowerCase().includes('quota') || basicTooltip.toLowerCase().includes('billing')) {
        basicTooltip += '\n\Ensure you have a positive API credit balance.';
      }
    } else {
      const content = this.getIndicatorContent(score, isCached);
      icon = content.icon;
      statusClass = content.statusClass;
      basicTooltip = content.basicTooltip;
    }

    indicator.className += ` ${statusClass}`;
    indicator.innerHTML = `<span class="sts-icon">${icon}</span>`;

    // Store attributes
    if (score !== null && score !== undefined) {
      indicator.setAttribute('data-score', score);
      indicator.setAttribute('data-cached', isCached ? 'true' : 'false');
    }

    // Handle details (new object or legacy string)
    let conclusion = '';
    let humanSignals = [];
    let aiSignals = [];

    if (details) {
      if (typeof details === 'string') {
        // Legacy/Fallback handling
        conclusion = details;
        indicator.setAttribute('data-conclusion', conclusion);
      } else {
        conclusion = details.conclusion || details.reasoning || '';
        humanSignals = details.humanSignals || [];
        aiSignals = details.aiSignals || [];
        // Fallback for generic signals
        if (humanSignals.length === 0 && aiSignals.length === 0 && details.legacySignals) {
          // We might want to just dump them in conclusion or a generic list?
          // For now, let's treat them as mixed or just append to conclusion if short
        }

        indicator.setAttribute('data-conclusion', conclusion);
        if (humanSignals.length) indicator.setAttribute('data-human-signals', JSON.stringify(humanSignals));
        if (aiSignals.length) indicator.setAttribute('data-ai-signals', JSON.stringify(aiSignals));
        if (details.legacySignals && details.legacySignals.length) indicator.setAttribute('data-legacy-signals', JSON.stringify(details.legacySignals));
      }
    }

    // Always store model if available (for error or success)
    if (model) {
      indicator.setAttribute('data-model', model);
    }

    if (textHash) {
      indicator.setAttribute('data-text-hash', textHash);
    }

    if (status === 'error') {
      indicator.setAttribute('data-error-message', errorMessage || 'Error analyzing content.');
    }

    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'sts-tooltip';

    // Create header container
    const headerEl = document.createElement('div');
    headerEl.className = 'sts-tooltip-header';

    // Left side: Brand
    const brandEl = document.createElement('div');
    brandEl.className = 'sts-tooltip-brand';

    // Icon
    const iconImg = document.createElement('img');
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      iconImg.src = chrome.runtime.getURL('icons/slopmoji.png');
    }
    iconImg.className = 'sts-header-icon';
    brandEl.appendChild(iconImg);

    // Title
    const titleSpan = document.createElement('span');
    titleSpan.className = 'sts-header-title';
    titleSpan.textContent = 'Slopdetector';
    brandEl.appendChild(titleSpan);

    headerEl.appendChild(brandEl);

    // Right side: Model Badge (if available)
    if (model) {
      const modelBadge = document.createElement('div');
      modelBadge.className = 'sts-tooltip-model';
      modelBadge.textContent = model;
      headerEl.appendChild(modelBadge);
    }

    tooltipEl.appendChild(headerEl);

    const textContent = document.createElement('div');
    textContent.className = 'sts-tooltip-content';
    // textContent.style.whiteSpace = 'pre-wrap'; // Removed to allow HTML structure

    // Add Basic Tooltip (Status/Certainty)
    const statusDiv = document.createElement('div');
    statusDiv.textContent = basicTooltip;
    statusDiv.className = 'sts-tooltip-verdict';

    if (statusClass) {
      const colorClass = statusClass.replace('sts-', 'sts-text-');
      statusDiv.classList.add(colorClass);
    }
    textContent.appendChild(statusDiv);

    if (status !== 'error' && status !== 'pending') {
      // Add Conclusion (Always shown)
      if (conclusion) {
        const conclusionEl = document.createElement('div');
        conclusionEl.className = 'sts-tooltip-conclusion';
        conclusionEl.textContent = conclusion;
        textContent.appendChild(conclusionEl);
      }

      // Add Signals (Conditional on Show Signals setting)
      if (this.settings.showReasoning) {
        const showAiFirst = (score >= 0.7);

        const renderHuman = () => {
          if (humanSignals && humanSignals.length > 0) {
            const section = document.createElement('div');
            section.className = 'sts-tooltip-section';
            const header = document.createElement('div');
            header.className = 'sts-tooltip-section-header sts-header-human';
            header.textContent = 'Human Signals';
            section.appendChild(header);
            this.buildSignalList(humanSignals, section);
            textContent.appendChild(section);
          }
        };

        const renderAi = () => {
          if (aiSignals && aiSignals.length > 0) {
            const section = document.createElement('div');
            section.className = 'sts-tooltip-section';
            const header = document.createElement('div');
            header.className = 'sts-tooltip-section-header sts-header-ai';
            header.textContent = 'AI Signals';
            section.appendChild(header);
            this.buildSignalList(aiSignals, section);
            textContent.appendChild(section);
          }
        };

        if (showAiFirst) {
          renderAi();
          renderHuman();
        } else {
          renderHuman();
          renderAi();
        }

        // Fallback: Generic Signals
        if ((!humanSignals || humanSignals.length === 0) && (!aiSignals || aiSignals.length === 0)) {
          const legacySignals = details && details.legacySignals ? details.legacySignals : [];
          if (legacySignals && legacySignals.length > 0) {
            const section = document.createElement('div');
            section.className = 'sts-tooltip-section';
            const header = document.createElement('div');
            header.className = 'sts-tooltip-section-header';
            header.textContent = 'Signals';
            section.appendChild(header);
            this.buildSignalList(legacySignals, section);
            textContent.appendChild(section);
          }
        }
      }
    }

    tooltipEl.appendChild(textContent);

    // Create footer for re-scan action (only if not pending)
    if (status !== 'pending') {
      const footerEl = document.createElement('div');
      footerEl.className = 'sts-tooltip-footer';
      footerEl.textContent = `(Click to re-assess using ${this.getProviderDisplayName()})`;
      tooltipEl.appendChild(footerEl);
    }

    document.body.appendChild(tooltipEl);

    // Store reference to tooltip on indicator for easy updates
    indicator._tooltipEl = tooltipEl;

    const showTooltip = () => {
      const rect = indicator.getBoundingClientRect();

      // Check if tooltip fits above
      const tooltipHeight = tooltipEl.offsetHeight;
      const spaceAbove = rect.top - 8 - tooltipHeight;

      if (spaceAbove < 10) {
        // Show below
        tooltipEl.style.top = `${rect.bottom + 8}px`;
        tooltipEl.style.transform = 'translate(-50%, 0)';
        tooltipEl.classList.add('sts-tooltip-bottom');
      } else {
        // Show above (default)
        tooltipEl.style.top = `${rect.top - 8}px`;
        tooltipEl.style.transform = 'translate(-50%, -100%)';
        tooltipEl.classList.remove('sts-tooltip-bottom');
      }

      tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
      tooltipEl.style.opacity = '1';
      tooltipEl.style.visibility = 'visible';
    };

    const hideTooltip = () => {
      tooltipEl.style.opacity = '0';
      tooltipEl.style.visibility = 'hidden';
    };

    indicator.addEventListener('mouseenter', showTooltip);
    indicator.addEventListener('mouseleave', hideTooltip);

    // Clean up tooltip when indicator is removed
    const cleanupObserver = new MutationObserver(() => {
      if (!document.contains(indicator)) {
        tooltipEl.remove();
        cleanupObserver.disconnect();
      }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });

    // Handle clicks for re-scan (error or success)
    if (status !== 'pending') {
      indicator.style.cursor = 'pointer';
      indicator.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tooltipEl.remove();
        cleanupObserver.disconnect();
        indicator.remove();

        // Clear from cache if we have the hash
        if (textHash && this.analysisCache.has(textHash)) {
          this.analysisCache.delete(textHash);
        }

        this.processedElements.delete(element);
        this.queueAnalysis({ element, type }, 0);
      });
    }

    this.positionIndicator(element, type, indicator);
  }

  refreshAllTooltips() {
    // Find all existing indicators and update their tooltips
    const indicators = document.querySelectorAll('.sts-indicator');
    indicators.forEach((indicator) => {
      const score = parseFloat(indicator.getAttribute('data-score'));
      const isCached = indicator.getAttribute('data-cached') === 'true';
      // Read new attributes
      const conclusion = indicator.getAttribute('data-conclusion');
      const humanSignalsRaw = indicator.getAttribute('data-human-signals');
      const aiSignalsRaw = indicator.getAttribute('data-ai-signals');
      const legacySignalsRaw = indicator.getAttribute('data-legacy-signals');
      let humanSignals = [], aiSignals = [], legacySignals = [];
      try { if (humanSignalsRaw) humanSignals = JSON.parse(humanSignalsRaw); } catch (e) { }
      try { if (aiSignalsRaw) aiSignals = JSON.parse(aiSignalsRaw); } catch (e) { }
      try { if (legacySignalsRaw) legacySignals = JSON.parse(legacySignalsRaw); } catch (e) { }

      const model = indicator.getAttribute('data-model');
      const errorMessage = indicator.getAttribute('data-error-message');

      if ((!isNaN(score) || errorMessage) && indicator._tooltipEl) {
        // Determine tooltip content basic part
        let basicTooltip = '';
        let statusClass = '';

        if (!isNaN(score)) {
          const content = this.getIndicatorContent(score, isCached);
          basicTooltip = content.basicTooltip;
          statusClass = content.statusClass;
        } else if (errorMessage) {
          basicTooltip = errorMessage;
          statusClass = 'sts-error';
          if (basicTooltip.toLowerCase().includes('rate limit') || basicTooltip.toLowerCase().includes('quota') || basicTooltip.toLowerCase().includes('billing')) {
            basicTooltip += '\nEnsure you have a positive API credit balance.';
          }
        }

        // Clear content
        indicator._tooltipEl.innerHTML = '';

        // Create header container
        const headerEl = document.createElement('div');
        headerEl.className = 'sts-tooltip-header';

        // Left side: Brand
        const brandEl = document.createElement('div');
        brandEl.className = 'sts-tooltip-brand';

        // Icon
        const iconImg = document.createElement('img');
        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
          iconImg.src = chrome.runtime.getURL('icons/slopmoji.png');
        }
        iconImg.className = 'sts-header-icon';
        brandEl.appendChild(iconImg);

        // Title
        const titleSpan = document.createElement('span');
        titleSpan.className = 'sts-header-title';
        titleSpan.textContent = 'Slopdetector';
        brandEl.appendChild(titleSpan);

        headerEl.appendChild(brandEl);

        // Right side: Model Badge
        if (model) {
          const modelBadge = document.createElement('div');
          modelBadge.className = 'sts-tooltip-model';
          modelBadge.textContent = model;
          headerEl.appendChild(modelBadge);
        }

        indicator._tooltipEl.appendChild(headerEl);

        // Rebuild Content
        const textContent = document.createElement('div');
        textContent.className = 'sts-tooltip-content';

        const statusDiv = document.createElement('div');
        statusDiv.textContent = basicTooltip;
        statusDiv.className = 'sts-tooltip-verdict';

        if (statusClass) {
          const colorClass = statusClass.replace('sts-', 'sts-text-');
          statusDiv.classList.add(colorClass);
        }
        textContent.appendChild(statusDiv);

        // Add components if not error
        if (!errorMessage) {
          if (conclusion) {
            const conclusionEl = document.createElement('div');
            conclusionEl.className = 'sts-tooltip-conclusion';
            conclusionEl.textContent = conclusion;
            textContent.appendChild(conclusionEl);
          }

          if (this.settings.showReasoning) {
            const showAiFirst = (score >= 0.7);

            const renderHuman = () => {
              if (humanSignals && humanSignals.length > 0) {
                const section = document.createElement('div');
                section.className = 'sts-tooltip-section';
                const header = document.createElement('div');
                header.className = 'sts-tooltip-section-header sts-header-human';
                header.textContent = 'Human Signals';
                section.appendChild(header);
                this.buildSignalList(humanSignals, section);
                textContent.appendChild(section);
              }
            };

            const renderAi = () => {
              if (aiSignals && aiSignals.length > 0) {
                const section = document.createElement('div');
                section.className = 'sts-tooltip-section';
                const header = document.createElement('div');
                header.className = 'sts-tooltip-section-header sts-header-ai';
                header.textContent = 'AI Signals';
                section.appendChild(header);
                this.buildSignalList(aiSignals, section);
                textContent.appendChild(section);
              }
            };

            if (showAiFirst) {
              renderAi();
              renderHuman();
            } else {
              renderHuman();
              renderAi();
            }

            // Fallback parsing for legacy attributes if separated signals are missing
            if ((!humanSignals || humanSignals.length === 0) && (!aiSignals || aiSignals.length === 0)) {
              if (legacySignals && legacySignals.length > 0) {
                const section = document.createElement('div');
                section.className = 'sts-tooltip-section';
                const header = document.createElement('div');
                header.className = 'sts-tooltip-section-header';
                header.textContent = 'Signals';
                section.appendChild(header);
                this.buildSignalList(legacySignals, section);
                textContent.appendChild(section);
              }
            }
          }
        }

        indicator._tooltipEl.appendChild(textContent);

        // Footer
        const footerEl = document.createElement('div');
        footerEl.className = 'sts-tooltip-footer';
        footerEl.textContent = `(Click to re-assess using ${this.getProviderDisplayName()})`;
        indicator._tooltipEl.appendChild(footerEl);
      }
    });
  }


  // Abstract methods - must be implemented by platform-specific classes
  findPosts(container) {
    throw new Error('findPosts must be implemented by subclass');
  }

  extractText(postData) {
    throw new Error('extractText must be implemented by subclass');
  }

  positionScanButton(element, type, button) {
    throw new Error('positionScanButton must be implemented by subclass');
  }

  positionIndicator(element, type, indicator) {
    throw new Error('positionIndicator must be implemented by subclass');
  }
}

// Initialization helper for SPA compatibility
function initializeDetector(DetectorClass, platformName) {
  let detector = null;

  function initDetector() {
    if (detector) return;
    detector = new DetectorClass();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDetector);
  } else {
    initDetector();
  }

  // Re-check when URL changes (SPA navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      urlObserver.disconnect();
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (detector) {
          detector.addScanButtonsToExistingPosts();
        }
      }, 500);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // Periodic check to catch missed posts (extended for LinkedIn-style dynamic content)
  let checkCount = 0;
  const periodicCheck = setInterval(() => {
    if (detector && checkCount < 10) {
      detector.addScanButtonsToExistingPosts();
      checkCount++;
    } else {
      clearInterval(periodicCheck);
    }
  }, 2000);

  return () => detector;
}
