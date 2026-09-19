// ==============================================================
// functions/tiles/[[path]].js — Proxy R2 para tiles vectoriales
// Solo GET, allowlist charset/longitud, sin listar claves privadas.
// ==============================================================

const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.pmtiles$/;
const CORS = 'https://yvylabs.com';

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

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', CORS);
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
