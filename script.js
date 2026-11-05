const configuredApiUrl = document.querySelector('meta[name="api-base-url"]')?.content.trim();
const isLocalFrontend = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const apiBaseUrl = (configuredApiUrl || (isLocalFrontend
  ? `${window.location.protocol}//${window.location.hostname}:4000`
  : window.location.origin)).replace(/\/+$/, '');
const sessionKey = 'brainTdsSession';

function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) ?? 'null');
    return session && typeof session.accessToken === 'string' ? session : null;
  } catch {
    localStorage.removeItem(sessionKey);
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(sessionKey);
}

async function parseResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

async function refreshSession() {
  const currentSession = getSession();
  if (!currentSession?.refreshToken) return null;
  const response = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: currentSession.refreshToken })
  });
  if (!response.ok) {
    clearSession();
    throw new Error('Your session expired. Please sign in again.');
  }
  const { session } = await response.json();
  saveSession(session);
  return session;
}

async function apiRequest(path, options = {}, retry = true) {
  const session = getSession();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  if (response.status === 401 && retry && session?.refreshToken) {
    try {
      const refreshed = await refreshSession();
      if (refreshed) return apiRequest(path, options, false);
    } catch (error) {
      if (document.body.dataset.page !== 'account') throw error;
    }
  }
  return parseResponse(response);
}

function setMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden', 'error', 'success');
  element.classList.add(isError ? 'error' : 'success');
}

function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, options).format(date);
}

function element(tagName, text, className) {
  const node = document.createElement(tagName);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function tableCell(text, className) {
  const cell = element('td', text, className);
  return cell;
}

function emptyTableRow(tbody, columns, message) {
  tbody.replaceChildren();
  const row = document.createElement('tr');
  const cell = element('td', message, 'empty-row');
  cell.colSpan = columns;
  row.append(cell);
  tbody.append(row);
}

function statusBadge(status) {
  const badge = element('span', status || 'Unknown', 'status-badge');
  badge.classList.add(`status-${String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  return badge;
}

function appendStatusCell(row, status) {
  const cell = document.createElement('td');
  cell.append(statusBadge(status));
  row.append(cell);
}

function routeToDashboard(user) {
  window.location.href = ['staff', 'admin'].includes(user.role)
    ? 'staff.html'
    : 'customer-dashboard.html';
}

// Keep the navigation compact on mobile and give internal pages a stable header.
const navbar = document.getElementById('navbar');
if (navbar) {
  const updateNavbar = () => {
    navbar.classList.toggle('scrolled', document.body.dataset.page !== 'home' || window.scrollY > 20);
  };
  updateNavbar();
  window.addEventListener('scroll', updateNavbar);
}

const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    const isOpen = navLinks.classList.contains('open');
    hamburger.textContent = isOpen ? '✕' : '☰';
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });
  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.textContent = '☰';
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
}

document.querySelectorAll('[data-logout]').forEach((button) => {
  button.addEventListener('click', () => {
    clearSession();
    window.location.href = 'account.html';
  });
});

// Animated stat counters on pages that show operational facts.
const statValues = document.querySelectorAll('.stat-value[data-target]');
if (statValues.length && 'IntersectionObserver' in window) {
  const animateCount = (node) => {
    const target = Number.parseInt(node.dataset.target, 10);
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / 1500, 1);
      node.textContent = String(Math.floor((1 - Math.pow(1 - progress, 3)) * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  statValues.forEach((node) => observer.observe(node));
}

// Public shipment tracking and delivery timeline.
const trackBtn = document.getElementById('trackBtn');
const trackingInput = document.getElementById('trackingInput');
const trackingResult = document.getElementById('trackingResult');
const trackingForm = document.getElementById('trackingForm');

if (trackingForm && trackBtn && trackingInput && trackingResult) {
  trackingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const trackingNumber = trackingInput.value.trim();
    if (!trackingNumber) return;

    trackBtn.disabled = true;
    trackBtn.textContent = 'Looking up…';
    trackingResult.classList.add('hidden');
    try {
      const { shipment } = await apiRequest(`/api/shipments/${encodeURIComponent(trackingNumber)}`);
      trackingResult.replaceChildren();
      const overview = element('div', undefined, 'tracking-overview');
      overview.append(
        element('span', 'SHIPMENT STATUS', 'eyebrow'),
        element('strong', shipment.status, 'tracking-status'),
        element('span', `${shipment.tracking_number} · ${shipment.origin} → ${shipment.destination}`, 'tracking-route')
      );
      if (shipment.estimated_delivery) {
        overview.append(element('span', `Estimated delivery ${formatDate(shipment.estimated_delivery)}`, 'tracking-eta'));
      }
      trackingResult.append(overview);

      if (shipment.events.length) {
        const timeline = element('ol', undefined, 'shipment-timeline');
        shipment.events.forEach((eventItem, index) => {
          const item = element('li', undefined, index === 0 ? 'timeline-event latest' : 'timeline-event');
          const marker = element('span', undefined, 'timeline-marker');
          const content = element('div', undefined, 'timeline-content');
          content.append(
            element('strong', eventItem.status),
            element('p', eventItem.description),
            element('span', `${eventItem.location} · ${formatDate(eventItem.occurred_at, { dateStyle: 'medium', timeStyle: 'short' })}`)
          );
          item.append(marker, content);
          timeline.append(item);
        });
        trackingResult.append(timeline);
      } else {
        trackingResult.append(element('p', 'Your shipment has been booked. Tracking events will appear here as it moves.', 'timeline-empty'));
      }
      trackingResult.classList.remove('hidden', 'error');
    } catch (error) {
      trackingResult.replaceChildren(element('p', error.message || 'Could not connect to shipment tracking. Please try again.'));
      trackingResult.classList.remove('hidden', 'success');
      trackingResult.classList.add('error');
    } finally {
      trackBtn.disabled = false;
      trackBtn.textContent = 'Track Shipment';
    }
  });
}

// Public booking form.
const inquiryForm = document.getElementById('inquiryForm');
const inquirySubmit = document.getElementById('inquirySubmit');
const inquiryResult = document.getElementById('inquiryResult');
if (inquiryForm && inquirySubmit && inquiryResult) {
  inquiryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    inquirySubmit.disabled = true;
    inquirySubmit.textContent = 'Sending…';
    inquiryResult.classList.add('hidden');

    const formData = new FormData(inquiryForm);
    const payload = Object.fromEntries(formData.entries());
    payload.fullName = formData.get('fullName');
    payload.email = formData.get('email');
    payload.phone = formData.get('phone');
    payload.origin = formData.get('origin');
    payload.destination = formData.get('destination');
    payload.serviceMode = formData.get('serviceMode');
    payload.cargoDescription = formData.get('cargoDescription');

    try {
      await apiRequest('/api/inquiries', { method: 'POST', body: JSON.stringify(payload) });
      inquiryForm.reset();
      setMessage(inquiryResult, 'Your shipment request has been received. Our team will contact you soon.');
    } catch (error) {
      setMessage(inquiryResult, error.message || 'Could not send your request. Please try again.', true);
    } finally {
      inquirySubmit.disabled = false;
      inquirySubmit.textContent = 'Send Shipment Request';
    }
  });
}

// Customer authentication and account recovery.
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('loginSubmit');
    const result = document.getElementById('loginResult');
    const values = new FormData(loginForm);
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const body = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') })
      });
      saveSession(body.session);
      routeToDashboard(body.session.user);
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in to account';
    }
  });
}

const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('signupSubmit');
    const result = document.getElementById('signupResult');
    const values = new FormData(signupForm);
    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const body = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          fullName: values.get('fullName'),
          phone: values.get('phone'),
          email: values.get('email'),
          password: values.get('password')
        })
      });
      if (!body.session) {
        setMessage(result, body.message);
        return;
      }
      saveSession(body.session);
      routeToDashboard(body.session.user);
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create customer account';
    }
  });
}

const recoveryForm = document.getElementById('recoveryForm');
if (recoveryForm) {
  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('recoverySubmit');
    const result = document.getElementById('recoveryResult');
    const values = new FormData(recoveryForm);
    submit.disabled = true;
    try {
      const body = await apiRequest('/api/auth/recovery', {
        method: 'POST',
        body: JSON.stringify({ email: values.get('email') })
      });
      setMessage(result, body.message);
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

const passwordResetForm = document.getElementById('passwordResetForm');
if (passwordResetForm) {
  const recoveryParams = new URLSearchParams(window.location.hash.slice(1));
  const recoveryToken = recoveryParams.get('access_token');
  if (recoveryParams.get('type') === 'recovery' && recoveryToken) {
    saveSession({ accessToken: recoveryToken, refreshToken: recoveryParams.get('refresh_token') || '' });
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.add('hidden');
    recoveryForm.classList.add('hidden');
    passwordResetForm.classList.remove('hidden');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  passwordResetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('passwordResetSubmit');
    const result = document.getElementById('passwordResetResult');
    const password = new FormData(passwordResetForm).get('password');
    submit.disabled = true;
    try {
      const body = await apiRequest('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ password })
      });
      clearSession();
      passwordResetForm.classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
      setMessage(document.getElementById('loginResult'), body.message);
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

if (document.body.dataset.page === 'account' && getSession() && passwordResetForm?.classList.contains('hidden')) {
  apiRequest('/api/auth/me')
    .then(({ user }) => routeToDashboard(user))
    .catch(clearSession);
}

// Customer dashboard.
async function loadCustomerDashboard() {
  const body = await apiRequest('/api/customer/dashboard');
  document.getElementById('customerName').textContent = body.user.full_name.split(' ')[0] || 'there';
  document.getElementById('activeShipmentCount').textContent = String(body.shipments.filter((item) => item.status !== 'Delivered').length);
  document.getElementById('deliveredShipmentCount').textContent = String(body.shipments.filter((item) => item.status === 'Delivered').length);
  document.getElementById('openRequestCount').textContent = String(body.inquiries.filter((item) => !['Declined', 'Approved'].includes(item.status)).length);

  const shipmentBody = document.getElementById('customerShipments');
  if (body.shipments.length === 0) {
    emptyTableRow(shipmentBody, 5, 'No shipments yet. Your confirmed shipments will appear here.');
  } else {
    shipmentBody.replaceChildren();
    body.shipments.forEach((shipment) => {
      const row = document.createElement('tr');
      const tracking = document.createElement('a');
      tracking.href = `track.html?number=${encodeURIComponent(shipment.tracking_number)}`;
      tracking.className = 'table-link';
      tracking.textContent = shipment.tracking_number;
      const trackingCell = document.createElement('td');
      trackingCell.append(tracking);
      row.append(trackingCell, tableCell(`${shipment.origin} → ${shipment.destination}`));
      appendStatusCell(row, shipment.status);
      row.append(tableCell(formatDate(shipment.estimated_delivery)), tableCell(formatDate(shipment.updated_at)));
      shipmentBody.append(row);
    });
  }

  const inquiryBody = document.getElementById('customerInquiries');
  if (body.inquiries.length === 0) {
    emptyTableRow(inquiryBody, 4, 'You have no open shipment requests.');
  } else {
    inquiryBody.replaceChildren();
    body.inquiries.forEach((item) => {
      const row = document.createElement('tr');
      row.append(tableCell(formatDate(item.created_at)), tableCell(`${item.origin} → ${item.destination}`), tableCell(item.service_mode));
      appendStatusCell(row, item.status);
      inquiryBody.append(row);
    });
  }
}

if (document.body.dataset.page === 'customer-dashboard') {
  const session = getSession();
  if (!session) {
    window.location.replace('account.html');
  } else {
    loadCustomerDashboard().catch((error) => {
      if (error.message.includes('Sign in') || error.message.includes('session')) {
        clearSession();
        window.location.replace('account.html');
      } else {
        emptyTableRow(document.getElementById('customerShipments'), 5, error.message);
        emptyTableRow(document.getElementById('customerInquiries'), 4, 'Unable to load shipment requests.');
      }
    });
  }

  const bookingForm = document.getElementById('customerBookingForm');
  bookingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('bookingSubmit');
    const result = document.getElementById('bookingResult');
    const values = new FormData(bookingForm);
    submit.disabled = true;
    try {
      const body = await apiRequest('/api/customer/bookings', {
        method: 'POST',
        body: JSON.stringify({
          origin: values.get('origin'),
          destination: values.get('destination'),
          serviceMode: values.get('serviceMode'),
          cargoDescription: values.get('cargoDescription')
        })
      });
      bookingForm.reset();
      setMessage(result, body.message);
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

// Operations dashboard helpers and handlers.
let staffDashboardData;

function populateStaffSelects(data) {
  const inquirySelect = document.getElementById('shipmentInquiry');
  inquirySelect.replaceChildren(new Option('Create without a request', ''));
  data.inquiries.filter((item) => item.status !== 'Declined').forEach((item) => {
    inquirySelect.add(new Option(`${item.full_name} · ${item.origin} → ${item.destination} · ${item.status}`, item.id));
  });

  const shipmentSelect = document.getElementById('eventShipment');
  shipmentSelect.replaceChildren(new Option('Select a shipment', ''));
  data.shipments.forEach((item) => {
    shipmentSelect.add(new Option(`${item.tracking_number} · ${item.origin} → ${item.destination}`, item.id));
  });
}

let adminUsersCache = [];

function renderAdminUsers() {
  const tbody = document.getElementById('adminUsers');
  const search = document.getElementById('adminUserSearch');
  const query = search.value.trim().toLowerCase();
  const filteredUsers = adminUsersCache.filter((user) => [user.full_name, user.email, user.role].some((value) => String(value || '').toLowerCase().includes(query)));
  tbody.replaceChildren();
  if (!filteredUsers.length) return emptyTableRow(tbody, 5, query ? 'No accounts match your search.' : 'No accounts found.');
  filteredUsers.forEach((user) => {
    const row = document.createElement('tr');
    row.append(tableCell(user.full_name || 'Customer'), tableCell(user.email), tableCell(user.role), tableCell(formatDate(user.created_at)));
    const action = document.createElement('td');
    if (user.id === getSession()?.user?.id) {
      action.append(element('span', 'You', 'muted'));
    } else {
      const role = document.createElement('select');
      role.className = 'role-select';
      ['customer', 'staff', 'admin'].forEach((value) => role.add(new Option(value, value, value === user.role, value === user.role)));
      role.setAttribute('aria-label', `Role for ${user.email}`);
      role.addEventListener('change', async () => {
        role.disabled = true;
        try {
          await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: role.value })
          });
          user.role = role.value;
          setMessage(document.getElementById('staffPageMessage'), `Updated ${user.email} to ${user.role}.`);
        } catch (error) {
          setMessage(document.getElementById('staffPageMessage'), error.message, true);
          role.value = user.role;
        } finally {
          role.disabled = false;
        }
      });
      action.append(role);
    }
    row.append(action);
    tbody.append(row);
  });
}

async function loadAdminUsers() {
  const { users } = await apiRequest('/api/admin/users');
  adminUsersCache = users;
  renderAdminUsers();
}

function updateHealthItem(id, label, isHealthy) {
  const item = document.getElementById(id);
  item.textContent = label;
  item.classList.toggle('health-good', isHealthy);
  item.classList.toggle('health-bad', !isHealthy);
  item.classList.remove('health-unknown');
}

async function loadAdminHealth() {
  const apiStatus = document.getElementById('apiHealthStatus');
  const databaseStatus = document.getElementById('databaseHealthStatus');
  const authStatus = document.getElementById('authHealthStatus');
  const checkedAt = document.getElementById('healthCheckedAt');
  const checkButton = document.getElementById('checkSystemHealth');
  checkButton.disabled = true;
  apiStatus.textContent = 'Checking…';
  apiStatus.className = 'health-unknown';
  try {
    const health = await parseResponse(await fetch(`${apiBaseUrl}/api/health`));
    const apiHealthy = health.status === 'ok';
    updateHealthItem('apiHealthStatus', apiHealthy ? 'Operational' : 'Unavailable', apiHealthy);
    updateHealthItem('databaseHealthStatus', health.databaseConfigured ? 'Configured' : 'Not configured', Boolean(health.databaseConfigured));
    updateHealthItem('authHealthStatus', health.authenticationConfigured ? 'Configured' : 'Not configured', Boolean(health.authenticationConfigured));
    checkedAt.textContent = `Last checked ${formatDate(new Date().toISOString(), { dateStyle: 'medium', timeStyle: 'short' })}`;
  } catch (error) {
    updateHealthItem('apiHealthStatus', 'Unreachable', false);
    updateHealthItem('databaseHealthStatus', 'Unknown', false);
    updateHealthItem('authHealthStatus', 'Unknown', false);
    checkedAt.textContent = `Health check failed: ${error.message}`;
  } finally {
    checkButton.disabled = false;
  }
}

async function loadStaffDashboard() {
  const data = await apiRequest('/api/staff/dashboard');
  staffDashboardData = data;
  document.getElementById('newRequestCount').textContent = String(data.summary.new_requests);
  document.getElementById('staffActiveShipments').textContent = String(data.summary.active_shipments);
  document.getElementById('staffDeliveredShipments').textContent = String(data.summary.delivered_shipments);
  document.getElementById('staffCustomerCount').textContent = String(data.summary.customers);
  document.getElementById('requestRecordCount').textContent = `${data.inquiries.length} requests`;
  document.getElementById('shipmentRecordCount').textContent = `${data.shipments.length} shipments`;

  const requests = document.getElementById('staffInquiries');
  if (data.inquiries.length === 0) {
    emptyTableRow(requests, 5, 'All caught up — no shipment requests yet.');
  } else {
    requests.replaceChildren();
    data.inquiries.forEach((item) => {
      const row = document.createElement('tr');
      const customer = document.createElement('td');
      customer.append(element('strong', item.full_name), element('span', item.email, 'table-subtext'), element('span', item.phone, 'table-subtext'));
      const cargo = document.createElement('td');
      cargo.append(element('strong', `${item.origin} → ${item.destination}`), element('span', `${item.service_mode} · ${item.cargo_description}`, 'table-subtext'));
      row.append(customer, cargo, tableCell(formatDate(item.created_at)));
      appendStatusCell(row, item.status);
      const actions = document.createElement('td');
      const status = document.createElement('select');
      status.className = 'status-select';
      status.setAttribute('aria-label', `Status for ${item.full_name}'s request`);
      ['New', 'Contacted', 'Approved', 'Declined'].forEach((value) => {
        status.add(new Option(value, value, value === item.status, value === item.status));
      });
      status.addEventListener('change', async () => {
        status.disabled = true;
        try {
          await apiRequest(`/api/staff/inquiries/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: status.value })
          });
          await loadStaffDashboard();
        } catch (error) {
          setMessage(document.getElementById('staffPageMessage'), error.message, true);
          status.value = item.status;
        } finally {
          status.disabled = false;
        }
      });
      actions.append(status);
      if (!['Approved', 'Declined'].includes(item.status)) {
        const approve = element('button', 'Approve & track', 'table-action');
        approve.type = 'button';
        approve.addEventListener('click', async () => {
          approve.disabled = true;
          try {
            await apiRequest(`/api/staff/inquiries/${encodeURIComponent(item.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'Approved' })
            });
            await loadStaffDashboard();
            document.getElementById('shipmentInquiry').value = item.id;
            document.getElementById('shipmentInquiry').dispatchEvent(new Event('change'));
            document.getElementById('createShipmentForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (error) {
            setMessage(document.getElementById('staffPageMessage'), error.message, true);
            approve.disabled = false;
          }
        });
        actions.append(approve);
      }
      row.append(actions);
      requests.append(row);
    });
  }

  const shipmentRows = document.getElementById('staffShipments');
  if (!data.shipments.length) {
    emptyTableRow(shipmentRows, 6, 'No shipments have been registered yet.');
  } else {
    shipmentRows.replaceChildren();
    data.shipments.forEach((item) => {
      const row = document.createElement('tr');
      row.append(tableCell(item.tracking_number), tableCell(item.customer_name || 'Guest request'), tableCell(`${item.origin} → ${item.destination}`));
      appendStatusCell(row, item.status);
      row.append(tableCell(formatDate(item.estimated_delivery)));
      const action = element('td', undefined);
      const button = element('button', 'Add update', 'table-action');
      button.type = 'button';
      button.addEventListener('click', () => {
        document.getElementById('eventShipment').value = item.id;
        document.getElementById('updateShipment').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      action.append(button);
      row.append(action);
      shipmentRows.append(row);
    });
  }
  populateStaffSelects(data);
}

if (document.body.dataset.page === 'staff') {
  if (!getSession()) {
    window.location.replace('account.html');
  } else {
    apiRequest('/api/auth/me').then(({ user }) => {
      if (!['staff', 'admin'].includes(user.role)) {
        window.location.replace('customer-dashboard.html');
        return;
      }
      if (user.role === 'admin') {
        document.getElementById('portalEyebrow').textContent = 'ADMIN CONTROL CENTER';
        document.getElementById('portalTitle').textContent = 'System dashboard';
        document.getElementById('portalDescription').textContent = 'Manage booking operations, shipments, tracking and account access from one place.';
        document.getElementById('adminAccountsLink').classList.remove('hidden');
        document.getElementById('adminHealthLink').classList.remove('hidden');
        document.getElementById('adminSystemPanel').classList.remove('hidden');
        document.getElementById('adminUsersPanel').classList.remove('hidden');
        loadAdminUsers().catch((error) => setMessage(document.getElementById('staffPageMessage'), error.message, true));
        loadAdminHealth();
      }
      loadStaffDashboard().catch((error) => {
        setMessage(document.getElementById('staffPageMessage'), error.message, true);
      });
    }).catch(() => {
      clearSession();
      window.location.replace('account.html');
    });
  }

  document.getElementById('refreshDashboard').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadStaffDashboard();
      if (!document.getElementById('adminUsersPanel').classList.contains('hidden')) {
        await loadAdminUsers();
        await loadAdminHealth();
      }
    } catch (error) {
      setMessage(document.getElementById('staffPageMessage'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('adminUserSearch').addEventListener('input', () => {
    renderAdminUsers();
  });
  document.getElementById('checkSystemHealth').addEventListener('click', () => {
    loadAdminHealth();
  });

  const inquirySelect = document.getElementById('shipmentInquiry');
  inquirySelect.addEventListener('change', () => {
    const inquiry = staffDashboardData?.inquiries.find((item) => item.id === inquirySelect.value);
    if (!inquiry) return;
    document.getElementById('newShipmentOrigin').value = inquiry.origin;
    document.getElementById('newShipmentDestination').value = inquiry.destination;
    document.getElementById('newShipmentMode').value = ['Air', 'Sea', 'Road'].includes(inquiry.service_mode) ? inquiry.service_mode : 'Sea';
    document.getElementById('newShipmentCargo').value = inquiry.cargo_description;
  });

  const createForm = document.getElementById('createShipmentForm');
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('createShipmentSubmit');
    const result = document.getElementById('createShipmentResult');
    const values = new FormData(createForm);
    submit.disabled = true;
    try {
      const body = await apiRequest('/api/staff/shipments', {
        method: 'POST',
        body: JSON.stringify({
          inquiryId: values.get('inquiryId'),
          trackingNumber: values.get('trackingNumber'),
          origin: values.get('origin'),
          destination: values.get('destination'),
          serviceMode: values.get('serviceMode'),
          estimatedDelivery: values.get('estimatedDelivery'),
          cargoDescription: values.get('cargoDescription')
        })
      });
      createForm.reset();
      setMessage(result, `Shipment ${body.shipment.tracking_number} created.`);
      await loadStaffDashboard();
      document.getElementById('eventShipment').value = body.shipment.id;
      document.getElementById('updateShipment').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  const eventForm = document.getElementById('shipmentEventForm');
  eventForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('eventSubmit');
    const result = document.getElementById('eventResult');
    const values = new FormData(eventForm);
    submit.disabled = true;
    try {
      await apiRequest(`/api/staff/shipments/${encodeURIComponent(values.get('shipmentId'))}/events`, {
        method: 'POST',
        body: JSON.stringify({
          status: values.get('status'),
          location: values.get('location'),
          description: values.get('description')
        })
      });
      eventForm.reset();
      setMessage(result, 'Tracking update published to the shipment timeline.');
      await loadStaffDashboard();
    } catch (error) {
      setMessage(result, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

// Carry an existing tracking lookup from the customer portal into the public tracker.
const trackingQuery = new URLSearchParams(window.location.search).get('number');
if (trackingQuery && trackingInput) {
  trackingInput.value = trackingQuery;
  trackingForm.requestSubmit();
}
