const DEFAULT_RULE = { minMinutes: 0, value: 0, unit: 'minutes', color: '#22c55e' };

const MINUTES_PER_UNIT = { minutes: 1, hours: 60, days: 1440 };
const UNIT_LABELS = { minutes: 'Minutos', hours: 'Horas', days: 'Dias' };

function toMinutes(value, unit) {
  return (Number(value) || 0) * (MINUTES_PER_UNIT[unit] || 1);
}

function formatRuleRange(rule) {
  const label = (UNIT_LABELS[rule.unit] || UNIT_LABELS.minutes).toLowerCase();
  return `${rule.value} ${label} ou mais`;
}

// The TalkJS chat iframe has no toggle of its own — it just follows
// whichever of these portal domains is actually embedding it.
const DOMAIN_LIST = [
  { hostname: 'portal.chatbotmaker.io', label: 'Chatbot Maker' },
  { hostname: 'portal.suri.ai', label: 'Suri' }
];

const state = {
  theme: 'light',
  themeBrightness: 100,
  themeContrast: 100,
  themeLightBrightness: 100,
  themeLightContrast: 100,
  showShopInfo: true,
  thresholds: [
    { minMinutes: 0, value: 0, unit: 'minutes', color: '#22c55e' },
    { minMinutes: 5, value: 5, unit: 'minutes', color: '#facc15' },
    { minMinutes: 15, value: 15, unit: 'minutes', color: '#ef4444' }
  ],
  domains: {
    'portal.chatbotmaker.io': true,
    'portal.suri.ai': true
  }
};

function updateThemeButtons() {
  document.querySelectorAll('.theme-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === state.theme);
  });
  document.querySelectorAll('.theme-settings').forEach((section) => {
    section.classList.toggle('active', section.dataset.themeSettings === state.theme);
  });
}

function updateSliders() {
  [
    ['brightness', 'brightnessValue', state.themeBrightness],
    ['contrast', 'contrastValue', state.themeContrast],
    ['lightBrightness', 'lightBrightnessValue', state.themeLightBrightness],
    ['lightContrast', 'lightContrastValue', state.themeLightContrast]
  ].forEach(([inputId, labelId, value]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input) input.value = value;
    if (label) label.textContent = `${value}%`;
  });
}

function updatePreview() {
  const previewValue = document.getElementById('previewValue');
  const previewBadge = document.getElementById('previewBadge');
  if (!previewValue || !previewBadge) {
    return;
  }

  const activeRule = [...state.thresholds].sort((a, b) => a.minMinutes - b.minMinutes).at(-1) || DEFAULT_RULE;
  previewValue.style.backgroundColor = `${activeRule.color || '#22c55e'}29`;
  previewValue.style.color = activeRule.color || '#22c55e';
}

function renderRules() {
  const rulesRoot = document.getElementById('rules');
  if (!rulesRoot) {
    return;
  }

  rulesRoot.innerHTML = '';

  state.thresholds.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'rule-row';

    const timeGroup = document.createElement('div');
    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Tempo';
    const timeInputRow = document.createElement('div');
    timeInputRow.className = 'time-input-row';

    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.min = '0';
    valueInput.step = '1';
    valueInput.value = rule.value;

    const unitSelect = document.createElement('select');
    Object.entries(UNIT_LABELS).forEach(([unitKey, label]) => {
      const option = document.createElement('option');
      option.value = unitKey;
      option.textContent = label;
      if (unitKey === rule.unit) option.selected = true;
      unitSelect.appendChild(option);
    });

    const syncTime = () => {
      const value = Number(valueInput.value) || 0;
      const unit = unitSelect.value;
      state.thresholds[index].value = value;
      state.thresholds[index].unit = unit;
      state.thresholds[index].minMinutes = toMinutes(value, unit);
      infoText.textContent = formatRuleRange(state.thresholds[index]);
      updatePreview();
    };
    valueInput.addEventListener('input', syncTime);
    unitSelect.addEventListener('change', syncTime);

    timeInputRow.appendChild(valueInput);
    timeInputRow.appendChild(unitSelect);
    timeGroup.appendChild(timeLabel);
    timeGroup.appendChild(timeInputRow);

    const colorGroup = document.createElement('div');
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = rule.color || '#22c55e';
    colorInput.addEventListener('input', (event) => {
      state.thresholds[index].color = event.target.value;
      updatePreview();
    });
    colorGroup.appendChild(colorLabel);
    colorGroup.appendChild(colorInput);

    const info = document.createElement('div');
    const infoLabel = document.createElement('label');
    infoLabel.textContent = 'Faixa';
    const infoText = document.createElement('div');
    infoText.textContent = formatRuleRange(rule);
    infoText.style.color = '#dfeaf8';
    infoText.style.fontSize = '14px';
    infoText.style.paddingTop = '4px';
    info.appendChild(infoLabel);
    info.appendChild(infoText);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn danger';
    removeBtn.textContent = 'Remover';
    removeBtn.disabled = state.thresholds.length <= 1;
    removeBtn.addEventListener('click', () => {
      if (state.thresholds.length <= 1) {
        return;
      }
      state.thresholds.splice(index, 1);
      renderRules();
      updatePreview();
    });

    row.appendChild(timeGroup);
    row.appendChild(colorGroup);
    row.appendChild(info);
    row.appendChild(removeBtn);
    rulesRoot.appendChild(row);
  });
}

function renderDomains() {
  const root = document.getElementById('domains');
  if (!root) {
    return;
  }

  root.innerHTML = '';

  DOMAIN_LIST.forEach(({ hostname, label }) => {
    const row = document.createElement('div');
    row.className = 'domain-row';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'domain-name';
    name.textContent = label;
    const hint = document.createElement('div');
    hint.className = 'domain-hint';
    hint.textContent = hostname;
    info.appendChild(name);
    info.appendChild(hint);

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.domains[hostname] !== false;
    checkbox.addEventListener('change', () => {
      state.domains[hostname] = checkbox.checked;
      saveConfig({ message: `Cronômetro ${checkbox.checked ? 'ativado' : 'desativado'} em ${label}.` });
    });
    const track = document.createElement('span');
    track.className = 'switch-track';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(track);

    row.appendChild(info);
    row.appendChild(switchLabel);
    root.appendChild(row);
  });
}

// Old stored rules only ever had `minMinutes` — no `value`/`unit`. Falling
// back to `unit: 'minutes'` for those keeps them displaying exactly as
// before instead of guessing a "nicer" unit for pre-existing data.
function normalizeThresholds() {
  const normalized = [...state.thresholds]
    .map((rule) => {
      const unit = MINUTES_PER_UNIT[rule.unit] ? rule.unit : 'minutes';
      const value = Number(rule.value ?? rule.minMinutes) || 0;
      return {
        value,
        unit,
        minMinutes: toMinutes(value, unit),
        color: rule.color || '#22c55e'
      };
    })
    .sort((a, b) => a.minMinutes - b.minMinutes);

  state.thresholds = normalized;
  return normalized;
}

function loadConfig() {
  if (!window.SuriTimerStorage) {
    return;
  }

  window.SuriTimerStorage.getConfig().then((config) => {
    state.theme = config.theme || 'light';
    state.themeBrightness = config.themeBrightness ?? 100;
    state.themeContrast = config.themeContrast ?? 100;
    state.themeLightBrightness = config.themeLightBrightness ?? 100;
    state.themeLightContrast = config.themeLightContrast ?? 100;
    state.showShopInfo = config.showShopInfo !== false;
    state.thresholds = (config.thresholds && config.thresholds.length)
      ? config.thresholds
      : [DEFAULT_RULE];
    state.domains = {
      ...state.domains,
      ...(config.domains || {})
    };

    normalizeThresholds();
    updateThemeButtons();
    updateSliders();
    renderRules();
    renderDomains();
    updatePreview();

    const showShopInfoCheckbox = document.getElementById('showShopInfo');
    if (showShopInfoCheckbox) showShopInfoCheckbox.checked = state.showShopInfo;
  });
}

function saveConfig(options = {}) {
  const status = document.getElementById('status');
  normalizeThresholds();
  renderRules();

  if (!window.SuriTimerStorage) {
    status.textContent = 'Storage indisponível no contexto atual.';
    return;
  }

  const config = {
    theme: state.theme,
    themeBrightness: state.themeBrightness,
    themeContrast: state.themeContrast,
    themeLightBrightness: state.themeLightBrightness,
    themeLightContrast: state.themeLightContrast,
    showShopInfo: state.showShopInfo,
    thresholds: state.thresholds,
    domains: state.domains
  };

  window.SuriTimerStorage.setConfig(config)
    .then(() => {
      status.textContent = options.message || 'Configurações salvas com sucesso.';
      updatePreview();
    })
    .catch((error) => {
      console.error(error);
      status.textContent = 'Não foi possível salvar. Verifique as permissões da extensão.';
    });
}

document.getElementById('addRule').addEventListener('click', () => {
  const lastMinutes = state.thresholds[state.thresholds.length - 1]?.minMinutes || 0;
  const value = lastMinutes + 5;
  state.thresholds.push({
    value,
    unit: 'minutes',
    minMinutes: value,
    color: '#ef4444'
  });
  renderRules();
  updatePreview();
});

document.getElementById('save').addEventListener('click', () => saveConfig());

document.querySelectorAll('.theme-option').forEach((button) => {
  button.addEventListener('click', () => {
    state.theme = button.dataset.theme;
    updateThemeButtons();
    saveConfig({ message: `Tema ${button.dataset.theme === 'dark' ? 'escuro' : 'claro'} aplicado.` });
  });
});

document.getElementById('brightness').addEventListener('input', (event) => {
  state.themeBrightness = Number(event.target.value);
  updateSliders();
});
document.getElementById('brightness').addEventListener('change', () => {
  saveConfig({ message: 'Brilho ajustado.' });
});

document.getElementById('contrast').addEventListener('input', (event) => {
  state.themeContrast = Number(event.target.value);
  updateSliders();
});
document.getElementById('contrast').addEventListener('change', () => {
  saveConfig({ message: 'Contraste ajustado.' });
});

document.getElementById('lightBrightness').addEventListener('input', (event) => {
  state.themeLightBrightness = Number(event.target.value);
  updateSliders();
});
document.getElementById('lightBrightness').addEventListener('change', () => {
  saveConfig({ message: 'Brilho ajustado.' });
});

document.getElementById('lightContrast').addEventListener('input', (event) => {
  state.themeLightContrast = Number(event.target.value);
  updateSliders();
});
document.getElementById('lightContrast').addEventListener('change', () => {
  saveConfig({ message: 'Contraste ajustado.' });
});

document.getElementById('showShopInfo').addEventListener('change', (event) => {
  state.showShopInfo = event.target.checked;
  saveConfig({ message: `Identificação do Shop ${state.showShopInfo ? 'ativada' : 'desativada'}.` });
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab);
    });
  });
});

loadConfig();
