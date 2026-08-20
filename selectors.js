(() => {
  const LABEL_ALIASES = ['TELEFONE', 'PHONE', 'CELULAR', 'WHATSAPP'];

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function getElementText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findTextMatch(root, label) {
    const candidates = [root, ...Array.from(root.querySelectorAll('*'))];

    for (const node of candidates) {
      const text = getElementText(node).toUpperCase();
      if (text.includes(label.toUpperCase())) {
        return node;
      }
    }

    return null;
  }

  function findPhoneValueFromNode(node) {
    if (!node) return null;

    const candidates = [node, ...Array.from(node.querySelectorAll('*'))];

    for (const candidate of candidates) {
      const textValue = getElementText(candidate);
      const valueDigits = normalizePhone(textValue);
      if (valueDigits.length >= 10) {
        return valueDigits;
      }

      if (candidate.value) {
        const inputDigits = normalizePhone(candidate.value);
        if (inputDigits.length >= 10) {
          return inputDigits;
        }
      }
    }

    return null;
  }

  function findDetailsPanel(root = document) {
    const body = root.body || root;
    if (!body) return null;

    const candidates = Array.from(body.querySelectorAll('aside, section, div, [role="complementary"], [role="dialog"], [data-testid]'));

    for (const candidate of candidates) {
      const label = getElementText(candidate).toUpperCase();
      if (label.includes('DETALHES') || label.includes('DETAILS') || label.includes('SESSÃO') || label.includes('SESSION')) {
        return candidate;
      }
    }

    return body;
  }

  function findPhoneField(root = document) {
    const detailsPanel = findDetailsPanel(root);
    const container = detailsPanel || root.body || root;

    for (const label of LABEL_ALIASES) {
      const matchNode = findTextMatch(container, label);
      const value = findPhoneValueFromNode(matchNode);
      if (value) {
        return value;
      }
    }

    return null;
  }

  window.SuriTimerSelectors = {
    LABEL_ALIASES,
    normalizePhone,
    findPhoneField,
    findDetailsPanel,
    findTextMatch,
    findPhoneValueFromNode
  };
})();
