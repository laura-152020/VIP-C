"""
Módulo de utilidades para formateo y cálculo de metadatos de imágenes.
"""

import hashlib
from typing import Tuple


def calcular_sha256(datos_binarios: bytes) -> str:
    """Calcula el hash SHA-256 en formato hexadecimal de un flujo de bytes."""
    return hashlib.sha256(datos_binarios).hexdigest()


def formatear_tamano(tamano_bytes: int) -> str:
    """Formatea una cantidad de bytes a una cadena legible (B, KB, MB, GB)."""
    if tamano_bytes < 1024:
        return f"{tamano_bytes} B"
    elif tamano_bytes < 1024 * 1024:
        return f"{tamano_bytes / 1024:.1f} KB"
    elif tamano_bytes < 1024 * 1024 * 1024:
        return f"{tamano_bytes / (1024 * 1024):.2f} MB"
    else:
        return f"{tamano_bytes / (1024 * 1024 * 1024):.2f} GB"


def formatear_dimensiones(ancho: int, alto: int) -> str:
    """Retorna una cadena legible con las dimensiones de la imagen."""
    if ancho <= 0 or alto <= 0:
        return "Desconocido"
    return f"{ancho} x {alto} px"
