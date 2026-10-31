'use strict';

function safeText(value, fallback, maximumLength) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximumLength)
    : fallback;
}

function safeBookUrl(value) {
  try {
    const url = new URL(value || '/book.html', self.location.origin);
    if (
      url.origin === self.location.origin &&
      ['/book', '/book.html'].includes(url.pathname)
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Fall through to the fixed same-origin booking page.
  }
  return '/book.html';
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }

  const appointmentId = safeText(payload.appointmentId, '', 120);
  const status = ['pending', 'approved', 'rejected'].includes(payload.status)
    ? payload.status
    : 'pending';
  const title = safeText(
    payload.title,
    'Appointment Status Updated',
    80,
  );
  const body = safeText(
    payload.body,
    'Your appointment status has changed.',
    240,
  );
  const url = safeBookUrl(payload.url);

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        tag: appointmentId ? `appointment-${appointmentId}` : undefined,
        data: { url, appointmentId, status },
      }),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'appointment-status',
              appointmentId,
              status,
            });
          });
        }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = safeBookUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        const target = new URL(targetUrl, self.location.origin);
        const existing = clients.find((client) => {
          const clientUrl = new URL(client.url);
          return (
            clientUrl.origin === target.origin &&
            ['/book', '/book.html'].includes(clientUrl.pathname)
          );
        });
        if (existing) {
          await existing.navigate(target.href);
          return existing.focus();
        }
        return self.clients.openWindow(target.href);
      }),
  );
});
