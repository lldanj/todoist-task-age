document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const settingsLink = document.getElementById('settingsLink');

  chrome.storage.sync.get({ enabled: true }, (data) => {
    toggle.checked = data.enabled;
  });

  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggle.checked });
  });

  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
