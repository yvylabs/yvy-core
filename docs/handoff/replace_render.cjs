const fs = require('fs');
const p = 'C:/Users/juanj/Documents/2026/yvyexplorer/src/js/objeto.js';
let c = fs.readFileSync(p, 'utf8');

const inicio = c.indexOf('function renderFicha(obj) {');
if (inicio === -1) { console.log('No se encontró renderFicha'); process.exit(1); }

// Buscar el siguiente 'function ' o 'export function ' después de inicio para encontrar el final
// Buscamos el cierre de la función: buscamos el siguiente 'function ' que no esté dentro de otra función
// Simplificadamente: buscamos el siguiente '\nfunction ' o '\nexport function ' después de inicio+1
let end = c.length;
const nextFunc = c.indexOf('\nfunction ', inicio + 1);
const nextExport = c.indexOf('\nexport function ', inicio + 1);
if (nextFunc === -1 && nextExport === -1) {
  end = c.length;
} else if (nextFunc === -1) {
  end = nextExport;
} else if (nextExport === -1) {
  end = nextFunc;
} else {
  end = Math.min(nextFunc, nextExport);
}

const nuevo = `export function renderFicha(obj) {
  const panel = document.getElementById('panel-explorador');
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = '';

  if (!obj) {
    panel.innerHTML = '<div class="dossier-vacio">Sin jurisdicción seleccionada.</div>';
    return;
  }

  const datos = getAgregado('demografia', obj.yvy_id);
  const m = datos?.metricas || {};
  const poblacion = Number(m.poblacion) || 0;
  const viviendas = Number(m.viviendas) || 0;
  const densidad = obj.sup_oficial_km2 && poblacion ? (poblacion / obj.sup_oficial_km2).toFixed(1) : '–';

  // ── Header fijo: nombre + chip + superficie
  const header = document.createElement('div');
  header.className = 'dossier-header';
  const nivelBadge = document.createElement('span');
  nivelBadge.className = 'dossier-chip';
  nivelBadge.textContent = etiquetaNivel(obj.nivel).toUpperCase();
  const nombre = document.createElement('h1');
  nombre.className = 'dossier-nombre';
  nombre.textContent = obj.nombre_oficial;
  const sup = document.createElement('span');
  sup.className = 'dossier-superficie';
  sup.textContent = obj.sup_oficial_km2 ? obj.sup_oficial_km2.toLocaleString('es-AR') + ' km²' : 'Sin superficie';
  header.appendChild(nivelBadge);
  header.appendChild(nombre);
  header.appendChild(sup);

  // ── Hero de población
  const hero = document.createElement('div');
  hero.className = 'dossier-hero';
  const num = document.createElement('div');
  num.className = 'dossier-hero-num';
  num.textContent = poblacion ? poblacion.toLocaleString('es-AR') : '–';
  const lab = document.createElement('div');
  lab.className = 'dossier-hero-label';
  lab.textContent = 'Habitantes · Censo 2022';
  hero.appendChild(num);
  hero.appendChild(lab);

  // ── Grid atómico
  const grid = document.createElement('div');
  grid.className = 'dossier-grid';
  const metricas = [
    { label: 'Población', valor: poblacion ? poblacion.toLocaleString('es-AR') : '–' },
    { label: 'Viviendas', valor: viviendas ? viviendas.toLocaleString('es-AR') : '–' },
    { label: 'Densidad', valor: densidad !== '–' ? densidad + ' hab/km²' : '–' },
    { label: 'Viviendas colectivas', valor: '–' },
    { label: 'Población en calle', valor: '–' },
    { label: 'Jurisdicción', valor: obj.nivel === 'pais' ? '24 provincias' : '–' },
  ];
  metricas.forEach(m => {
    const item = document.createElement('div');
    item.className = 'dossier-metrica';
    item.innerHTML = '<div class="dossier-metrica__valor">' + m.valor + '</div><div class="dossier-metrica__label">' + m.label + '</div>';
    grid.appendChild(item);
  });

  // ── Briefing: texto auto-generado
  const briefing = document.createElement('div');
  briefing.className = 'dossier-briefing';
  const briefLabel = document.createElement('div');
  briefLabel.className = 'dossier-briefing__label';
  briefLabel.textContent = 'Breve descripción';
  const briefTexto = document.createElement('div');
  briefTexto.className = 'dossier-briefing__texto';
  briefTexto.textContent = 'El ' + obj.nivel + ' de ' + obj.nombre_oficial + ' cuenta con ' + (poblacion ? poblacion.toLocaleString('es-AR') : '–') + ' habitantes según el Censo Nacional 2022 (INDEC).';
  briefing.appendChild(briefLabel);
  briefing.appendChild(briefTexto);

  // ── Referencias
  const refs = document.createElement('div');
  refs.className = 'dossier-ref';
  refs.innerHTML = '<span class="dossier-ref__label">Referencias:</span> <span class="dossier-ref__item">Censo Nacional 2022 (INDEC)</span> · <span class="dossier-ref__item">IGN</span>';

  // ── Botón copiar dossier
  const btnCopiar = document.createElement('button');
  btnCopiar.className = 'dossier-copy';
  btnCopiar.textContent = 'Copiar dossier';
  btnCopiar.addEventListener('click', () => {
    const texto = obj.nombre_oficial + ' · ' + etiquetaNivel(obj.nivel) + ' · ' + (obj.sup_oficial_km2 ? obj.sup_oficial_km2.toLocaleString('es-AR') + ' km²' : '') + '\\n--- \\nPOBLACIÓN: ' + (poblacion ? poblacion.toLocaleString('es-AR') : '–') + '\\nVIVIENDAS: ' + (viviendas ? viviendas.toLocaleString('es-AR') : '–') + '\\nReferencias: Censo Nacional 2022 (INDEC)\nVer en Yvy: ' + location.href;
    navigator.clipboard.writeText(texto).then(() => {
      btnCopiar.textContent = 'Copiado';
      setTimeout(() => btnCopiar.textContent = 'Copiar dossier', 2000);
    });
  });

  panel.appendChild(header);
  panel.appendChild(hero);
  panel.appendChild(grid);
  panel.appendChild(briefing);
  panel.appendChild(refs);
  panel.appendChild(btnCopiar);
}`;

const resultado = c.slice(0, inicio) + nuevo + c.slice(end);
fs.writeFileSync(p, resultado);
console.log('OK: renderFicha reemplazado. Inicio:', inicio, 'Fin:', end);
