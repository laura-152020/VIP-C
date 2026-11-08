"""
Script de prueba unitaria para validar la extracción de imágenes en Excel (XLSX).
Documento de prueba: C:\\Users\\juand\\OneDrive\\Escritorio\\EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx
"""

import sys
import unittest
import tempfile
from pathlib import Path

# Añadir el directorio raíz de Version 1 al sys.path
DIRECTORIO_RAIZ = Path(__file__).resolve().parent.parent
if str(DIRECTORIO_RAIZ) not in sys.path:
    sys.path.insert(0, str(DIRECTORIO_RAIZ))

from extractores.extractor_excel import ExtractorExcel
from utilidades.metadatos import formatear_tamano


class TestExtractorExcel(unittest.TestCase):
    
    def setUp(self):
        ruta_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx"
        self.ruta_excel = ruta_local if ruta_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx")
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_salida = Path(self.temp_dir.name)
        self.extractor = ExtractorExcel()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_archivo_existe(self):
        """Verifica que el archivo Excel de prueba exista."""
        self.assertTrue(self.ruta_excel.exists(), f"El archivo no existe en {self.ruta_excel}")

    def test_extraccion_imagenes_excel(self):
        """Ejecuta el análisis y verifica la extracción de imágenes y metadatos de Excel."""
        print(f"\n[PRUEBA EXCEL] Analizando archivo: {self.ruta_excel.name}")
        resultado = self.extractor.analizar_documento(str(self.ruta_excel))
        
        self.assertEqual(resultado.estado, "Analizado", f"Fallo al analizar: {resultado.errores}")
        self.assertEqual(resultado.total_paginas_o_hojas, 4, "El Excel debe tener 4 hojas")
        
        print(f"-> Total hojas detectadas: {resultado.total_paginas_o_hojas}")
        print(f"-> Nombres de hojas: {resultado.nombres_hojas}")
        print(f"-> Total objetos de imagen detectados: {len(resultado.imagenes)}")

        # Debe haber detectado imágenes (la especificación menciona 7 archivos de imagen internos)
        self.assertGreaterEqual(len(resultado.imagenes), 7, "Debe detectar al menos 7 imágenes")

        hashes_unicos = set()
        for idx, img in enumerate(resultado.imagenes, 1):
            hashes_unicos.add(img.hash_sha256)
            celdas = f"[{img.celda_inicio or 'N/A'} -> {img.celda_fin or 'N/A'}]"
            nombre_salida = f"test_{idx:02d}_{img.nombre_original}"
            ruta_guardado = self.dir_salida / nombre_salida
            with open(ruta_guardado, "wb") as f:
                f.write(img.datos_binarios)
            
            print(
                f"   Img #{idx:02d} | Hoja: {img.hoja_excel} | Celdas: {celdas} | "
                f"Formato: {img.formato} | {img.ancho}x{img.alto} px | "
                f"Tamaño: {formatear_tamano(img.tamano_bytes)} | SHA: {img.hash_sha256[:10]}..."
            )
            self.assertTrue(ruta_guardado.exists())
            self.assertEqual(ruta_guardado.stat().st_size, img.tamano_bytes)

        print(f"-> Imágenes únicas encontradas por SHA-256: {len(hashes_unicos)}")
        print(f"-> Archivos exportados en: {self.dir_salida}")


if __name__ == "__main__":
    unittest.main()
