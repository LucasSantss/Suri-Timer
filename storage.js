(() => {
  const STORAGE_KEY = 'suriTimerConfig';

  const DEFAULT_CONFIG = {
    theme: 'light',
    themeBrightness: 100,
    themeContrast: 100,
    thresholds: [
      { minMinutes: 0, color: '#22c55e' },
      { minMinutes: 5, color: '#facc15' },
      { minMinutes: 15, color: '#ef4444' }
    ],
    domains: {
      'portal.chatbotmaker.io': true,
      'portal.suri.ai': true
    }
  };

  function getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: getDefaultConfig() }, (result) => {
        const defaults = getDefaultConfig();
        const stored = result[STORAGE_KEY] || {};
        const config = {
          ...defaults,
          ...stored,
          domains: { ...defaults.domains, ...(stored.domains || {}) }
        };
        resolve(config);
      });
    });
  }

  async function setConfig(nextConfig) {
    return new Promise((resolve, reject) => {
      const value = nextConfig || getDefaultConfig();
      chrome.storage.sync.set({ [STORAGE_KEY]: value }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(value);
      });
    });
  }

  window.SuriTimerStorage = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    getDefaultConfig,
    getConfig,
    setConfig
  };
})();
