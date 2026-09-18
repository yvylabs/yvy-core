// ==============================================================
// functions/tiles/[[path]].js — Proxy R2 para tiles vectoriales
// Sirve /tiles/*.pmtiles desde el bucket YVY_DATA con passthrough
// de Range (PMTiles vive de range requests: sin reenviar el header
// Range el cliente pediría archivos enteros y todo se rompe).
// Todo lo demás sigue a Pages (return env.ASSETS.fetch).
// ==============================================================

export async function onRequest({ request, env, params }) {
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  // Solo .pmtiles por esta ruta; el resto, a Pages.
  if (!key.endsWith('.pmtiles')) {
    return env.ASSETS.fetch(request);
  }

  const obj = await env.YVY_DATA.get(key, { range: request.headers });
  if (!obj) {
    return new Response('No tengo ese dato todavía', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (obj.httpMetadata && obj.httpMetadata.contentType) {
    headers.set('Content-Type', obj.httpMetadata.contentType);
  }
  // R2 devuelve httpEtag/size; reenviar lo relevante para 206/416
  const range = request.headers.get('range');
  return new Response(obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}
