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
    validar_rango, RANGO_YVY, PILOTO_KEYS, CATEGORIA_TIPO,
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
