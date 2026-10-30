(() => {
  'use strict';

  const API_BASE_URL = '/api';
  const PUSH_USER_ID_KEY = 'daybook-customer-push-user-id';
  const APPOINTMENT_DURATION_MINUTES = 60;
  const DAY_KEYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const elements = {
    form: document.querySelector('#booking-form'),
    date: document.querySelector('#booking-date'),
    slots: document.querySelector('#slot-grid'),
    time: document.querySelector('#booking-time'),
    name: document.querySelector('#customer-name'),
    email: document.querySelector('#customer-email'),
    submit: document.querySelector('#submit-button'),
    message: document.querySelector('#form-message'),
    timeZone: document.querySelector('#time-zone-label'),
    summaryDate: document.querySelector('#summary-date'),
    summaryTime: document.querySelector('#summary-time'),
    summaryZone: document.querySelector('#summary-zone'),
    summaryNote: document.querySelector('#summary-note'),
  };

  let availability;
  let bookedTimes = [];

  function normalizeAvailability(payload) {
    const value = payload?.availability;
    return {
      timeZone:
        typeof value?.timeZone === 'string' && value.timeZone
          ? value.timeZone
          : 'UTC',
      weeklySlots: (Array.isArray(value?.weeklySlots)
        ? value.weeklySlots
        : []
      )
        .filter(
          (slot) =>
            slot &&
            typeof slot.day === 'string' &&
            typeof slot.start === 'string' &&
            typeof slot.end === 'string',
        )
        .map((slot) => ({
          ...slot,
          blackoutSlots: Array.isArray(slot.blackoutSlots)
            ? slot.blackoutSlots
            : Array.isArray(slot.blackout)
              ? slot.blackout
              : [],
        })),
      disabledDates: Array.isArray(value?.disabledDates)
        ? value.disabledDates
        : [],
      blackoutHours: Array.isArray(value?.blackoutHours)
        ? value.blackoutHours
        : [],
      dateSpecificExceptions: (Array.isArray(value?.dateSpecificExceptions)
        ? value.dateSpecificExceptions
        : []
      ).filter(
        (exception) =>
          exception &&
          typeof exception.date === 'string' &&
          typeof exception.start === 'string' &&
          typeof exception.end === 'string',
      ),
    };
  }

  function normalizeBookedSlots(payload) {
    return (Array.isArray(payload?.bookedSlots) ? payload.bookedSlots : [])
      .filter((time) => typeof time === 'string')
      .map((time) => time.slice(0, 5));
  }

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

  function dateInParts(dateValue) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return { year, month, day };
  }

  function scheduleDayForDate(dateValue) {
    const { year, month, day } = dateInParts(dateValue);
    return DAY_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  }

  function managerLocalDateTime() {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: availability.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    return parts;
  }

  function formatDate(dateValue) {
    if (!dateValue) return 'Select a date';
    const { year, month, day } = dateInParts(dateValue);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function setMessage(message, state = 'error') {
    elements.message.textContent = message;
    elements.message.dataset.state = state;
  }

  function refreshSelectionSummary() {
    elements.summaryDate.textContent = formatDate(elements.date.value);
    elements.summaryTime.textContent =
      elements.time.value || 'Select an available time';
    elements.submit.disabled =
      !availability || !elements.time.value || !elements.date.value;
  }

  function clearTimeSelection() {
    elements.time.value = '';
    elements.slots.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function renderSlots() {
    clearTimeSelection();
    elements.slots.replaceChildren();
    refreshSelectionSummary();

    if (!availability || !elements.date.value) {
      elements.slots.append(
        createSlotMessage('Choose a date to see available times.'),
      );
      return;
    }

    const day = scheduleDayForDate(elements.date.value);
    const slots = (availability.weeklySlots ?? []).filter(
      (slot) => slot.day === day && slot.active !== false,
    );
    const slotTimes = slots
      .flatMap((slot) => {
        const [startHour, startMinute] = slot.start
          .split(':')
          .map(Number);
        const [endHour, endMinute] = slot.end.split(':').map(Number);
        const start = startHour * 60 + startMinute;
        const end = endHour * 60 + endMinute;
        const times = [];

        for (
          let minutes = start;
          minutes + APPOINTMENT_DURATION_MINUTES <= end;
          minutes += APPOINTMENT_DURATION_MINUTES
        ) {
          const overlapsBlackout = (Array.isArray(slot.blackoutSlots)
            ? slot.blackoutSlots
            : []
          ).some((period) => {
            const [blackoutStart, blackoutEnd] = period
              .split('-')
              .map((value) => {
                const [hour, minute] = value.split(':').map(Number);
                return hour * 60 + minute;
              });
            return (
              minutes < blackoutEnd &&
              blackoutStart < minutes + APPOINTMENT_DURATION_MINUTES
            );
          });
          if (!overlapsBlackout) {
            times.push(
              `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
            );
          }
        }
        return times;
      })
      .filter((time) => {
        const currentDateTime = managerLocalDateTime();
        if (
          elements.date.value === currentDateTime.slice(0, 10) &&
          `${elements.date.value} ${time}` <= currentDateTime
        ) {
          return false;
        }
        const [hour, minute] = time.split(':').map(Number);
        const slotStart = hour * 60 + minute;
        const slotEnd = slotStart + APPOINTMENT_DURATION_MINUTES;
        const overlapsDateException = (
          availability.dateSpecificExceptions ?? []
        ).some((exception) => {
          if (exception.date !== elements.date.value) return false;
          const [startHour, startMinute] = exception.start
            .split(':')
            .map(Number);
          const [endHour, endMinute] = exception.end.split(':').map(Number);
          const exceptionStart = startHour * 60 + startMinute;
          const exceptionEnd = endHour * 60 + endMinute;
          return slotStart < exceptionEnd && exceptionStart < slotEnd;
        });
        if (overlapsDateException) return false;
        return !(bookedTimes ?? []).includes(time);
      });

    if (!slotTimes.length) {
      elements.slots.append(
        createSlotMessage('No available time slots found for this date.'),
      );
      return;
    }

    slotTimes.forEach((time) => {
      const button = document.createElement('button');
      button.className = 'slot-button';
      button.type = 'button';
      button.textContent = time;
      button.dataset.time = time;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        clearTimeSelection();
        button.setAttribute('aria-pressed', 'true');
        elements.time.value = time;
        setMessage('');
        refreshSelectionSummary();
      });
      elements.slots.append(button);
    });
  }

  function createSlotMessage(message) {
    const element = document.createElement('p');
    element.className = 'slot-empty';
    element.textContent = message;
    return element;
  }

  function getPushUserId() {
    let userId = localStorage.getItem(PUSH_USER_ID_KEY);
    if (!userId) {
      userId = `customer-${crypto.randomUUID()}`;
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

  async function subscribeForUpdates(userId) {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return 'This browser does not support push notifications.';
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return 'Notification permission was not granted.';
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
        userId,
        subscription: subscription.toJSON(),
      },
    });
    return 'Push notifications are enabled for this browser.';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    if (!elements.time.value) {
      setMessage('Choose one of the available appointment times.');
      elements.slots.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    elements.submit.disabled = true;
    elements.submit.textContent = 'Sending request...';
    try {
      const result = await apiRequest('/appointments', {
        method: 'POST',
        body: {
          name: elements.name.value.trim(),
          email: elements.email.value.trim(),
          date: elements.date.value,
          time: elements.time.value,
        },
      });

      bookedTimes = [...(bookedTimes ?? []), result.appointment.time];
      elements.name.value = '';
      elements.email.value = '';
      clearTimeSelection();
      renderSlots();
      elements.summaryDate.textContent = formatDate(
        result.appointment.date,
      );
      elements.summaryTime.textContent = result.appointment.time;
      elements.summaryNote.textContent =
        'Your request is pending manager review.';
      setMessage(
        'Appointment requested. Check your email for updates.',
        'success',
      );

      try {
        const pushMessage = await subscribeForUpdates(
          result.userId || getPushUserId(),
        );
        elements.summaryNote.textContent = pushMessage;
      } catch (error) {
        elements.summaryNote.textContent = `Booking received. Push setup failed: ${error.message}`;
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      elements.submit.textContent = 'Request appointment';
      refreshSelectionSummary();
    }
  }

  async function initialize() {
    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    elements.date.min = todayValue;
    elements.date.value = todayValue;
    elements.date.addEventListener('change', () => {
      void loadBookedTimes();
    });
    elements.form.addEventListener('submit', handleSubmit);
    elements.timeZone.textContent = 'Loading schedule';

    try {
      const availabilityResult = await apiRequest('/availability');
      availability = normalizeAvailability(availabilityResult);
      elements.timeZone.textContent = availability.timeZone;
      elements.summaryZone.textContent = availability.timeZone;
      await loadBookedTimes();
    } catch (error) {
      elements.timeZone.textContent = 'Unavailable';
      elements.summaryZone.textContent = 'Unavailable';
      elements.slots.replaceChildren(
        createSlotMessage(
          `Could not load appointment times: ${error.message}`,
        ),
      );
      setMessage('Please refresh the page or try again later.');
    }
  }

  async function loadBookedTimes() {
    if (!availability || !elements.date.value) return;
    const date = elements.date.value;
    elements.slots.replaceChildren(
      createSlotMessage('Checking available times...'),
    );
    clearTimeSelection();
    refreshSelectionSummary();
    try {
      const result = await apiRequest(
        `/appointments?view=slots&date=${encodeURIComponent(date)}`,
      );
      if (elements.date.value !== date) return;
      bookedTimes = normalizeBookedSlots(result);
      renderSlots();
    } catch (error) {
      if (elements.date.value !== date) return;
      bookedTimes = [];
      elements.slots.replaceChildren(
        createSlotMessage(
          `Could not load appointment times: ${error.message}`,
        ),
      );
      setMessage('Please refresh the page or try again later.');
    }
  }

  void initialize();
})();
