// Service worker de FocusData: solo muestra las notificaciones del temporizador y atiende
// sus clics. No intercepta peticiones ni guarda nada en caché.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { phase } = event.notification.data || {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(c => new URL(c.url).pathname === '/');
    if (!app) {
      try { await self.clients.openWindow('/'); } catch { /* sin permiso para abrir ventanas */ }
      return;
    }
    if (event.action === 'start') {
      // «Empezar descanso / pomodoro»: arranca la siguiente fase sin sacarte de lo que haces.
      app.postMessage({ type: 'focusdata:start', phase });
      return;
    }
    try { await app.focus(); } catch { /* el navegador no dejó traer la ventana al frente */ }
  })());
});
