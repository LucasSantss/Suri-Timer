(() => {
  const MESSAGE_NAMESPACE = 'suri-timer-ext';
  const cache = new Map();

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function inferPhone(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const raw = record.id || record.conversationId || record.userPhone || record.phone || '';
    const normalized = normalizePhone(raw);
    if (normalized.length >= 10) {
      return normalized;
    }

    const userPhone = normalizePhone(record.userPhone);
    if (userPhone.length >= 10) {
      return userPhone;
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

    if ('conversationDateAnswer' in value || 'conversationDateRequest' in value) {
      return true;
    }

    return Object.values(value).some((child) => isLikelyConversationPayload(child));
  }

  function postConversationUpdate(phone, conversationDateAnswer, conversationId) {
    if (!phone || !conversationDateAnswer) {
      return;
    }

    const message = {
      source: MESSAGE_NAMESPACE,
      type: 'CONVERSATION_UPDATE',
      payload: {
        phone,
        conversationDateAnswer,
        conversationId: conversationId || null
      }
    };

    window.postMessage(message, '*');
  }

  function storeConversation(record) {
    if (!record || typeof record !== 'object') {
      return;
    }

    const conversationDateAnswer = record.conversationDateAnswer;
    if (!conversationDateAnswer || typeof conversationDateAnswer !== 'string') {
      return;
    }

    const phone = inferPhone(record);
    if (!phone) {
      return;
    }

    const previous = cache.get(phone);
    if (previous !== conversationDateAnswer) {
      cache.set(phone, conversationDateAnswer);
      postConversationUpdate(phone, conversationDateAnswer, record.conversationId || record.id || null);
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

    if ('conversationDateAnswer' in value) {
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
    if (!body || typeof body !== 'string' || !body.includes('conversationDateAnswer')) {
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
