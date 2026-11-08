"""
Módulo clasificador para la detección de fotografías de carreteras, vías y naturaleza.
Discrimina automáticamente fotos reales de logotipos, banners gráficos,
firmas manuscritas y tablas escaneadas mediante visión computacional ligera (Pillow + NumPy).
"""

import io
from typing import Tuple, Dict, Any
from PIL import Image
import numpy as np

from extractores.modelo import ImagenExtraida
from utilidades.registro import obtener_logger


class ClasificadorVialNaturaleza:
    """
    Clasificador especializado en identificar fotografías de infraestructura vial,
    carreteras, obras, taludes y entorno natural frente a elementos gráficos documentales.
    """

    def __init__(self, umbral_confianza: float = 32.0):
        self.logger = obtener_logger()
        self.umbral_confianza = umbral_confianza

    def clasificar(self, imagen: ImagenExtraida) -> bool:
        """
        Evalúa una ImagenExtraida y actualiza sus campos de clasificación in-situ.
        Retorna True si es clasificada como Carretera/Naturaleza, False en caso contrario.
        """
        # 1. Reglas de Descarte Geométrico Inmediato
        es_valida_geo, razon_geo = self._validar_geometria(imagen.ancho, imagen.alto)
        if not es_valida_geo:
            imagen.es_carretera_o_naturaleza = False
            imagen.score_confianza_vial = 5.0
            imagen.categoria_detectada = "Gráfico / Logo / Firma"
            imagen.detalle_clasificacion = razon_geo
            return False

        # 2. Análisis Colorimétrico y Morfológico
        try:
            score, es_vial, detalle, thumb_bytes = self._analizar_contenido_imagen(imagen.datos_binarios)
            imagen.es_carretera_o_naturaleza = es_vial
            imagen.score_confianza_vial = round(score, 1)
            imagen.categoria_detectada = "Carretera / Naturaleza" if es_vial else "Gráfico / Logo / Firma"
            imagen.detalle_clasificacion = detalle
            imagen.miniatura_bytes = thumb_bytes
            return es_vial
        except Exception as e:
            self.logger.warning(f"Error analizando imagen {imagen.id_imagen} con clasificador vial: {e}")
            # En caso de error inesperado, clasificar con cautela
            imagen.es_carretera_o_naturaleza = False
            imagen.score_confianza_vial = 0.0
            imagen.categoria_detectada = "Error de análisis"
            imagen.detalle_clasificacion = f"Fallo en clasificador: {e}"
            return False

    def _validar_geometria(self, ancho: int, alto: int) -> Tuple[bool, str]:
        """Descarta firmas diminutas y banners excesivamente alargados."""
        if ancho < 130 or alto < 90:
            return False, f"Dimensión muy pequeña ({ancho}x{alto} px) - Típico de firma o icono"

        ratio = ancho / max(alto, 1)
        if ratio > 3.0:
            return False, f"Franja horizontal extrema (Relación {ratio:.1f}:1) - Típico de banner"
        if ratio < 0.33:
            return False, f"Franja vertical extrema (Relación 1:{1/ratio:.1f}) - Típico de cintillo"

        return True, "Geometría válida para fotografía"

    def _analizar_contenido_imagen(self, datos_binarios: bytes) -> Tuple[float, bool, str, bytes]:
        """
        Analiza la distribución cromática y textura en espacios RGB y HSV, y genera miniatura comprimida.
        """
        with Image.open(io.BytesIO(datos_binarios)) as img:
            # Procesar sobre miniatura rápida de 150x115 píxeles
            img_rgb = img.convert("RGB")
            thumb_rgb = img_rgb.resize((150, 115), Image.Resampling.BOX)
            
            # Generar buffer de miniatura para la interfaz
            buf = io.BytesIO()
            thumb_rgb.save(buf, format="JPEG", quality=75)
            thumb_bytes = buf.getvalue()

            arr_rgb = np.array(thumb_rgb, dtype=float)

            # Para evaluar si es fondo documental plano (logo/tabla/firma), medimos el blanco
            # en los 2/3 inferiores de la imagen para no penalizar cielos nublados en la parte superior.
            alto_h = arr_rgb.shape[0]
            zona_inferior_rgb = arr_rgb[int(alto_h * 0.33):, :, :]
            ratio_blanco_inferior = float(np.mean(np.all(zona_inferior_rgb > 238, axis=-1)))
            ratio_blanco_total = float(np.mean(np.all(arr_rgb > 238, axis=-1)))

            # Si más del 40% de la zona inferior es blanco plano, es logo con fondo, firma o tabla
            if ratio_blanco_inferior > 0.40:
                score_penalizado = max(0.0, 15.0 - (ratio_blanco_inferior * 20.0))
                return score_penalizado, False, f"Fondo blanco/documental predominante ({ratio_blanco_inferior*100:.1f}%)", thumb_bytes

            # Conversión a HSV para análisis cromático de entorno natural y vial
            thumb_hsv = thumb_rgb.convert("HSV")
            arr_hsv = np.array(thumb_hsv, dtype=float)
            h = arr_hsv[:, :, 0]
            s = arr_hsv[:, :, 1]
            v = arr_hsv[:, :, 2]

            # 1. Vegetación / Follaje / Bosque (Verdes)
            # En PIL HSV: H va de 0 a 255. Verde está aprox entre 30 y 95.
            mascara_verde = (h >= 30) & (h <= 95) & (s >= 25) & (v >= 20)
            ratio_verde = float(np.mean(mascara_verde))

            # 2. Terreno / Talud / Tierra / Roca (Ocres y Marrones)
            # H entre 10 y 30 con saturación media
            mascara_tierra = (h >= 10) & (h < 30) & (s >= 25) & (v >= 25)
            ratio_tierra = float(np.mean(mascara_tierra))

            # 3. Asfalto / Calzada / Pavimento (Tonos neutros grisáceos)
            # Baja saturación, luminosidad media
            mascara_asfalto = (s < 28) & (v >= 30) & (v <= 195)
            ratio_asfalto = float(np.mean(mascara_asfalto))

            # 4. Cielo despejado / Celestes
            # H entre 140 y 195
            mascara_cielo = (h >= 140) & (h <= 195) & (s >= 18) & (v >= 45)
            ratio_cielo = float(np.mean(mascara_cielo))

            # Cálculo de score ponderado (0 a 100%)
            suma_vial_natural = (ratio_verde * 1.3) + (ratio_asfalto * 1.1) + (ratio_tierra * 1.3) + (ratio_cielo * 0.8)
            score_bruto = (suma_vial_natural - (ratio_blanco_inferior * 1.5)) * 100.0
            score_final = float(np.clip(score_bruto, 0.0, 100.0))

            es_vial_o_natural = (score_final >= self.umbral_confianza)

            detalle = (
                f"Confianza: {score_final:.1f}% | "
                f"Vegetación: {ratio_verde*100:.1f}%, Asfalto: {ratio_asfalto*100:.1f}%, "
                f"Talud/Tierra: {ratio_tierra*100:.1f}%, Blanco: {ratio_blanco_total*100:.1f}%"
            )

            return score_final, es_vial_o_natural, detalle, thumb_bytes
