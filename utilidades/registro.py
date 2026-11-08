"""
Módulo de registro y logging para la aplicación.
Registra eventos en consola y en el archivo logs/extractor.log.
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

_logger_configurado = False


def configurar_logger(directorio_logs: Path = None, nivel: int = logging.INFO) -> logging.Logger:
    """
    Configura y retorna el logger principal de la aplicación.
    Escribe tanto en consola (si está disponible) como en archivo de log rotativo.
    """
    global _logger_configurado
    logger = logging.getLogger("ExtractorImagenes")
    
    if _logger_configurado:
        return logger
        
    logger.setLevel(nivel)
    logger.propagate = False
    
    formato = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s:%(module)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Manejador de consola (solo si sys.stdout existe, e.g. terminal o modo desarrollo)
    if sys.stdout is not None:
        try:
            manejador_consola = logging.StreamHandler(sys.stdout)
            manejador_consola.setLevel(nivel)
            manejador_consola.setFormatter(formato)
            logger.addHandler(manejador_consola)
        except Exception:
            pass
    
    # Manejador de archivo rotativo (5 MB por archivo, hasta 3 respaldos)
    if directorio_logs is None:
        directorio_logs = Path(__file__).resolve().parent.parent / "logs"
        
    try:
        directorio_logs.mkdir(parents=True, exist_ok=True)
        archivo_log = directorio_logs / "extractor.log"
        manejador_archivo = RotatingFileHandler(
            str(archivo_log),
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8"
        )
        manejador_archivo.setLevel(nivel)
        manejador_archivo.setFormatter(formato)
        logger.addHandler(manejador_archivo)
    except Exception as e:
        logger.warning(f"No se pudo inicializar el archivo de registro en {directorio_logs}: {e}")
        
    _logger_configurado = True
    return logger


def obtener_logger() -> logging.Logger:
    """Retorna el logger configurado."""
    return logging.getLogger("ExtractorImagenes")
