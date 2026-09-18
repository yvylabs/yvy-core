// ==============================================================
// atmosphereEffects.js
// Efectos atmosféricos tras el globo, estilo GeoLibre.
//
// Apila 3 canvases Canvas 2D DENTRO del contenedor del canvas de
// MapLibre (map.getCanvasContainer()), por DEBAJO del canvas WebGL
// del mapa. Cuando la proyección es "globe", la parte del espacio
// fuera del disco terrestre es transparente, y deja ver estos
// fondos.
//
//   zIndex 1 = spaceCanvas  (degradado radial azul noche)
//   zIndex 2 = starsCanvas  (campo de estrellas con parallax)
//   zIndex 3 = haloCanvas    (halo atmosférico ajustado al disco)
//   zIndex 4 = mapa          (canvas WebGL de MapLibre)
//
// Se coordina con mapa vía listeners y un requestAnimationFrame.
//
// Adaptado a vanilla JS desde el plugin de GeoLibre
// (packages/plugins/src/plugins/maplibre-effects.ts), MIT.
// ==============================================================

const SPACE_EDGE_DARKEN = 0.33;
const STAR_AREA_PER_STAR = 900; // px² por estrella
const EFFECTS_FRAME_MS = 1000 / 60;

function isGlobeProjection(map) {
  try {
    return map.getProjection()?.type === 'globe';
  } catch {
    return false;
  }
}

/**
 * Calcula el centro y radio proyectado del disco del globo en
 * píxeles de pantalla, muestreando 16 puntos sobre el ecuador y
 * fitteando el círculo por bounding box (igual que GeoLibre).
 */
function getGlobeCircle(map) {
  const center = map.getCenter();
  const screen = map.project(center);
  let minX = screen.x, maxX = screen.x, minY = screen.y, maxY = screen.y;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const lng = center.lng + 90 * Math.cos(angle);
    const lat = center.lat + 90 * Math.sin(angle);
    let p;
    try {
      p = map.project({ lng, lat });
    } catch {
      continue;
    }
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const radius = (w + h) / 4;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    radius,
  };
}

export function inicializarEfectosAtmosfera(map, options = {}) {
  const container = map.getCanvasContainer();
  if (!container || container.querySelector('[data-yvy-effects]')) return;

  const settings = {
    spaceColor: options.spaceColor ?? '#0c1b33',
    haloColor:  options.haloColor  ?? '#7fb5ff',
    haloOpacity: options.haloOpacity ?? 0.35,
    haloExtent:  options.haloExtent  ?? 1.6,
  };

  // Raíz de los canvases (posición absolute, llenan el contenedor)
  const root = document.createElement('div');
  root.dataset.yvyEffects = '1';
  root.style.cssText =
    'position:absolute;inset:0;pointer-events:none;z-index:0;';

  function mkCanvas(z) {
    const c = document.createElement('canvas');
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    c.style.zIndex = String(z);
    root.appendChild(c);
    return { canvas: c, ctx: c.getContext('2d') };
  }

  const space = mkCanvas(1);
  const stars = mkCanvas(2);
  const halo  = mkCanvas(3);

  container.insertBefore(root, container.firstChild);

  // El canvas WebGL del mapa debe quedar por encima de estos canvases
  const mapCanvas = map.getCanvas();
  if (mapCanvas) mapCanvas.style.zIndex = '4';

  // ------------------------------------------------------------
  // Estrellas: tile único dibujado a una textura off-screen, luego
  // "tileado" con parallax 1:1 respecto al centro del globo.
  // ------------------------------------------------------------
  const STAR_TILE = 1024;
  const starTile = document.createElement('canvas');
  starTile.width = STAR_TILE;
  starTile.height = STAR_TILE;
  const sctx = starTile.getContext('2d');
  const nStars = Math.floor((STAR_TILE * STAR_TILE) / STAR_AREA_PER_STAR);
  for (let i = 0; i < nStars; i++) {
    const x = Math.random() * STAR_TILE;
    const y = Math.random() * STAR_TILE;
    const r = Math.random() * 1.2 + 0.2;
    const a = Math.random() * 0.7 + 0.15;
    sctx.fillStyle = `rgba(255,255,255,${a})`;
    sctx.beginPath();
    sctx.arc(x, y, r, 0, Math.PI * 2);
    sctx.fill();
  }
  const starOffset = { x: 0, y: 0 };

  function resizeAll() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const { canvas } of [space, stars, halo]) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }
  }

  function drawSpace() {
    const { ctx, canvas } = space;
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 1.1);
    grad.addColorStop(0, settings.spaceColor);
    // Oscurecer el borde del espacio (efecto viñeta)
    const edge = darkenRgb(settings.spaceColor, SPACE_EDGE_DARKEN);
    grad.addColorStop(1, edge);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars() {
    const { ctx, canvas } = stars;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    // Parallax 1:1 con el centro del globo en píxeles
    const center = map.getCenter();
    let sx = 0, sy = 0;
    try {
      const p = map.project(center);
      sx = p.x - w / 2;
      sy = p.y - h / 2;
    } catch { /* ignore */ }
    starOffset.x = (sx * 0.5) % STAR_TILE;
    starOffset.y = (sy * 0.5) % STAR_TILE;

    for (let dx = -STAR_TILE; dx < w; dx += STAR_TILE) {
      for (let dy = -STAR_TILE; dy < h; dy += STAR_TILE) {
        ctx.drawImage(
          starTile,
          dx + starOffset.x,
          dy + starOffset.y
        );
      }
    }
  }

  function drawHalo() {
    const { ctx, canvas } = halo;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!isGlobeProjection(map)) return;
    const c = getGlobeCircle(map);
    if (!c.radius || c.radius < 10) return;
    const inner = c.radius;
    const outer = c.radius * settings.haloExtent;
    const grad = ctx.createRadialGradient(c.x, c.y, inner, c.x, c.y, outer);
    const rgb = hexToRgb(settings.haloColor);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    grad.addColorStop(0.3, `rgba(${rgb.r},${rgb.g},${rgb.b},${settings.haloOpacity})`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------
  // Loop principal con throttle a 60 fps
  // ------------------------------------------------------------
  let last = 0;
  let raf = 0;
  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (t - last < EFFECTS_FRAME_MS) return;
    last = t;
    const globe = isGlobeProjection(map);
    space.canvas.style.visibility = globe ? 'visible' : 'hidden';
    stars.canvas.style.visibility = globe ? 'visible' : 'hidden';
    halo.canvas.style.visibility  = globe ? 'visible' : 'hidden';
    if (!globe) return;
    drawSpace();
    drawStars();
    drawHalo();
  }
  raf = requestAnimationFrame(tick);

  // ------------------------------------------------------------
  // Listeners del mapa
  // ------------------------------------------------------------
  map.on('resize', resizeAll);
  map.on('move', () => { /* el loop já redibuja en cada frame */ });
  document.addEventListener('visibilitychange', () => {});

  resizeAll();
}

// Utilidades de color
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function darkenRgb(hex, factor) {
  const { r, g, b } = hexToRgb(hex);
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `rgb(${dr},${dg},${db})`;
}
