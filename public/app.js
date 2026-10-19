const loginScreen = document.querySelector('#login-screen');
const appShell = document.querySelector('#app-shell');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const moduleList = document.querySelector('#module-list');
const emptyState = document.querySelector('#empty-state');
const moduleDialog = document.querySelector('#module-dialog');
const activationDialog = document.querySelector('#activation-dialog');
const licenseDialog = document.querySelector('#license-dialog');
const toast = document.querySelector('#toast');
const historyBody = document.querySelector('#history-body');

let selectedModuleId = null;
let selectedLicenseModuleId = null;
let historyOffset = 0;
let historyTotal = 0;
let toastTimeout;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && url !== '/api/login') showLogin();
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function showLogin() {
  appShell.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginForm.reset();
  loginError.textContent = '';
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  refreshDashboard();
}

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3400);
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function relativeTime(value) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function daysLeft(value) {
  const remaining = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

function renderModules(data) {
  document.querySelector('#stat-total').textContent = data.summary.total;
  document.querySelector('#stat-active').textContent = data.summary.active;
  document.querySelector('#stat-inactive').textContent = data.summary.inactive;
  moduleList.replaceChildren();
  emptyState.classList.toggle('hidden', data.modules.length > 0);

  for (const module of data.modules) {
    const card = document.createElement('article');
    card.className = 'module-card';
    const active = module.enabled;
    const expiryLabel = active
      ? `${daysLeft(module.expiresAt)} day${daysLeft(module.expiresAt) === 1 ? '' : 's'} remaining`
      : 'No active schedule';
    card.innerHTML = `
      <div class="module-name-wrap">
        <span class="module-glyph">◈</span>
        <div><div class="module-name">${escapeHtml(module.name)}</div><div class="module-key">${escapeHtml(module.moduleKey)}</div></div>
      </div>
      <div class="module-status ${active ? 'is-active' : ''}"><i></i>${active ? 'ACTIVE' : 'INACTIVE'}</div>
      <div class="module-expiry ${active ? '' : 'expired'}"><span>${expiryLabel}</span><small>${active ? `Expires ${formatDate(module.expiresAt, true)}` : `Registered ${formatDate(module.createdAt)}`}</small></div>
      <div class="module-actions">
        <button class="small-button" data-activate="${escapeHtml(module.id)}">${active ? '＋ Add days' : 'Activate'}</button>
        ${active ? `<button class="small-button secondary" data-deactivate="${escapeHtml(module.id)}">Deactivate</button>` : ''}
        <button class="small-button secondary" data-licenses="${escapeHtml(module.id)}">Serial access</button>
      </div>`;
    moduleList.append(card);
  }
}

function renderHistory(events, append = false) {
  if (!append) historyBody.replaceChildren();
  document.querySelector('#history-count').textContent = `${historyTotal} EVENT${historyTotal === 1 ? '' : 'S'}`;
  document.querySelector('#stat-events').textContent = historyTotal;
  document.querySelector('#history-empty').classList.toggle('hidden', historyTotal > 0);

  for (const event of events) {
    const row = document.createElement('tr');
    const duration = event.durationDays
      ? `${event.durationDays} day${event.durationDays === 1 ? '' : 's'}`
      : '—';
    const window = event.activatedAt
      ? `${formatDate(event.activatedAt)} → ${formatDate(event.expiresAt)}`
      : '—';
    row.innerHTML = `
      <td><span class="history-module">${escapeHtml(event.moduleName)}<small>${escapeHtml(event.moduleKey)}</small>${event.serialNumber ? `<small class="history-serial">${escapeHtml(event.serialNumber)}</small>` : ''}</span></td>
      <td><span class="event-badge ${escapeHtml(event.action)}">${escapeHtml(event.action)}</span></td>
      <td>${duration}</td>
      <td>${window}</td>
      <td title="${escapeHtml(formatDate(event.occurredAt, true))}">${escapeHtml(relativeTime(event.occurredAt))}</td>`;
    historyBody.append(row);
  }
  document.querySelector('#load-more-button').classList.toggle('hidden', historyOffset >= historyTotal);
}

async function loadHistory(reset = false) {
  if (reset) historyOffset = 0;
  const result = await api(`/api/history?limit=50&offset=${historyOffset}`);
  historyTotal = result.total;
  renderHistory(result.events, !reset);
  historyOffset += result.events.length;
}

async function refreshDashboard() {
  try {
    const [modules] = await Promise.all([api('/api/modules'), loadHistory(true)]);
    renderModules(modules);
  } catch (error) {
    if (!appShell.classList.contains('hidden')) showToast(error.message, true);
  }
}

function renderLicenses(licenses) {
  const list = document.querySelector('#license-list');
  document.querySelector('#license-count').textContent = licenses.length;
  if (licenses.length === 0) {
    list.innerHTML = '<p class="license-empty">No serial numbers registered for this module.</p>';
    return;
  }
  list.innerHTML = licenses.map((license) => {
    const status = license.status.toUpperCase();
    const active = license.status === 'active';
    const paused = license.status === 'paused';
    const expiry = license.expiresAt
      ? `${paused ? 'Paused · held expiry ' : 'Expires '}${formatDate(license.expiresAt, true)}`
      : `Registered ${formatDate(license.createdAt)}`;
    const actions = active
      ? `<button class="small-button secondary" data-license-action="pause" data-license-id="${escapeHtml(license.id)}">Pause</button><button class="small-button secondary" data-license-action="deactivate" data-license-id="${escapeHtml(license.id)}">Deactivate</button>`
      : paused
        ? `<button class="small-button" data-license-action="resume" data-license-id="${escapeHtml(license.id)}">Resume</button><button class="small-button secondary" data-license-action="deactivate" data-license-id="${escapeHtml(license.id)}">Deactivate</button>`
        : `<button class="small-button" data-license-activate="${escapeHtml(license.serialNumber)}">Activate</button>`;
    return `<article class="license-row">
      <div class="license-identity"><strong>${escapeHtml(license.serialNumber)}</strong><small>${escapeHtml(expiry)}</small></div>
      <span class="license-status ${escapeHtml(license.status)}"><i></i>${status}</span>
      <div class="license-actions">${actions}</div>
    </article>`;
  }).join('');
}

async function loadLicenses() {
  const result = await api(`/api/modules/${encodeURIComponent(selectedLicenseModuleId)}/licenses`);
  renderLicenses(result.licenses);
}

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date()).toUpperCase();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const form = new FormData(loginForm);
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: form.get('username'),
        password: form.get('password'),
      }),
    });
    loginForm.reset();
    showDashboard();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    showLogin();
  }
});

function openModuleDialog() {
  document.querySelector('#module-form').reset();
  document.querySelector('#module-error').textContent = '';
  moduleDialog.showModal();
}
document.querySelector('#add-module-button').addEventListener('click', openModuleDialog);
document.querySelector('#empty-add-button').addEventListener('click', openModuleDialog);

document.querySelector('#module-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  document.querySelector('#module-error').textContent = '';
  try {
    await api('/api/modules', {
      method: 'POST',
      body: JSON.stringify({ name: form.get('name'), moduleKey: form.get('moduleKey') }),
    });
    moduleDialog.close();
    showToast('Module added to the registry.');
    await refreshDashboard();
  } catch (error) {
    document.querySelector('#module-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

moduleList.addEventListener('click', async (event) => {
  const licensesButton = event.target.closest('[data-licenses]');
  if (licensesButton) {
    selectedLicenseModuleId = licensesButton.dataset.licenses;
    const card = licensesButton.closest('.module-card');
    document.querySelector('#license-module-label').textContent =
      `Manage serial-number access for ${card.querySelector('.module-name').textContent}.`;
    document.querySelector('#license-error').textContent = '';
    document.querySelector('#license-form').reset();
    licenseDialog.showModal();
    try {
      await loadLicenses();
    } catch (error) {
      showToast(error.message, true);
      licenseDialog.close();
    }
    return;
  }
  const activateButton = event.target.closest('[data-activate]');
  if (activateButton) {
    selectedModuleId = activateButton.dataset.activate;
    const card = activateButton.closest('.module-card');
    document.querySelector('#activation-module-label').textContent =
      `Set access duration for ${card.querySelector('.module-name').textContent}.`;
    document.querySelector('#activation-error').textContent = '';
    activationDialog.showModal();
    return;
  }
  const deactivateButton = event.target.closest('[data-deactivate]');
  if (!deactivateButton) return;
  deactivateButton.disabled = true;
  try {
    await api(`/api/modules/${encodeURIComponent(deactivateButton.dataset.deactivate)}/deactivate`, {
      method: 'POST',
      body: '{}',
    });
    showToast('Module access has been deactivated.');
    await refreshDashboard();
  } catch (error) {
    showToast(error.message, true);
    deactivateButton.disabled = false;
  }
});

document.querySelector('#license-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const serialNumber = data.get('serialNumber');
  const action = event.submitter?.value;
  const days = Number(data.get('days'));
  const error = document.querySelector('#license-error');
  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  error.textContent = '';
  if (action === 'activate' && (!Number.isInteger(days) || days < 1 || days > 3650)) {
    error.textContent = 'Enter a whole number of activation days from 1 to 3650.';
    return;
  }
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (action === 'register') {
      await api(`/api/modules/${encodeURIComponent(selectedLicenseModuleId)}/licenses`, {
        method: 'POST',
        body: JSON.stringify({ serialNumber }),
      });
      showToast('Serial number registered as inactive.');
    } else {
      await api(`/api/modules/${encodeURIComponent(selectedLicenseModuleId)}/licenses/activate`, {
        method: 'POST',
        body: JSON.stringify({ serialNumber, days }),
      });
      showToast(`Serial activated for ${days} day${days === 1 ? '' : 's'}.`);
    }
    form.reset();
    await loadLicenses();
    await refreshDashboard();
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

document.querySelector('#license-list').addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-license-action]');
  const activateButton = event.target.closest('[data-license-activate]');
  if (!actionButton && !activateButton) return;
  const button = actionButton || activateButton;
  if (activateButton) {
    document.querySelector('#license-serial').value = activateButton.dataset.licenseActivate;
    document.querySelector('#license-days').focus();
    return;
  }
  button.disabled = true;
  try {
    const endpointAction = actionButton.dataset.licenseAction;
    await api(`/api/modules/${encodeURIComponent(selectedLicenseModuleId)}/licenses/${encodeURIComponent(actionButton.dataset.licenseId)}/${endpointAction}`, {
      method: 'POST',
      body: '{}',
    });
    const actionLabels = { pause: 'paused', resume: 'resumed', deactivate: 'deactivated' };
    showToast(`Serial ${actionLabels[endpointAction]}.`);
    await loadLicenses();
    await refreshDashboard();
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
});

document.querySelector('#activation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const days = Number(new FormData(event.currentTarget).get('days'));
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  document.querySelector('#activation-error').textContent = '';
  try {
    await api(`/api/modules/${encodeURIComponent(selectedModuleId)}/activate`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
    activationDialog.close();
    showToast(`Module activated for ${days} day${days === 1 ? '' : 's'}.`);
    await refreshDashboard();
  } catch (error) {
    document.querySelector('#activation-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#load-more-button').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try {
    await loadHistory();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
});

window.addEventListener('pagehide', () => {
  fetch('/api/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: 'same-origin',
    keepalive: true,
  }).catch((error) => console.error('Unable to revoke the panel session on exit.', error));
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) showLogin();
});

updateClock();
setInterval(updateClock, 30_000);
api('/api/session').then(showDashboard).catch(() => showLogin());
