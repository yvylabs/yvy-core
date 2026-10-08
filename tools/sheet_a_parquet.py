#!/usr/bin/env python3
"""Sheet (export CSV) -> parquet validado para data/registry.

Flujo sin Colab: editar en Google Sheet -> Archivo -> Descargar CSV ->
correr este script -> copiar a data/registry/ -> pnpm run build.

Uso:
  python tools/sheet_a_parquet.py entrada.csv data/registry/jurisdicciones.parquet
  python tools/sheet_a_parquet.py entrada.csv data/registry/demografia.parquet

Solo escribe si el contrato da ok (ver --force). Hace backup del
parquet anterior en 02_backup/ si se pasa --backup-dir.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yvy_plantilla import (  # noqa: E402
    RANGO_YVY,
    backup,
    leer_csv_robusto,
    limpiar_txt,
    to_int,
    validar_contrato,
)

# Etiqueta de la columna `nivel` -> nivel de RANGO_YVY (plantilla).
# El build mapea aparte a su canonico (departamento->depto, etc.).
NIVEL_MAP = {
    'pais': 'pais',
    'provincia': 'provincia',
    'departamento': 'departamento',
    'gobierno_local': 'municipio',
    'barrio': 'barrio',
    'concesion': 'concesion',
}

REQ_JURIS = ['yvy_id', 'nivel', 'parent_yvy_id', 'nombre_oficial']
REQ_DATASET = ['yvy_id', 'fuente', 'fecha_vigencia', 'version']


def validar_jurisdicciones(df) -> list[str]:
    import pandas as pd

    problemas = []
    for c in REQ_JURIS:
        if c not in df.columns:
            problemas.append(f'falta columna {c}')
    if problemas:
        return problemas
    if df['yvy_id'].isna().any():
        problemas.append('yvy_id nulos')
    dup = df[df['yvy_id'].duplicated(keep=False)]
    if len(dup):
        problemas.append(f"yvy_id duplicados: {dup['yvy_id'].unique()[:10].tolist()}")
    malas = df[~df['nivel'].isin(NIVEL_MAP)]
    if len(malas):
        problemas.append(f"nivel desconocido: {malas['nivel'].unique()[:10].tolist()}")
    ids = set(pd.to_numeric(df['yvy_id'], errors='coerce').dropna().astype(int))
    for etiqueta, grupo in df.groupby('nivel'):
        nivel = NIVEL_MAP.get(etiqueta)
        if not nivel:
            continue
        for p in validar_contrato(grupo, nivel, col_parent='parent_yvy_id', catalogo_ids=ids):
            problemas.append(f'[{etiqueta}] {p}')
    return problemas


def validar_dataset(df) -> list[str]:
    problemas = []
    for c in REQ_DATASET:
        if c not in df.columns:
            problemas.append(f'falta columna {c}')
    if problemas:
        return problemas
    if df['yvy_id'].isna().any():
        problemas.append('yvy_id nulos')
    dup = df[df['yvy_id'].duplicated(keep=False)]
    if len(dup):
        problemas.append(f"yvy_id duplicados: {dup['yvy_id'].unique()[:10].tolist()}")
    metricas = [c for c in df.columns if c not in REQ_DATASET + ['yvy_id', 'cod_indec', 'nombre_oficial', 'parent_yvy_id', 'categoria', 'tipo']]
    for c in metricas:
        mal = df[c].notna() & (df[c].astype(str).str.strip() != '') & df[c].apply(
            lambda v: to_int(v) is None)
        if int(mal.sum()):
            ej = df.loc[mal, c].unique()[:5].tolist()
            problemas.append(f'metrica no numerica en {c}: {ej}')
    return problemas


def main() -> int:
    ap = argparse.ArgumentParser(description='Sheet CSV -> parquet validado')
    ap.add_argument('entrada', help='CSV descargado del Sheet')
    ap.add_argument('salida', help='parquet destino (data/registry/*.parquet)')
    ap.add_argument('--force', action='store_true', help='escribir aunque haya warnings')
    ap.add_argument('--backup-dir', default='02_backup', help='respaldo del parquet anterior')
    args = ap.parse_args()

    df = leer_csv_robusto(Path(args.entrada))
    es_juris = 'nivel' in df.columns
    # yvy_id/parent siempre enteros (el CSV del Sheet los trae como texto)
    for c in (['yvy_id', 'parent_yvy_id'] if es_juris else ['yvy_id']):
        if c in df.columns:
            df[c] = df[c].apply(lambda v: to_int(v) if v is not None and str(v).strip() != '' else None).astype('Int64')
    if 'yvy_id' in df.columns and df['yvy_id'].isna().any():
        print(f"CONTRATO: yvy_id no numerico en {int(df['yvy_id'].isna().sum())} fila(s).")
        return 1
    problemas = validar_jurisdicciones(df) if es_juris else validar_dataset(df)
    if problemas:
        print(f'CONTRATO: {len(problemas)} problema(s) en {args.entrada}:')
        for p in problemas:
            print(f'  - {p}')
        if not args.force:
            print('No se escribio nada. Corregi el Sheet o usa --force.')
            return 1
        print('--force: se escribe igual.')
    else:
        print(f'CONTRATO OK: {len(df)} filas.')
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].apply(limpiar_txt)
    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    if salida.exists():
        backup(salida, args.backup_dir, etiqueta='parquet')
    df.to_parquet(salida, index=False)
    print(f'OK -> {args.salida}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
