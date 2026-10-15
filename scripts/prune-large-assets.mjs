#!/usr/bin/env node
// scripts/prune-large-assets.mjs
// No rompe funciones: solo borra del dist los archivos > 24.5 MiB
// para que Pages no falle (límite 25 MiB). Esos archivos deben estar en R2
// y ser servidos por functions/data/* o functions/tiles/*
import fs from 'fs';
import path from 'path';

const DIST = 'dist';
const MAX_BYTES = 24.5 * 1024 * 1024; // 24.5 MiB margen

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST);
let pruned = 0;
for (const file of files) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) {
    console.log(`[prune] ${file} ${(stat.size/1024/1024).toFixed(2)} MiB > 24.5 MiB -> borrando de dist (quedará en R2)`);
    fs.unlinkSync(file);
    pruned++;
  }
}
console.log(`[prune] listo, ${pruned} archivos pesados borrados de dist`);
