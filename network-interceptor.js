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

  // A conversation's queue (Atendimentos / Automático / Esperando) isn't a
  // field the API sends directly — it's implied by which of dateAnswer /
  // dateRequest are set: dateAnswer present means a human already answered
  // (Atendimentos); otherwise dateRequest present means the client is
  // queued waiting for a human (Esperando); otherwise it's still with the
  // bot (Automático), where lastSenderChange (the client's last message) is
  // what content-script.js uses instead.
  function postConversationUpdate(entry) {
    // WebChat visitors have no phone number at all — a name (or, at worst,
    // the platform's own conversationId) is still enough to match a queue
    // row by, so only *some* identifier is required here.
    if (!entry || (!entry.phone && !entry.name)) {
      return;
    }

    // Need at least one queue-state field to classify the conversation.
    if (!entry.dateAnswer && !entry.dateRequest && !entry.lastSenderChange) {
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
        lastSenderChange: entry.lastSenderChange || null
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
    const name = record.userName || null;

    const signature = `${dateAnswer}|${dateRequest}|${lastSenderChange}`;
    const previous = cache.get(key);
    if (!previous || previous.signature !== signature) {
      const entry = { phone, name, conversationId, dateAnswer, dateRequest, lastSenderChange, signature };
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
