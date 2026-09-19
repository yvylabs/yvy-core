// ==============================================================
// functions/data/[[fgb]].js — Proxy R2 para análisis (.fgb) y
// tiles pesados (.pmtiles). Solo GET, allowlist estricta.
// El resto de /data/* (manifest, json) sigue a Pages.
// ==============================================================

const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.(fgb|pmtiles)$/;
const CORS = 'https://yvylabs.com';

export async function onRequestGet({ request, env, params }) {
  const key = Array.isArray(params.fgb) ? params.fgb.join('/') : String(params.fgb || '');
  if (!KEY_RE.test(key)) {
    return env.ASSETS.fetch(request);
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
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);

  const range = request.headers.get('range');
  return new Response(obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}
