"""Tests mínimos de yvy_plantilla.py (solo funciones puras, sin geopandas).

Correr en Colab:  !python -m unittest tools.test_plantilla -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yvy_plantilla import (
    norm_txt, limpiar_txt, to_int, to_float,
    yvy_id_provincia, yvy_id_depto, yvy_id_municipio, yvy_id_barrio,
    yvy_id_barrio_libre, validar_rango, RANGO_YVY, BLOQUES_RESERVADOS,
    TOPE_BARRIOS, PILOTO_KEYS, CATEGORIA_TIPO,
)


class TestTexto(unittest.TestCase):
    def test_norm_txt(self):
        self.assertEqual(norm_txt("San Lorenzo"), "san lorenzo")
        self.assertEqual(norm_txt("Orán"), "oran")
        self.assertEqual(norm_txt(None), "")

    def test_limpiar_txt_nunca_nan(self):
        self.assertIsNone(limpiar_txt(float("nan")))
        self.assertIsNone(limpiar_txt("-"))
        self.assertEqual(limpiar_txt(" Salta "), "Salta")

    def test_to_int_miles(self):
        self.assertEqual(to_int("5,371"), 5371)
        self.assertEqual(to_int("5.371"), 5371)
        self.assertIsNone(to_int("-"))
        self.assertIsNone(to_int(None))

    def test_to_float_coma_decimal(self):
        self.assertAlmostEqual(to_float("100,0134 ha"), 100.0134)
        self.assertIsNone(to_float("-"))


class TestYvyId(unittest.TestCase):
    def test_esquema_1_mas_cod(self):
        self.assertEqual(yvy_id_provincia("66"), 1066)
        self.assertEqual(yvy_id_depto("66028"), 166028)
        self.assertEqual(yvy_id_municipio("660070"), 1660070)
        self.assertEqual(yvy_id_barrio(1660063, 1), 1660063001)

    def test_rangos(self):
        self.assertTrue(validar_rango(1066, "provincia"))
        self.assertTrue(validar_rango(166028, "departamento"))
        self.assertTrue(validar_rango(1660070, "municipio"))
        self.assertTrue(validar_rango(1660063001, "barrio"))
        self.assertFalse(validar_rango(166, "provincia"))
        for nivel, (lo, hi) in RANGO_YVY.items():
            self.assertLess(lo, hi, nivel)

    def test_prefijo_barrio(self):
        yid, pid = 1660063127, 1660063
        self.assertTrue(str(yid).startswith(str(pid)))

    def test_barrio_libre_es_append_only(self):
        muni = 1660063
        ocupados = {muni * 1000 + 1, muni * 1000 + 2, muni * 1000 + 3}
        self.assertEqual(yvy_id_barrio_libre(muni, ocupados), muni * 1000 + 4)
        # Un hueco en el medio se rellena, pero nada se renumera.
        con_hueco = {muni * 1000 + 1, muni * 1000 + 3}
        self.assertEqual(yvy_id_barrio_libre(muni, con_hueco), muni * 1000 + 2)

    def test_barrio_desborde(self):
        muni = 1660063
        ocupados = {muni * 1000 + s for s in range(1, 1000)}
        nuevo = yvy_id_barrio_libre(muni, ocupados)
        self.assertGreaterEqual(nuevo, 2000000000)
        self.assertLessEqual(nuevo, 2999999999)
        self.assertTrue(validar_rango(nuevo, "barrio"))

    def test_bloque_reservado_municipio_es_valido(self):
        self.assertTrue(validar_rango(2000001, "municipio"))
        self.assertFalse(validar_rango(9000000001, "municipio"))


class TestContrato(unittest.TestCase):
    def test_piloto_keys_canonicas(self):
        self.assertEqual(PILOTO_KEYS,
                         {"pais": "pais", "provincia": "provincia",
                          "departamento": "deptos", "municipio": "municipios",
                          "barrio": "barrios"})

    def test_categorias_vocabulario(self):
        for t in ("demografia", "mineria", "catastro", "escuelas", "salud"):
            self.assertIn(t, CATEGORIA_TIPO)
        self.assertEqual(
            set(CATEGORIA_TIPO.values()),
            {"Sociedad", "Economía", "Ambiente", "Infraestructura"})


if __name__ == "__main__":
    unittest.main()
