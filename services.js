const serviceForm = document.getElementById('service-form');
const serviceIdInput = document.getElementById('service-id');
const serviceNameInput = document.getElementById('service-name');
const servicePriceInput = document.getElementById('service-price');
const serviceDurationInput = document.getElementById('service-duration');
const submitButton = document.getElementById('submit-service');
const cancelEditButton = document.getElementById('cancel-edit');
const serviceError = document.getElementById('service-error');
const servicesStatus = document.getElementById('services-status');
const servicesTableWrap = document.getElementById('services-table-wrap');
const servicesList = document.getElementById('services-list');
const serviceCount = document.getElementById('service-count');
const toast = document.getElementById('toast');

let services = [];
let toastTimer;

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function errorMessage(error, fallback) {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

async function parseJsonResponse(response) {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError('The server returned an invalid response.', response.status);
  }
}

async function requestServices(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw new ApiError('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // The status code supplies a safe fallback when an upstream error is not JSON.
    }
    throw new ApiError(
      payload.message || payload.error || `Request failed (${response.status}).`,
      response.status,
    );
  }
  return parseJsonResponse(response);
}

function normalizeService(value) {
  const price = value?.price;
  const durationMinutes = value?.durationMinutes;
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0 ||
    typeof durationMinutes !== 'number' ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  ) {
    throw new ApiError('The server returned an invalid service record.');
  }
  return { ...value, name: value.name, price, durationMinutes };
}

function serviceFromPayload(payload) {
  return normalizeService(payload?.service);
}

function formatPrice(price) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price);
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} mins`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? `${hours} hr ${remainder} mins`
    : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function createActionButton(label, className, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `service-action ${className}`;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

function renderServices() {
  servicesList.replaceChildren();
  serviceCount.textContent = String(services.length);
  serviceCount.setAttribute(
    'aria-label',
    `${services.length} ${services.length === 1 ? 'service' : 'services'}`,
  );
  if (services.length === 0) {
    servicesStatus.textContent = 'No services yet. Add the first service above.';
    servicesStatus.classList.remove('is-error');
    servicesStatus.hidden = false;
    servicesTableWrap.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  services.forEach((service) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const priceCell = document.createElement('td');
    const durationCell = document.createElement('td');
    const actionsCell = document.createElement('td');
    nameCell.className = 'service-name-cell';
    nameCell.textContent = service.name;
    priceCell.textContent = formatPrice(service.price);
    durationCell.textContent = formatDuration(service.durationMinutes);
    actionsCell.className = 'service-actions';
    actionsCell.append(
      createActionButton('Edit', 'edit-service', service.id),
      createActionButton('Delete', 'delete-service', service.id),
    );
    row.append(nameCell, priceCell, durationCell, actionsCell);
    fragment.append(row);
  });
  servicesList.append(fragment);
  servicesStatus.hidden = true;
  servicesTableWrap.hidden = false;
}

function resetForm() {
  serviceForm.reset();
  serviceIdInput.value = '';
  serviceDurationInput.value = '30';
  submitButton.textContent = 'Add Service';
  cancelEditButton.hidden = true;
  serviceError.textContent = '';
}

function beginEdit(service) {
  serviceIdInput.value = service.id;
  serviceNameInput.value = service.name;
  servicePriceInput.value = service.price.toFixed(2);
  const duration = String(service.durationMinutes);
  if (
    ![...serviceDurationInput.options].some(
      (option) => option.value === duration,
    )
  ) {
    serviceDurationInput.add(new Option(`${duration} mins`, duration));
  }
  serviceDurationInput.value = duration;
  submitButton.textContent = 'Save Changes';
  cancelEditButton.hidden = false;
  serviceNameInput.focus();
  serviceForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function validatedFormValue() {
  const name = serviceNameInput.value.trim();
  const price = Number(servicePriceInput.value);
  const durationMinutes = Number(serviceDurationInput.value);
  if (!name) throw new Error('Enter a service name.');
  if (name.length > 120) {
    throw new Error('Service name must be 120 characters or fewer.');
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    throw new Error('Enter a valid price between 0 and 1000000.');
  }
  if (Math.abs(price * 100 - Math.round(price * 100)) > Number.EPSILON * 100) {
    throw new Error('Price may contain at most two decimal places.');
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > 1_440
  ) {
    throw new Error('Choose a valid duration.');
  }
  return { name, price, durationMinutes };
}

async function loadServices() {
  servicesStatus.hidden = false;
  servicesStatus.classList.remove('is-error');
  servicesStatus.textContent = 'Loading services…';
  servicesTableWrap.hidden = true;
  try {
    const payload = await requestServices('/api/services');
    const records = Array.isArray(payload?.services) ? payload.services : [];
    services = records.map(normalizeService);
    renderServices();
  } catch (error) {
    services = [];
    serviceCount.textContent = '0';
    const message = errorMessage(
      error,
      'Failed to load services. Please try again.',
    );
    servicesStatus.textContent = message;
    servicesStatus.classList.add('is-error');
    showToast(message);
  }
}

serviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  serviceError.textContent = '';
  let body;
  try {
    body = validatedFormValue();
  } catch (error) {
    serviceError.textContent = error.message;
    return;
  }

  const editingId = serviceIdInput.value;
  submitButton.disabled = true;
  try {
    const payload = await requestServices(
      editingId
        ? `/api/services?id=${encodeURIComponent(editingId)}`
        : '/api/services',
      {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      },
    );
    const savedService = serviceFromPayload(payload);
    services = editingId
      ? services.map((service) =>
          service.id === editingId ? savedService : service,
        )
      : [savedService, ...services];
    renderServices();
    resetForm();
    showToast(editingId ? 'Service updated.' : 'Service added.');
  } catch (error) {
    const message = errorMessage(
      error,
      'Failed to save service. Please try again.',
    );
    serviceError.textContent = message;
    showToast(message);
  } finally {
    submitButton.disabled = false;
  }
});

cancelEditButton.addEventListener('click', resetForm);

servicesList.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button[data-id]');
  if (!button) return;
  const service = services.find((item) => item.id === button.dataset.id);
  if (!service) {
    showToast('That service is no longer available. Refresh and try again.');
    return;
  }
  if (button.classList.contains('edit-service')) {
    beginEdit(service);
    return;
  }
  if (!window.confirm(`Delete "${service.name}"?`)) return;

  button.disabled = true;
  try {
    await requestServices(
      `/api/services?id=${encodeURIComponent(service.id)}`,
      { method: 'DELETE' },
    );
    services = services.filter((item) => item.id !== service.id);
    if (serviceIdInput.value === service.id) resetForm();
    renderServices();
    showToast('Service deleted.');
  } catch (error) {
    button.disabled = false;
    showToast(
      errorMessage(error, 'Failed to delete service. Please try again.'),
    );
  }
});

loadServices();
