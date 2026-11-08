"""
Módulo de detección y gestión de imágenes duplicadas mediante SHA-256.
"""

from typing import List, Dict
from extractores.modelo import ImagenExtraida
from utilidades.registro import obtener_logger


class GestorDuplicados:
    """
    Analiza una lista de imágenes extraídas para identificar duplicados exactos
    mediante comparación de hashes criptográficos SHA-256.
    """

    def __init__(self):
        self.logger = obtener_logger()

    def procesar_duplicados(self, imagenes: List[ImagenExtraida]) -> Dict[str, any]:
        """
        Clasifica las imágenes en originales y duplicadas.
        Marca 'es_duplicado' e 'id_original' in-situ sobre cada objeto ImagenExtraida.
        Retorna un resumen estadístico.
        """
        mapa_hashes: Dict[str, ImagenExtraida] = {}
        total_duplicados = 0
        total_unicas = 0

        for img in imagenes:
            h = img.hash_sha256
            if h in mapa_hashes:
                img.es_duplicado = True
                img.id_original = mapa_hashes[h].id_imagen
                total_duplicados += 1
            else:
                img.es_duplicado = False
                img.id_original = img.id_imagen
                mapa_hashes[h] = img
                total_unicas += 1

        self.logger.info(
            f"Deduplicación completada: {len(imagenes)} analizadas, "
            f"{total_unicas} únicas, {total_duplicados} duplicadas."
        )

        return {
            "total_imagenes": len(imagenes),
            "unicas": total_unicas,
            "duplicados": total_duplicados,
            "hashes_unicos": len(mapa_hashes)
        }

    @staticmethod
    def filtrar_unicas(imagenes: List[ImagenExtraida]) -> List[ImagenExtraida]:
        """Retorna únicamente la primera ocurrencia de cada imagen idéntica."""
        vistos = set()
        resultado = []
        for img in imagenes:
            if img.hash_sha256 not in vistos:
                vistos.add(img.hash_sha256)
                resultado.append(img)
        return resultado
