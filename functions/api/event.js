// functions/api/event.js — Ingesta agregada free-tier. Lee cf-ipcountry, no guarda IP.
// TODO Fase 2: flush diario a D1 (hoy solo valida + cuenta en memoria).

const MAX_BODY = 2048;

export async function onRequestPost({ request }) {
  const ctype = request.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) return new Response('bad request', { status: 400 });
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (raw.length > MAX_BODY) return new Response('too large', { status: 413 });
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const country = request.headers.get('cf-ipcountry') || null;
  const allowed = ['app_load', 'search_miss', 'pick', 'ficha_view', 'report_copy'];
  if (!allowed.includes(body.event)) return new Response('ignored', { status: 202 });
  const yvy = Number(body.yvy_id);
  // Solo agregados: event + yvy_id + nivel + country. Sin q, url, coords.
  const safe = {
    event: body.event,
    yvy_id: Number.isFinite(yvy) ? yvy : null,
    nivel: typeof body.nivel === 'string' && /^[a-z]{1,20}$/.test(body.nivel) ? body.nivel : null,
    country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null,
    day: new Date().toISOString().slice(0, 10),
  };
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  return new Response(JSON.stringify({ ok: true, ...safe }), { headers });
}
