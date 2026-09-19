// telemetry.js — Telemetría privada, agregada, opt-out. Solo para el dueño.
// Nunca texto libre, IP ni coords exactas. Eventos: app_load, search_miss, pick, ficha_view, report_copy.

const OFF = (() => {
  try {
    if (typeof window !== 'undefined' && window.location.search.includes('telemetry=0')) return true;
    if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return true;
  } catch {}
  return false;
})();

function bucketZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return null;
  if (n < 4) return 'z0-4';
  if (n < 8) return 'z4-8';
  if (n < 12) return 'z8-12';
  return 'z12+';
}

export function track(event, props = {}) {
  if (OFF) return;
  try {
    const payload = { event, ...props, ts: Date.now() };
    if (payload.zoom != null) {
      payload.zoom_bucket = bucketZoom(payload.zoom);
      delete payload.zoom;
    }
    delete payload.q;
    delete payload.url;
    delete payload.coords;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('api/event', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('api/event', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {}
}
