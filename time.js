(() => {
  'use strict';

  const API_URL = '/api/availability';
  const DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  const DAY_ALIASES = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  };
  const DEFAULT_START = '09:00';
  const DEFAULT_END = '17:00';

  const elements = {
    form: document.querySelector('#availability-form'),
    dayInputs: [...document.querySelectorAll('input[name="working-day"]')],
    defaultStart: document.querySelector('#default-start'),
    defaultEnd: document.querySelector('#default-end'),
    customDayList: document.querySelector('#custom-day-list'),
    addDateException: document.querySelector('#add-date-exception'),
    dateExceptionForm: document.querySelector('#date-exception-form'),
    exceptionDate: document.querySelector('#exception-date'),
    exceptionStart: document.querySelector('#exception-start'),
    exceptionEnd: document.querySelector('#exception-end'),
    confirmDateException: document.querySelector('#confirm-date-exception'),
    dateExceptionList: document.querySelector('#date-exception-list'),
    error: document.querySelector('#availability-error'),
    loadStatus: document.querySelector('#load-status'),
    resetButton: document.querySelector('#reset-button'),
    saveButton: document.querySelector('#save-button'),
    timeZone: document.querySelector('#time-zone'),
    toast: document.querySelector('#toast'),
  };

  let toastTimer;
  let schedule = createDefaultSchedule();
  let dateExceptions = [];

  function createDefaultSchedule() {
    return {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      defaultStart: DEFAULT_START,
      defaultEnd: DEFAULT_END,
      weeklySlots: DAYS.map((day) => ({
        day,
        active: !['Saturday', 'Sunday'].includes(day),
        start: DEFAULT_START,
        end: DEFAULT_END,
        blackoutSlots: [],
        custom: false,
      })),
    };
  }

  function normalizeSchedule(availability) {
    const source = Array.isArray(availability?.weeklySlots)
      ? availability.weeklySlots
      : [];
    const byDay = new Map(
      source.map((slot) => [DAY_ALIASES[slot.day] || slot.day, slot]),
    );
    const hourCounts = new Map();
    source
      .filter((slot) => slot.active !== false)
      .forEach((slot) => {
        const key = `${slot.start || DEFAULT_START}|${slot.end || DEFAULT_END}`;
        hourCounts.set(key, (hourCounts.get(key) || 0) + 1);
      });
    const [defaultStart, defaultEnd] =
      [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].split('|') ||
      [DEFAULT_START, DEFAULT_END];
    return {
      timeZone: availability?.timeZone || 'UTC',
      defaultStart,
      defaultEnd,
      weeklySlots: DAYS.map((day) => {
        const slot = byDay.get(day);
        const start = slot?.start || defaultStart;
        const end = slot?.end || defaultEnd;
        const blackoutSlots = Array.isArray(slot?.blackoutSlots)
          ? slot.blackoutSlots
          : Array.isArray(slot?.blackout)
            ? slot.blackout
            : [];
        return {
          day,
          active: slot ? slot.active !== false : false,
          start,
          end,
          blackoutSlots: [...blackoutSlots],
          custom: start !== defaultStart || end !== defaultEnd,
        };
      }),
    };
  }

  function normalizeDateExceptions(exceptions) {
    return (Array.isArray(exceptions) ? exceptions : [])
      .filter(
        (exception) =>
          exception &&
          typeof exception.date === 'string' &&
          typeof exception.start === 'string' &&
          typeof exception.end === 'string',
      )
      .map(({ date, start, end }) => ({
        date: date.slice(0, 10),
        start: start.slice(0, 5),
        end: end.slice(0, 5),
      }))
      .sort((a, b) =>
        `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`),
      );
  }

  async function requestAvailability(options = {}) {
    const response = await fetch(API_URL, {
      method: options.method || 'GET',
      headers: options.body
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}.`);
    }
    return payload;
  }

  function slotFor(day) {
    return schedule.weeklySlots.find((slot) => slot.day === day);
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

  function createTimeField(labelText, value, onChange) {
    const label = document.createElement('label');
    label.className = 'custom-time-field';
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'time';
    input.value = value;
    input.required = true;
    input.addEventListener('change', () => onChange(input.value));
    label.append(text, input);
    return { label, input };
  }

  function renderUnavailableTags(slot, list) {
    list.replaceChildren();
    if (slot.blackoutSlots.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'unavailable-empty';
      empty.textContent = 'No unavailable times added.';
      list.append(empty);
      return;
    }
    slot.blackoutSlots.forEach((period, index) => {
      const tag = document.createElement('span');
      tag.className = 'unavailable-tag';
      const text = document.createElement('span');
      text.textContent = period.replace('-', ' – ');
      const remove = document.createElement('button');
      remove.className = 'remove-unavailable';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${slot.day} unavailable period`);
      remove.addEventListener('click', () => {
        slot.blackoutSlots.splice(index, 1);
        elements.error.textContent = '';
        renderCustomDays();
      });
      tag.append(text, remove);
      list.append(tag);
    });
  }

  function periodsOverlap(periods, start, end) {
    return periods.some((period) => {
      const [existingStart, existingEnd] = period.split('-');
      return start < existingEnd && existingStart < end;
    });
  }

  function dateExceptionsOverlap(date, start, end) {
    return dateExceptions.some(
      (exception) =>
        exception.date === date &&
        start < exception.end &&
        exception.start < end,
    );
  }

  function formatExceptionDate(dateValue) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function renderDateExceptions() {
    elements.dateExceptionList.replaceChildren();
    if (dateExceptions.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'date-exception-empty';
      empty.textContent = 'No one-off exceptions added.';
      elements.dateExceptionList.append(empty);
      return;
    }
    dateExceptions.forEach((exception, index) => {
      const tag = document.createElement('span');
      tag.className = 'date-exception-tag';
      const text = document.createElement('span');
      text.textContent = `${formatExceptionDate(exception.date)} ${exception.start}–${exception.end}`;
      const remove = document.createElement('button');
      remove.className = 'remove-date-exception';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute(
        'aria-label',
        `Remove exception on ${exception.date} from ${exception.start} to ${exception.end}`,
      );
      remove.addEventListener('click', () => {
        dateExceptions.splice(index, 1);
        elements.error.textContent = '';
        renderDateExceptions();
      });
      tag.append(text, remove);
      elements.dateExceptionList.append(tag);
    });
  }

  function setDateExceptionFormOpen(open) {
    elements.addDateException.setAttribute('aria-expanded', String(open));
    elements.dateExceptionForm.setAttribute('aria-hidden', String(!open));
    elements.dateExceptionForm.classList.toggle('is-open', open);
    if (open) elements.exceptionDate.focus();
  }

  function addDateException() {
    const date = elements.exceptionDate.value;
    const start = elements.exceptionStart.value;
    const end = elements.exceptionEnd.value;
    if (!date || !start || !end || start >= end) {
      elements.error.textContent =
        'Choose a date and an end time later than the exception start time.';
      return;
    }
    if (dateExceptionsOverlap(date, start, end)) {
      elements.error.textContent =
        'One-off exceptions on the same date cannot overlap.';
      return;
    }
    dateExceptions.push({ date, start, end });
    dateExceptions = normalizeDateExceptions(dateExceptions);
    elements.exceptionStart.value = '';
    elements.exceptionEnd.value = '';
    elements.error.textContent = '';
    renderDateExceptions();
  }

  function renderCustomDays() {
    elements.customDayList.replaceChildren();
    const activeSlots = schedule.weeklySlots.filter((slot) => slot.active);
    if (activeSlots.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'status-copy';
      empty.textContent = 'Select a working day to configure custom hours.';
      elements.customDayList.append(empty);
      return;
    }

    activeSlots.forEach((slot) => {
      const card = document.createElement('section');
      card.className = 'custom-day-card';
      card.dataset.custom = String(slot.custom);

      const head = document.createElement('div');
      head.className = 'custom-day-head';
      const title = document.createElement('strong');
      title.textContent = slot.day;
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'custom-toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = slot.custom;
      const toggleText = document.createElement('span');
      toggleText.textContent = 'Use custom hours';
      toggleLabel.append(toggle, toggleText);
      head.append(title, toggleLabel);

      const grid = document.createElement('div');
      grid.className = 'custom-time-grid';
      const startField = createTimeField('Start', slot.start, (value) => {
        slot.start = value;
      });
      const endField = createTimeField('End', slot.end, (value) => {
        slot.end = value;
      });
      startField.input.disabled = !slot.custom;
      endField.input.disabled = !slot.custom;
      grid.append(startField.label, endField.label);

      const blackoutSection = document.createElement('div');
      blackoutSection.className = 'blackout-section';
      const blackoutHead = document.createElement('div');
      blackoutHead.className = 'blackout-heading';
      const blackoutTitle = document.createElement('span');
      blackoutTitle.textContent = 'Unavailable / Blocked Times';
      const blackoutHelp = document.createElement('small');
      blackoutHelp.textContent = 'Excluded without changing operating hours';
      blackoutHead.append(blackoutTitle, blackoutHelp);

      const unavailableControls = document.createElement('div');
      unavailableControls.className = 'unavailable-controls';
      const unavailableStart = createTimeField('Blocked start', '', () => {});
      unavailableStart.input.required = false;
      const unavailableEnd = createTimeField('Blocked end', '', () => {});
      unavailableEnd.input.required = false;
      const addButton = document.createElement('button');
      addButton.className = 'mini-button add-unavailable';
      addButton.type = 'button';
      addButton.textContent = 'Add Unavailable Slot';
      addButton.addEventListener('click', () => {
        const start = unavailableStart.input.value;
        const end = unavailableEnd.input.value;
        if (!start || !end || start >= end) {
          elements.error.textContent = `${slot.day} blocked end time must be later than its start time.`;
          return;
        }
        if (start < slot.start || end > slot.end) {
          elements.error.textContent = `${slot.day} blocked times must fall within ${slot.start}–${slot.end}.`;
          return;
        }
        if (periodsOverlap(slot.blackoutSlots, start, end)) {
          elements.error.textContent = `${slot.day} blocked times cannot overlap.`;
          return;
        }
        slot.blackoutSlots.push(`${start}-${end}`);
        slot.blackoutSlots.sort();
        elements.error.textContent = '';
        renderCustomDays();
      });
      unavailableControls.append(
        unavailableStart.label,
        unavailableEnd.label,
        addButton,
      );
      const blackoutList = document.createElement('div');
      blackoutList.className = 'blackout-list';
      renderUnavailableTags(slot, blackoutList);
      blackoutSection.append(blackoutHead, unavailableControls, blackoutList);

      toggle.addEventListener('change', () => {
        slot.custom = toggle.checked;
        if (!slot.custom) {
          slot.start = elements.defaultStart.value;
          slot.end = elements.defaultEnd.value;
        }
        renderCustomDays();
      });

      card.append(head, grid, blackoutSection);
      elements.customDayList.append(card);
    });
  }

  function renderSchedule() {
    elements.defaultStart.value = schedule.defaultStart;
    elements.defaultEnd.value = schedule.defaultEnd;
    elements.timeZone.textContent = schedule.timeZone;
    elements.dayInputs.forEach((input) => {
      input.checked = Boolean(slotFor(input.value)?.active);
    });
    renderCustomDays();
    renderDateExceptions();
  }

  function applyDefaultHours() {
    schedule.defaultStart = elements.defaultStart.value;
    schedule.defaultEnd = elements.defaultEnd.value;
    schedule.weeklySlots.forEach((slot) => {
      if (!slot.custom) {
        slot.start = elements.defaultStart.value;
        slot.end = elements.defaultEnd.value;
      }
    });
    renderCustomDays();
  }

  function validateSchedule() {
    if (!elements.defaultStart.value || elements.defaultStart.value >= elements.defaultEnd.value) {
      return 'Default end time must be later than the start time.';
    }
    if (!schedule.weeklySlots.some((slot) => slot.active)) {
      return 'Select at least one working day.';
    }
    for (const slot of schedule.weeklySlots.filter((item) => item.active)) {
      if (!slot.start || !slot.end || slot.start >= slot.end) {
        return `${slot.day} end time must be later than its start time.`;
      }
      for (const period of slot.blackoutSlots) {
        const [start, end] = period.split('-');
        if (!start || !end || start >= end || start < slot.start || end > slot.end) {
          return `${slot.day} unavailable periods must fall within operating hours.`;
        }
      }
      const sortedPeriods = [...slot.blackoutSlots].sort();
      for (let index = 1; index < sortedPeriods.length; index += 1) {
        const previousEnd = sortedPeriods[index - 1].split('-')[1];
        const currentStart = sortedPeriods[index].split('-')[0];
        if (previousEnd > currentStart) {
          return `${slot.day} unavailable periods cannot overlap.`;
        }
      }
    }
    for (const exception of dateExceptions) {
      if (
        !exception.date ||
        !exception.start ||
        !exception.end ||
        exception.start >= exception.end
      ) {
        return 'Each one-off exception needs a valid date and time range.';
      }
    }
    return '';
  }

  async function saveSchedule(event) {
    event.preventDefault();
    elements.error.textContent = validateSchedule();
    if (elements.error.textContent) return;

    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Saving…';
    try {
      const payload = {
        timeZone: schedule.timeZone,
        weeklySlots: schedule.weeklySlots.map(
          ({ day, active, start, end, blackoutSlots }) => ({
            day,
            active,
            start,
            end,
            blackoutSlots,
          }),
        ),
        dateSpecificExceptions: dateExceptions.map((exception) => ({
          ...exception,
        })),
      };
      const result = await requestAvailability({ method: 'PUT', body: payload });
      schedule = normalizeSchedule(result.availability);
      dateExceptions = normalizeDateExceptions(
        result.availability?.dateSpecificExceptions,
      );
      renderSchedule();
      elements.loadStatus.textContent = 'Schedule saved';
      showToast('Weekly availability saved.');
    } catch (error) {
      elements.error.textContent = `Could not save availability: ${error.message}`;
      showToast('Availability could not be saved.');
    } finally {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = 'Save availability';
    }
  }

  function resetSchedule() {
    const timeZone = schedule.timeZone;
    schedule = createDefaultSchedule();
    schedule.timeZone = timeZone;
    dateExceptions = [];
    elements.error.textContent = '';
    elements.loadStatus.textContent = 'Defaults restored locally';
    renderSchedule();
  }

  function bindEvents() {
    elements.form.addEventListener('submit', saveSchedule);
    elements.resetButton.addEventListener('click', resetSchedule);
    elements.defaultStart.addEventListener('change', applyDefaultHours);
    elements.defaultEnd.addEventListener('change', applyDefaultHours);
    elements.addDateException.addEventListener('click', () => {
      const open =
        elements.addDateException.getAttribute('aria-expanded') !== 'true';
      setDateExceptionFormOpen(open);
    });
    elements.confirmDateException.addEventListener('click', addDateException);
    elements.dayInputs.forEach((input) => {
      input.addEventListener('change', () => {
        const slot = slotFor(input.value);
        slot.active = input.checked;
        if (slot.active && !slot.custom) {
          slot.start = elements.defaultStart.value;
          slot.end = elements.defaultEnd.value;
        }
        renderCustomDays();
      });
    });
  }

  async function initialize() {
    bindEvents();
    elements.exceptionDate.min = new Date().toISOString().slice(0, 10);
    try {
      const result = await requestAvailability();
      schedule = normalizeSchedule(result.availability);
      dateExceptions = normalizeDateExceptions(
        result.availability?.dateSpecificExceptions,
      );
      elements.loadStatus.textContent = 'Schedule loaded';
    } catch (error) {
      elements.loadStatus.textContent = 'Using local defaults';
      elements.error.textContent = `Could not load availability: ${error.message}`;
    }
    renderSchedule();
  }

  void initialize();
})();
