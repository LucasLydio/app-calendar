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
    error: document.querySelector('#availability-error'),
    loadStatus: document.querySelector('#load-status'),
    resetButton: document.querySelector('#reset-button'),
    saveButton: document.querySelector('#save-button'),
    timeZone: document.querySelector('#time-zone'),
    toast: document.querySelector('#toast'),
  };

  let toastTimer;
  let schedule = createDefaultSchedule();

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
        blackout: [],
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
        const blackout = Array.isArray(slot?.blackout) ? slot.blackout : [];
        return {
          day,
          active: slot ? slot.active !== false : false,
          start,
          end,
          blackout: [...blackout],
          custom:
            start !== defaultStart || end !== defaultEnd || blackout.length > 0,
        };
      }),
    };
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

  function renderBlackouts(slot, list, disabled) {
    list.replaceChildren();
    slot.blackout.forEach((period, index) => {
      const [startValue, endValue] = period.split('-');
      const row = document.createElement('div');
      row.className = 'blackout-row';

      const start = document.createElement('input');
      start.type = 'time';
      start.value = startValue;
      start.disabled = disabled;
      start.setAttribute('aria-label', `${slot.day} unavailable period start`);

      const end = document.createElement('input');
      end.type = 'time';
      end.value = endValue;
      end.disabled = disabled;
      end.setAttribute('aria-label', `${slot.day} unavailable period end`);

      const update = () => {
        slot.blackout[index] = `${start.value}-${end.value}`;
      };
      start.addEventListener('change', update);
      end.addEventListener('change', update);

      const remove = document.createElement('button');
      remove.className = 'mini-button remove-blackout';
      remove.type = 'button';
      remove.disabled = disabled;
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${slot.day} unavailable period`);
      remove.addEventListener('click', () => {
        slot.blackout.splice(index, 1);
        renderCustomDays();
      });
      row.append(start, end, remove);
      list.append(row);
    });
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
      blackoutTitle.textContent = 'Unavailable periods';
      const addButton = document.createElement('button');
      addButton.className = 'mini-button';
      addButton.type = 'button';
      addButton.disabled = !slot.custom;
      addButton.textContent = '+ Add break';
      addButton.addEventListener('click', () => {
        slot.blackout.push('12:00-13:00');
        renderCustomDays();
      });
      blackoutHead.append(blackoutTitle, addButton);
      const blackoutList = document.createElement('div');
      blackoutList.className = 'blackout-list';
      renderBlackouts(slot, blackoutList, !slot.custom);
      blackoutSection.append(blackoutHead, blackoutList);

      toggle.addEventListener('change', () => {
        slot.custom = toggle.checked;
        if (!slot.custom) {
          slot.start = elements.defaultStart.value;
          slot.end = elements.defaultEnd.value;
          slot.blackout = [];
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
      for (const period of slot.blackout) {
        const [start, end] = period.split('-');
        if (!start || !end || start >= end || start < slot.start || end > slot.end) {
          return `${slot.day} unavailable periods must fall within operating hours.`;
        }
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
          ({ day, active, start, end, blackout }) => ({
            day,
            active,
            start,
            end,
            blackout,
          }),
        ),
      };
      const result = await requestAvailability({ method: 'PUT', body: payload });
      schedule = normalizeSchedule(result.availability);
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
    elements.error.textContent = '';
    elements.loadStatus.textContent = 'Defaults restored locally';
    renderSchedule();
  }

  function bindEvents() {
    elements.form.addEventListener('submit', saveSchedule);
    elements.resetButton.addEventListener('click', resetSchedule);
    elements.defaultStart.addEventListener('change', applyDefaultHours);
    elements.defaultEnd.addEventListener('change', applyDefaultHours);
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
    try {
      const result = await requestAvailability();
      schedule = normalizeSchedule(result.availability);
      elements.loadStatus.textContent = 'Schedule loaded';
    } catch (error) {
      elements.loadStatus.textContent = 'Using local defaults';
      elements.error.textContent = `Could not load availability: ${error.message}`;
    }
    renderSchedule();
  }

  void initialize();
})();
