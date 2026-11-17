# Tests del esqueleto de ingesta (solo stdlib, sin pyarrow/geopandas).
# Correr: python3 -m unittest tools.test_ingesta -v
import json
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))
import ingesta  # noqa: E402


class TestDescubrimiento(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cliente = Path(self.tmp.name) / "cliente"
        self.cliente.mkdir()
        self.geo = self.cliente / "municipios.geojson"
        self.geo.write_text(json.dumps({
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"yvy_id": 1660063, "nombre": "Salta"},
                 "geometry": {"type": "Polygon", "coordinates": [[[-65.5, -25.3], [-65.0, -25.3], [-65.0, -24.7], [-65.5, -25.3]]]}},
                {"type": "Feature", "properties": {"yvy_id": 1660070, "nombre": "Güemes"},
                 "geometry": {"type": "Point", "coordinates": [-65.1, -24.6]}},
            ],
        }), encoding="utf8")
        (self.cliente / "censo.csv").write_text("yvy_id,poblacion,fuente\n1660063,627704,INDEC\n1660070,30000,INDEC\n", encoding="utf8")
        (self.cliente / "boletin.pdf").write_bytes(b"%PDF-1.4 falso")
        (self.cliente / "planilla.xlsx").write_bytes(b"PK falso")
        (self.cliente / "NOTAS.txt").write_text("ignorar", encoding="utf8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_descubrir_clasifica_y_ordena(self):
        inv = ingesta.descubrir(self.cliente)
        self.assertEqual(inv["total_archivos"], 5)
        self.assertEqual(inv["por_tipo"]["geojson"], 1)
        self.assertEqual(inv["por_tipo"]["pdf"], 1)
        self.assertEqual(inv["por_tipo"]["excel"], 1)
        self.assertEqual(inv["sin_clasificar"], ["NOTAS.txt"])
        self.assertEqual(inv["archivos"][0]["archivo"], "NOTAS.txt")

    def test_geojson_con_stdlib(self):
        d = ingesta.leer_geojson(self.geo)
        self.assertEqual(d["estado"], "ok")
        self.assertEqual(d["features"], 2)
        self.assertEqual(d["ids_detectados"], 2)
        self.assertIn("yvy_id", d["propiedades"])
        self.assertEqual(d["bounds"], [-65.5, -25.3, -65.0, -24.6])

    def test_csv_y_stubs(self):
        d = ingesta.leer_csv(self.cliente / "censo.csv")
        self.assertEqual(d["filas"], 2)
        self.assertIn("yvy_id", d["columnas_obligatorias_presentes"])
        self.assertEqual(ingesta.leer_pdf(self.cliente / "boletin.pdf")["estado"], "pendiente")
        self.assertEqual(ingesta.leer_excel(self.cliente / "planilla.xlsx")["estado"], "pendiente")

    def test_inspeccionar_no_se_detiene_por_archivos_raros(self):
        ins = ingesta.inspeccionar(ingesta.descubrir(self.cliente))
        self.assertEqual(ins["municipios.geojson"]["estado"], "ok")
        self.assertEqual(ins["NOTAS.txt"]["estado"], "desconocido")


class TestOntologia(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ont = ingesta.leer_ontologia(RAIZ / "data/ontologia.json")

    def test_csv_a_ontologia_es_roundtrip(self):
        filas = ingesta.ontologia_a_csv(self.ont)
        self.assertGreater(len(filas), 20)
        vuelta = ingesta.csv_a_ontologia(filas, self.ont)
        self.assertEqual(vuelta["schema"], self.ont["schema"])
        self.assertEqual(len(vuelta["tipos"]), len(self.ont["tipos"]))
        self.assertEqual(len(vuelta["metricas"]), len(self.ont["metricas"]))
        self.assertEqual(len(vuelta["relaciones"]), len(self.ont["relaciones"]))
        una = self.ont["metricas"]["poblacion"]
        self.assertEqual(vuelta["metricas"]["poblacion"]["unidad"], una["unidad"])

    def test_metrica_sin_unidad_no_entra(self):
        fila = {"seccion": "metricas", "clave": "humo", "unidad": "", "etiqueta": "Humo"}
        vuelta = ingesta.csv_a_ontologia([fila], self.ont)
        self.assertNotIn("humo", vuelta["metricas"])


class TestPlanes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ont = ingesta.leer_ontologia(RAIZ / "data/ontologia.json")

    def test_plan_parquet_tiene_el_contrato(self):
        plan = ingesta.plan_parquet(self.ont)
        self.assertEqual(plan["archivo"], "data/registry/jurisdicciones.parquet")
        for col in ("yvy_id", "nivel", "nombre_oficial", "parent_yvy_id", "fuente", "fecha"):
            self.assertIn(col, plan["columnas_obligatorias"])
        self.assertIn("sin fuente no entra", " ".join(plan["reglas"]))

    def test_plan_pmtiles_por_nivel_con_geometria(self):
        ins = {"x.geojson": {"bounds": [-72.9, -54.8, -53.6, -21.7]}}
        planes = ingesta.plan_pmtiles(self.ont, ins)
        self.assertGreater(len(planes), 0)
        self.assertTrue(all(p["estado"] == "planificado" for p in planes))
        self.assertTrue(all("tippecanoe" in p["comando_sugerido"] for p in planes))
        self.assertEqual(planes[0]["bounds_detectados"], [-72.9, -54.8, -53.6, -21.7])

    def test_carpeta_inexistente_falla_claro(self):
        with self.assertRaisesRegex(ValueError, "no existe"):
            ingesta.descubrir(Path("/no/existe"))


class TestSalida(unittest.TestCase):
    def test_procesar_escribe_cuatro_artefactos(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            cliente = base / "cliente"
            cliente.mkdir()
            (cliente / "municipios.geojson").write_text(json.dumps({
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "properties": {"yvy_id": 1660063},
                              "geometry": {"type": "Point", "coordinates": [-65.2, -24.8]}}],
            }), encoding="utf8")
            salida = base / "salida"
            r = ingesta.procesar(cliente, salida, RAIZ / "data/ontologia.json")
            for nombre in ("inventario.json", "ontologia.csv", "ontologia.json", "plan.json"):
                self.assertTrue((salida / nombre).exists(), nombre)
            self.assertTrue(r["ontologia"]["roundtrip_ok"])
            self.assertEqual(json.loads((salida / "ontologia.json").read_text(encoding="utf8"))["schema"],
                             ingesta.leer_ontologia(RAIZ / "data/ontologia.json")["schema"])
            # dry-run no escribe
            otra = base / "otra"
            ingesta.procesar(cliente, otra, RAIZ / "data/ontologia.json", dry_run=True)
            self.assertFalse(otra.exists())


if __name__ == "__main__":
    unittest.main()
