const DEFAULT_RULE = { minMinutes: 0, color: '#22c55e' };

const DOMAIN_LIST = [
  { hostname: 'portal.chatbotmaker.io', label: 'Chatbot Maker' },
  { hostname: 'portal.suri.ai', label: 'Suri' },
  { hostname: 'app.talkjs.com', label: 'Chat (widget de mensagens)' }
];

const state = {
  theme: 'light',
  themeBrightness: 100,
  themeContrast: 100,
  thresholds: [DEFAULT_RULE],
  domains: {
    'portal.chatbotmaker.io': true,
    'portal.suri.ai': true,
    'app.talkjs.com': true
  }
};

function setStatus(message) {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message || '';
  }
}

function updateThemeButtons() {
  document.querySelectorAll('.theme-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === state.theme);
  });
}

function updateSliders() {
  const brightness = document.getElementById('brightness');
  const contrast = document.getElementById('contrast');
  const brightnessValue = document.getElementById('brightnessValue');
  const contrastValue = document.getElementById('contrastValue');
  if (brightness) brightness.value = state.themeBrightness;
  if (contrast) contrast.value = state.themeContrast;
  if (brightnessValue) brightnessValue.textContent = `${state.themeBrightness}%`;
  if (contrastValue) contrastValue.textContent = `${state.themeContrast}%`;
}

function renderDomains() {
  const root = document.getElementById('domains');
  if (!root) return;

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

function renderRules() {
  const rulesRoot = document.getElementById('rules');
  if (!rulesRoot) return;

  rulesRoot.innerHTML = '';

  state.thresholds.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'rule-row';

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.min = '0';
    minInput.step = '1';
    minInput.value = rule.minMinutes;
    minInput.title = 'Minutos';
    minInput.addEventListener('input', (event) => {
      state.thresholds[index].minMinutes = Number(event.target.value) || 0;
    });

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = rule.color || '#22c55e';
    colorInput.title = 'Cor';
    colorInput.addEventListener('input', (event) => {
      state.thresholds[index].color = event.target.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'rule-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remover regra';
    removeBtn.disabled = state.thresholds.length <= 1;
    removeBtn.addEventListener('click', () => {
      if (state.thresholds.length <= 1) return;
      state.thresholds.splice(index, 1);
      renderRules();
    });

    row.appendChild(minInput);
    row.appendChild(colorInput);
    row.appendChild(removeBtn);
    rulesRoot.appendChild(row);
  });
}

function normalizeThresholds() {
  state.thresholds = [...state.thresholds]
    .map((rule) => ({
      minMinutes: Number(rule.minMinutes) || 0,
      color: rule.color || '#22c55e'
    }))
    .sort((a, b) => a.minMinutes - b.minMinutes);
}

function saveConfig(options = {}) {
  if (!window.SuriTimerStorage) {
    setStatus('Storage indisponível.');
    return;
  }

  normalizeThresholds();
  renderRules();

  const config = {
    theme: state.theme,
    themeBrightness: state.themeBrightness,
    themeContrast: state.themeContrast,
    thresholds: state.thresholds,
    domains: state.domains
  };

  window.SuriTimerStorage.setConfig(config)
    .then(() => {
      setStatus(options.message || 'Salvo.');
    })
    .catch((error) => {
      console.error(error);
      setStatus('Não foi possível salvar.');
    });
}

async function init() {
  if (!window.SuriTimerStorage) {
    setStatus('Storage indisponível neste contexto.');
    return;
  }

  const config = await window.SuriTimerStorage.getConfig();
  state.theme = config.theme || 'light';
  state.themeBrightness = config.themeBrightness ?? 100;
  state.themeContrast = config.themeContrast ?? 100;
  state.thresholds = (config.thresholds && config.thresholds.length) ? config.thresholds : [DEFAULT_RULE];
  state.domains = { ...state.domains, ...(config.domains || {}) };

  normalizeThresholds();
  updateThemeButtons();
  updateSliders();
  renderDomains();
  renderRules();
}

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

document.getElementById('addRule').addEventListener('click', () => {
  const lastMinutes = state.thresholds[state.thresholds.length - 1]?.minMinutes || 0;
  state.thresholds.push({ minMinutes: lastMinutes + 5, color: '#ef4444' });
  renderRules();
});

document.getElementById('save').addEventListener('click', () => saveConfig());

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
