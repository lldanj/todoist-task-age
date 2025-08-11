const API_TOKEN = "a24425f7ede6b9c983c028616b55f62240bf7021";

function timeAgo(dateString) {
  const now = new Date();
  const then = new Date(dateString);
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `Created ${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `Created ${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `Created ${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return `Created just now`;
}

async function fetchTaskDetails(taskId) {
  const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function addCreationDateToTask(taskEl) {
  if (taskEl.querySelector('.creation-date')) return;

  const taskId = taskEl.getAttribute('data-item-id') || taskEl.getAttribute('data-id');
  if (!taskId) return;

  const taskData = await fetchTaskDetails(taskId);
  if (!taskData) return;

  const creationDate = taskData.created_at || taskData.created;
  if (!creationDate) return;

  const dateEl = document.createElement('div');
  dateEl.className = 'creation-date';
  dateEl.style.fontSize = '0.85em';
  dateEl.style.color = '#c9a46b';
  dateEl.style.marginTop = '0px';
  dateEl.style.marginLeft = '30px';
  dateEl.style.marginBottom = '10px';
  dateEl.textContent = timeAgo(creationDate);

  taskEl.appendChild(dateEl);
}

async function addCreationDates(root = document) {
  const tasks = Array.from(root.querySelectorAll('[data-item-id], [data-id]'));
  for (const taskEl of tasks) {
    await addCreationDateToTask(taskEl);
  }
}

async function addCreationDateSingleTaskView() {
  const singleTaskPanel = document.querySelector('[data-testid="task_view"]');
  if (!singleTaskPanel) return false;

  if (singleTaskPanel.querySelector('.creation-date-single')) return true;

  const taskEl = singleTaskPanel.querySelector('[data-item-id], [data-id]');
  if (!taskEl) return false;

  const taskId = taskEl.getAttribute('data-item-id') || taskEl.getAttribute('data-id');
  if (!taskId) return false;

  const taskData = await fetchTaskDetails(taskId);
  if (!taskData) return false;

  const creationDate = taskData.created_at || taskData.created;
  if (!creationDate) return false;

  const locationLabel = Array.from(singleTaskPanel.querySelectorAll('div, span')).find(
    (el) => el.textContent.trim() === 'Location'
  );

  if (!locationLabel) return false;

  const existing = singleTaskPanel.querySelector('.creation-date-single');
  if (existing) existing.remove();

  const dateEl = document.createElement('div');
  dateEl.className = 'creation-date-single';
  dateEl.style.fontSize = '0.85em';
  dateEl.style.color = '#666';
  dateEl.style.marginTop = '4px';
  dateEl.style.marginLeft = '20px';
  dateEl.textContent = timeAgo(creationDate);

  locationLabel.insertAdjacentElement('afterend', dateEl);

  return true;
}

function showRunningMessage() {
  if (document.getElementById('todoist-extension-status')) return;
  const msg = document.createElement('div');
  msg.id = 'todoist-extension-status';
  msg.textContent = 'extension running...';
  Object.assign(msg.style, {
    position: 'fixed',
    bottom: '5px',
    left: '5px',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    zIndex: '9999',
  });
  document.body.appendChild(msg);
}

function createToggleButton(enabled) {
  if (document.getElementById('todoist-extension-toggle')) return;

  const btn = document.createElement('button');
  btn.id = 'todoist-extension-toggle';
  btn.textContent = enabled ? 'Created Date: ON' : 'Created Date: OFF';

  Object.assign(btn.style, {
    position: 'fixed',
    top: '50px',  // moved down 40px from 10px
    right: '10px',
    padding: '3px 5px',
    fontSize: '11px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: enabled ? '#4caf50' : '#ccc',
    color: enabled ? 'white' : '#333',
    cursor: 'pointer',
    zIndex: '10000',
  });

  btn.onclick = () => {
    const newEnabled = btn.textContent.endsWith('ON') ? false : true;
    chrome.storage.sync.set({ enabled: newEnabled }, () => {
      btn.textContent = newEnabled ? 'Created Date: ON' : 'Created Date: OFF';
      btn.style.backgroundColor = newEnabled ? '#4caf50' : '#ccc';
      btn.style.color = newEnabled ? 'white' : '#333';
      if (newEnabled) {
        runExtension();
      } else {
        document.querySelectorAll('.creation-date, .creation-date-single').forEach(el => el.remove());
        const status = document.getElementById('todoist-extension-status');
        if (status) status.remove();
      }
    });
  };

  document.body.appendChild(btn);
}

async function runExtension() {
  const data = await new Promise((resolve) => chrome.storage.sync.get({ enabled: true }, resolve));
  if (!data.enabled) {
    const status = document.getElementById('todoist-extension-status');
    if (status) status.remove();
    return;
  }

  showRunningMessage();

  const singleTaskAdded = await addCreationDateSingleTaskView();

  if (!singleTaskAdded) {
    addCreationDates();

    const taskListContainer = document.querySelector('[data-testid="task_list"]') || document.body;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            addCreationDates(node);
          }
        }
      }
    });
    observer.observe(taskListContainer, { childList: true, subtree: true });
  }
}

chrome.storage.sync.get({ enabled: true }, (data) => {
  createToggleButton(data.enabled);
  if (data.enabled) {
    setTimeout(runExtension, 1500);
  }
});
