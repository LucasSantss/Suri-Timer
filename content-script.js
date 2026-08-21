(() => {
  const MESSAGE_NAMESPACE = 'suri-timer-ext';
  const conversations = new Map(); // normalizedPhone -> { phone, name, queue, dateAnswer: Date|null, lastSenderChange: Date|null }

  let config = null;
  let domainEnabled = true;
  let colorInterval = null;
  let refreshTimer = null;
  let observerInstalled = false;
  let lastKnownPhone = null;

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  // Embedded widgets (TalkJS chat, the "V2" internal-chat iframe) don't get
  // their own domain toggle — they just follow whichever portal is actually
  // embedding them, found by walking `location.ancestorOrigins` (nearest
  // enclosing frame first) until one matches a known domain. This also
  // covers double-nested iframes (portal → wrapper → widget).
  function isDomainEnabled(cfg) {
    const domains = cfg?.domains;
    if (!domains || typeof domains !== 'object') {
      return true;
    }

    const ancestorOrigins = window.location.ancestorOrigins;
    if (ancestorOrigins) {
      for (let i = 0; i < ancestorOrigins.length; i += 1) {
        try {
          const ancestorHostname = new URL(ancestorOrigins[i]).hostname;
          if (Object.prototype.hasOwnProperty.call(domains, ancestorHostname)) {
            return domains[ancestorHostname] !== false;
          }
        } catch (e) {
          // keep looking at the next ancestor
        }
      }
    }

    const hostname = window.location.hostname;
    if (Object.prototype.hasOwnProperty.call(domains, hostname)) {
      return domains[hostname] !== false;
    }
    return true;
  }

  // getActiveThreshold runs once per 'atendimento' conversation on every
  // refresh tick (every row, every second) — re-sorting `thresholds` from
  // scratch each call was pure waste since it only ever changes when config
  // changes. Cache by reference: the same `config.thresholds` array is
  // passed in on every call until the user edits "Tempos", so this collapses
  // to a no-op except right after a real config change.
  let __sortedThresholdsCache = null;
  let __sortedThresholdsSource = null;
  function getSortedThresholds(thresholds) {
    if (__sortedThresholdsSource === thresholds && __sortedThresholdsCache) {
      return __sortedThresholdsCache;
    }
    __sortedThresholdsCache = [...thresholds].sort((a, b) => a.minMinutes - b.minMinutes);
    __sortedThresholdsSource = thresholds;
    return __sortedThresholdsCache;
  }

  function getActiveThreshold(minutes, thresholds) {
    const sorted = getSortedThresholds(thresholds);

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

  // Inject the (scoped) highlight style for the participant name and the
  // queue-row marker (only once). The dark theme itself is handled entirely
  // by the vendored Dark Reader engine (vendor/darkreader.js) — it analyzes
  // the page's real styles instead of a blanket CSS filter, so it renders
  // correctly on any page and keeps itself in sync with the SPA on its own.
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

      [data-suri-marker] {
        position: absolute !important;
        top: 0 !important;
        bottom: 0 !important;
        left: 0 !important;
        width: 4px !important;
        border-radius: 2px !important;
        pointer-events: none !important;
        z-index: 2 !important;
      }

      /* Fallback base background for screens whose color comes from
         JS-computed values Dark Reader can't rewrite (some Material-UI
         sections read runtime CSS custom properties instead of static
         stylesheet rules). This only paints the base layer — any element
         with its own background (cards, panels, anything Dark Reader
         already themes correctly) still sits on top of it unaffected. */
      html.suri-dark-mode-fallback body,
      html.suri-dark-mode-fallback #root,
      html.suri-dark-mode-fallback main {
        background-color: #181a1b !important;
      }

      /* MUI Card panels (.MuiCard-root) — confirmed via DevTools that their
         emotion-generated background rule (e.g. .css-123kfj0, hash changes
         per deploy) stays white; Dark Reader isn't converting it for some
         reason. .MuiCard-root itself is a stable class MUI always adds
         alongside the hashed one, so target that instead. Scoped to Card
         specifically (not the broader .MuiPaper-root, which the app bar and
         other already-correctly-dark elements also use) to avoid flattening
         elevation shading Dark Reader already got right elsewhere. */
      html.suri-dark-mode-fallback .MuiCard-root {
        background-color: #181a1b !important;
        color: #e8e6e3 !important;
      }

      /* Flow-builder node cards (Fluxos screen, react-flow-based). Same
         "own explicit background Dark Reader isn't reaching" situation as
         the MUI cards above — .flow-node is a plain, stable app class. */
      html.suri-dark-mode-fallback .flow-node {
        background-color: #181a1b !important;
        color: #e8e6e3 !important;
        border-color: #333a3d !important;
      }
    `;

    const style = document.createElement('style');
    style.setAttribute('data-suri', 'global-style');
    style.textContent = css;
    document.head?.appendChild(style);
  }

  // Without this, Dark Reader can't read the CSS rules of any stylesheet
  // loaded with crossorigin (common with hashed build assets, e.g. Vite's
  // index-XXXX.css) — the browser blocks JS access to .cssRules on those
  // unless fetched directly, so those rules were silently left untouched
  // (white backgrounds, unstyled text) even though everything else worked.
  // This is Dark Reader's own documented fix for that exact situation.
  if (window.DarkReader?.setFetchMethod) {
    window.DarkReader.setFetchMethod(window.fetch.bind(window));
  }

  // Tell Dark Reader to leave our own colored elements exactly as we set
  // them, instead of trying to "fix" their colors into its dark palette.
  const DARK_READER_FIXES = {
    ignoreInlineStyle: ['.suri-timer-highlight', '[data-suri-marker]']
  };

  let __lastAppliedTheme = null;

  // `force` re-runs DarkReader.enable() even when the theme/brightness/
  // contrast haven't changed — used when the page's own DOM changed (e.g.
  // opening a conversation renders a new message thread + details panel)
  // so that newly-inserted content gets themed too, not just what existed
  // when "Escuro" was first turned on.
  function applyPageTheme(theme, brightness, contrast, force = false) {
    if (!window.DarkReader) return;

    const signature = `${theme}|${brightness ?? 100}|${contrast ?? 100}`;
    if (!force && signature === __lastAppliedTheme) {
      return;
    }
    __lastAppliedTheme = signature;

    injectGlobalStyles();
    document.documentElement.classList.toggle('suri-dark-mode-fallback', theme === 'dark');

    if (theme === 'dark') {
      window.DarkReader.enable(
        { brightness: brightness ?? 100, contrast: contrast ?? 100 },
        DARK_READER_FIXES
      );
    } else {
      window.DarkReader.disable();
    }
  }

  let __themeForceTimer = null;
  function scheduleForceTheme() {
    if (!domainEnabled || !config || config.theme !== 'dark') return;
    if (__themeForceTimer) clearTimeout(__themeForceTimer);
    __themeForceTimer = setTimeout(() => {
      __themeForceTimer = null;
      applyPageTheme(config.theme, config.themeBrightness, config.themeContrast, true);
    }, 1200);
  }

  // The name element rarely changes while the same conversation stays open,
  // so avoid re-scanning the details panel on every tick.
  let __cachedNameEl = null;
  let __cachedNamePhone = null;

  function findParticipantNameElement() {
    if (__cachedNameEl && __cachedNamePhone === lastKnownPhone && document.contains(__cachedNameEl)) {
      return __cachedNameEl;
    }

    try {
      const container = window.SuriTimerSelectors?.findDetailsPanel(document) || document.body;
      const candidates = Array.from(container.querySelectorAll('h1,h2,h3,strong,b,div,span,p'));

      // When the client has no registered name, the platform itself displays
      // the raw phone number where the name would go — track the shortest
      // such element as a fallback so those clients still get the highlight,
      // instead of being silently left with no identification at all. A
      // genuine name (found below) always wins when one exists.
      let phoneFallback = null;
      let phoneFallbackLength = Infinity;

      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (!text) continue;
        if (text.length < 4 || text.length > 60) continue;

        if (/\d/.test(text)) {
          if (lastKnownPhone && normalizePhone(text) === lastKnownPhone && text.length < phoneFallbackLength) {
            phoneFallback = el;
            phoneFallbackLength = text.length;
          }
          continue;
        }

        if (text.split(/\s+/).length >= 2) {
          __cachedNameEl = el;
          __cachedNamePhone = lastKnownPhone;
          return el;
        }
      }

      if (phoneFallback) {
        __cachedNameEl = phoneFallback;
        __cachedNamePhone = lastKnownPhone;
        return phoneFallback;
      }
    } catch (err) {
      // ignore
    }

    __cachedNameEl = null;
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

    // Skip the style write (and the repaint it triggers) when the color
    // hasn't actually changed since the last tick.
    if (el.dataset.suriColor !== color) {
      injectGlobalStyles();
      el.classList.add('suri-timer-highlight');
      el.style.backgroundColor = hexToRgba(color, 0.16);
      el.style.setProperty('--suri-accent', color);
      el.dataset.suriColor = color;
    }

    __last_highlight_el = el;
  }

  function parseDateOrNull(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // conversationId is like "wp447721785081837:5545998280751" (WhatsApp),
  // "wc...", "fb...", "ig..." — the letters prefix identifies the channel,
  // which the Automático staleness rule below depends on.
  function getChannelPrefix(conversationId) {
    if (!conversationId) return null;
    const match = /^([a-zA-Z]+)/.exec(conversationId);
    return match ? match[1].toLowerCase() : null;
  }

  // WebChat visitors have no phone at all — key on whatever identifier is
  // actually available (phone, then the platform's conversationId, then the
  // name itself) so those conversations don't get silently dropped.
  //
  // `queue` comes solely from network-interceptor.js's QUEUE_TYPE_MAP
  // (sourced from each record's own `type` field: 0=Automático, 1=Esperando,
  // 2=Atendimentos) — the only reliable source. There's deliberately no
  // fallback inference from dateAnswer/dateRequest/agentId: agentId gets set
  // as soon as an agent picks up a conversation, before their first reply,
  // which made a heuristic misclassify still-Esperando conversations as
  // Atendimentos. A conversation with no usable `queue` gets no color at all
  // (see getConversationColor) rather than a guessed one.
  function registerConversation(phone, name, conversationId, dateAnswerIso, dateRequestIso, lastSenderChangeIso, agentId, queue, agentName) {
    const normalizedName = normalizeNameForMatch(name);
    const key = phone || conversationId || normalizedName;
    if (!key) {
      return;
    }

    const dateAnswer = parseDateOrNull(dateAnswerIso);
    const dateRequest = parseDateOrNull(dateRequestIso);
    const lastSenderChange = parseDateOrNull(lastSenderChangeIso);

    conversations.set(key, {
      phone: phone || null,
      name: name || null,
      normalizedName,
      queue: queue || null,
      channelPrefix: getChannelPrefix(conversationId),
      dateAnswer,
      dateRequest,
      agentId: agentId || null,
      agentName: agentName || null,
      lastSenderChange
    });

    scheduleRefresh();
  }

  // A burst of network responses can register many conversations at once —
  // debounce so we repaint the queue once per burst instead of once per row.
  let __scheduleRefreshTimer = null;
  function scheduleRefresh() {
    if (!domainEnabled) return;
    if (__scheduleRefreshTimer) clearTimeout(__scheduleRefreshTimer);
    __scheduleRefreshTimer = setTimeout(() => {
      __scheduleRefreshTimer = null;
      // This is genuinely new data (a conversation just registered/changed),
      // not a routine poll — bypass the queue-colors throttle below so it
      // paints right away instead of possibly waiting up to 4s. Without this,
      // conversations that arrived just after the first burst (still common
      // seconds into a first load) sat uncolored until the throttle window
      // happened to elapse, which read as slow/janky.
      refreshAll(false, true);
    }, 150);
  }

  // Automático doesn't use the configurable time-in-queue thresholds — it's
  // a fixed two-state indicator on how long ago the client last wrote in,
  // independent of "Tempos" settings which only apply to Atendimentos. The
  // staleness window itself depends on the channel (conversationId prefix):
  // WebChat ("wc") never goes stale, Facebook/Instagram ("fb"/"ig") get a
  // week, everything else (WhatsApp, "wp") gets the default 24h.
  const AUTOMATICO_RECENT_COLOR = '#22c55e';
  const AUTOMATICO_STALE_COLOR = '#ef4444';
  const AUTOMATICO_STALE_HOURS_DEFAULT = 24;
  const AUTOMATICO_STALE_HOURS_WEEKLY = 24 * 7;
  const AUTOMATICO_WEEKLY_CHANNELS = new Set(['fb', 'ig']);

  function getAutomaticoStaleHours(channelPrefix) {
    if (channelPrefix === 'wc') return Infinity;
    if (AUTOMATICO_WEEKLY_CHANNELS.has(channelPrefix)) return AUTOMATICO_STALE_HOURS_WEEKLY;
    return AUTOMATICO_STALE_HOURS_DEFAULT;
  }

  // Returns the marker/highlight color for a conversation, or null when it
  // should show no visual identification at all (Esperando, or no data yet).
  function getConversationColor(conversation) {
    if (!conversation) return null;

    if (conversation.queue === 'atendimento') {
      // An agent can be assigned before dateAnswer is set — fall back to
      // dateRequest (when the client first asked for a human) so those
      // conversations still get a time-based color instead of none.
      const referenceDate = conversation.dateAnswer || conversation.dateRequest;
      if (!referenceDate) return null;
      const elapsedMinutes = (Date.now() - referenceDate.getTime()) / 60000;
      const rule = getActiveThreshold(elapsedMinutes, config?.thresholds || [{ minMinutes: 0, color: '#22c55e' }]);
      return rule.color || '#22c55e';
    }

    if (conversation.queue === 'automatico') {
      const staleHours = getAutomaticoStaleHours(conversation.channelPrefix);
      if (staleHours === Infinity) return AUTOMATICO_RECENT_COLOR;
      // No lastSenderChange at all means we can't tell how long the client
      // has been waiting on the bot — treat that as stale (red) rather than
      // leaving it uncolored, since an unknown wait is exactly the case this
      // marker exists to flag.
      if (!conversation.lastSenderChange) return AUTOMATICO_STALE_COLOR;
      const elapsedHours = (Date.now() - conversation.lastSenderChange.getTime()) / 3600000;
      return elapsedHours < staleHours ? AUTOMATICO_RECENT_COLOR : AUTOMATICO_STALE_COLOR;
    }

    // 'esperando' never gets a visual marker.
    return null;
  }

  function refreshActiveConversationColor() {
    if (!domainEnabled || !window.SuriTimerSelectors) {
      clearHighlight();
      return;
    }

    const phone = normalizePhone(window.SuriTimerSelectors.findPhoneField(document));
    lastKnownPhone = phone || null;

    let conversation = phone ? conversations.get(phone) : null;

    // No phone on the page (or no match for it) — WebChat conversations have
    // none at all, so fall back to matching the panel's own name text.
    if (!conversation) {
      const nameEl = findParticipantNameElement();
      const nameText = nameEl ? nameEl.textContent : '';
      conversation = matchConversationForText(nameText);
    }

    const color = getConversationColor(conversation);
    if (!color) {
      clearHighlight();
      return;
    }

    try {
      applyNameHighlight(color);
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

  // Fuzzy fallback for when neither name is a substring of the other (e.g.
  // reordered words). Requires EVERY significant word of the shorter name to
  // appear in the longer one — not just one shared word. Now that
  // conversations from all three queues are tracked at once (not just the
  // handful active in Atendimentos), a single common word (a first name like
  // "Marcos", a surname like "Almeida") is no longer rare enough to safely
  // mean "same client" on its own.
  function namesLikelyMatch(a, b) {
    const wordsA = a.split(' ').filter((w) => w.length >= 3);
    const wordsB = b.split(' ').filter((w) => w.length >= 3);
    if (!wordsA.length || !wordsB.length) return false;

    const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
    const longerSet = new Set(longer);
    return shorter.every((word) => longerSet.has(word));
  }

  function matchConversationForText(text, excludeSet, rowFullText) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    const digits = normalizePhone(trimmed);
    if (digits.length >= 10) {
      const byPhone = conversations.get(digits);
      if (byPhone) return byPhone;
    }

    const normalizedText = normalizeNameForMatch(trimmed);
    if (!normalizedText) {
      // Names made entirely of punctuation/symbols (a lone ".", an emoji
      // with no letters/digits) strip down to nothing here — normal
      // name-based matching below can never find them. Fall back to an
      // exact, un-normalized comparison of the row text against each
      // conversation's raw name so these clients aren't left unmatched.
      // Placeholder names like "." are common junk data, so several
      // *different* clients can share the exact same (stripped-to-nothing)
      // name. `excludeSet` stops every such row from collapsing onto the
      // same first conversation, but with nothing else to go on it can still
      // pair the wrong row with the wrong candidate whenever Map insertion
      // order (when each conversation was first captured off the network)
      // doesn't match the rows' on-screen order (typically sorted by
      // activity) — a silent swap, not a miss. The row also shows the
      // assigned agent's name (e.g. "RENATO DA SILVA") even when the
      // client's own name doesn't, so when `rowFullText` is given, prefer
      // whichever remaining candidate's `agentName` actually appears in it —
      // genuinely disambiguating instead of guessing by order.
      const candidates = [];
      for (const conversation of conversations.values()) {
        if (excludeSet && excludeSet.has(conversation)) continue;
        if (conversation.name && conversation.name.trim() === trimmed) {
          candidates.push(conversation);
        }
      }

      if (!candidates.length) return null;

      if (candidates.length > 1 && rowFullText) {
        const normalizedRowText = normalizeNameForMatch(rowFullText);
        const byAgent = candidates.find(
          (c) => c.agentName && normalizedRowText.includes(normalizeNameForMatch(c.agentName))
        );
        if (byAgent) {
          if (excludeSet) excludeSet.add(byAgent);
          return byAgent;
        }
      }

      const chosen = candidates[0];
      if (excludeSet) excludeSet.add(chosen);
      return chosen;
    }

    // An exact match must always win. Substring matches (handles truncated
    // row text like "Letícia | MAXHAIRCABE..." matching the full "Letícia |
    // MAXHAIRCABELOS") are only unambiguous when there's just one candidate
    // — a short, unrelated name like "Francisca" is also a substring of
    // "Francisca Edna de Sousa Silva", so returning on the *first* substring
    // hit (arbitrary Map iteration order) could shadow the real exact match
    // for the full name with some other client's shorter one. Scan every
    // conversation first and rank: exact > closest-length substring > fuzzy.
    let exactMatch = null;
    let bestSubstringMatch = null;
    let bestSubstringDiff = Infinity;
    let fuzzyMatch = null;

    for (const conversation of conversations.values()) {
      const name = conversation.normalizedName;
      if (!name) continue;

      if (name === normalizedText) {
        exactMatch = conversation;
        continue;
      }

      if (name.includes(normalizedText) || normalizedText.includes(name)) {
        const diff = Math.abs(name.length - normalizedText.length);
        if (diff < bestSubstringDiff) {
          bestSubstringDiff = diff;
          bestSubstringMatch = conversation;
        }
        continue;
      }

      if (!fuzzyMatch && namesLikelyMatch(normalizedText, name)) {
        fuzzyMatch = conversation;
      }
    }

    return exactMatch || bestSubstringMatch || fuzzyMatch;
  }

  // A thin vertical stripe on the row's left edge, full height. It's its own
  // element (not a wrapper around the avatar <img>) so its dark-mode filter
  // exemption never conflicts with the avatar's own exemption.
  function getMarkerHost(row) {
    return row.querySelector('td.cell-center') || row.querySelector('td');
  }

  function styleRow(row, color) {
    const host = getMarkerHost(row);
    if (!host) return;

    let marker = host.querySelector(':scope > [data-suri-marker]');
    if (!marker) {
      marker = document.createElement('span');
      marker.setAttribute('data-suri-marker', 'true');
      if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
      host.appendChild(marker);
    }

    // Skip the write (and the repaint it triggers) when unchanged.
    if (marker.dataset.suriColor === color) return;
    marker.style.backgroundColor = color;
    marker.dataset.suriColor = color;
  }

  function clearRowStyle(row) {
    const marker = row.querySelector('[data-suri-marker]');
    if (marker) {
      marker.remove();
    }
  }

  function refreshQueueColors() {
    if (!domainEnabled) {
      return;
    }

    const rows = getConversationRows();
    const usedForPass = new Set();
    for (const row of rows) {
      const nameEl = row.querySelector(ROW_NAME_SELECTOR);
      const text = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent || '') : '';
      const conversation = matchConversationForText(text, usedForPass, row.textContent);
      const color = getConversationColor(conversation);

      if (!color) {
        clearRowStyle(row);
        continue;
      }

      try {
        styleRow(row, color);
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

  // refreshQueueColors() is O(rows × tracked conversations) — with Automático
  // now tracking every conversation (not just the handful active in
  // Atendimentos), repainting the whole visible list on every single 1s tick
  // is wasted work: queue colors only move in minute/hour increments, so a
  // few seconds of staleness is never visible. refreshActiveConversationColor
  // (a single lookup for whichever conversation is open) stays on the fast
  // 1s cycle since it's cheap and its highlight should feel responsive.
  const QUEUE_COLORS_REFRESH_INTERVAL_MS = 400;
  let __lastQueueColorsRefresh = 0;

  function refreshAll(forceTheme = false, forceQueueColors = false) {
    // Cheap no-op on the plain 1s tick once the theme is already applied.
    // `forceTheme` is set when the DOM itself just changed (a conversation
    // was opened, new content rendered) so Dark Reader re-scans and themes
    // whatever is new — it doesn't always catch that on its own.
    if (domainEnabled && config) {
      applyPageTheme(config.theme, config.themeBrightness, config.themeContrast, forceTheme);
    }
    refreshActiveConversationColor();

    const now = Date.now();
    // `forceQueueColors` (set when scheduleRefresh fires for freshly
    // registered/changed conversation data) always repaints — the throttle
    // below is only meant to skip *redundant* repaints on the routine 1s/
    // mutation-observer ticks, where colors can't have moved.
    if (forceQueueColors || now - __lastQueueColorsRefresh >= QUEUE_COLORS_REFRESH_INTERVAL_MS) {
      __lastQueueColorsRefresh = now;
      refreshQueueColors();
    }
  }

  function startColorLoop() {
    if (colorInterval) return;
    // Reset the throttle so the very first tick after (re)starting paints
    // the queue list immediately instead of waiting out the interval.
    __lastQueueColorsRefresh = 0;
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
    const phone = payload.phone ? normalizePhone(payload.phone) : null;

    // A phone isn't required — WebChat conversations have none — but we
    // need at least a name to ever be able to match them to a queue row.
    if (!phone && !payload.name) {
      return;
    }

    registerConversation(phone, payload.name, payload.conversationId, payload.dateAnswer, payload.dateRequest, payload.lastSenderChange, payload.agentId, payload.queue, payload.agentName);
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

      // Our own colors refresh quickly (250ms) — cheap either way, since it
      // no-ops when nothing actually changed.
      refreshTimer = setTimeout(() => refreshAll(false), 250);

      // Re-running Dark Reader is heavier, so it gets its own longer debounce
      // that coalesces bursts (e.g. several chat messages arriving in a row)
      // instead of firing on every single mutation.
      scheduleForceTheme();
    });

    // characterData is deliberately left out — a live chat re-fires text
    // mutations constantly (timestamps, message text), which made this fire
    // far more often than needed. The 1s interval already guarantees the
    // colors stay in sync; the observer here just reacts faster to actual
    // structural changes (opening a conversation, new rows in the queue).
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
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

    applyPageTheme(config.theme, config.themeBrightness, config.themeContrast);
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
    // Paint immediately with defaults instead of blocking the very first
    // render on chrome.storage.sync — it's a synced, cross-device area that
    // can have real first-access latency (e.g. right after browser startup),
    // and until it resolves nothing was drawn at all: no marker stripes, no
    // highlight, no theme. Reconcile with the user's actual saved config
    // (custom thresholds, per-domain toggle, theme) as soon as it arrives.
    applyConfig(window.SuriTimerStorage ? window.SuriTimerStorage.getDefaultConfig() : null);

    if (!window.SuriTimerStorage) {
      return;
    }
    const storedConfig = await window.SuriTimerStorage.getConfig();
    applyConfig(storedConfig);
  }

  window.addEventListener('message', handleMessage, false);

  // network-interceptor.js runs from document_start and may have already
  // processed conversation-list responses before this script (document_idle)
  // attached the listener above, or before the user switched back to this
  // tab/page — ask it to replay everything captured so far, so no client is
  // ever permanently left without its color just because of timing.
  function requestSnapshot() {
    window.postMessage({ source: MESSAGE_NAMESPACE, type: 'REQUEST_SNAPSHOT' }, window.location.origin);
  }

  requestSnapshot();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestSnapshot();
    }
  });
  window.addEventListener('focus', requestSnapshot);
  window.addEventListener('pageshow', requestSnapshot);

  // A slow background safety net: re-syncs with whatever network-interceptor
  // has captured even if some earlier message was somehow missed, without
  // needing a reload. Cheap — it only replays already-captured in-memory
  // data, no network traffic.
  setInterval(() => {
    if (domainEnabled) {
      requestSnapshot();
    }
  }, 15000);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }

  // Diagnostic surface for tracking down "client shows no color" reports —
  // dumps, per visible row, whether it matched a tracked conversation and
  // why it did/didn't get a color. Not used by the extension itself.
  // Usage in the page console:
  //   copy(JSON.stringify(window.__suriTimerDebug.getRowsSnapshot(), null, 2))
  window.__suriTimerDebug = {
    getConversations: () => Array.from(conversations.entries()).map(([key, c]) => ({
      key,
      phone: c.phone,
      name: c.name,
      queue: c.queue,
      channelPrefix: c.channelPrefix,
      agentId: c.agentId,
      agentName: c.agentName,
      dateAnswer: c.dateAnswer ? c.dateAnswer.toISOString() : null,
      dateRequest: c.dateRequest ? c.dateRequest.toISOString() : null,
      lastSenderChange: c.lastSenderChange ? c.lastSenderChange.toISOString() : null,
      color: getConversationColor(c)
    })),
    getRowsSnapshot: () => {
      const usedForPass = new Set();
      return getConversationRows().map((row) => {
        const nameEl = row.querySelector(ROW_NAME_SELECTOR);
        const text = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent || '') : '';
        const conversation = matchConversationForText(text, usedForPass, row.textContent);
        return {
          rowText: text,
          matched: !!conversation,
          matchedKey: conversation ? (conversation.phone || conversation.name) : null,
          queue: conversation ? conversation.queue : null,
          agentId: conversation ? conversation.agentId : null,
          agentName: conversation ? conversation.agentName : null,
          dateAnswer: conversation?.dateAnswer ? conversation.dateAnswer.toISOString() : null,
          dateRequest: conversation?.dateRequest ? conversation.dateRequest.toISOString() : null,
          lastSenderChange: conversation?.lastSenderChange ? conversation.lastSenderChange.toISOString() : null,
          color: conversation ? getConversationColor(conversation) : null
        };
      });
    }
  };
})();
