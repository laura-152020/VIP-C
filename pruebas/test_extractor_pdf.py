"""
Script de prueba unitaria para validar la extracción de imágenes en PDF.
Documento de prueba: C:\\Users\\juand\\OneDrive\\Escritorio\\2026051307900.pdf
"""

import sys
import unittest
import tempfile
from pathlib import Path

# Añadir el directorio raíz de Version 1 al sys.path
DIRECTORIO_RAIZ = Path(__file__).resolve().parent.parent
if str(DIRECTORIO_RAIZ) not in sys.path:
    sys.path.insert(0, str(DIRECTORIO_RAIZ))

from extractores.extractor_pdf import ExtractorPDF
from utilidades.metadatos import formatear_tamano


class TestExtractorPDF(unittest.TestCase):
    
    def setUp(self):
        ruta_local = DIRECTORIO_RAIZ / "pruebas" / "datos" / "2026051307900.pdf"
        self.ruta_pdf = ruta_local if ruta_local.exists() else Path(r"C:\Users\juand\OneDrive\Escritorio\2026051307900.pdf")
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_salida = Path(self.temp_dir.name)
        self.extractor = ExtractorPDF()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_archivo_existe(self):
        """Verifica que el archivo PDF de prueba esté accesible."""
        self.assertTrue(self.ruta_pdf.exists(), f"El archivo de prueba no existe en {self.ruta_pdf}")

    def test_extraccion_imagenes_pdf(self):
        """Ejecuta el análisis y verifica la extracción de imágenes del PDF."""
        print(f"\n[PRUEBA PDF] Analizando archivo: {self.ruta_pdf.name}")
        resultado = self.extractor.analizar_documento(str(self.ruta_pdf))
        
        self.assertEqual(resultado.estado, "Analizado", f"Fallo al analizar: {resultado.errores}")
        self.assertEqual(resultado.total_paginas_o_hojas, 6, "El PDF debe tener 6 páginas")
        self.assertGreater(len(resultado.imagenes), 0, "Debe encontrar al menos una imagen incrustada")
        
        print(f"-> Total páginas analizadas: {resultado.total_paginas_o_hojas}")
        print(f"-> Total objetos de imagen detectados: {len(resultado.imagenes)}")

        # Contabilizar apariciones y hashes únicos
        hashes_unicos = set()
        for idx, img in enumerate(resultado.imagenes, 1):
            hashes_unicos.add(img.hash_sha256)
            nombre_salida = f"test_p{img.pagina_pdf:02d}_{idx:02d}_{img.nombre_original}.{img.formato}"
            ruta_guardado = self.dir_salida / nombre_salida
            with open(ruta_guardado, "wb") as f:
                f.write(img.datos_binarios)
            
            print(
                f"   Img #{idx:02d} | Pág: {img.pagina_pdf} | "
                f"Formato: {img.formato} | {img.ancho}x{img.alto} px | "
                f"Tamaño: {formatear_tamano(img.tamano_bytes)} | SHA: {img.hash_sha256[:10]}..."
            )
            self.assertTrue(ruta_guardado.exists())
            self.assertEqual(ruta_guardado.stat().st_size, img.tamano_bytes)

        print(f"-> Imágenes únicas encontradas por SHA-256: {len(hashes_unicos)}")
        print(f"-> Archivos exportados en: {self.dir_salida}")


if __name__ == "__main__":
    unittest.main()
