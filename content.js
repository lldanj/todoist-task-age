// Configuration
const CONFIG = {
  DEBUG: true, // Set to false to disable debug logging
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  DEBOUNCE_DELAY: 1000, // ms - increased to prevent rapid-fire calls
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // ms
  RATE_LIMIT_DELAY: 100, // ms between requests
};

// In-memory cache for task data
const taskCache = new Map();

// Request queue for rate limiting
let requestQueue = [];
let isProcessingQueue = false;

// MutationObserver reference for cleanup
let mutationObserver = null;

// Processing flags to prevent concurrent execution
let isProcessingSingleTaskView = false;
let currentTaskId = null;

// Debug logging function
function debugLog(...args) {
  if (CONFIG.DEBUG) {
    console.log('[Todoist Extension]', ...args);
  }
}

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

// Get API token from storage
async function getApiToken() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ apiToken: '' }, (data) => {
      resolve(data.apiToken);
    });
  });
}

// Cache management
function getCachedTask(taskId) {
  const cached = taskCache.get(taskId);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CONFIG.CACHE_TTL) {
    taskCache.delete(taskId);
    debugLog(`Cache expired for task ${taskId}`);
    return null;
  }

  debugLog(`Cache hit for task ${taskId}`);
  return cached.data;
}

function setCachedTask(taskId, data) {
  taskCache.set(taskId, {
    data,
    timestamp: Date.now(),
  });
  debugLog(`Cached task ${taskId}`);
}

// Retry logic with exponential backoff
async function fetchWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      debugLog(`Fetching ${url} (attempt ${i + 1}/${retries})`);
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      if (response.status === 401) {
        debugLog('Authentication failed - invalid API token');
        showError('Invalid API token. Please check your settings.');
        return null;
      }

      if (response.status === 404) {
        debugLog(`Task not found (404) - likely deleted or invalid ID`);
        return null;
      }

      if (response.status === 429) {
        debugLog('Rate limited, waiting before retry...');
        await sleep(CONFIG.RETRY_DELAY * Math.pow(2, i));
        continue;
      }

      if (response.status >= 500) {
        debugLog(`Server error ${response.status}, retrying...`);
        await sleep(CONFIG.RETRY_DELAY * Math.pow(2, i));
        continue;
      }

      debugLog(`Request failed with status ${response.status}`);
      return response;
    } catch (error) {
      debugLog(`Request error: ${error.message}`);
      if (i === retries - 1) {
        showError(`Network error: ${error.message}`);
        return null;
      }
      await sleep(CONFIG.RETRY_DELAY * Math.pow(2, i));
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rate-limited request queue
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;
  debugLog(`Processing request queue (${requestQueue.length} requests)`);

  while (requestQueue.length > 0) {
    const { taskId, resolve, reject } = requestQueue.shift();

    try {
      const token = await getApiToken();
      if (!token) {
        debugLog('No API token found');
        showError('Please configure your API token in extension settings');
        resolve(null);
        continue;
      }

      const response = await fetchWithRetry(
        `https://api.todoist.com/rest/v2/tasks/${taskId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response && response.ok) {
        const data = await response.json();
        setCachedTask(taskId, data);
        resolve(data);
      } else {
        resolve(null);
      }
    } catch (error) {
      debugLog(`Error fetching task ${taskId}:`, error);
      reject(error);
    }

    // Rate limiting delay
    if (requestQueue.length > 0) {
      await sleep(CONFIG.RATE_LIMIT_DELAY);
    }
  }

  isProcessingQueue = false;
  debugLog('Request queue processed');
}

async function fetchTaskDetails(taskId) {
  // Check cache first
  const cached = getCachedTask(taskId);
  if (cached) {
    return cached;
  }

  // Add to queue and process
  return new Promise((resolve, reject) => {
    requestQueue.push({ taskId, resolve, reject });
    processRequestQueue();
  });
}

// Error notification system
function showError(message) {
  const existingError = document.getElementById('todoist-extension-error');
  if (existingError) existingError.remove();

  const errorDiv = document.createElement('div');
  errorDiv.id = 'todoist-extension-error';
  errorDiv.textContent = message;
  Object.assign(errorDiv.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    background: '#f44336',
    color: '#fff',
    padding: '10px 15px',
    borderRadius: '4px',
    fontSize: '13px',
    zIndex: '10001',
    maxWidth: '300px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
  });

  document.body.appendChild(errorDiv);

  setTimeout(() => {
    errorDiv.style.opacity = '0';
    errorDiv.style.transition = 'opacity 0.3s';
    setTimeout(() => errorDiv.remove(), 300);
  }, 5000);
}

async function addCreationDateToTask(taskEl) {
  if (taskEl.querySelector('.creation-date')) return;

  // Skip if this is inside a single task view panel
  if (taskEl.closest('[data-testid="task_view"]')) {
    debugLog('Skipping task inside single task view');
    return;
  }

  const taskId = taskEl.getAttribute('data-item-id') || taskEl.getAttribute('data-id');
  if (!taskId) return;

  // Ensure the task element has relative positioning
  const computedStyle = window.getComputedStyle(taskEl);
  if (computedStyle.position === 'static') {
    taskEl.style.position = 'relative';
  }

  // Add loading indicator - positioned absolutely on the right
  const loadingEl = document.createElement('div');
  loadingEl.className = 'creation-date creation-date-loading';
  Object.assign(loadingEl.style, {
    position: 'absolute',
    top: '8px',
    right: '10px',
    fontSize: '0.75em',
    color: '#999',
    pointerEvents: 'none',
    zIndex: '10',
  });
  loadingEl.textContent = 'Loading...';
  taskEl.appendChild(loadingEl);

  try {
    const taskData = await fetchTaskDetails(taskId);

    // Remove loading indicator
    loadingEl.remove();

    if (!taskData) {
      debugLog(`No data received for task ${taskId}`);
      return;
    }

    const creationDate = taskData.created_at || taskData.created;
    if (!creationDate) {
      debugLog(`No creation date found for task ${taskId}`);
      return;
    }

    const dateEl = document.createElement('div');
    dateEl.className = 'creation-date';
    Object.assign(dateEl.style, {
      position: 'absolute',
      top: '8px',
      right: '10px',
      fontSize: '0.75em',
      color: '#c9a46b',
      pointerEvents: 'none',
      zIndex: '10',
      whiteSpace: 'nowrap',
    });
    dateEl.textContent = timeAgo(creationDate);

    taskEl.appendChild(dateEl);
    debugLog(`Added creation date to task ${taskId}`);
  } catch (error) {
    loadingEl.remove();
    debugLog(`Error adding creation date to task ${taskId}:`, error);
  }
}

async function addCreationDates(root = document) {
  const tasks = Array.from(root.querySelectorAll('[data-item-id], [data-id]'));
  for (const taskEl of tasks) {
    await addCreationDateToTask(taskEl);
  }
}

async function addCreationDateSingleTaskView() {
  const singleTaskPanel = document.querySelector('[data-testid="task_view"]');
  if (!singleTaskPanel) {
    currentTaskId = null;
    return false;
  }

  const taskEl = singleTaskPanel.querySelector('[data-item-id], [data-id]');
  if (!taskEl) {
    currentTaskId = null;
    return false;
  }

  const taskId = taskEl.getAttribute('data-item-id') || taskEl.getAttribute('data-id');
  if (!taskId) {
    currentTaskId = null;
    return false;
  }

  // Prevent concurrent processing of the same task
  if (isProcessingSingleTaskView && currentTaskId === taskId) {
    debugLog(`Already processing single task view for ${taskId}, skipping`);
    return true;
  }

  // If it's a different task, clean up the old one
  if (currentTaskId !== taskId) {
    debugLog(`New task detected: ${taskId} (previous: ${currentTaskId})`);
    singleTaskPanel.querySelectorAll('.creation-date-single').forEach(el => {
      el.remove();
      debugLog('Removed creation-date-single from previous task');
    });
  }

  isProcessingSingleTaskView = true;
  currentTaskId = taskId;

  try {
    const taskData = await fetchTaskDetails(taskId);
    if (!taskData) {
      debugLog(`No data for single task view ${taskId}`);
      isProcessingSingleTaskView = false;
      return false;
    }

    const creationDate = taskData.created_at || taskData.created;
    if (!creationDate) {
      debugLog(`No creation date for single task view ${taskId}`);
      isProcessingSingleTaskView = false;
      return false;
    }

    // Check if we already added the date while fetching
    if (singleTaskPanel.querySelector('.creation-date-single')) {
      debugLog('Creation date already exists, skipping');
      isProcessingSingleTaskView = false;
      return true;
    }

    // More specific selector: find the Location label in the metadata section
    const locationLabel = Array.from(singleTaskPanel.querySelectorAll('div, span')).find(
      (el) => el.textContent.trim() === 'Location' && !el.querySelector('*')
    );

    if (!locationLabel) {
      debugLog('Location label not found in single task view');
      isProcessingSingleTaskView = false;
      return false;
    }

    // Create and add the date element
    const dateEl = document.createElement('div');
    dateEl.className = 'creation-date-single';
    dateEl.style.fontSize = '0.85em';
    dateEl.style.color = '#666';
    dateEl.style.marginTop = '4px';
    dateEl.style.marginLeft = '20px';
    dateEl.textContent = timeAgo(creationDate);

    locationLabel.insertAdjacentElement('afterend', dateEl);
    debugLog(`Added creation date to single task view ${taskId}`);

    isProcessingSingleTaskView = false;
    return true;
  } catch (error) {
    debugLog(`Error in single task view:`, error);
    isProcessingSingleTaskView = false;
    return false;
  }
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
        // Disconnect the mutation observer to stop adding new dates
        if (mutationObserver) {
          mutationObserver.disconnect();
          mutationObserver = null;
          debugLog('MutationObserver disconnected');
        }

        // Reset processing flags
        isProcessingSingleTaskView = false;
        currentTaskId = null;

        // Clear request queue
        requestQueue = [];
        isProcessingQueue = false;

        // Remove all creation date elements (including loading ones)
        document.querySelectorAll('.creation-date, .creation-date-single, .creation-date-loading').forEach(el => el.remove());

        // Remove status message
        const status = document.getElementById('todoist-extension-status');
        if (status) status.remove();

        debugLog('Extension disabled - all elements removed and flags reset');
      }
    });
  };

  document.body.appendChild(btn);
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function runExtension() {
  debugLog('Starting extension...');

  const data = await new Promise((resolve) => chrome.storage.sync.get({ enabled: true }, resolve));
  if (!data.enabled) {
    debugLog('Extension is disabled');
    const status = document.getElementById('todoist-extension-status');
    if (status) status.remove();
    return;
  }

  // Check if API token is configured
  const token = await getApiToken();
  if (!token) {
    debugLog('No API token configured');
    showError('Please configure your API token in extension settings (right-click extension icon → Options)');
    return;
  }

  showRunningMessage();

  // Try to add single task view first
  await addCreationDateSingleTaskView();

  // Always set up the observer for task lists
  debugLog('Adding creation dates to task list');
  addCreationDates();

  const taskListContainer = document.querySelector('[data-testid="task_list"]') || document.body;

  // Disconnect existing observer if any
  if (mutationObserver) {
    mutationObserver.disconnect();
    debugLog('Disconnected previous MutationObserver');
  }

  // Debounced handler for mutations to avoid excessive calls
  const debouncedHandler = debounce(async (mutations) => {
    // Double-check extension is still enabled
    const data = await new Promise((resolve) => chrome.storage.sync.get({ enabled: true }, resolve));
    if (!data.enabled) {
      debugLog('Extension disabled during mutation processing, skipping');
      return;
    }

    debugLog(`Processing ${mutations.length} mutations`);
    const nodesToProcess = new Set();

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          nodesToProcess.add(node);

          // Check if single task view appeared
          if (node.querySelector && node.querySelector('[data-testid="task_view"]')) {
            debugLog('Single task view detected in mutations');
            addCreationDateSingleTaskView();
          }
        }
      }
    }

    nodesToProcess.forEach(node => addCreationDates(node));
  }, CONFIG.DEBOUNCE_DELAY);

  mutationObserver = new MutationObserver(debouncedHandler);
  mutationObserver.observe(taskListContainer, { childList: true, subtree: true });
  debugLog('MutationObserver attached with debouncing');

  debugLog('Extension initialized successfully');
}

chrome.storage.sync.get({ enabled: true }, (data) => {
  createToggleButton(data.enabled);
  if (data.enabled) {
    setTimeout(runExtension, 1500);
  }
});
