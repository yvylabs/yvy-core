// ==============================================================
// functions/tiles/[[path]].js — Proxy R2 para tiles vectoriales
// Solo GET, allowlist charset/longitud, sin listar claves privadas.
// ==============================================================

const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.pmtiles$/;
// Orígenes permitidos: dominio propio + previews de Pages (*.yvy-explorer.pages.dev).
// El CORS fijo anterior bloqueaba los previews (el navegador descarta la respuesta).
const ORIGEN_PERMITIDO_RE = /^https:\/\/([a-z0-9-]+\.)?yvylabs\.com$|^https:\/\/[a-z0-9-]+\.yvy-explorer\.pages\.dev$/;

function headersCors(request) {
  const headers = new Headers();
  const origen = request.headers.get('origin');
  if (origen && ORIGEN_PERMITIDO_RE.test(origen)) {
    headers.set('Access-Control-Allow-Origin', origen);
  }
  headers.set('Vary', 'Origin');
  return headers;
}

// Preflight de los Range-requests (header Range no es safelisted): sin esto
// el navegador ni siquiera intenta el GET en los previews.
export async function onRequestOptions({ request }) {
  const headers = headersCors(request);
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

export async function onRequestGet({ request, env, params }) {
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!KEY_RE.test(key)) {
    return new Response('No tengo ese dato todavía', { status: 404 });
  }

  let obj;
  try {
    obj = await env.YVY_DATA.get(key, { range: request.headers });
  } catch {
    return new Response('No tengo ese dato todavía', { status: 503 });
  }
  if (!obj) {
    return new Response('No tengo ese dato todavía', { status: 404 });
  }

  const headers = headersCors(request);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=60, must-revalidate');
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (obj.httpMetadata && obj.httpMetadata.contentType) {
    headers.set('Content-Type', obj.httpMetadata.contentType);
  }
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  if (obj.range && obj.range.suffix !== undefined) {
    // R2 range object: reenviar Content-Range si existe
    try {
      const cr = obj.range;
      if (cr && typeof cr === 'object') {
        const start = cr.offset ?? 0;
        const end = cr.length != null ? start + cr.length - 1 : (obj.size != null ? obj.size - 1 : null);
        if (end != null && obj.size != null) headers.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
      }
    } catch {}
  }

  const range = request.headers.get('range');
  return new Response(obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}
