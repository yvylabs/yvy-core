// ==============================================================
// pmtiles-header.js — Header PMTiles v3 (127 bytes) + metadatos
// ------------------------------------------------------------
// Una sola lectura del formato para el build (archivo local) y para
// la verificación del artefacto remoto (Range request de 127 bytes).
// Si el header no cierra, devuelve null: nunca se inventa geometría.
//
// Layout PMTiles v3 (LE):
//   0..6   "PMTiles"      7  version
//   8..15  root_dir_off   16..23 root_dir_len
//   24..31 metadata_off   32..39 metadata_len
//   40..47 leaf_off       48..55 leaf_len
//   56..63 tile_data_off  64..71 tile_data_len
//   72..79 addressed_tiles  80..87 tile_entries  88..95 tile_contents
//   96 clustered  97 internal_comp  98 tile_comp  99 tile_type
//   100 min_zoom  101 max_zoom
//   102/106/110/114 min_lon/min_lat/max_lon/max_lat (e7)
//   118 center_zoom  119/123 center_lon/center_lat (e7)
// ==============================================================

export const HEADER_BYTES = 127;

export function leerHeaderPMTiles(buf) {
  if (!buf || buf.length < HEADER_BYTES) return null;
  if (buf.toString('latin1', 0, 7) !== 'PMTiles') return null;
  try {
    if (buf.readUInt8(7) !== 3) return null;
    const u64 = (off) => Number(buf.readBigUInt64LE(off));
    const minZoom = buf.readUInt8(100);
    const maxZoom = buf.readUInt8(101);
    const minLon = buf.readInt32LE(102) / 1e7;
    const minLat = buf.readInt32LE(106) / 1e7;
    const maxLon = buf.readInt32LE(110) / 1e7;
    const maxLat = buf.readInt32LE(114) / 1e7;
    const centerZoom = buf.readUInt8(118);
    const centerLon = buf.readInt32LE(119) / 1e7;
    const centerLat = buf.readInt32LE(123) / 1e7;
    const ok = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
    if (!ok(minLon, -180, 180) || !ok(maxLon, -180, 180) || !ok(minLat, -90, 90) || !ok(maxLat, -90, 90)) return null;
    if (minZoom < 0 || maxZoom > 22 || maxZoom < minZoom) return null;
    return {
      version: 3,
      minZoom,
      maxZoom,
      bounds: [minLon, minLat, maxLon, maxLat],
      center: ok(centerLon, -180, 180) && ok(centerLat, -90, 90) ? [centerLon, centerLat] : null,
      centerZoom,
      metadataOffset: u64(24),
      metadataLength: u64(32),
      tileDataOffset: u64(56),
      tileDataLength: u64(64),
      addressedTiles: u64(72),
      tileEntries: u64(80),
      tileContents: u64(88),
      compresionInterna: buf.readUInt8(97),
      compresionTiles: buf.readUInt8(98),
      tipoTile: buf.readUInt8(99),
    };
  } catch {
    return null;
  }
}

/**
 * Aplica los metadatos JSON del archivo (bounds/center/vector_layers) al
 * header. Los del header son la verdad geométrica; los del JSON solo
 * pisan si son válidos, como hace el lector del build.
 */
export function aplicarMetadatosJSON(header, json) {
  if (!header || !json) return header;
  const h = { ...header };
  if (Array.isArray(json.bounds) && json.bounds.length === 4) {
    const b = json.bounds.map(Number);
    if (b.every((n) => Number.isFinite(n))) h.bounds = b;
  }
  if (Array.isArray(json.center) && json.center.length >= 2) {
    const c = [Number(json.center[0]), Number(json.center[1])];
    if (c.every((n) => Number.isFinite(n))) h.center = c;
  }
  if (Array.isArray(json.vector_layers) && json.vector_layers.length > 0) {
    h.capaInterna = json.vector_layers[0].id || null;
  }
  return h;
}
