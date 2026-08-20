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

  function postConversationUpdate(phone, dateAnswer, name, conversationId) {
    if (!phone || !dateAnswer) {
      return;
    }

    const message = {
      source: MESSAGE_NAMESPACE,
      type: 'CONVERSATION_UPDATE',
      payload: {
        phone,
        dateAnswer,
        name: name || null,
        conversationId: conversationId || null
      }
    };

    window.postMessage(message, window.location.origin);
  }

  function storeConversation(record) {
    if (!record || typeof record !== 'object') {
      return;
    }

    const dateAnswer = record.dateAnswer;
    if (!dateAnswer || typeof dateAnswer !== 'string') {
      return;
    }

    const phone = inferPhone(record);
    if (!phone) {
      return;
    }

    const previous = cache.get(phone);
    if (previous !== dateAnswer) {
      cache.set(phone, dateAnswer);
      postConversationUpdate(phone, dateAnswer, record.userName, record.conversationId || record.id || null);
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
        const text = this.responseText;
        processTextBody(text);
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
})();
