// ==============================================================
// functions/data/[[fgb]].js — Proxy R2 para análisis (.fgb) y
// tiles pesados (.pmtiles). Sirve /data/*.fgb y /data/*.pmtiles
// desde el bucket YVY_DATA con passthrough de Range (FlatGeobuf
// consulta por bbox y PMTiles por tile vía range requests).
// Motivo .pmtiles aquí: la app pide /data/*.pmtiles y Pages limita
// archivos estáticos a 25 MB (municipios.pmtiles = 28,5 MB).
// El resto de /data/* (manifest, json) sigue a Pages.
// ==============================================================

export async function onRequest({ request, env, params }) {
  const key = Array.isArray(params.fgb) ? params.fgb.join('/') : String(params.fgb || '');
  // Solo .fgb y .pmtiles por esta ruta; el resto, a Pages.
  if (!key.endsWith('.fgb') && !key.endsWith('.pmtiles')) {
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

  const range = request.headers.get('range');
  return new Response(obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}
