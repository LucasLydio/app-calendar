(() => {
  'use strict';

  const API_BASE_URL = '/api';
  const PUSH_USER_ID_KEY = 'daybook-push-user-id';
  const DEFAULT_AVAILABILITY = {
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start: '09:00',
    end: '17:00',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };

  const elements = {
    availabilityForm: document.querySelector('#availability-form'),
    availabilityError: document.querySelector('#availability-error'),
    availabilityNote: document.querySelector('#availability-note'),
    appointmentList: document.querySelector('#appointment-list'),
    queueCount: document.querySelector('#queue-count'),
    queueCaption: document.querySelector('#queue-caption'),
    pendingTotal: document.querySelector('#pending-total'),
    approvedTotal: document.querySelector('#approved-total'),
    availabilityTotal: document.querySelector('#availability-total'),
    toast: document.querySelector('#toast'),
    todayLabel: document.querySelector('#today-label'),
    startTime: document.querySelector('#start-time'),
    endTime: document.querySelector('#end-time'),
  };

  let state = {
    availability: { ...DEFAULT_AVAILABILITY },
    appointments: [],
  };
  let activeView = 'pending';
  let toastTimer;

  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: options.body
        ? { 'Content-Type': 'application/json' }
        : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new Error(
        payload?.error ||
          `Request failed with status ${response.status}.`,
      );
    }
    return payload;
  }

  function availabilityFromApi(availability) {
    const slots = availability.weeklySlots || [];
    const dayKeys = {
      Monday: 'mon',
      Tuesday: 'tue',
      Wednesday: 'wed',
      Thursday: 'thu',
      Friday: 'fri',
      Saturday: 'sat',
      Sunday: 'sun',
    };
    const activeSlots = slots.filter((slot) => slot.active !== false);
    return {
      days: [
        ...new Set(activeSlots.map((slot) => dayKeys[slot.day] || slot.day)),
      ],
      start: activeSlots[0]?.start || '09:00',
      end: activeSlots[0]?.end || '17:00',
      timeZone: availability.timeZone || 'UTC',
    };
  }

  async function loadBackendData() {
    const [pendingResult, allResult, availabilityResult] =
      await Promise.allSettled([
        apiRequest('/appointments?status=pending'),
        apiRequest('/appointments?status=all'),
        apiRequest('/availability'),
      ]);

    if (allResult.status === 'fulfilled') {
      state.appointments = allResult.value.appointments;
    } else if (pendingResult.status === 'fulfilled') {
      state.appointments = pendingResult.value.appointments;
    }

    if (availabilityResult.status === 'fulfilled') {
      state.availability = availabilityFromApi(
        availabilityResult.value.availability,
      );
      renderAvailability();
    }
    renderAppointments();

    const failures = [pendingResult, allResult, availabilityResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason.message);
    if (failures.length) {
      showToast(`Could not fully load live data: ${failures[0]}`);
    }
  }

  function getPushUserId() {
    let userId = localStorage.getItem(PUSH_USER_ID_KEY);
    if (!userId) {
      userId = `browser-${crypto.randomUUID()}`;
      localStorage.setItem(PUSH_USER_ID_KEY, userId);
    }
    return userId;
  }

  function decodeVapidKey(encodedKey) {
    const padding = '='.repeat((4 - (encodedKey.length % 4)) % 4);
    const base64 = `${encodedKey}${padding}`
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function setupPushNotifications() {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      showToast('Push notifications are not supported by this browser.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Enable notifications to receive appointment updates.');
        return;
      }

      const { publicKey } = await apiRequest('/push/vapid-public-key');
      const registration =
        await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        });
      }

      await apiRequest('/push/subscriptions', {
        method: 'POST',
        body: {
          userId: getPushUserId(),
          subscription: subscription.toJSON(),
        },
      });
    } catch (error) {
      showToast(`Push setup failed: ${error.message}`);
    }
  }

  function formatAppointmentDate(dateValue) {
    const date = new Date(`${dateValue}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  function formatToday() {
    const now = new Date();
    elements.todayLabel.dateTime = now.toISOString().slice(0, 10);
    elements.todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(now);
  }

  function initialsFor(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase();
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createAppointmentRow(appointment) {
    const row = createElement('article', 'appointment');
    const person = createElement('div', 'person');
    const initials = createElement(
      'span',
      'person-initials',
      initialsFor(appointment.name),
    );
    initials.setAttribute('aria-hidden', 'true');

    const personCopy = createElement('div', 'person-copy');
    personCopy.append(
      createElement('strong', '', appointment.name),
      createElement(
        'span',
        '',
        `${appointment.service} · ${appointment.email}`,
      ),
    );
    person.append(initials, personCopy);

    const time = createElement('div', 'appointment-time');
    time.append(
      createElement('strong', '', appointment.time),
      createElement('span', '', formatAppointmentDate(appointment.date)),
    );

    row.append(person, time);
    if (appointment.status === 'pending') {
      const actions = createElement('div', 'appointment-actions');
      const approveButton = createElement(
        'button',
        'button button-approve',
        'Approve',
      );
      approveButton.type = 'button';
      approveButton.dataset.action = 'approve';
      approveButton.dataset.id = appointment.id;
      approveButton.setAttribute(
        'aria-label',
        `Approve appointment for ${appointment.name}`,
      );

      const rejectButton = createElement(
        'button',
        'button button-reject',
        'Reject',
      );
      rejectButton.type = 'button';
      rejectButton.dataset.action = 'reject';
      rejectButton.dataset.id = appointment.id;
      rejectButton.setAttribute(
        'aria-label',
        `Reject appointment for ${appointment.name}`,
      );
      actions.append(approveButton, rejectButton);
      row.append(actions);
    } else {
      const actions = createElement('div', 'appointment-actions');
      const status = createElement(
        'span',
        `status-label ${appointment.status}`,
        appointment.status,
      );
      actions.append(status);
      if (appointment.status === 'approved') {
        const downloadLink = createElement(
          'a',
          'button button-quiet',
          'Download .ics',
        );
        downloadLink.href = `${API_BASE_URL}/appointments/${encodeURIComponent(appointment.id)}/ics`;
        downloadLink.setAttribute(
          'aria-label',
          `Download calendar file for ${appointment.name}`,
        );
        actions.append(downloadLink);
      }
      row.append(actions);
    }
    return row;
  }

  function renderAppointments() {
    const appointments = state.appointments.filter((item) =>
      activeView === 'pending'
        ? item.status === 'pending'
        : item.status !== 'pending',
    );
    const fragment = document.createDocumentFragment();

    if (appointments.length === 0) {
      const empty = createElement('div', 'empty-state');
      empty.append(
        createElement(
          'strong',
          '',
          activeView === 'pending' ? 'All caught up' : 'No decisions yet',
        ),
        createElement(
          'span',
          '',
          activeView === 'pending'
            ? 'New appointment requests will appear here.'
            : 'Approved and rejected requests will appear here.',
        ),
      );
      fragment.append(empty);
    } else {
      appointments.forEach((appointment) =>
        fragment.append(createAppointmentRow(appointment)),
      );
    }

    elements.appointmentList.replaceChildren(fragment);
    elements.appointmentList.setAttribute(
      'aria-labelledby',
      activeView === 'pending' ? 'pending-tab' : 'history-tab',
    );
    elements.queueCaption.textContent =
      activeView === 'pending'
        ? 'Requests need your decision'
        : 'Recently reviewed requests';
    elements.queueCount.textContent = String(
      state.appointments.filter((item) => item.status === 'pending')
        .length,
    );
    elements.queueCount.setAttribute(
      'aria-label',
      `${elements.queueCount.textContent} pending requests`,
    );
    elements.pendingTotal.textContent = elements.queueCount.textContent;
    elements.approvedTotal.textContent = String(
      state.appointments.filter((item) => item.status === 'approved')
        .length,
    );
  }

  function renderAvailability() {
    document.querySelectorAll('input[name="day"]').forEach((input) => {
      input.checked = state.availability.days.includes(input.value);
    });
    elements.startTime.value = state.availability.start;
    elements.endTime.value = state.availability.end;
    elements.availabilityTotal.textContent = String(
      state.availability.days.length,
    );
  }

  function setActiveTab(view) {
    activeView = view;
    document.querySelectorAll('.tab-button').forEach((button) => {
      button.setAttribute(
        'aria-selected',
        String(button.dataset.view === view),
      );
    });
    renderAppointments();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(
      () => elements.toast.classList.remove('is-visible'),
      3200,
    );
  }

  async function updateAppointmentStatus(id, decision, button) {
    button.disabled = true;
    try {
      await apiRequest(
        `/appointments/${encodeURIComponent(id)}/${decision}`,
        { method: 'POST' },
      );
      await loadBackendData();
      showToast(
        decision === 'approve'
          ? 'Appointment approved. Calendar sync has been queued.'
          : 'Appointment rejected.',
      );
    } catch (error) {
      button.disabled = false;
      showToast(`Could not ${decision} appointment: ${error.message}`);
    }
  }

  async function handleAvailabilitySubmit(event) {
    event.preventDefault();
    const days = [
      ...document.querySelectorAll('input[name="day"]:checked'),
    ].map((input) => input.value);
    const start = elements.startTime.value;
    const end = elements.endTime.value;
    elements.availabilityError.textContent = '';
    elements.availabilityNote.textContent = '';

    if (days.length === 0) {
      elements.availabilityError.textContent =
        'Select at least one working day.';
      return;
    }
    if (!start || !end || start >= end) {
      elements.availabilityError.textContent =
        'End time must be later than start time.';
      return;
    }

    const weeklySlots = days.map((day) => ({ day, start, end }));
    try {
      const result = await apiRequest('/availability', {
        method: 'PUT',
        body: {
          timeZone: state.availability.timeZone,
          weeklySlots,
        },
      });
      state.availability = availabilityFromApi(result.availability);
      renderAvailability();
      elements.availabilityNote.textContent = 'Availability saved.';
      showToast('Weekly availability saved.');
    } catch (error) {
      elements.availabilityError.textContent = `Could not save availability: ${error.message}`;
    }
  }

  function resetAvailability() {
    document.querySelectorAll('input[name="day"]').forEach((input) => {
      input.checked = DEFAULT_AVAILABILITY.days.includes(input.value);
    });
    elements.startTime.value = DEFAULT_AVAILABILITY.start;
    elements.endTime.value = DEFAULT_AVAILABILITY.end;
    elements.availabilityForm.requestSubmit();
  }

  function handleQueueClick(event) {
    const actionButton = event.target.closest('button[data-action]');
    if (actionButton)
      void updateAppointmentStatus(
        actionButton.dataset.id,
        actionButton.dataset.action,
        actionButton,
      );
  }

  function bindEvents() {
    elements.availabilityForm.addEventListener(
      'submit',
      handleAvailabilitySubmit,
    );
    document
      .querySelector('#reset-availability')
      .addEventListener('click', resetAvailability);
    elements.appointmentList.addEventListener('click', handleQueueClick);
    document.querySelectorAll('.tab-button').forEach((button) => {
      button.addEventListener('click', () =>
        setActiveTab(button.dataset.view),
      );
    });
  }

  async function initialize() {
    formatToday();
    renderAvailability();
    renderAppointments();
    bindEvents();
    await Promise.all([loadBackendData(), setupPushNotifications()]);
  }

  void initialize();
})();
