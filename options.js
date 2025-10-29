document.addEventListener('DOMContentLoaded', () => {
  const apiTokenInput = document.getElementById('apiToken');
  const saveButton = document.getElementById('save');
  const testButton = document.getElementById('test');
  const statusDiv = document.getElementById('status');

  // Load existing token
  chrome.storage.sync.get({ apiToken: '' }, (data) => {
    if (data.apiToken) {
      apiTokenInput.value = data.apiToken;
    }
  });

  // Save token
  saveButton.addEventListener('click', () => {
    const token = apiTokenInput.value.trim();

    if (!token) {
      showStatus('Please enter an API token', 'error');
      return;
    }

    chrome.storage.sync.set({ apiToken: token }, () => {
      showStatus('API token saved successfully!', 'success');
    });
  });

  // Test token
  testButton.addEventListener('click', async () => {
    const token = apiTokenInput.value.trim();

    if (!token) {
      showStatus('Please enter an API token', 'error');
      return;
    }

    showStatus('Testing connection...', 'success');

    try {
      const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        showStatus('✓ Connection successful! Token is valid.', 'success');
      } else if (response.status === 401) {
        showStatus('✗ Invalid token. Please check your API token.', 'error');
      } else {
        showStatus(`✗ Error: ${response.status} - ${response.statusText}`, 'error');
      }
    } catch (error) {
      showStatus(`✗ Connection failed: ${error.message}`, 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;

    if (type === 'success') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }
});
