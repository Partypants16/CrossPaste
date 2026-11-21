// CrossPaste's service worker. It exists so the page can be installed as an app
// (which is what puts CrossPaste in the phone's share menu). It deliberately caches
// nothing: the shared clipboard is only useful live, and a cached copy could show
// stale text. Shares post straight to the server's /share route.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
