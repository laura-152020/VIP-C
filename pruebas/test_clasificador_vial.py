"""
Prueba unitaria para verificar la precisión del clasificador de carreteras y naturaleza.
Evalúa las imágenes extraídas reales de PDF y Excel.
"""

import sys
import unittest
from pathlib import Path

DIRECTORIO_RAIZ = Path(__file__).resolve().parent.parent
if str(DIRECTORIO_RAIZ) not in sys.path:
    sys.path.insert(0, str(DIRECTORIO_RAIZ))

from extractores.extractor_pdf import ExtractorPDF
from extractores.extractor_excel import ExtractorExcel
from procesamiento.clasificador_vial import ClasificadorVialNaturaleza


class TestClasificadorVial(unittest.TestCase):

    def setUp(self):
        ruta_pdf_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "2026051307900.pdf"
        self.ruta_pdf = ruta_pdf_local if ruta_pdf_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\2026051307900.pdf")
        
        ruta_excel_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx"
        self.ruta_excel = ruta_excel_local if ruta_excel_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx")
        
        self.clasificador = ClasificadorVialNaturaleza(umbral_confianza=30.0)

    def test_clasificacion_excel(self):
        """Valida que en Excel se detecten las 6 fotos de campo y se descarten los logos de Rentan."""
        ext_excel = ExtractorExcel()
        doc = ext_excel.analizar_documento(str(self.ruta_excel))
        self.assertEqual(doc.estado, "Analizado")

        fotos_viales = 0
        logos_descartados = 0

        print("\n=== CLASIFICACIÓN EN EXCEL ===")
        for img in doc.imagenes:
            es_vial = self.clasificador.clasificar(img)
            print(f"[{img.categoria_detectada:22}] {img.nombre_original:12} | Conf: {img.score_confianza_vial:4.1f}% | {img.detalle_clasificacion}")
            
            if "image1" in img.nombre_original:  # Logo Rentan
                self.assertFalse(es_vial, f"El logo {img.nombre_original} no debe ser clasificado como carretera")
                logos_descartados += 1
            else:  # Fotos de inspección de campo (image2 a image7)
                self.assertTrue(es_vial, f"La foto {img.nombre_original} debe ser clasificada como carretera/naturaleza")
                fotos_viales += 1

        self.assertEqual(fotos_viales, 6, "Deben detectarse exactamente las 6 fotos viales en el Excel")
        self.assertEqual(logos_descartados, 2, "Deben descartarse las 2 instancias del logo de Rentan")
        print(f"-> Excel: {fotos_viales} fotos de carreteras/naturaleza detectadas, {logos_descartados} logos descartados.")

    def test_clasificacion_pdf(self):
        """Valida que en PDF se detecten las fotos de inspección vial y se descarten logos, banners y firmas."""
        ext_pdf = ExtractorPDF()
        doc = ext_pdf.analizar_documento(str(self.ruta_pdf))
        self.assertEqual(doc.estado, "Analizado")

        print("\n=== CLASIFICACIÓN EN PDF ===")
        conteo_viales = 0
        conteo_descartados = 0

        for img in doc.imagenes:
            es_vial = self.clasificador.clasificar(img)
            if es_vial:
                conteo_viales += 1
            else:
                conteo_descartados += 1

        print(f"-> PDF: {conteo_viales} fotos de carreteras/naturaleza detectadas, {conteo_descartados} elementos gráficos descartados.")
        # En el PDF hay 26 imágenes: los logos y banners aparecen en las 6 páginas (6 logos JERA + 6 banners = 12 descartes mínimos + firma + tabla = 14 descartes)
        # Las fotos viales individuales aparecen en las páginas 1, 2, 3, 4, 5, 6
        self.assertGreaterEqual(conteo_viales, 10, "Deben detectarse las fotografías viales del PDF")
        self.assertGreaterEqual(conteo_descartados, 12, "Deben descartarse todos los banners y logos de JERA")


if __name__ == "__main__":
    unittest.main()
