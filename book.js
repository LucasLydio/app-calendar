(() => {
  'use strict';

  const API_BASE_URL = '/api';
  const PUSH_USER_ID_KEY = 'daybook-customer-push-user-id';
  const APPOINTMENT_HISTORY_KEY = 'my_appointments';
  const SLOT_INTERVAL_MINUTES = 30;
  const LEGACY_APPOINTMENT_DURATION_MINUTES = 60;
  const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
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
    history: document.querySelector('#booking-history'),
    historyCount: document.querySelector('#history-count'),
    historyList: document.querySelector('#history-list'),
    historyStatus: document.querySelector('#history-status'),
    enableNotifications: document.querySelector('#enable-notifications'),
    serviceOptions: document.querySelector('#service-options'),
    serviceId: document.querySelector('#booking-service'),
    serviceStatus: document.querySelector('#service-status'),
    bookingDetails: document.querySelector('#booking-details'),
    date: document.querySelector('#booking-date'),
    slots: document.querySelector('#slot-grid'),
    time: document.querySelector('#booking-time'),
    name: document.querySelector('#customer-name'),
    email: document.querySelector('#customer-email'),
    submit: document.querySelector('#submit-button'),
    message: document.querySelector('#form-message'),
    timeZone: document.querySelector('#time-zone-label'),
    summaryService: document.querySelector('#summary-service'),
    summaryDate: document.querySelector('#summary-date'),
    summaryTime: document.querySelector('#summary-time'),
    summaryZone: document.querySelector('#summary-zone'),
    summaryNote: document.querySelector('#summary-note'),
  };

  let availability;
  let services = [];
  let selectedService;
  let bookedIntervals = [];
  let appointmentHistory = [];
  let fallbackPushUserId;

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
            TIME_PATTERN.test(slot.start) &&
            typeof slot.end === 'string' &&
            TIME_PATTERN.test(slot.end) &&
            slot.start < slot.end,
        )
        .map((slot) => ({
          ...slot,
          blackoutSlots: (Array.isArray(slot.blackoutSlots)
            ? slot.blackoutSlots
            : Array.isArray(slot.blackout)
              ? slot.blackout
              : []
          ).filter(
            (period) =>
              typeof period === 'string' &&
              /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(
                period,
              ),
          ),
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
          TIME_PATTERN.test(exception.start) &&
          typeof exception.end === 'string' &&
          TIME_PATTERN.test(exception.end) &&
          exception.start < exception.end,
      ),
    };
  }

  function normalizeServices(payload) {
    return (Array.isArray(payload?.services) ? payload.services : [])
      .filter(
        (service) =>
          service &&
          typeof service.id === 'string' &&
          typeof service.name === 'string' &&
          service.name.trim() &&
          typeof service.price === 'number' &&
          Number.isFinite(service.price) &&
          service.price >= 0 &&
          Number.isInteger(service.durationMinutes) &&
          service.durationMinutes > 0,
      )
      .map((service) => ({
        id: service.id,
        name: service.name.trim(),
        price: service.price,
        durationMinutes: service.durationMinutes,
      }));
  }

  function normalizeBookedIntervals(payload) {
    const intervals = Array.isArray(payload?.bookedIntervals)
      ? payload.bookedIntervals
      : [];
    if (intervals.length > 0) {
      return intervals
        .filter(
          (interval) =>
            interval &&
            typeof interval.time === 'string' &&
            TIME_PATTERN.test(interval.time.slice(0, 5)) &&
            Number.isInteger(interval.durationMinutes) &&
            interval.durationMinutes > 0,
        )
        .map((interval) => ({
          time: interval.time.slice(0, 5),
          durationMinutes: interval.durationMinutes,
        }));
    }
    return (Array.isArray(payload?.bookedSlots) ? payload.bookedSlots : [])
      .filter(
        (time) =>
          typeof time === 'string' && TIME_PATTERN.test(time.slice(0, 5)),
      )
      .map((time) => ({
        time: time.slice(0, 5),
        durationMinutes: LEGACY_APPOINTMENT_DURATION_MINUTES,
      }));
  }

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers: options.body
          ? { 'Content-Type': 'application/json', Accept: 'application/json' }
          : { Accept: 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new Error('Unable to reach the server. Check your connection.');
    }
    const contentType = response.headers.get('content-type') || '';
    let payload;
    try {
      payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
    } catch {
      throw new Error('The server returned an invalid response.');
    }
    if (!response.ok) {
      throw new Error(
        payload?.message ||
          payload?.error ||
          `Request failed with status ${response.status}.`,
      );
    }
    return payload;
  }

  function minutesFromTime(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  function timeFromMinutes(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}`;
  }

  function intervalsOverlap(firstStart, firstEnd, secondStart, secondEnd) {
    return firstStart < secondEnd && secondStart < firstEnd;
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
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: availability.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
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

  function setMessage(message, state = 'error') {
    elements.message.textContent = message;
    elements.message.dataset.state = state;
  }

  function normalizeHistoryEntry(value) {
    if (
      !value ||
      typeof value.appointmentId !== 'string' ||
      !value.appointmentId.trim() ||
      typeof value.serviceName !== 'string' ||
      typeof value.date !== 'string' ||
      typeof value.time !== 'string'
    ) {
      return null;
    }
    return {
      appointmentId: value.appointmentId.trim(),
      serviceName: value.serviceName.trim() || 'Appointment',
      date: value.date.slice(0, 10),
      time: value.time.slice(0, 5),
      status: ['pending', 'approved', 'rejected'].includes(value.status)
        ? value.status
        : 'pending',
      ...(typeof value.message === 'string' && value.message.trim()
        ? { message: value.message.trim() }
        : {}),
    };
  }

  function readAppointmentHistory() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(APPOINTMENT_HISTORY_KEY) ?? '[]',
      );
      return (Array.isArray(parsed) ? parsed : [])
        .map(normalizeHistoryEntry)
        .filter(Boolean)
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  function writeAppointmentHistory() {
    try {
      localStorage.setItem(
        APPOINTMENT_HISTORY_KEY,
        JSON.stringify(appointmentHistory.slice(0, 50)),
      );
      return true;
    } catch {
      elements.historyStatus.textContent =
        'This browser could not save booking history locally.';
      return false;
    }
  }

  function historyStatusLabel(status) {
    if (status === 'approved') return 'Confirmed';
    if (status === 'rejected') return 'Cancelled';
    return 'Pending';
  }

  function renderAppointmentHistory() {
    elements.historyList.replaceChildren();
    elements.historyCount.textContent = String(appointmentHistory.length);
    elements.enableNotifications.hidden = appointmentHistory.length === 0;
    if (appointmentHistory.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'No bookings have been saved on this device yet.';
      elements.historyList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    appointmentHistory.forEach((appointment) => {
      const item = document.createElement('article');
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      const dateTime = document.createElement('span');
      const badge = document.createElement('span');
      item.className = 'history-item';
      copy.className = 'history-item-copy';
      name.textContent = appointment.serviceName;
      dateTime.textContent = `${formatDate(appointment.date)} at ${appointment.time}`;
      badge.className = 'history-badge';
      badge.dataset.status = appointment.status;
      badge.textContent = historyStatusLabel(appointment.status);
      copy.append(name, dateTime);
      item.append(copy, badge);
      fragment.append(item);
    });
    elements.historyList.append(fragment);
  }

  function saveAppointmentToHistory(appointment) {
    const entry = normalizeHistoryEntry({
      appointmentId: appointment.id,
      serviceName: appointment.serviceName || appointment.service,
      date: appointment.date,
      time: appointment.time,
      status: appointment.status || 'pending',
    });
    if (!entry) return;
    appointmentHistory = [
      entry,
      ...appointmentHistory.filter(
        (item) => item.appointmentId !== entry.appointmentId,
      ),
    ].slice(0, 50);
    writeAppointmentHistory();
    renderAppointmentHistory();
    elements.history.open = true;
  }

  async function refreshAppointmentHistory() {
    if (appointmentHistory.length === 0) return;
    const ids = appointmentHistory.map((item) => item.appointmentId);
    elements.historyStatus.textContent = 'Refreshing appointment statuses…';
    try {
      const result = await apiRequest(
        `/appointments?ids=${encodeURIComponent(ids.join(','))}`,
      );
      const latest = new Map(
        (Array.isArray(result?.appointments) ? result.appointments : []).map(
          (appointment) => [appointment.id, appointment],
        ),
      );
      appointmentHistory = appointmentHistory.map((saved) => {
        const current = latest.get(saved.appointmentId);
        return current
          ? normalizeHistoryEntry({
              appointmentId: current.id,
              serviceName: current.serviceName || saved.serviceName,
              date: current.date,
              time: current.time,
              status: current.status,
              message: current.message,
            }) || saved
          : saved;
      });
      writeAppointmentHistory();
      renderAppointmentHistory();
      elements.historyStatus.textContent = 'Booking statuses are up to date.';
    } catch (error) {
      elements.historyStatus.textContent =
        'Saved bookings are shown. Current statuses could not be refreshed.';
    }
  }

  function updateSavedAppointmentStatus(appointmentId, status) {
    if (!appointmentId) return;
    let changed = false;
    appointmentHistory = appointmentHistory.map((appointment) => {
      if (appointment.appointmentId !== appointmentId) return appointment;
      changed = true;
      return { ...appointment, status };
    });
    if (changed) {
      writeAppointmentHistory();
      renderAppointmentHistory();
    }
  }

  function refreshSelectionSummary() {
    elements.summaryService.textContent = selectedService
      ? `${selectedService.name} · ${formatPrice(selectedService.price)} · ${formatDuration(selectedService.durationMinutes)}`
      : 'Select a service';
    elements.summaryDate.textContent = selectedService
      ? formatDate(elements.date.value)
      : 'Select a service first';
    elements.summaryTime.textContent =
      elements.time.value || 'Select an available time';
    elements.submit.disabled =
      !selectedService ||
      !availability ||
      !elements.time.value ||
      !elements.date.value;
  }

  function clearTimeSelection() {
    elements.time.value = '';
    elements.slots.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function intervalOverlapsUnavailable(slotStart, slotEnd, slot) {
    const recurringOverlap = (Array.isArray(slot.blackoutSlots)
      ? slot.blackoutSlots
      : []
    ).some((period) => {
      const [start, end] = period.split('-');
      return intervalsOverlap(
        slotStart,
        slotEnd,
        minutesFromTime(start),
        minutesFromTime(end),
      );
    });
    if (recurringOverlap) return true;

    return (availability.dateSpecificExceptions ?? []).some((exception) =>
      exception.date === elements.date.value
        ? intervalsOverlap(
            slotStart,
            slotEnd,
            minutesFromTime(exception.start),
            minutesFromTime(exception.end),
          )
        : false,
    );
  }

  function intervalOverlapsBooking(slotStart, slotEnd) {
    return (bookedIntervals ?? []).some((interval) => {
      const bookedStart = minutesFromTime(interval.time);
      return intervalsOverlap(
        slotStart,
        slotEnd,
        bookedStart,
        bookedStart + interval.durationMinutes,
      );
    });
  }

  function renderSlots() {
    clearTimeSelection();
    elements.slots.replaceChildren();
    refreshSelectionSummary();

    if (!selectedService) {
      elements.slots.append(createSlotMessage('Choose a service first.'));
      return;
    }
    if (!availability || !elements.date.value) {
      elements.slots.append(
        createSlotMessage('Choose a date to see available times.'),
      );
      return;
    }

    const day = scheduleDayForDate(elements.date.value);
    const durationMinutes = selectedService.durationMinutes;
    const activeSlots = (availability.weeklySlots ?? []).filter(
      (slot) => slot.day === day && slot.active !== false,
    );
    const currentDateTime = managerLocalDateTime();
    const uniqueTimes = new Set();

    activeSlots.forEach((slot) => {
      const start = minutesFromTime(slot.start);
      const end = minutesFromTime(slot.end);
      for (
        let slotStart = start;
        slotStart + durationMinutes <= end;
        slotStart += SLOT_INTERVAL_MINUTES
      ) {
        const time = timeFromMinutes(slotStart);
        const slotEnd = slotStart + durationMinutes;
        const isPast =
          elements.date.value === currentDateTime.slice(0, 10) &&
          `${elements.date.value} ${time}` <= currentDateTime;
        if (
          !isPast &&
          !intervalOverlapsUnavailable(slotStart, slotEnd, slot) &&
          !intervalOverlapsBooking(slotStart, slotEnd)
        ) {
          uniqueTimes.add(time);
        }
      }
    });

    const slotTimes = [...uniqueTimes].sort();
    if (slotTimes.length === 0) {
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

  function selectService(service) {
    selectedService = service;
    elements.serviceId.value = service.id;
    elements.bookingDetails.disabled = false;
    elements.serviceStatus.textContent = `${service.name} selected.`;
    elements.serviceStatus.dataset.state = 'success';
    elements.serviceOptions
      .querySelectorAll('.service-option')
      .forEach((button) => {
        button.setAttribute(
          'aria-checked',
          String(button.dataset.serviceId === service.id),
        );
      });
    bookedIntervals = [];
    clearTimeSelection();
    setMessage('');
    refreshSelectionSummary();
    if (availability) void loadBookedTimes();
  }

  function renderServices() {
    elements.serviceOptions.replaceChildren();
    if (services.length === 0) {
      elements.serviceStatus.textContent =
        'No services are currently available for booking.';
      elements.serviceStatus.dataset.state = 'error';
      return;
    }
    const fragment = document.createDocumentFragment();
    services.forEach((service) => {
      const button = document.createElement('button');
      const name = document.createElement('strong');
      const details = document.createElement('span');
      button.type = 'button';
      button.className = 'service-option';
      button.dataset.serviceId = service.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      name.textContent = service.name;
      details.textContent = `${formatPrice(service.price)} · ${formatDuration(service.durationMinutes)}`;
      button.append(name, details);
      button.addEventListener('click', () => selectService(service));
      fragment.append(button);
    });
    elements.serviceOptions.append(fragment);
    elements.serviceStatus.textContent = 'Select one service to continue.';
    elements.serviceStatus.dataset.state = '';
  }

  function getPushUserId() {
    try {
      let userId = localStorage.getItem(PUSH_USER_ID_KEY);
      if (!userId) {
        userId = `customer-${crypto.randomUUID()}`;
        localStorage.setItem(PUSH_USER_ID_KEY, userId);
      }
      return userId;
    } catch {
      fallbackPushUserId ||= `customer-${crypto.randomUUID()}`;
      return fallbackPushUserId;
    }
  }

  function decodeVapidKey(encodedKey) {
    const padding = '='.repeat((4 - (encodedKey.length % 4)) % 4);
    const base64 = `${encodedKey}${padding}`
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function subscribeForUpdates(
    appointmentIds,
    userId,
    { requestPermission = false } = {},
  ) {
    const ids = [...new Set(
      (Array.isArray(appointmentIds) ? appointmentIds : []).filter(
        (id) => typeof id === 'string' && id,
      ),
    )];
    if (ids.length === 0) return 'No bookings are available to subscribe to.';
    if (
      !window.isSecureContext ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return 'This browser does not support push notifications.';
    }
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true;
    if (isIos && !isStandalone) {
      return 'On iPhone or iPad, add this page to the Home Screen and open it there to enable notifications.';
    }
    if (Notification.permission === 'denied') {
      return 'Notifications are blocked. Enable them in your browser or device settings.';
    }
    if (Notification.permission === 'default' && !requestPermission) {
      return 'Use “Enable status notifications” in Your Bookings to receive updates.';
    }
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== 'granted') {
      return 'Notification permission was not granted.';
    }
    const { publicKey } = await apiRequest('/push');
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
    await Promise.all(
      ids.map((appointmentId) =>
        apiRequest('/push', {
          method: 'POST',
          body: {
            userId,
            appointmentId,
            subscription: subscription.toJSON(),
          },
        }),
      ),
    );
    return 'Push notifications are enabled for this browser.';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');
    if (!selectedService) {
      setMessage('Choose a service before requesting an appointment.');
      elements.serviceOptions.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }
    if (!elements.time.value) {
      setMessage('Choose one of the available appointment times.');
      elements.slots.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    elements.submit.disabled = true;
    elements.submit.textContent = 'Sending request...';
    let bookingSucceeded = false;
    try {
      const pushUserId = getPushUserId();
      const result = await apiRequest('/appointments', {
        method: 'POST',
        body: {
          userId: pushUserId,
          serviceId: selectedService.id,
          name: elements.name.value.trim(),
          email: elements.email.value.trim(),
          date: elements.date.value,
          time: elements.time.value,
        },
      });
      bookedIntervals = [
        ...(bookedIntervals ?? []),
        {
          time: result.appointment.time,
          durationMinutes:
            result.appointment.serviceDuration ??
            selectedService.durationMinutes,
        },
      ];
      elements.name.value = '';
      elements.email.value = '';
      clearTimeSelection();
      renderSlots();
      elements.summaryService.textContent =
        result.appointment.serviceName || selectedService.name;
      elements.summaryDate.textContent = formatDate(result.appointment.date);
      elements.summaryTime.textContent = result.appointment.time;
      elements.summaryNote.textContent =
        'Your request is pending manager review.';
      setMessage(
        'Appointment requested. Check your email for updates.',
        'success',
      );
      saveAppointmentToHistory(result.appointment);
      bookingSucceeded = true;

      try {
        const pushMessage = await subscribeForUpdates(
          [result.appointment.id],
          result.userId || pushUserId,
        );
        elements.summaryNote.textContent = pushMessage;
        elements.historyStatus.textContent = pushMessage;
      } catch (error) {
        elements.summaryNote.textContent = `Booking received. Push setup failed: ${error.message}`;
      }
    } catch (error) {
      setMessage(error.message);
      if (error.message.toLowerCase().includes('overlap')) {
        await loadBookedTimes();
      }
    } finally {
      elements.submit.textContent = 'Request appointment';
      if (!bookingSucceeded) refreshSelectionSummary();
    }
  }

  async function loadBookedTimes() {
    if (!availability || !selectedService || !elements.date.value) return;
    const date = elements.date.value;
    const serviceId = selectedService.id;
    elements.slots.replaceChildren(
      createSlotMessage('Checking available times...'),
    );
    clearTimeSelection();
    refreshSelectionSummary();
    try {
      const result = await apiRequest(
        `/appointments?view=slots&date=${encodeURIComponent(date)}&serviceId=${encodeURIComponent(serviceId)}`,
      );
      if (
        elements.date.value !== date ||
        selectedService?.id !== serviceId
      ) {
        return;
      }
      bookedIntervals = normalizeBookedIntervals(result);
      renderSlots();
    } catch (error) {
      if (
        elements.date.value !== date ||
        selectedService?.id !== serviceId
      ) {
        return;
      }
      bookedIntervals = [];
      elements.slots.replaceChildren(
        createSlotMessage(
          `Could not load appointment times: ${error.message}`,
        ),
      );
      setMessage('Please refresh the page or try again later.');
    }
  }

  async function enableHistoryNotifications() {
    elements.enableNotifications.disabled = true;
    elements.historyStatus.textContent = 'Enabling status notifications…';
    try {
      const message = await subscribeForUpdates(
        appointmentHistory.map((appointment) => appointment.appointmentId),
        getPushUserId(),
        { requestPermission: true },
      );
      elements.historyStatus.textContent = message;
      if (
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        elements.enableNotifications.textContent = 'Notifications enabled';
      }
    } catch (error) {
      elements.historyStatus.textContent =
        error.message || 'Notifications could not be enabled.';
    } finally {
      elements.enableNotifications.disabled = false;
    }
  }

  async function initialize() {
    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(
      today.getMonth() + 1,
    ).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    elements.date.min = todayValue;
    elements.date.value = todayValue;
    elements.bookingDetails.disabled = true;
    appointmentHistory = readAppointmentHistory();
    renderAppointmentHistory();
    elements.date.addEventListener('change', () => void loadBookedTimes());
    elements.form.addEventListener('submit', handleSubmit);
    elements.enableNotifications.addEventListener(
      'click',
      enableHistoryNotifications,
    );
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'appointment-status') {
          updateSavedAppointmentStatus(
            event.data.appointmentId,
            event.data.status,
          );
        }
      });
    }
    elements.timeZone.textContent = 'Loading schedule';
    elements.slots.replaceChildren(createSlotMessage('Choose a service first.'));
    void refreshAppointmentHistory();

    const [servicesResult, availabilityResult] = await Promise.allSettled([
      apiRequest('/services'),
      apiRequest('/availability'),
    ]);

    if (servicesResult.status === 'fulfilled') {
      services = normalizeServices(servicesResult.value);
      renderServices();
    } else {
      elements.serviceStatus.textContent = `Could not load services: ${servicesResult.reason.message}`;
      elements.serviceStatus.dataset.state = 'error';
    }

    if (availabilityResult.status === 'fulfilled') {
      availability = normalizeAvailability(availabilityResult.value);
      elements.timeZone.textContent = availability.timeZone;
      elements.summaryZone.textContent = availability.timeZone;
    } else {
      elements.timeZone.textContent = 'Unavailable';
      elements.summaryZone.textContent = 'Unavailable';
      setMessage('Could not load availability. Please try again later.');
    }
    refreshSelectionSummary();
  }

  void initialize();
})();
