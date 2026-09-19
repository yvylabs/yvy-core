#!/bin/sh
# pre-push local (cortesía; el guardia real es el CI).
# Activar: git config core.hooksPath scripts
set -e
if git diff --cached --name-only | grep -E '\.(pmtiles|parquet|fgb)$|public/data/manifest.*\.json'; then
  echo "pre-push: raw o manifests derivados — revisá SPEC §6"; exit 1
fi
grep -q "Esri, Maxar, Earthstar Geographics" src/js/main.js || { echo "pre-push: atribución ausente"; exit 1; }
echo "pre-push ok"
