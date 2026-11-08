"""
Modelos de datos unificados para el Extractor Inteligente de Imágenes.
Representa imágenes y documentos analizados de manera homogénea para PDF y Excel.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Any


@dataclass
class ImagenExtraida:
    """
    Representa una imagen incrustada extraída de un PDF o Excel.
    Contiene todos los metadatos técnicos, ubicación y contenido binario original.
    """
    id_imagen: str
    archivo_origen: str                      # Ruta completa del documento original
    nombre_archivo: str                     # Nombre con extensión del documento
    tipo_documento: str                     # 'PDF' o 'Excel'
    nombre_original: str                    # Identificador o nombre interno (ej. xref_14, image1.png)
    formato: str                            # 'png', 'jpeg', 'jpg', 'wmf', etc.
    ancho: int                              # Ancho nativo en píxeles
    alto: int                               # Alto nativo en píxeles
    tamano_bytes: int                       # Tamaño exacto en bytes
    hash_sha256: str                        # Hash SHA-256 de los bytes originales
    datos_binarios: bytes                   # Contenido binario sin recodificar
    
    # Metadatos de ubicación específicos
    pagina_pdf: Optional[int] = None        # Número de página en PDF (base 1)
    hoja_excel: Optional[str] = None        # Nombre de la hoja en Excel
    celda_inicio: Optional[str] = None      # Celda de anclaje inicial (ej. 'B5')
    celda_fin: Optional[str] = None         # Celda de anclaje final (ej. 'E12')
    
    # Control de duplicados y selección en interfaz
    es_duplicado: bool = False              # True si su hash coincide con otra previa
    id_original: Optional[str] = None       # ID de la primera imagen con el mismo hash
    seleccionada: bool = True               # Para checkboxes en la galería
    es_pagina_completa: bool = False        # Indica si es render de página completa (PDF)
    
    # Clasificación inteligente de contenido
    es_carretera_o_naturaleza: bool = False # True si corresponde a vías, carreteras o naturaleza
    score_confianza_vial: float = 0.0       # Puntuación 0.0 a 100.0%
    categoria_detectada: str = "Sin clasificar" # 'Carretera / Naturaleza' o 'Gráfico / Logo / Firma'
    detalle_clasificacion: str = ""         # Resumen colorimétrico explicativo
    miniatura_bytes: Optional[bytes] = None # Thumbnail pre-generado para renderizado ultra rápido en GUI
    
    # Metadatos de exportación
    nombre_exportado: Optional[str] = None  # Nombre final de guardado
    estado_extraccion: str = "Pendiente"    # 'Pendiente', 'Exportada', 'Omitida', 'Error'
    ruta_destino: Optional[str] = None      # Ruta absoluta final guardada en disco
    mensaje_error: Optional[str] = None     # Detalle en caso de fallo


@dataclass
class DocumentoAnalizado:
    """
    Representa el resultado del análisis estructural de un archivo PDF o Excel.
    """
    ruta_archivo: str
    nombre_archivo: str
    tipo_documento: str                     # 'PDF' o 'Excel'
    tamano_bytes: int = 0
    total_paginas_o_hojas: int = 0
    nombres_hojas: List[str] = field(default_factory=list)
    imagenes: List[ImagenExtraida] = field(default_factory=list)
    errores: List[str] = field(default_factory=list)
    estado: str = "Pendiente"               # 'Pendiente', 'Analizado', 'Error'
