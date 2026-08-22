(() => {
  const MESSAGE_NAMESPACE = 'suri-timer-ext';
  const MAX_PHONE_DIGITS = 15;
  const cache = new Map();

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isPlausiblePhone(digits) {
    return digits.length >= 10 && digits.length <= MAX_PHONE_DIGITS;
  }

  // userPhone/phone are clean, dedicated fields — always prefer them. `id`/
  // `conversationId` are opaque platform identifiers (e.g. "wp437...:5588...")
  // that happen to contain digits too, so they are only a last-resort fallback.
  function inferPhone(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const direct = normalizePhone(record.userPhone || record.phone);
    if (isPlausiblePhone(direct)) {
      return direct;
    }

    const fallback = normalizePhone(record.id || record.conversationId);
    if (isPlausiblePhone(fallback)) {
      return fallback;
    }

    return null;
  }

  // Each conversation record carries its own `type` (0=Automático,
  // 1=Esperando, 2=Atendimentos — confirmed in DevTools). This is the only
  // source used to classify a conversation's queue: it's authoritative and
  // per-record, unlike dateAnswer/dateRequest/agentId, which only imply the
  // queue and can be misleading (e.g. platformUserId/agentId gets set as
  // soon as an agent picks up a conversation, before their first reply, so a
  // record can look like Atendimentos by that heuristic while `type` still
  // correctly says Esperando). A record with no usable `type` gets no queue
  // at all rather than a guessed one.
  const QUEUE_TYPE_MAP = { 0: 'automatico', 1: 'esperando', 2: 'atendimento' };

  function isLikelyConversationPayload(value) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item) => isLikelyConversationPayload(item));
    }

    if ('dateAnswer' in value || 'dateRequest' in value) {
      return true;
    }

    return Object.values(value).some((child) => isLikelyConversationPayload(child));
  }

  function postConversationUpdate(entry) {
    // WebChat visitors have no phone number at all — a name (or, at worst,
    // the platform's own conversationId) is still enough to match a queue
    // row by, so only *some* identifier is required here.
    if (!entry || (!entry.phone && !entry.name)) {
      return;
    }

    // Need at least one queue-state field to classify the conversation — a
    // known `queue` (from the record's own `type`) counts on its own here:
    // an Automático conversation the client never wrote back into legitimately
    // has every date field null (dateAnswer/dateRequest/lastSenderChange/
    // agentId), which used to make this look like nothing worth tracking and
    // silently drop it — so it never got the "no lastSenderChange = stale"
    // red marker, it just never got registered at all.
    if (!entry.dateAnswer && !entry.dateRequest && !entry.lastSenderChange && !entry.lastActivity && !entry.agentId && !entry.queue) {
      return;
    }

    const message = {
      source: MESSAGE_NAMESPACE,
      type: 'CONVERSATION_UPDATE',
      payload: {
        phone: entry.phone || null,
        name: entry.name || null,
        conversationId: entry.conversationId || null,
        dateAnswer: entry.dateAnswer || null,
        dateRequest: entry.dateRequest || null,
        lastSenderChange: entry.lastSenderChange || null,
        lastActivity: entry.lastActivity || null,
        agentId: entry.agentId || null,
        agentName: entry.agentName || null,
        queue: entry.queue || null
      }
    };

    window.postMessage(message, window.location.origin);
  }

  function storeConversation(record) {
    if (!record || typeof record !== 'object') {
      return;
    }

    const conversationId = record.conversationId || record.id || null;
    const phone = inferPhone(record);

    // Need *some* stable identifier to dedupe on — prefer the phone, fall
    // back to the platform's own conversation id (covers WebChat visitors).
    const key = phone || conversationId;
    if (!key) {
      return;
    }

    const dateAnswer = typeof record.dateAnswer === 'string' ? record.dateAnswer : null;
    const dateRequest = typeof record.dateRequest === 'string' ? record.dateRequest : null;
    const lastSenderChange = typeof record.lastSenderChange === 'string' ? record.lastSenderChange : null;
    // Same value the row shows as "Última mensagem em ..." — used in
    // content-script.js as a last-resort disambiguator (nearest timestamp)
    // for rows whose name AND agent both fail to tell two conversations
    // apart (e.g. one agent handling several simultaneously-open chats that
    // all display an emoji-only name).
    const lastActivity = typeof record.lastActivity === 'string' ? record.lastActivity : null;
    const name = record.userName || null;
    const agentId = record.platformUserId || null;
    // Shown in the row itself (below the client name/tag, e.g. "👤 RENATO DA
    // SILVA") — used in content-script.js to disambiguate rows whose client
    // name strips down to nothing (see matchConversationForText), since two
    // different "." clients being worked by two different agents are still
    // visually distinguishable that way even though their names aren't.
    const agentName = record.platformUserName || null;

    const previous = cache.get(key);
    // Some updates for an already-known conversation (e.g. the lightweight
    // payload fired when a client replies and the row jumps to the top of
    // the list) carry dateAnswer/lastSenderChange but no `type` at all. If
    // we treated a missing `type` as "no queue" here, that partial update
    // would wipe out the correct classification we already had from the
    // last full list fetch, and it wouldn't come back until the queue tab
    // was reloaded. So a missing `type` keeps whatever queue we last knew
    // for this conversation instead of clearing it — only a *present* `type`
    // (still the sole source of truth) ever changes the classification.
    const queueType = QUEUE_TYPE_MAP[record.type] || (previous ? previous.queue : null);

    const signature = `${dateAnswer}|${dateRequest}|${lastSenderChange}|${lastActivity}|${agentId}|${agentName}|${queueType || ''}`;
    if (!previous || previous.signature !== signature) {
      const entry = { phone, name, conversationId, dateAnswer, dateRequest, lastSenderChange, lastActivity, agentId, agentName, queue: queueType || null, signature };
      cache.set(key, entry);
      postConversationUpdate(entry);
    }
  }

  function walkObject(value) {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walkObject(item);
      }
      return;
    }

    if ('dateAnswer' in value) {
      storeConversation(value);
    }

    for (const child of Object.values(value)) {
      walkObject(child);
    }
  }

  function handleParsedResponse(payload) {
    if (!payload) {
      return;
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        walkObject(item);
      }
      return;
    }

    if (isLikelyConversationPayload(payload)) {
      walkObject(payload);
    }
  }

  function processTextBody(body) {
    if (!body || typeof body !== 'string' || !body.includes('dateAnswer')) {
      return;
    }

    try {
      const parsed = JSON.parse(body);
      handleParsedResponse(parsed);
    } catch (error) {
      // Ignore parse failures; the page may return partial or non-JSON content.
    }
  }

  // Real-time single-conversation updates are often fetched with
  // `xhr.responseType = "json"` instead of the default text/"" — the browser
  // parses the body itself in that case, so `.responseText` throws and those
  // requests were silently skipped. `.response` already holds the parsed
  // object there, no JSON.parse needed.
  function processResponseValue(value) {
    if (typeof value === 'string') {
      processTextBody(value);
      return;
    }
    if (value && typeof value === 'object') {
      handleParsedResponse(value);
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    return originalFetch(...args).then(async (response) => {
      try {
        const clone = response.clone();
        const text = await clone.text();
        processTextBody(text);
      } catch (error) {
        // Ignore clone/read errors from responses we cannot inspect.
      }

      return response;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this.__suriTimerIntercepted = true;
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const handleReadyState = () => {
      try {
        const type = this.responseType;
        if (type === '' || type === 'text') {
          processTextBody(this.responseText);
        } else if (type === 'json') {
          processResponseValue(this.response);
        }
        // Other types (arraybuffer, blob, document) are never JSON — skip.
      } catch (error) {
        // Ignore unreadable responses.
      }
    };

    this.addEventListener('load', handleReadyState, { once: true });
    this.addEventListener('readystatechange', () => {
      if (this.readyState === 4) {
        handleReadyState();
      }
    }, { once: true });

    return originalSend.apply(this, args);
  };

  // Real-time queue updates (a client entering "Atendimentos") often arrive
  // as WebSocket push messages rather than a fresh fetch/XHR response — those
  // clients never appeared in an intercepted HTTP response otherwise, which
  // is why some rows had no captured dateAnswer despite the data existing.
  if (typeof window.WebSocket === 'function') {
    const OriginalWebSocket = window.WebSocket;

    function PatchedWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols);

      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data === 'string') {
            processTextBody(event.data);
          } else if (event.data instanceof Blob) {
            event.data.text().then(processTextBody).catch(() => {});
          }
        } catch (error) {
          // Ignore frames we cannot inspect.
        }
      });

      return socket;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
    window.WebSocket = PatchedWebSocket;
  }

  // This script runs at document_start (MAIN world) and can process the
  // page's very first API responses before content-script.js (isolated
  // world, document_idle) has even attached its postMessage listener —
  // those early updates were silently lost. content-script.js asks for a
  // replay of everything captured so far as soon as it wakes up.
  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }
    if (!event.data || event.data.source !== MESSAGE_NAMESPACE || event.data.type !== 'REQUEST_SNAPSHOT') {
      return;
    }

    for (const entry of cache.values()) {
      postConversationUpdate(entry);
    }
  });
})();
