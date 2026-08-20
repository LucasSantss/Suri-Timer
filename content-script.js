(() => {
  const MESSAGE_NAMESPACE = 'suri-timer-ext';
  const conversations = new Map(); // normalizedPhone -> { phone, name, dateAnswer: Date }

  let config = null;
  let domainEnabled = true;
  let colorInterval = null;
  let refreshTimer = null;
  let observerInstalled = false;
  let lastKnownPhone = null;

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isDomainEnabled(cfg) {
    const domains = cfg?.domains;
    if (!domains || typeof domains !== 'object') {
      return true;
    }
    const hostname = window.location.hostname;
    if (Object.prototype.hasOwnProperty.call(domains, hostname)) {
      return domains[hostname] !== false;
    }
    return true;
  }

  function getActiveThreshold(minutes, thresholds) {
    const sorted = [...thresholds].sort((a, b) => a.minMinutes - b.minMinutes);

    let winner = sorted[0] || { minMinutes: 0, color: '#22c55e' };
    for (const rule of sorted) {
      if (minutes >= rule.minMinutes) {
        winner = rule;
      }
    }

    return winner;
  }

  function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(34,197,94,${alpha})`;
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Inject the (scoped) highlight style for the participant name, plus the
  // Dark Reader-style page inversion used by the "Escuro" theme (only once).
  let __suri_injected_styles = false;
  function injectGlobalStyles() {
    if (__suri_injected_styles) return;
    __suri_injected_styles = true;

    const css = `
      .suri-timer-highlight {
        display: inline-block !important;
        padding: 2px 8px !important;
        border-radius: 8px !important;
        box-shadow: 0 6px 18px rgba(2,6,23,0.12) !important;
        transition: background-color 240ms ease, box-shadow 240ms ease, color 240ms ease;
      }

      html.suri-dark-mode {
        background: #fff !important;
        filter: invert(1) hue-rotate(180deg) !important;
      }

      html.suri-dark-mode img,
      html.suri-dark-mode video,
      html.suri-dark-mode picture,
      html.suri-dark-mode canvas,
      html.suri-dark-mode iframe,
      html.suri-dark-mode svg {
        filter: invert(1) hue-rotate(180deg) !important;
      }

      /* Our own colored elements must keep their real color: cancel the
         page-wide inversion by inverting them a second time. */
      html.suri-dark-mode .suri-timer-highlight,
      html.suri-dark-mode td[data-suri-colored="true"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }
    `;

    const style = document.createElement('style');
    style.setAttribute('data-suri', 'global-style');
    style.textContent = css;
    document.head?.appendChild(style);
  }

  function applyPageTheme(theme) {
    injectGlobalStyles();
    document.documentElement.classList.toggle('suri-dark-mode', theme === 'dark');
  }

  function findParticipantNameElement() {
    try {
      const container = window.SuriTimerSelectors?.findDetailsPanel(document) || document.body;
      const candidates = Array.from(container.querySelectorAll('h1,h2,h3,strong,b,div,span,p'));

      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (!text) continue;
        if (text.length < 4 || text.length > 60) continue;
        if (/\d/.test(text)) continue;
        if (text.split(/\s+/).length >= 2) {
          return el;
        }
      }
    } catch (err) {
      // ignore
    }
    return null;
  }

  let __last_highlight_el = null;
  function clearHighlight() {
    if (__last_highlight_el) {
      __last_highlight_el.classList.remove('suri-timer-highlight');
      __last_highlight_el.style.backgroundColor = '';
      __last_highlight_el.style.color = '';
      __last_highlight_el = null;
    }
  }

  function applyNameHighlight(color) {
    injectGlobalStyles();
    const el = findParticipantNameElement();
    if (!el) {
      clearHighlight();
      return;
    }

    if (__last_highlight_el && __last_highlight_el !== el) {
      __last_highlight_el.classList.remove('suri-timer-highlight');
      __last_highlight_el.style.backgroundColor = '';
      __last_highlight_el.style.color = '';
    }

    el.classList.add('suri-timer-highlight');
    el.style.backgroundColor = hexToRgba(color, 0.16);
    el.style.setProperty('--suri-accent', color);
    __last_highlight_el = el;
  }

  function registerConversation(phone, dateAnswerIso, name) {
    const parsedDate = new Date(dateAnswerIso);
    if (Number.isNaN(parsedDate.getTime())) {
      return;
    }

    conversations.set(phone, { phone, name: name || null, dateAnswer: parsedDate });
  }

  function refreshActiveConversationColor() {
    if (!domainEnabled || !window.SuriTimerSelectors) {
      clearHighlight();
      return;
    }

    const phone = normalizePhone(window.SuriTimerSelectors.findPhoneField(document));
    lastKnownPhone = phone || null;

    if (!phone) {
      clearHighlight();
      return;
    }

    const conversation = conversations.get(phone);
    if (!conversation) {
      clearHighlight();
      return;
    }

    const elapsedMinutes = (Date.now() - conversation.dateAnswer.getTime()) / 60000;
    const rule = getActiveThreshold(elapsedMinutes, config?.thresholds || [{ minMinutes: 0, color: '#22c55e' }]);

    try {
      applyNameHighlight(rule.color || '#22c55e');
    } catch (e) {
      // ignore
    }
  }

  // --- Queue list (left sidebar) row coloring ---
  // Rows are <tr class="messaginguseritemgrid"> and the client's display name
  // (or phone, when no name is set) lives in a child ".messaginglist-name".
  const ROW_SELECTOR = 'tr.messaginguseritemgrid';
  const ROW_NAME_SELECTOR = '.messaginglist-name';

  function getConversationRows() {
    return Array.from(document.querySelectorAll(ROW_SELECTOR));
  }

  // Lowercase, strip accents/emoji/punctuation, collapse whitespace — so
  // "Raquel Lacerda 🌸" and "Luciana - A.M LUCIANA MOTA" can still be matched
  // against the plain API names ("Raquel Lacerda", "A.M LUCIANA MOTA").
  function normalizeNameForMatch(value) {
    return (value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesLikelyMatch(a, b) {
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;

    const wordsA = new Set(a.split(' ').filter((w) => w.length >= 3));
    const wordsB = b.split(' ').filter((w) => w.length >= 3);
    return wordsB.some((word) => wordsA.has(word));
  }

  function matchConversationForText(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    const digits = normalizePhone(trimmed);
    if (digits.length >= 10) {
      const byPhone = conversations.get(digits);
      if (byPhone) return byPhone;
    }

    const normalizedText = normalizeNameForMatch(trimmed);
    if (!normalizedText) return null;

    for (const conversation of conversations.values()) {
      const normalizedName = normalizeNameForMatch(conversation.name);
      if (normalizedName && namesLikelyMatch(normalizedText, normalizedName)) {
        return conversation;
      }
    }

    return null;
  }

  // Target the cell that holds the name/tags text, not the avatar cell — the
  // avatar <img> has its own dark-mode filter exemption, and nesting two
  // independent invert-cancelling filters would double-cancel the image.
  function getStyleTargetCell(row) {
    const nameEl = row.querySelector(ROW_NAME_SELECTOR);
    return (nameEl && nameEl.closest('td')) || row.querySelector('td');
  }

  function styleRow(row, color) {
    const cell = getStyleTargetCell(row);
    if (!cell) return;
    cell.style.setProperty('box-shadow', `inset 4px 0 0 0 ${color}`, 'important');
    cell.setAttribute('data-suri-colored', 'true');
  }

  function clearRowStyle(row) {
    const cell = row.querySelector('td[data-suri-colored="true"]');
    if (!cell) return;
    cell.style.removeProperty('box-shadow');
    cell.removeAttribute('data-suri-colored');
  }

  function refreshQueueColors() {
    if (!domainEnabled) {
      return;
    }

    const rows = getConversationRows();
    for (const row of rows) {
      const nameEl = row.querySelector(ROW_NAME_SELECTOR);
      const text = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent || '') : '';
      const conversation = matchConversationForText(text);

      if (!conversation) {
        clearRowStyle(row);
        continue;
      }

      const elapsedMinutes = (Date.now() - conversation.dateAnswer.getTime()) / 60000;
      const rule = getActiveThreshold(elapsedMinutes, config?.thresholds || [{ minMinutes: 0, color: '#22c55e' }]);

      try {
        styleRow(row, rule.color || '#22c55e');
      } catch (e) {
        // ignore
      }
    }
  }

  function clearAllRowStyles() {
    for (const row of getConversationRows()) {
      clearRowStyle(row);
    }
  }

  function refreshAll() {
    refreshActiveConversationColor();
    refreshQueueColors();
  }

  function startColorLoop() {
    if (colorInterval) return;
    colorInterval = setInterval(refreshAll, 1000);
  }

  function stopColorLoop() {
    if (colorInterval) {
      clearInterval(colorInterval);
      colorInterval = null;
    }
  }

  function handleMessage(event) {
    if (event.source !== window) {
      return;
    }

    if (!event.data || event.data.source !== MESSAGE_NAMESPACE) {
      return;
    }

    if (event.data.type !== 'CONVERSATION_UPDATE') {
      return;
    }

    const payload = event.data.payload || {};
    const phone = normalizePhone(payload.phone);
    const dateAnswer = payload.dateAnswer;

    if (!phone || !dateAnswer) {
      return;
    }

    registerConversation(phone, dateAnswer, payload.name);
  }

  function installObserver() {
    if (observerInstalled || !document.body) {
      return;
    }
    observerInstalled = true;

    const observer = new MutationObserver(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(refreshAll, 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function loadConfig() {
    if (!window.SuriTimerStorage) {
      return;
    }

    config = await window.SuriTimerStorage.getConfig();
    domainEnabled = isDomainEnabled(config);
  }

  function applyConfig(nextConfig) {
    config = nextConfig || (window.SuriTimerStorage ? window.SuriTimerStorage.getDefaultConfig() : { thresholds: [{ minMinutes: 0, color: '#22c55e' }] });
    domainEnabled = isDomainEnabled(config);

    if (!domainEnabled) {
      clearHighlight();
      clearAllRowStyles();
      applyPageTheme('light');
      stopColorLoop();
      return;
    }

    applyPageTheme(config.theme);
    startColorLoop();
    installObserver();
    refreshAll();
  }

  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes['suriTimerConfig']) {
        return;
      }

      const nextConfig = changes['suriTimerConfig'].newValue;
      if (nextConfig) {
        applyConfig(nextConfig);
      }
    });
  }

  async function init() {
    await loadConfig();
    if (!domainEnabled) {
      return;
    }
    applyPageTheme(config?.theme);
    startColorLoop();
    installObserver();
    refreshAll();
  }

  window.addEventListener('message', handleMessage, false);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
