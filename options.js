const DEFAULT_RULE = { minMinutes: 0, color: '#22c55e' };

const state = {
  theme: 'dark',
  thresholds: [
    { minMinutes: 0, color: '#22c55e' },
    { minMinutes: 5, color: '#facc15' },
    { minMinutes: 15, color: '#ef4444' }
  ]
};

function updatePreview() {
  const previewValue = document.getElementById('previewValue');
  const previewBadge = document.getElementById('previewBadge');
  if (!previewValue || !previewBadge) {
    return;
  }

  const activeRule = [...state.thresholds].sort((a, b) => a.minMinutes - b.minMinutes).at(-1) || DEFAULT_RULE;
  previewValue.textContent = '00:15';
  previewBadge.style.borderColor = activeRule.color || '#22c55e';
  previewValue.style.color = activeRule.color || '#22c55e';

  const buttons = document.querySelectorAll('.theme-option');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === state.theme);
  });
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

    const minGroup = document.createElement('div');
    const minLabel = document.createElement('label');
    minLabel.textContent = 'Minutos';
    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.min = '0';
    minInput.step = '1';
    minInput.value = rule.minMinutes;
    minInput.addEventListener('input', (event) => {
      state.thresholds[index].minMinutes = Number(event.target.value) || 0;
      updatePreview();
    });
    minGroup.appendChild(minLabel);
    minGroup.appendChild(minInput);

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
    infoText.textContent = `${rule.minMinutes} min ou mais`;
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

    row.appendChild(minGroup);
    row.appendChild(colorGroup);
    row.appendChild(info);
    row.appendChild(removeBtn);
    rulesRoot.appendChild(row);
  });
}

function normalizeThresholds() {
  const normalized = [...state.thresholds]
    .map((rule) => ({
      minMinutes: Number(rule.minMinutes) || 0,
      color: rule.color || '#22c55e'
    }))
    .sort((a, b) => a.minMinutes - b.minMinutes);

  state.thresholds = normalized;
  return normalized;
}

function loadConfig() {
  if (!window.SuriTimerStorage) {
    return;
  }

  window.SuriTimerStorage.getConfig().then((config) => {
    state.theme = config.theme || 'dark';
    state.thresholds = (config.thresholds && config.thresholds.length)
      ? config.thresholds
      : [DEFAULT_RULE];

    normalizeThresholds();
    renderRules();
    updatePreview();
  });
}

function saveConfig() {
  const status = document.getElementById('status');
  normalizeThresholds();

  if (!window.SuriTimerStorage) {
    status.textContent = 'Storage indisponível no contexto atual.';
    return;
  }

  const config = {
    theme: state.theme,
    thresholds: state.thresholds
  };

  window.SuriTimerStorage.setConfig(config)
    .then(() => {
      status.textContent = 'Configurações salvas com sucesso.';
      updatePreview();
    })
    .catch((error) => {
      console.error(error);
      status.textContent = 'Não foi possível salvar. Verifique as permissões da extensão.';
    });
}

document.getElementById('addRule').addEventListener('click', () => {
  const lastMinutes = state.thresholds[state.thresholds.length - 1]?.minMinutes || 0;
  state.thresholds.push({
    minMinutes: lastMinutes + 5,
    color: '#ef4444'
  });
  renderRules();
  updatePreview();
});

document.getElementById('save').addEventListener('click', saveConfig);

document.querySelectorAll('.theme-option').forEach((button) => {
  button.addEventListener('click', () => {
    state.theme = button.dataset.theme;
    updatePreview();
  });
});

loadConfig();
