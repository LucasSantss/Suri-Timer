(() => {
  const MESSAGE_NAMESPACE = 'suri-timer-ext';
  const conversationCache = new Map();
  let uiHost = null;
  let timerInterval = null;
  let config = null;
  let lastKnownPhone = null;
  let lastKnownStartDate = null;
  let refreshTimer = null;

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);

    if (hours > 0) {
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

  function applyThemeColors() {
    if (!uiHost || !uiHost.shadowRoot) {
      return;
    }

    const theme = config?.theme || 'dark';
    const palette = theme === 'light'
      ? {
          bg: 'rgba(255,255,255,0.96)',
          fg: '#111827',
          border: 'rgba(15, 23, 42, 0.12)',
          muted: '#4b5563'
        }
      : {
          bg: 'rgba(15, 23, 42, 0.9)',
          fg: '#f8fafc',
          border: 'rgba(148, 163, 184, 0.25)',
          muted: '#cbd5e1'
        };

    const wrapper = uiHost.shadowRoot.querySelector('.timer-badge');
    if (!wrapper) {
      return;
    }

    wrapper.style.setProperty('--timer-bg', palette.bg);
    wrapper.style.setProperty('--timer-fg', palette.fg);
    wrapper.style.setProperty('--timer-border', palette.border);
    wrapper.style.setProperty('--timer-muted', palette.muted);
  }

  // Inject global page theme and highlight styles (only once)
  let __suri_injected_styles = false;
  function injectGlobalStyles() {
    if (__suri_injected_styles) return;
    __suri_injected_styles = true;

    const css = `
      html.suri-theme-dark, html.suri-theme-dark * {
        background-color: #0f1724 !important;
        color: #e5edf8 !important;
        border-color: rgba(148,163,184,0.12) !important;
        box-shadow: none !important;
        background-image: none !important;
      }

      html.suri-theme-light, html.suri-theme-light * {
        background-color: #ffffff !important;
        color: #111827 !important;
        border-color: rgba(15,23,42,0.06) !important;
      }

      .suri-timer-highlight {
        display: inline-block !important;
        padding: 2px 8px !important;
        border-radius: 8px !important;
        box-shadow: 0 6px 18px rgba(2,6,23,0.12) !important;
        transition: background-color 240ms ease, box-shadow 240ms ease, color 240ms ease;
      }
    `;

    const style = document.createElement('style');
    style.setAttribute('data-suri', 'global-style');
    style.textContent = css;
    document.head?.appendChild(style);
  }

  function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(34,197,94,${alpha})`;
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean.length === 3 ? clean.split('').map(c=>c+c).join('') : clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  function applyNameHighlight(color) {
    injectGlobalStyles();
    const el = findParticipantNameElement();
    if (!el) {
      if (__last_highlight_el) {
        __last_highlight_el.classList.remove('suri-timer-highlight');
        __last_highlight_el.style.backgroundColor = '';
        __last_highlight_el.style.color = '';
        __last_highlight_el = null;
      }
      return;
    }

    if (__last_highlight_el && __last_highlight_el !== el) {
      __last_highlight_el.classList.remove('suri-timer-highlight');
      __last_highlight_el.style.backgroundColor = '';
      __last_highlight_el.style.color = '';
    }

    el.classList.add('suri-timer-highlight');
    const bg = hexToRgba(color, 0.12);
    el.style.backgroundColor = bg;
    el.style.setProperty('--suri-accent', color);
    __last_highlight_el = el;
  }

  function applyPageThemeClass() {
    injectGlobalStyles();
    if (!config || !config.theme) return;
    document.documentElement.classList.remove('suri-theme-dark', 'suri-theme-light');
    document.documentElement.classList.add(`suri-theme-${config.theme}`);
  }

  function renderTimer() {
    if (!uiHost || !uiHost.shadowRoot) {
      return;
    }

    const valueNode = uiHost.shadowRoot.querySelector('.timer-value');
    const labelNode = uiHost.shadowRoot.querySelector('.timer-label');

    if (!valueNode || !labelNode) {
      return;
    }

    if (!lastKnownStartDate) {
      valueNode.textContent = '00:00';
      labelNode.textContent = 'Atendimento';
      uiHost.style.setProperty('--timer-accent', '#8b5cf6');
      try { applyNameHighlight(null); applyPageThemeClass(); } catch (e) {}
      return;
    }

    const elapsed = Date.now() - lastKnownStartDate.getTime();
    const minutes = elapsed / 60000;
    const activeRule = getActiveThreshold(minutes, config?.thresholds || [{ minMinutes: 0, color: '#22c55e' }]);
    const accentColor = activeRule.color || '#22c55e';

    valueNode.textContent = formatElapsed(elapsed);
    labelNode.textContent = 'Atendimento';
    uiHost.style.setProperty('--timer-accent', accentColor);
    try {
      applyNameHighlight(accentColor);
      applyPageThemeClass();
    } catch (e) {}
  }

  function ensureUi() {
    if (uiHost) {
      return;
    }

    uiHost = document.createElement('div');
    uiHost.id = 'suri-attendance-timer';
    uiHost.setAttribute('aria-live', 'polite');
    uiHost.style.position = 'fixed';
    uiHost.style.top = '18px';
    uiHost.style.right = '18px';
    uiHost.style.zIndex = '2147483647';
    uiHost.style.pointerEvents = 'none';
    uiHost.style.fontFamily = 'system-ui, sans-serif';

    const shadow = uiHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          --timer-bg: rgba(15, 23, 42, 0.9);
          --timer-fg: #f8fafc;
          --timer-border: rgba(148, 163, 184, 0.25);
          --timer-muted: #cbd5e1;
          --timer-accent: #22c55e;
        }

        .timer-badge {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 9999px;
          background: var(--timer-bg);
          color: var(--timer-fg);
          border: 1px solid var(--timer-border);
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(8px);
          user-select: none;
        }

        .timer-label {
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--timer-muted);
          white-space: nowrap;
        }

        .timer-value {
          font-size: 14px;
          font-weight: 800;
          line-height: 1;
          color: var(--timer-accent);
          white-space: nowrap;
        }
      </style>
      <div class="timer-badge">
        <span class="timer-label">Atendimento</span>
        <span class="timer-value">00:00</span>
      </div>
    `;

    document.body.appendChild(uiHost);
    applyThemeColors();
    renderTimer();
  }

  function startTimerLoop() {
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timerInterval = setInterval(() => {
      renderTimer();
    }, 1000);
  }

  function applyConversationStart(isoDate, phone) {
    if (!isoDate) {
      return;
    }

    const parsedDate = new Date(isoDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return;
    }

    lastKnownStartDate = parsedDate;
    lastKnownPhone = phone || lastKnownPhone;

    ensureUi();
    renderTimer();
    startTimerLoop();
  }

  function updateActiveConversationFromDom() {
    if (!window.SuriTimerSelectors) {
      return;
    }

    const phone = window.SuriTimerSelectors.findPhoneField(document);
    if (!phone) {
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return;
    }

    const startIso = conversationCache.get(normalizedPhone);
    if (startIso) {
      if (lastKnownPhone !== normalizedPhone) {
        lastKnownPhone = normalizedPhone;
      }
      applyConversationStart(startIso, normalizedPhone);
      return;
    }

    if (lastKnownPhone !== normalizedPhone) {
      lastKnownPhone = normalizedPhone;
      lastKnownStartDate = null;
      ensureUi();
      renderTimer();
    }
  }

  async function loadConfig() {
    if (!window.SuriTimerStorage) {
      return;
    }

    config = await window.SuriTimerStorage.getConfig();
    ensureUi();
    applyThemeColors();
    renderTimer();
  }

  function applyConfig(nextConfig) {
    config = nextConfig || { theme: 'dark', thresholds: [{ minMinutes: 0, color: '#22c55e' }, { minMinutes: 5, color: '#facc15' }, { minMinutes: 15, color: '#ef4444' }] };
    applyThemeColors();
    renderTimer();
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
    const conversationDateAnswer = payload.conversationDateAnswer;

    if (!phone || !conversationDateAnswer) {
      return;
    }

    conversationCache.set(phone, conversationDateAnswer);
    const currentPhone = normalizePhone(lastKnownPhone || window.SuriTimerSelectors?.findPhoneField(document) || '');

    if (currentPhone === phone) {
      applyConversationStart(conversationDateAnswer, phone);
      return;
    }

    if (!lastKnownPhone && currentPhone) {
      applyConversationStart(conversationDateAnswer, phone);
    }
  }

  function installObserver() {
    if (!document.body) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(() => {
        updateActiveConversationFromDom();
      }, 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function init() {
    ensureUi();
    loadConfig();
    installObserver();
    updateActiveConversationFromDom();
  }

  window.addEventListener('message', handleMessage, false);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
