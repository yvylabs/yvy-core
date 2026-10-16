const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.(fgb|pmtiles)$/;
export async function onRequestGet({ request, env, params }) {
  const key = Array.isArray(params.path)? params.path.join('/') : String(params.path || '');
  if (!KEY_RE.test(key)) return env.ASSETS.fetch(request);
  let obj = await env.YVY_DATA.get(key) || await env.YVY_DATA.get(`data/${key}`);
  if (obj) {
    const h = new Headers();
    h.set('Content-Type', 'application/octet-stream');
    h.set('Accept-Ranges', 'bytes');
    // Vary: Range es obligatorio (ver functions/tiles/[[path]].js):
    // sin esto el edge mezcla cuerpos de distintos rangos y pmtiles aborta.
    h.set('Vary', 'Range');
    h.set('Access-Control-Allow-Origin', '*');
    if (obj.httpEtag) h.set('ETag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers: h });
  }
  return env.ASSETS.fetch(request);
}