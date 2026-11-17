#!/usr/bin/env python3
# ==============================================================
# ingesta.py — Paso 0 del pipeline Yvy Core (ESQUELETO)
# ------------------------------------------------------------
# Toma una carpeta de cliente (PDFs, Excels, GeoJSONs, CSVs) y
# produce un PLAN de conversión, no los artefactos finales todavía.
#
# ¿Por qué un plan y no Parquet/PMTiles ya?
#   1. El contrato lo manda el build (src/lib/catalogo.js): un
#      yvy_id derivado, unidades declaradas y fuente por métrica.
#      Generar Parquet "por moldes" es la forma más rápida de
#      publicar un dato falso.
#   2. En este entorno no hay pyarrow/geopandas ni pmtiles CLI.
#      Instalarlos es decisión del operador, no del esqueleto.
#   3. El SLA de 72 h se cumple con Google Docs + un GeoJSON
#      correcto: el trabajo caro es la DECISIÓN de qué dato entra,
#      no el convertidor.
#
# Salidas (en --out):
#   inventario.json   qué encontramos y qué pudimos leer
#   ontologia.csv     plantilla auditable para el cliente
#   ontologia.json    misma ontología en el formato que SÍ lee la receta
#   plan.json         columnas obligatorias del Parquet y receta para PMTiles
#
# Uso:
#   python3 scripts/ingesta.py cliente/ --out salida/ --dry-run
# ==============================================================

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "yvy-ingesta-v0"
EXTENSIONES = {
    ".geojson": "geojson",
    ".json": "geojson",
    ".csv": "tabular",
    ".xlsx": "excel",
    ".xls": "excel",
    ".pdf": "pdf",
}
COLUMNAS_OBLIGATORIAS = [
    "yvy_id",
    "nivel",
    "nombre_oficial",
    "parent_yvy_id",
    "cod_indec",
    "fuente",
    "fecha",
]
COLUMNAS_ONTOLOGIA = [
    "seccion",
    "clave",
    "etiqueta",
    "unidad",
    "tipo",
    "dataset",
    "nivel",
    "padre",
    "contiene",
    "geometria",
    "fuente",
    "fecha",
    "visibilidad",
    "estado",
]


# --------------------------------------------------------------
# Descubrimiento
# --------------------------------------------------------------
def descubrir(carpeta: Path) -> dict:
    """Inventario determinista de la carpeta del cliente."""
    carpeta = Path(carpeta)
    if not carpeta.is_dir():
        raise ValueError(f"la carpeta del cliente no existe: {carpeta}")
    archivos = []
    for ruta in sorted(carpeta.rglob("*")):
        if not ruta.is_file():
            continue
        ext = ruta.suffix.lower()
        archivos.append({
            "archivo": str(ruta.relative_to(carpeta)).replace("\\", "/"),
            "extension": ext,
            "tipo": EXTENSIONES.get(ext, "desconocido"),
            "bytes": ruta.stat().st_size,
        })
    conteo = Counter(a["tipo"] for a in archivos)
    return {
        "carpeta": str(carpeta),
        "total_archivos": len(archivos),
        "por_tipo": dict(sorted(conteo.items())),
        "archivos": archivos,
        "sin_clasificar": [a["archivo"] for a in archivos if a["tipo"] == "desconocido"],
    }


# --------------------------------------------------------------
# Lectores (stdlib). Excel y PDF quedan como TODO explícito.
# --------------------------------------------------------------
def _bounds_de_coordenadas(coords, acc):
    """Recorre coords anidadas y acumula el rectángulo en grados."""
    if not isinstance(coords, (list, tuple)) or not coords:
        return
    if isinstance(coords[0], (int, float)) and len(coords) >= 2:
        lon, lat = float(coords[0]), float(coords[1])
        acc[0] = min(acc[0], lon)
        acc[1] = min(acc[1], lat)
        acc[2] = max(acc[2], lon)
        acc[3] = max(acc[3], lat)
        return
    for hijo in coords:
        _bounds_de_coordenadas(hijo, acc)


def leer_geojson(ruta: Path) -> dict:
    """Lee un FeatureCollection con stdlib: features, propiedades y bounds."""
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    tipo = datos.get("type")
    features = datos.get("features") if tipo == "FeatureCollection" else ([datos] if tipo == "Feature" else [])
    propiedades = set()
    bounds = [float("inf"), float("inf"), float("-inf"), float("-inf")]
    ids = []
    for f in features:
        props = f.get("properties") or {}
        propiedades.update(str(k) for k in props)
        for candidato in ("yvy_id", "id", "cod_indec"):
            if candidato in props and props[candidato] not in (None, ""):
                ids.append(str(props[candidato]))
                break
        geom = f.get("geometry")
        if geom:
            _bounds_de_coordenadas(geom.get("coordinates"), bounds)
    if bounds[0] == float("inf"):
        bounds = None
    return {
        "estado": "ok" if features else "vacio",
        "tipo": tipo,
        "features": len(features),
        "propiedades": sorted(propiedades),
        "ids_detectados": len(ids),
        "ejemplos_id": ids[:8],
        "bounds": [round(n, 6) for n in bounds] if bounds else None,
        "aviso": None if ids else "sin propiedad yvy_id/id/cod_indec: hay que declarar el mapping antes de generar Parquet",
    }


def leer_csv(ruta: Path) -> dict:
    """Lee encabezado y cuenta filas sin cargar el archivo completo."""
    with Path(ruta).open(newline="", encoding="utf-8-sig") as fh:
        lector = csv.reader(fh)
        encabezado = next(lector, [])
        filas = sum(1 for _ in lector)
    tiene_id = any(c.strip().lower() in COLUMNAS_OBLIGATORIAS for c in encabezado)
    return {
        "estado": "ok" if encabezado else "vacio",
        "columnas": [c.strip() for c in encabezado],
        "filas": filas,
        "columnas_obligatorias_presentes": [c for c in encabezado if c.strip() in COLUMNAS_OBLIGATORIAS],
        "aviso": None if tiene_id else "sin yvy_id/cod_indec: el registry no puede derivar identidad",
    }


def leer_excel(ruta: Path) -> dict:
    # TODO(SLA-72h): con openpyxl leer hojas, detection de encabezado y
    # exportar a CSV intermedio. No se instala nada en el esqueleto.
    return {
        "estado": "pendiente",
        "archivo": str(ruta),
        "aviso": "Excel detectado: convertir a CSV con encabezado en fila 1 antes de seguir (openpyxl NO está instalado en el esqueleto)",
    }


def leer_pdf(ruta: Path) -> dict:
    # TODO(SLA-72h): con pypdf/pdfplumber extraer texto y tabla; TODO el
    # contenido es fuente declarada, nunca se copia sin fecha ni URL.
    return {
        "estado": "pendiente",
        "archivo": str(ruta),
        "aviso": "PDF detectado: extraer texto/tablas y declarar fuente + fecha de corte antes de cargar métricas",
    }


def inspeccionar(inventario: dict) -> dict:
    """Aplica el lector correspondiente a cada archivo del inventario."""
    resultado = {}
    carpetas = Path(inventario["carpeta"])
    for a in inventario["archivos"]:
        ruta = carpetas / a["archivo"]
        try:
            if a["tipo"] == "geojson":
                detalle = leer_geojson(ruta)
            elif a["tipo"] == "tabular":
                detalle = leer_csv(ruta)
            elif a["tipo"] == "excel":
                detalle = leer_excel(ruta)
            elif a["tipo"] == "pdf":
                detalle = leer_pdf(ruta)
            else:
                detalle = {"estado": "desconocido", "aviso": "extensión no clasificada"}
        except Exception as err:  # un archivo roto no detiene el inventario
            detalle = {"estado": "error", "aviso": f"{type(err).__name__}: {err}"}
        detalle["tipo"] = a["tipo"]
        resultado[a["archivo"]] = detalle
    return resultado


# --------------------------------------------------------------
# Ontología: fuente de verdad SOURCE (data/ontologia.json)
# --------------------------------------------------------------
def ontologia_a_csv(ontologia: dict) -> list[dict]:
    """Aplana la ontología del build a la plantilla que ve el cliente."""
    filas = []
    for clave, info in (ontologia.get("tipos") or {}).items():
        filas.append({
            "seccion": "tipos", "clave": clave, "etiqueta": info.get("etiqueta") or clave,
            "unidad": "", "tipo": "", "dataset": "",
            "nivel": info.get("nivel", ""),
            "padre": "|".join(info.get("padre") or []),
            "contiene": "|".join(info.get("contiene") or []),
            "geometria": str(bool(info.get("geometria"))).lower(),
            "fuente": "", "fecha": "",
            "visibilidad": info.get("visibilidad", "public"), "estado": "declarado",
        })
    for clave, info in (ontologia.get("metricas") or {}).items():
        filas.append({
            "seccion": "metricas", "clave": clave,
            "etiqueta": info.get("etiqueta") or clave,
            "unidad": info.get("unidad") or "", "tipo": info.get("tipo") or "",
            "dataset": info.get("dataset") or "",
            "nivel": "|".join(info.get("niveles") or []),
            "padre": "", "contiene": "", "geometria": "",
            "fuente": info.get("fuente") or "", "fecha": info.get("fecha") or "",
            "visibilidad": info.get("visibilidad", "public"),
            "estado": "previsto" if info.get("previsto") else "declarado",
        })
    for clave, info in (ontologia.get("relaciones") or {}).items():
        filas.append({
            "seccion": "relaciones", "clave": clave,
            "etiqueta": info.get("descripcion") or clave,
            "unidad": "", "tipo": "", "dataset": "",
            "nivel": "", "padre": "", "contiene": "", "geometria": "",
            "fuente": info.get("fuente") or "", "fecha": info.get("fecha") or "",
            "visibilidad": info.get("visibilidad", "public"), "estado": "declarado",
        })
    return filas


def csv_a_ontologia(filas: list[dict], original: dict | None = None) -> dict:
    """
    Convierte la plantilla de vuelta al formato que lee la receta.
    `original` preserva schema/version/reglas: la plantilla NO puede
    redefinir el contrato, solo completar declaraciones.
    """
    base = dict(original or {})
    ont = {
        "schema": base.get("schema", "yvy-ontologia-v1"),
        "version": base.get("version", "0.1"),
        "descripcion": base.get("descripcion", "Ontología generada por scripts/ingesta.py (esqueleto)."),
        "tipos": {}, "metricas": {}, "relaciones": {},
        "reglas": base.get("reglas", {}),
    }
    for f in filas:
        seccion, clave = f["seccion"], f["clave"]
        if not seccion or not clave:
            continue
        comun = {
            "visibilidad": f.get("visibilidad") or "public",
        }
        if seccion == "tipos":
            ont["tipos"][clave] = {
                "nivel": int(f["nivel"]) if str(f.get("nivel", "")).lstrip("-").isdigit() else f.get("nivel"),
                "padre": [x for x in f.get("padre", "").split("|") if x],
                "contiene": [x for x in f.get("contiene", "").split("|") if x],
                "geometria": str(f.get("geometria", "")).lower() == "true",
                **comun,
            }
        elif seccion == "metricas":
            if not f.get("unidad"):
                continue  # SPEC §4: sin unidad, la métrica NO entra
            metrica = {
                "unidad": f["unidad"], "tipo": f.get("tipo") or "entero",
                "etiqueta": f.get("etiqueta") or clave,
                "dataset": f.get("dataset") or "general",
                **comun,
            }
            if f.get("fuente"):
                metrica["fuente"] = f["fuente"]
            if f.get("fecha"):
                metrica["fecha"] = f["fecha"]
            if f.get("estado") == "previsto":
                metrica["previsto"] = True
            ont["metricas"][clave] = metrica
        elif seccion == "relaciones":
            ont["relaciones"][clave] = {
                "descripcion": f.get("etiqueta") or clave,
                "fuente": f.get("fuente") or "sin fuente",
                "fecha": f.get("fecha") or None,
                **comun,
            }
    return ont


def leer_ontologia(ruta: Path) -> dict:
    return json.loads(Path(ruta).read_text(encoding="utf8"))


# --------------------------------------------------------------
# Planes: qué hay que generar después (sin ejecutar conversión)
# --------------------------------------------------------------
def plan_parquet(ontologia: dict) -> dict:
    return {
        "archivo": "data/registry/jurisdicciones.parquet",
        "formato": "parquet",
        "columnas_obligatorias": COLUMNAS_OBLIGATORIAS,
        "niveles": list((ontologia.get("tipos") or {}).keys()),
        "metricas": sorted((ontologia.get("metricas") or {}).keys()),
        "reglas": [
            "yvy_id = offset(nivel) + cod_indec (cuando hay código oficial)",
            "sin fuente no entra; sin fecha se marca explícitamente",
            "null + estado missing, nunca 0 de relleno",
            "el tipo va como columna, nunca dentro del yvy_id",
        ],
        "estado": "planificado",
        "pendiente": "pyarrow no está instalado: escribir el parquet con el esquema de arriba",
    }


def plan_pmtiles(ontologia: dict, inspeccion: dict) -> list[dict]:
    bounds = next(
        (d["bounds"] for d in inspeccion.values() if d.get("bounds")), None
    )
    planes = []
    for clave, info in (ontologia.get("tipos") or {}).items():
        if not info.get("geometria"):
            continue
        planes.append({
            "nivel": clave,
            "archivo": f"public/data/{clave}s.pmtiles",
            "comando_sugerido": (
                f"tippecanoe -o {clave}s.pmtiles -Z8 -z14 "
                f"--generate-ids --minimum-zoom=8 --maximum-zoom=14 entrada.geojson"
            ),
            "bounds_detectados": bounds,
            "nota": "--use-attribute-for-id=yvy_id si los features traen yvy_id; el build filtra por id MVT",
            "estado": "planificado",
        })
    return planes


# --------------------------------------------------------------
# CLI
# --------------------------------------------------------------
def _escribir_json(ruta: Path, datos) -> None:
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf8")


def _escribir_csv(ruta: Path, filas: list[dict]) -> None:
    with ruta.open("w", newline="", encoding="utf8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNAS_ONTOLOGIA)
        writer.writeheader()
        for f in filas:
            writer.writerow({c: f.get(c, "") for c in COLUMNAS_ONTOLOGIA})


def procesar(carpeta: Path, salida: Path, ontologia_src: Path, dry_run: bool = False) -> dict:
    inventario = descubrir(carpeta)
    inspeccion = inspeccionar(inventario)
    original = leer_ontologia(ontologia_src)
    filas = ontologia_a_csv(original)
    roundtrip = csv_a_ontologia(filas, original)
    resumen = {
        "schema": SCHEMA,
        "generado": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "inventario": inventario,
        "inspeccion": inspeccion,
        "ontologia": {
            "csv_filas": len(filas),
            "metricas_declaradas": len(roundtrip["metricas"]),
            "roundtrip_ok": len(roundtrip["metricas"]) == len(original.get("metricas", {})),
            "aviso": "El CSV es una plantilla: la fuente de verdad sigue siendo data/ontologia.json",
        },
        "planes": {
            "parquet": plan_parquet(original),
            "pmtiles": plan_pmtiles(original, inspeccion),
        },
        "siguiente_paso": "Completar PDF/Excel, escribir el Parquet y generar PMTiles; recién ahí pnpm run receta",
    }
    if not dry_run:
        salida.mkdir(parents=True, exist_ok=True)
        _escribir_json(salida / "inventario.json", resumen)
        _escribir_csv(salida / "ontologia.csv", filas)
        _escribir_json(salida / "ontologia.json", roundtrip)
        _escribir_json(salida / "plan.json", resumen["planes"])
    return resumen


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Esqueleto de ingesta Yvy Core (paso 0)")
    p.add_argument("carpeta", type=Path, help="carpeta cliente/ con PDFs, Excels, GeoJSONs y CSVs")
    p.add_argument("--out", type=Path, default=Path("salida/ingesta"), help="directorio de salida")
    p.add_argument("--ontologia", type=Path, default=Path("data/ontologia.json"), help="ontología fuente")
    p.add_argument("--dry-run", action="store_true", help="inspeccionar sin escribir archivos")
    args = p.parse_args(argv)
    try:
        r = procesar(args.carpeta, args.out, args.ontologia, args.dry_run)
    except (ValueError, OSError, json.JSONDecodeError) as err:
        print(f"[ingesta] error: {err}", file=sys.stderr)
        return 2
    print(f"[ingesta] {r['inventario']['total_archivos']} archivos · " +
          ", ".join(f"{k}:{v}" for k, v in r['inventario']['por_tipo'].items()))
    print(f"[ingesta] ontología: {r['ontologia']['csv_filas']} filas · roundtrip " +
          ("OK" if r['ontologia']['roundtrip_ok'] else "INCOMPLETO"))
    for archivo, d in r["inspeccion"].items():
        if d.get("aviso"):
            print(f"[ingesta] ⚠ {archivo}: {d['aviso']}")
    print("[ingesta] " + ("dry-run: no se escribió nada" if args.dry_run else f"salida: {args.out}"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
