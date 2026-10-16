const KEY_RE = /^[A-Za-z0-9/_.-]{1,120}\.(fgb|pmtiles)$/;
export async function onRequestGet({ request, env, params }) {
  const key = Array.isArray(params.path)? params.path.join('/') : String(params.path || '');
  if (!KEY_RE.test(key)) return env.ASSETS.fetch(request);
  let obj = null;
  try {
    obj = await env.YVY_DATA.get(key, { range: request.headers })
      || await env.YVY_DATA.get(`data/${key}`, { range: request.headers });
  } catch {
    return new Response('No tengo ese dato todavía', { status: 503 });
  }
  if (obj) {
    const h = new Headers();
    h.set('Content-Type', 'application/octet-stream');
    h.set('Accept-Ranges', 'bytes');
    // Vary: Range es obligatorio (ver functions/tiles/[[path]].js):
    // sin esto el edge mezcla cuerpos de distintos rangos y pmtiles aborta.
    h.set('Vary', 'Range');
    h.set('Access-Control-Allow-Origin', '*');
    if (obj.httpEtag) h.set('ETag', obj.httpEtag);
    const range = request.headers.get('range');
    if (range && obj.size != null) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] === '' ? obj.size - 1 : Math.min(Number(m[2]), obj.size - 1);
        h.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
      }
    }
    return new Response(obj.body, { status: range ? 206 : 200, headers: h });
  }
  return env.ASSETS.fetch(request);
}