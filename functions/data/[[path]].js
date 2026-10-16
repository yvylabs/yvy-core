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
  // Miss en R2: el estático vía ASSETS.fetch devuelve 200-full ante Range
  // (no hace byte-serving en este path); se rebana acá para devolver el
  // 206 que pmtiles.js exige (si no, aborta el tile en silencio).
  const up = await env.ASSETS.fetch(request);
  const range = request.headers.get('range');
  if (up.ok && up.status === 200 && range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const buf = await up.arrayBuffer();
      const total = buf.byteLength;
      const start = Math.min(Number(m[1]), total);
      const end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start < total && end >= start) {
        const h = new Headers(up.headers);
        h.set('Content-Range', `bytes ${start}-${end}/${total}`);
        h.set('Accept-Ranges', 'bytes');
        h.append('Vary', 'Range');
        return new Response(buf.slice(start, end + 1), { status: 206, headers: h });
      }
    }
  }
  return up;
}