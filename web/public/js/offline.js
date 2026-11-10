// Offline fallback page (served by the service worker when the network is unreachable).
// Reloads only once the server is really reachable again ('online' events can fire spuriously).
async function reachable() {
  try { return (await fetch('/healthz', { cache: 'no-store' })).ok; } catch { return false; }
}
document.getElementById('retry')?.addEventListener('click', () => location.reload());
addEventListener('online', () => setTimeout(async () => { if (navigator.onLine && await reachable()) location.reload(); }, 1000));
