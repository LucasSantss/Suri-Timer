(() => {
  const LABEL_ALIASES = ['TELEFONE', 'PHONE', 'CELULAR', 'WHATSAPP'];
  const MAX_PHONE_DIGITS = 15;

  function normalizePhone(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function isPlausiblePhone(digits) {
    return digits.length >= 10 && digits.length <= MAX_PHONE_DIGITS;
  }

  function getElementText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Direct text of this node only, ignoring text inherited from descendants.
  function getOwnText(node) {
    if (!node || !node.childNodes) return '';
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // Returns the smallest element whose text contains `label` — a field's own
  // label element, not an outer panel that merely happens to contain it too.
  function findTextMatch(root, label) {
    const upperLabel = label.toUpperCase();
    const candidates = [root, ...Array.from(root.querySelectorAll('*'))];

    let best = null;
    let bestLength = Infinity;

    for (const node of candidates) {
      const text = getElementText(node).toUpperCase();
      if (!text || !text.includes(upperLabel)) continue;
      if (text.length < bestLength) {
        best = node;
        bestLength = text.length;
      }
    }

    return best;
  }

  // Starting at a field's label, walk up a few ancestor levels looking for an
  // <input>/<textarea> value or a nearby node whose OWN text is a plausible
  // phone — never the aggregated text of a large container.
  function findPhoneValueFromNode(labelNode) {
    if (!labelNode) return null;

    let scope = labelNode;
    for (let depth = 0; depth < 6 && scope; depth += 1) {
      const fields = scope.querySelectorAll ? scope.querySelectorAll('input, textarea') : [];
      for (const field of fields) {
        const digits = normalizePhone(field.value);
        if (isPlausiblePhone(digits)) {
          return digits;
        }
      }

      const ownTextDigits = normalizePhone(getOwnText(scope));
      if (isPlausiblePhone(ownTextDigits)) {
        return ownTextDigits;
      }

      if (scope.children) {
        for (const child of scope.children) {
          const childTextDigits = normalizePhone(getOwnText(child));
          if (isPlausiblePhone(childTextDigits)) {
            return childTextDigits;
          }
        }
      }

      scope = scope.parentElement;
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
