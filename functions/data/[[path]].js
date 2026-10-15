const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.(fgb|pmtiles)$/;
const CORS = 'https://yvylabs.com';

export async function onRequestGet({ request, env, params }) {
  const key = Array.isArray(params.path)? params.path.join('/') : String(params.path || '');
  if (!KEY_RE.test(key)) {
    return env.ASSETS.fetch(request);
  }

  // probar en raíz y en data/
  let obj = await env.YVY_DATA.get(key);
  if (!obj) obj = await env.YVY_DATA.get(`data/${key}`);

  if (!obj) {
    return new Response('No tengo ese dato todavía: ' + key, { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=60, must-revalidate');
  headers.set('Access-Control-Allow-Origin', CORS);
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);

  return new Response(obj.body, { status: 200, headers });
}