#!/usr/bin/env python3
# ============================================================
# yvy_plantilla.py — Plantilla de curación Yvy Explorer
# ------------------------------------------------------------
# Convierte un GIS (GPKG) o tabla (CSV) en artefactos listos
# según SPEC §10: registry parquets + agregados + PMTiles.
#
# Apta para POLÍGONO, PUNTO y LÍNEA (ramas diferenciadas).
# Uso típico (ver MANUAL.md):
#   1. inventario_csv() / inventario_gpkg()  → qué hay
#   2. asignar_yvy_id(...)                   → ids estables 1+cod
#   3. validar_contrato(...)                 → rangos, padres, dupes, geoms
#   4. csv_a_parquet() / gpkg_capa_a_pmtiles() → artefactos
#   5. escribir_agregados() / escribir_catalogo() → portal
#
# Requiere: geopandas, pyogrio, pyarrow, pyproj, pandas, pyyaml.
# tippecanoe solo para gpkg_capa_a_pmtiles (se verifica al usar).
# ============================================================

from __future__ import annotations

import csv
import json
import logging
import re
import shutil
import sqlite3
import subprocess
import unicodedata
from datetime import datetime
from pathlib import Path

# ---------- Logging ----------
LOG = logging.getLogger("yvy")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")


# ============================================================
# 0. Constantes de contrato (SPEC §10 — no tocar sin SPEC)
# ============================================================
RANGO_YVY = {
    "pais": (0, 999),
    "provincia": (1000, 1999),
    "departamento": (100000, 199999),
    "municipio": (1000000, 1999999),
    "barrio": (1000000000, 1999999999),
}
OFFSET_YVY = {"provincia": 1000, "departamento": 100000, "municipio": 1000000}
CATEGORIA_TIPO = {
    "demografia": "Sociedad", "escuelas": "Sociedad", "salud": "Sociedad",
    "barrios": "Sociedad", "empleo": "Economía", "produccion": "Economía",
    "mineria": "Economía", "ambiente": "Ambiente", "clima": "Ambiente",
    "hidrologia": "Ambiente", "rutas": "Infraestructura", "ffcc": "Infraestructura",
    "energia": "Infraestructura", "agua": "Infraestructura", "catastro": "Infraestructura",
}
ZOOM_POR_GEOM = {
    # (zmin, zmax) por defecto según geometría
    "poligono": (8, 14),
    "punto": (10, 16),
    "linea": (8, 14),
}
GEOM_FAMILIA = {
    "Polygon": "poligono", "MultiPolygon": "poligono",
    "Point": "punto", "MultiPoint": "punto",
    "LineString": "linea", "MultiLineString": "linea",
}


# ============================================================
# 1. Utilidades
# ============================================================
def norm_txt(s) -> str:
    """Normaliza texto: sin tildes, minúsculas, espacios simples."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def limpiar_txt(v):
    """Texto o None. Nunca devuelve la cadena 'nan'."""
    if v is None:
        return None
    try:
        import math
        if isinstance(v, float) and math.isnan(v):
            return None
    except Exception:
        pass
    s = str(v).strip()
    if s.lower() in ("", "nan", "none", "nat", "-"):
        return None
    return s


def to_int(x):
    """Entero o None. Acepta miles con . o , y '-' como ausencia."""
    if x is None:
        return None
    s = str(x).strip()
    if s in ("", "-", "...", "nan", "None"):
        return None
    s = re.sub(r"\s+", "", s)
    if re.fullmatch(r"[\d.,]+", s):
        s = s.replace(".", "").replace(",", "")
    try:
        return int(s)
    except ValueError:
        return None


def to_float(x):
    """Flotante o None. Acepta coma decimal ('100,0134 ha' → 100.0134)."""
    if x is None:
        return None
    s = str(x).strip()
    if s in ("", "-", "...", "nan", "None"):
        return None
    s = re.sub(r"\s*ha\s*$", "", s, flags=re.IGNORECASE).strip()
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    elif "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def leer_csv_robusto(path: Path, **kwargs):
    """Lee CSV probando utf-8-sig y latin-1. Devuelve DataFrame (pandas)."""
    import pandas as pd

    ultimo = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(path, dtype=str, encoding=enc, **kwargs)
            df.columns = [unicodedata.normalize("NFC", c.strip()) for c in df.columns]
            LOG.info("CSV %s leído con %s (%d filas)", path.name, enc, len(df))
            return df
        except Exception as e:  # noqa: BLE001
            ultimo = e
    raise ValueError(f"No se pudo leer {path}: {ultimo}")


def backup(path: Path, destino_dir: Path, etiqueta: str = "") -> Path | None:
    """Copia path a destino_dir/etiqueta/<timestamp>/ (devuelve destino o None)."""
    path = Path(path)
    if not path.exists():
        LOG.warning("Backup omitido (no existe): %s", path.name)
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    destino = Path(destino_dir) / etiqueta / ts if etiqueta else Path(destino_dir) / ts
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destino / path.name)
    LOG.info("Backup: %s → %s", path.name, destino)
    return destino


# ============================================================
# 2. Inventario (GPKG: TODAS las capas · CSV: encoding+columnas+filas)
# ============================================================
def inventario_gpkg(path: Path) -> list[dict]:
    """Una fila por CAPA (no por archivo). Nunca toma solo la primera."""
    import geopandas as gpd

    filas = []
    try:
        capas = gpd.list_layers(path)
    except Exception as e:  # noqa: BLE001
        return [{"archivo": path.name, "capa": "", "error": f"error_listar_capas: {e}"}]
    for _, r in capas.iterrows():
        nombre = r["name"]
        try:
            gdf = gpd.read_file(path, layer=nombre)
        except Exception as e:  # noqa: BLE001
            filas.append({"archivo": path.name, "capa": nombre, "error": f"error_lectura: {e}"})
            continue
        filas.append({
            "archivo": path.name,
            "capa": nombre,
            "n_features": len(gdf),
            "tipo_geom": ",".join(sorted(gdf.geom_type.dropna().unique())) if len(gdf) else "",
            "crs": str(gdf.crs) if gdf.crs else "",
            "columnas": ",".join([c for c in gdf.columns if c != "geometry"]),
        })
    return filas


def inventario_csv(path: Path) -> dict:
    """Lee encabezado + cuenta filas sin cargar todo (chunks)."""
    import pandas as pd

    df0 = leer_csv_robusto(path, nrows=5)
    n = 0
    for chunk in pd.read_csv(path, dtype=str, encoding="utf-8-sig", on_bad_lines="skip",
                             chunksize=50000):
        n += len(chunk)
    return {"archivo": path.name, "columnas": list(df0.columns), "n_filas_aprox": n}


# ============================================================
# 3. yvy_id estable (offsets explícitos — NUNCA zfill genérico)
# ============================================================
def yvy_id_provincia(cod_indec) -> int:
    return OFFSET_YVY["provincia"] + int(str(cod_indec).strip())


def yvy_id_depto(cod_indec) -> int:
    return OFFSET_YVY["departamento"] + int(str(cod_indec).strip())


def yvy_id_municipio(cod_indec) -> int:
    return OFFSET_YVY["municipio"] + int(str(cod_indec).strip())


def yvy_id_barrio(yvy_municipio: int, secuencia_1based: int) -> int:
    """Secuencia sobre orden DETERMINISTA (ordenar por nom_largo antes)."""
    return int(f"{int(yvy_municipio)}{int(secuencia_1based):03d}")


def validar_rango(yvy_id: int, nivel: str) -> bool:
    lo, hi = RANGO_YVY[nivel]
    return lo <= int(yvy_id) <= hi


# ============================================================
# 4. Validadores de contrato (SPEC §10)
# ============================================================
def validar_contrato(df, nivel: str, col_parent: str | None = None,
                     catalogo_ids: set | None = None) -> list[str]:
    """Devuelve lista de problemas (vacía = ok). No modifica nada."""
    import pandas as pd

    problemas = []
    if "yvy_id" not in df.columns:
        return ["falta columna yvy_id"]
    if df["yvy_id"].isna().any():
        problemas.append(f"yvy_id nulos: {int(df['yvy_id'].isna().sum())}")
    dup = df[df["yvy_id"].duplicated(keep=False)]
    if len(dup):
        problemas.append(f"yvy_id duplicados: {sorted(map(int, dup['yvy_id'].unique()))[:10]}")
    lo, hi = RANGO_YVY[nivel]
    fuera = df[(df["yvy_id"] < lo) | (df["yvy_id"] > hi)]
    if len(fuera):
        problemas.append(f"yvy_id fuera de rango [{lo},{hi}]: {len(fuera)} filas")
    if col_parent and col_parent in df.columns and catalogo_ids is not None:
        hu = df[~df[col_parent].isin(list(catalogo_ids) + [0]) & df[col_parent].notna()]
        if len(hu):
            problemas.append(f"parents inexistentes: {sorted(map(int, hu[col_parent].unique()))[:10]}")
    return problemas


def validar_geometrias(gdf, familia_esperada: str) -> dict:
    """Reporta inválidas/vacías/nulas/tipos. No cura (ver curar_geometrias)."""
    rep = {
        "n": len(gdf),
        "invalidas": int((~gdf.geometry.is_valid).sum()),
        "vacias": int(gdf.geometry.is_empty.sum()),
        "nulas": int(gdf.geometry.isna().sum()),
        "tipos": gdf.geom_type.value_counts().to_dict(),
        "familia_esperada": familia_esperada,
    }
    for t in rep["tipos"]:
        if GEOM_FAMILIA.get(t, "?") != familia_esperada:
            rep.setdefault("tipos_inesperados", []).append(t)
    return rep


def curar_geometrias(gdf, familia: str):
    """make_valid en polígonos; marca vacías/nulas con geom_estado. Devuelve (gdf, reporte).

    - poligono: make_valid; vacías/nulas → geom_estado vacia/nula (NO se borran).
    - punto/linea: solo reporte (sin buffer ni make_valid agresivo).
    """
    import pandas as pd

    gdf = gdf.copy()
    if "geom_estado" not in gdf.columns:
        gdf["geom_estado"] = "ok"
    if familia == "poligono":
        try:
            import shapely
            mask = ~gdf.geometry.is_valid & gdf.geometry.notna() & ~gdf.geometry.is_empty
            gdf.loc[mask, "geometry"] = gdf.loc[mask, "geometry"].apply(shapely.make_valid)
            reparadas = int(mask.sum())
        except Exception:  # noqa: BLE001
            reparadas = 0
    else:
        reparadas = 0
    gdf.loc[gdf.geometry.is_empty, "geom_estado"] = "vacia"
    gdf.loc[gdf.geometry.isna(), "geom_estado"] = "nula"
    rep = validar_geometrias(gdf, familia)
    rep["reparadas"] = reparadas
    return gdf, rep


# ============================================================
# 5. CSV → Parquet (contrato: UTF-8, null→None, schema explícito)
# ============================================================
def csv_a_parquet(entrada: Path, salida: Path, columnas: dict | None = None,
                  numericas_int: list | None = None, numericas_float: list | None = None,
                  null_es_cero: list | None = None) -> Path:
    """Convierte CSV a parquet curado.

    - columnas: {origen: destino} (renombra; si None, conserva).
    - numericas_int/float: parseo con miles/coma-decimal.
    - null_es_cero: columnas donde None → 0 (ej. colectivas/calle).
    """
    import pandas as pd

    df = leer_csv_robusto(entrada)
    if columnas:
        faltan = [c for c in columnas if c not in df.columns]
        if faltan:
            raise ValueError(f"Columnas no encontradas en {entrada.name}: {faltan}")
        df = df[list(columnas)].rename(columns=columnas)
    for c in numericas_int or []:
        if c in df.columns:
            df[c] = df[c].apply(to_int)
    for c in numericas_float or []:
        if c in df.columns:
            df[c] = df[c].apply(to_float)
    for c in (null_es_cero or []):
        if c in df.columns:
            df[c] = df[c].apply(lambda v: 0 if v is None else v)
    # texto limpio (nunca 'nan')
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].apply(limpiar_txt)
    salida = Path(salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(salida, index=False)
    LOG.info("Parquet: %s (%d filas, %d cols)", salida.name, len(df), len(df.columns))
    return salida


# ============================================================
# 6. GPKG capa → PMTiles (tippecanoe verificado, atómico)
# ============================================================
def _which_tippecanoe() -> str:
    r = subprocess.run(["which", "tippecanoe"], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("tippecanoe no instalado (ver MANUAL.md §1).")
    return r.stdout.strip()


def gpkg_capa_a_pmtiles(gpkg: Path, capa: str, salida: Path, col_id: str,
                        zmin: int, zmax: int, capa_nombre: str | None = None,
                        max_tile_bytes: int = 500000,
                        drop_densest: bool = False) -> Path:
    """Exporta UNA capa a PMTiles con id estable.

    - col_id: columna numérica única (yvy_id, expediente-num, etc.).
    - Escribe a temporal + rename atómico + verifica magic 'PMTiles'.
    - drop_densest=False por defecto (no tirar features sin aviso).
    """
    import geopandas as gpd

    exe = _which_tippecanoe()
    gdf = gpd.read_file(gpkg, layer=capa)
    if col_id not in gdf.columns:
        raise ValueError(f"La capa no tiene columna '{col_id}'")
    if gdf[col_id].isna().any():
        raise ValueError(f"ids nulos en '{col_id}'")
    if gdf[col_id].duplicated().any():
        dups = gdf[gdf[col_id].duplicated(keep=False)][col_id].unique()[:10].tolist()
        raise ValueError(f"ids duplicados en '{col_id}': {dups}")
    if str(gdf.crs) != "EPSG:4326":
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf.rename(columns={col_id: "id"})
    tmp = Path(salida).parent / (Path(salida).name + ".tmp.geojson")
    gdf.to_file(tmp, driver="GeoJSON")
    pmtiles = Path(salida)
    tmp_pm = pmtiles.parent / (pmtiles.name + ".tmp")
    cmd = [exe, "-o", str(tmp_pm), "-Z", str(zmin), "-z", str(zmax),
           "-l", capa_nombre or Path(salida).stem,
           "--use-attribute-for-id=id",
           f"--maximum-tile-bytes={int(max_tile_bytes)}", "--force", str(tmp)]
    if drop_densest:
        cmd.insert(-1, "--drop-densest-as-needed")
    LOG.info("tippecanoe %s (z%d-%d, %d feats)…", pmtiles.name, zmin, zmax, len(gdf))
    r = subprocess.run(cmd, capture_output=True, text=True)
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        tmp_pm.unlink(missing_ok=True)
        raise RuntimeError(f"tippecanoe falló: {r.stderr[-800:]}")
    with open(tmp_pm, "rb") as f:
        magic = f.read(7)
    if magic != b"PMTiles":
        tmp_pm.unlink(missing_ok=True)
        raise RuntimeError(f"{pmtiles.name} no es PMTiles válido (magic={magic}). Temporal borrado.")
    tmp_pm.replace(pmtiles)  # atómico: el destino solo aparece válido
    LOG.info("OK %s (%.1f MB)", pmtiles.name, pmtiles.stat().st_size / 1e6)
    return pmtiles


# ============================================================
# 7. Agregados + catálogo (forma SPEC §10)
# ============================================================
def escribir_agregados(tipo: str, categoria: str, filas: list[dict],
                       salida_dir: Path, fuente: str, fecha_vigencia: str,
                       version: str, metricas_keys: list) -> list[Path]:
    """Un JSON por yvy_id: {tipo,categoria,yvy_id,yvy_id_contenedor,
    fuente,fecha_vigencia,version,metricas{...}}. metricas None→0."""
    import pandas as pd

    salida_dir = Path(salida_dir)
    salida_dir.mkdir(parents=True, exist_ok=True)
    outs = []
    for row in filas:
        yid = int(row["yvy_id"])
        cont = int(row.get("yvy_id_contenedor", yid))
        mets = {}
        for k in metricas_keys:
            v = row.get(k)
            if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
                mets[k] = 0
            else:
                n = to_float(v)
                mets[k] = int(n) if n is not None and float(n).is_integer() else (n if n is not None else v)
        agg = {"tipo": tipo, "categoria": categoria, "yvy_id": yid,
               "yvy_id_contenedor": cont, "fuente": fuente,
               "fecha_vigencia": fecha_vigencia, "version": version,
               "metricas": mets}
        p = salida_dir / f"{yid}.json"
        with open(p, "w", encoding="utf-8") as f:
            json.dump(agg, f, ensure_ascii=False, indent=2)
        outs.append(p)
    LOG.info("Agregados %s: %d JSON en %s", tipo, len(outs), salida_dir)
    return outs


def escribir_catalogo(nodos: list[dict], tipos: list[dict], agregados_idx: dict,
                      salida: Path, version: str = "1.0") -> Path:
    """Índice de curación 07_manifest/catalogo.json (NO es el manifest del portal)."""
    cat = {"generado": datetime.now().isoformat(timespec="seconds"),
           "version": version, "schema": "yvy-catalogo-v1",
           "piloto": {}, "nodos": nodos, "tipos": tipos, "agregados": agregados_idx}
    for n in nodos:
        cat["piloto"].setdefault(n["nivel"], []).append(n["yvy_id"])
    salida = Path(salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
    LOG.info("Catálogo: %s (%d nodos)", salida.name, len(nodos))
    return salida
