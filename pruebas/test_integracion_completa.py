"""
Prueba de integración integral de extremo a extremo.
Valida el flujo completo de análisis, deduplicación, exportación estructurada y generación de informes CSV
utilizando los dos archivos reales de prueba simultáneamente.
"""

import sys
import unittest
import tempfile
import csv
from pathlib import Path

# Añadir el directorio raíz de Version 1 al sys.path
DIRECTORIO_RAIZ = Path(__file__).resolve().parent.parent
if str(DIRECTORIO_RAIZ) not in sys.path:
    sys.path.insert(0, str(DIRECTORIO_RAIZ))

from extractores.extractor_pdf import ExtractorPDF
from extractores.extractor_excel import ExtractorExcel
from procesamiento.duplicados import GestorDuplicados
from procesamiento.clasificador_vial import ClasificadorVialNaturaleza
from procesamiento.exportador import ExportadorImagenes, COLUMNAS_CSV
from utilidades.archivos import asegurar_directorio


class TestIntegracionCompleta(unittest.TestCase):

    def setUp(self):
        ruta_pdf_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "2026051307900.pdf"
        self.ruta_pdf = ruta_pdf_local if ruta_pdf_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\2026051307900.pdf")
        
        ruta_excel_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx"
        self.ruta_excel = ruta_excel_local if ruta_excel_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx")
        
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_resultados = Path(self.temp_dir.name)

        # Guardar timestamps y tamaños originales para garantizar que no se alteren
        self.pdf_stat_original = (self.ruta_pdf.stat().st_size, self.ruta_pdf.stat().st_mtime)
        self.excel_stat_original = (self.ruta_excel.stat().st_size, self.ruta_excel.stat().st_mtime)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_flujo_completo(self):
        print("\n========================================================")
        print("  INICIANDO PRUEBA DE INTEGRACIÓN COMPLETA (E2E)")
        print("========================================================")

        # 1. Verificación de archivos
        self.assertTrue(self.ruta_pdf.exists(), "El archivo PDF debe existir")
        self.assertTrue(self.ruta_excel.exists(), "El archivo Excel debe existir")

        # 2. Análisis de PDF
        ext_pdf = ExtractorPDF()
        doc_pdf = ext_pdf.analizar_documento(str(self.ruta_pdf))
        self.assertEqual(doc_pdf.estado, "Analizado")
        self.assertEqual(doc_pdf.total_paginas_o_hojas, 6)
        print(f"1. PDF analizado: {len(doc_pdf.imagenes)} imágenes encontradas en 6 páginas.")

        # 3. Análisis de Excel
        ext_excel = ExtractorExcel()
        doc_excel = ext_excel.analizar_documento(str(self.ruta_excel))
        self.assertEqual(doc_excel.estado, "Analizado")
        self.assertEqual(doc_excel.total_paginas_o_hojas, 4)
        print(f"2. Excel analizado: {len(doc_excel.imagenes)} imágenes encontradas en 4 hojas.")

        # 4. Agrupación y Deduplicación
        todas_imagenes = doc_pdf.imagenes + doc_excel.imagenes
        gestor_dup = GestorDuplicados()
        stats_dup = gestor_dup.procesar_duplicados(todas_imagenes)
        print(f"3. Deduplicación SHA-256: {stats_dup['unicas']} únicas, {stats_dup['duplicados']} duplicadas.")

        # 5. Clasificación Inteligente de Carreteras y Naturaleza
        clasificador = ClasificadorVialNaturaleza()
        total_viales = 0
        total_graficos = 0
        for img in todas_imagenes:
            es_vial = clasificador.clasificar(img)
            if es_vial:
                total_viales += 1
            else:
                total_graficos += 1

        print(f"4. Clasificación de contenido: {total_viales} Carreteras/Naturaleza, {total_graficos} Gráficos/Logos/Firmas descartados.")
        self.assertEqual(total_viales, 18, "Deben detectarse 18 fotos viales en total (12 de PDF + 6 de Excel)")
        self.assertEqual(total_graficos, 16, "Deben descartarse 16 elementos gráficos (14 de PDF + 2 de Excel)")

        # Preseleccionar solo carreteras y naturaleza (como hace la interfaz)
        for img in todas_imagenes:
            img.seleccionada = img.es_carretera_o_naturaleza

        # 6. Exportación a disco respetando la selección manual
        exportador = ExportadorImagenes()
        resumen_exp = exportador.exportar(
            imagenes=todas_imagenes,
            directorio_destino=str(self.dir_resultados),
            organizar_por_documento=True,
            omitir_duplicados_exactos=True,
            sobrescribir_existentes=True
        )

        print(f"5. Exportación finalizada: {resumen_exp['exportadas']} fotografías de carreteras/naturaleza guardadas.")
        print(f"   Duplicadas omitidas: {resumen_exp['duplicadas_omitidas']}")
        print(f"   Errores: {resumen_exp['errores']}")
        self.assertEqual(resumen_exp["errores"], 0, "No debe haber errores de exportación")
        self.assertEqual(resumen_exp["exportadas"], 18, "Deben exportarse exactamente las 18 fotos viales")

        # 6. Verificación de archivos generados en disco
        resumen_csv = self.dir_resultados / "resumen_general.csv"
        self.assertTrue(resumen_csv.exists(), "Debe existir resumen_general.csv")

        # Validar estructura y codificación del CSV (debe poder leerse con utf-8-sig)
        with open(resumen_csv, mode="r", encoding="utf-8-sig") as f:
            lector = csv.DictReader(f)
            columnas_leidas = lector.fieldnames
            self.assertEqual(columnas_leidas, COLUMNAS_CSV, "Las columnas del CSV deben coincidir con la especificación")
            filas = list(lector)
            self.assertEqual(len(filas), len(todas_imagenes), "El resumen CSV debe listar todas las imágenes encontradas")

        print(f"5. Verificación de resumen_general.csv: OK ({len(filas)} registros)")

        # 7. Verificar carpetas de documentos
        carpetas_hijas = [p for p in self.dir_resultados.iterdir() if p.is_dir()]
        self.assertGreaterEqual(len(carpetas_hijas), 2, "Deben existir al menos dos subcarpetas (una por doc)")
        
        for carpeta in carpetas_hijas:
            manifest = carpeta / "manifest.csv"
            self.assertTrue(manifest.exists(), f"Debe existir manifest.csv en {carpeta.name}")
            print(f"   Carpeta: {carpeta.name} -> manifest.csv presente.")

        # 8. Comprobar integridad absoluta de los archivos de prueba originales
        self.assertEqual(self.ruta_pdf.stat().st_size, self.pdf_stat_original[0], "El PDF original no debe cambiar de tamaño")
        self.assertEqual(self.ruta_pdf.stat().st_mtime, self.pdf_stat_original[1], "El PDF original no debe modificarse")

        self.assertEqual(self.ruta_excel.stat().st_size, self.excel_stat_original[0], "El Excel original no debe cambiar de tamaño")
        self.assertEqual(self.ruta_excel.stat().st_mtime, self.excel_stat_original[1], "El Excel original no debe modificarse")
        print("6. Verificación de integridad de archivos originales: INTACTOS (100% garantizado)")

        print("========================================================")
        print("  TODAS LAS VERIFICACIONES E2E PASARON CON ÉXITO")
        print("========================================================\n")


if __name__ == "__main__":
    unittest.main()
