// Maintenance page: shows the Developer's message and ETA, and re-checks every 30 s.
const msg = document.getElementById('m-message');
const eta = document.getElementById('m-eta');
async function check() {
  try {
    const r = await fetch('/api/maintenance', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (!d.on) { location.reload(); return; }
    msg.textContent = d.message || 'We are upgrading Batlas. Hang tight, we will be back soon!';
    if (d.eta && !isNaN(Date.parse(d.eta))) {
      const t = new Date(d.eta);
      eta.textContent = `Expected back: ${t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
      eta.hidden = false;
    } else eta.hidden = true;
  } catch { /* offline: keep the page as is */ }
}
check();
setInterval(check, 30000);
