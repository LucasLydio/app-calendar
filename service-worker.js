'use strict';

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || 'You have an appointment update.' };
  }

  const title = payload.title || 'Appointment update';
  const options = {
    body: payload.body || 'Your appointment status has changed.',
    data: {
      appointmentId: payload.appointmentId,
      status: payload.status,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
