document.getElementById('dark').addEventListener('click', async () => {
  if (!window.SuriTimerStorage) return;
  const c = await window.SuriTimerStorage.getConfig();
  c.theme = 'dark';
  await window.SuriTimerStorage.setConfig(c);
  window.close();
});

document.getElementById('light').addEventListener('click', async () => {
  if (!window.SuriTimerStorage) return;
  const c = await window.SuriTimerStorage.getConfig();
  c.theme = 'light';
  await window.SuriTimerStorage.setConfig(c);
  window.close();
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

// reflect current theme
async function init() {
  if (!window.SuriTimerStorage) return;
  const c = await window.SuriTimerStorage.getConfig();
  if (c?.theme === 'light') {
    document.getElementById('light').style.fontWeight = '700';
  } else {
    document.getElementById('dark').style.fontWeight = '700';
  }
}

init();
