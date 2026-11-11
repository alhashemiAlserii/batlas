// Registers the Batlas service worker (site shell only; see /sw.js). Imported by common.js on every page.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return;
  const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}
registerServiceWorker();
