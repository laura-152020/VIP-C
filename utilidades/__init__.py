"""
Paquete de utilidades.
"""
from .archivos import sanitizar_nombre, asegurar_directorio, generar_ruta_no_colision, abrir_en_explorador
from .metadatos import calcular_sha256, formatear_tamano, formatear_dimensiones
from .registro import configurar_logger, obtener_logger
