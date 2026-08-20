(() => {
  const STORAGE_KEY = 'suriTimerConfig';

  const DEFAULT_CONFIG = {
    theme: 'dark',
    thresholds: [
      { minMinutes: 0, color: '#22c55e' },
      { minMinutes: 5, color: '#facc15' },
      { minMinutes: 15, color: '#ef4444' }
    ]
  };

  function getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ [STORAGE_KEY]: getDefaultConfig() }, (result) => {
        const config = result[STORAGE_KEY] || getDefaultConfig();
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
