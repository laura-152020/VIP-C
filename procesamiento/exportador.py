"""
Módulo de exportación de imágenes y generación de informes CSV.
Escribe las imágenes en disco conservando calidad nativa, organiza carpetas
sanitizadas para Windows y genera reportes detallados en formato 'utf-8-sig'.
"""

import csv
import io
from pathlib import Path
from typing import List, Dict, Optional, Callable, Any
from collections import defaultdict

from extractores.modelo import ImagenExtraida
from utilidades.archivos import sanitizar_nombre, asegurar_directorio, generar_ruta_no_colision, validar_directorio_escritura
from utilidades.registro import obtener_logger


COLUMNAS_CSV = [
    "Archivo de origen",
    "Tipo de documento",
    "Nombre original de la imagen",
    "Nombre exportado",
    "Página del PDF",
    "Hoja del Excel",
    "Celda inicial",
    "Celda final",
    "Extensión",
    "Ancho",
    "Alto",
    "Tamaño en bytes",
    "SHA-256",
    "Estado de extracción",
    "Ruta de destino",
    "Categoría detectada",
    "Score de confianza vial"
]


class ExportadorImagenes:
    """
    Gestiona la exportación física a disco y los informes de auditoría.
    """

    def __init__(self):
        self.logger = obtener_logger()

    def exportar(
        self,
        imagenes: List[ImagenExtraida],
        directorio_destino: str,
        organizar_por_documento: bool = True,
        omitir_duplicados_exactos: bool = False,
        sobrescribir_existentes: bool = False,
        callback_progreso: Optional[Callable[[int, int, str], None]] = None
    ) -> Dict[str, Any]:
        """
        Ejecuta la exportación de las imágenes seleccionadas y genera los informes CSV.
        """
        resumen = {
            "total_seleccionadas": 0,
            "exportadas": 0,
            "omitidas": 0,
            "duplicadas_omitidas": 0,
            "errores": 0,
            "carpeta_destino": str(directorio_destino or ""),
            "detalles_errores": []
        }

        # 1. Validar directorio de destino
        es_valido_dir, msg_error_dir = validar_directorio_escritura(directorio_destino)
        if not es_valido_dir:
            self.logger.error(f"Ruta de destino inválida: {msg_error_dir}")
            resumen["errores"] = 1
            resumen["detalles_errores"].append(msg_error_dir)
            return resumen

        dir_base = asegurar_directorio(directorio_destino)
        resumen["carpeta_destino"] = str(dir_base)

        imagenes_a_procesar = [img for img in imagenes if img.seleccionada]
        total = len(imagenes_a_procesar)
        resumen["total_seleccionadas"] = total

        if not imagenes:
            return resumen

        # Mapa para evitar re-exportar el mismo hash si se configuró omitir_duplicados_exactos
        hashes_exportados = set()
        
        # Agrupador para manifests por documento (incluye todas para auditoría)
        imagenes_por_doc: Dict[str, List[ImagenExtraida]] = defaultdict(list)
        contador_seleccionadas = 0

        for img in imagenes:
            # Caso 0: Imagen no seleccionada por el usuario (se audita como omitida)
            if not img.seleccionada:
                img.estado_extraccion = "Omitida (No seleccionada)"
                img.nombre_exportado = ""
                img.ruta_destino = ""
                resumen["omitidas"] += 1
                imagenes_por_doc[img.archivo_origen].append(img)
                continue

            contador_seleccionadas += 1
            if callback_progreso and total > 0:
                callback_progreso(contador_seleccionadas, total, f"Exportando imagen {contador_seleccionadas}/{total}...")

            doc_stem = sanitizar_nombre(Path(img.archivo_origen).stem)
            
            # Caso 1: Omitir si ya se exportó un archivo físico con exactamente el mismo hash
            if omitir_duplicados_exactos and img.hash_sha256 in hashes_exportados:
                img.estado_extraccion = "Omitida (Duplicada)"
                img.nombre_exportado = ""
                img.ruta_destino = ""
                resumen["duplicadas_omitidas"] += 1
                resumen["omitidas"] += 1
                imagenes_por_doc[img.archivo_origen].append(img)
                continue

            try:
                # Determinar carpeta de destino para esta imagen
                if organizar_por_documento:
                    subcarpeta_doc = dir_base / doc_stem / img.tipo_documento
                else:
                    subcarpeta_doc = dir_base

                asegurar_directorio(subcarpeta_doc)

                # Construir nombre base descriptivo
                ext = f".{img.formato.lstrip('.')}"
                nombre_orig_limpio = Path(img.nombre_original).stem

                if img.tipo_documento == "PDF":
                    if img.es_pagina_completa:
                        nombre_base = f"pagina_{img.pagina_pdf:03d}_completa"
                    else:
                        nombre_base = f"pagina_{img.pagina_pdf:03d}_{nombre_orig_limpio}"
                else:  # Excel
                    hoja_limpia = sanitizar_nombre(img.hoja_excel or "Hoja")
                    celda_info = f"celda_{img.celda_inicio}" if img.celda_inicio else "media"
                    nombre_base = f"{hoja_limpia}_{celda_info}_{nombre_orig_limpio}"

                # Si no se organiza por carpeta de documento, prefijar el documento para evitar colisiones
                if not organizar_por_documento:
                    nombre_base = f"{doc_stem}_{nombre_base}"

                if sobrescribir_existentes:
                    ruta_final = subcarpeta_doc / f"{sanitizar_nombre(nombre_base)}{ext}"
                else:
                    ruta_final = generar_ruta_no_colision(subcarpeta_doc, nombre_base, ext)

                # Escribir flujo binario original sin alteración
                with open(ruta_final, "wb") as f_out:
                    f_out.write(img.datos_binarios)

                img.estado_extraccion = "Exportada"
                img.nombre_exportado = ruta_final.name
                img.ruta_destino = str(ruta_final.resolve())
                hashes_exportados.add(img.hash_sha256)
                resumen["exportadas"] += 1

            except Exception as e_exp:
                msg_err = f"Fallo al guardar {img.id_imagen}: {str(e_exp)}"
                self.logger.error(msg_err)
                img.estado_extraccion = "Error"
                img.mensaje_error = str(e_exp)
                resumen["errores"] += 1
                resumen["detalles_errores"].append(msg_err)

            imagenes_por_doc[img.archivo_origen].append(img)

        # Generar informes CSV individuales por documento y resumen general
        self._generar_informes_csv(dir_base, imagenes_por_doc, organizar_por_documento)

        self.logger.info(
            f"Exportación finalizada: {resumen['exportadas']} exportadas, "
            f"{resumen['duplicadas_omitidas']} duplicadas omitidas, {resumen['errores']} errores."
        )

        return resumen

    def _generar_informes_csv(
        self,
        dir_base: Path,
        imagenes_por_doc: Dict[str, List[ImagenExtraida]],
        organizar_por_documento: bool
    ):
        """
        Escribe los archivos manifest.csv y resumen_general.csv en formato UTF-8 con BOM.
        """
        todas_imagenes: List[ImagenExtraida] = []

        for ruta_origen, lista_imgs in imagenes_por_doc.items():
            todas_imagenes.extend(lista_imgs)
            
            if organizar_por_documento:
                doc_stem = sanitizar_nombre(Path(ruta_origen).stem)
                carpeta_doc = dir_base / doc_stem
                asegurar_directorio(carpeta_doc)
                ruta_manifest = carpeta_doc / "manifest.csv"
                self._escribir_csv(ruta_manifest, lista_imgs)

        # Generar resumen general en la raíz de salida
        ruta_resumen_gral = dir_base / "resumen_general.csv"
        self._escribir_csv(ruta_resumen_gral, todas_imagenes)

    @staticmethod
    def _escribir_csv(ruta_csv: Path, lista_imgs: List[ImagenExtraida]):
        """Escribe una lista de imágenes en formato CSV compatible con Microsoft Excel (utf-8-sig)."""
        try:
            with open(ruta_csv, mode="w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=COLUMNAS_CSV)
                writer.writeheader()
                for img in lista_imgs:
                    writer.writerow({
                        "Archivo de origen": img.archivo_origen,
                        "Tipo de documento": img.tipo_documento,
                        "Nombre original de la imagen": img.nombre_original,
                        "Nombre exportado": img.nombre_exportado or "",
                        "Página del PDF": img.pagina_pdf if img.pagina_pdf else "",
                        "Hoja del Excel": img.hoja_excel or "",
                        "Celda inicial": img.celda_inicio or "",
                        "Celda final": img.celda_fin or "",
                        "Extensión": img.formato,
                        "Ancho": img.ancho,
                        "Alto": img.alto,
                        "Tamaño en bytes": img.tamano_bytes,
                        "SHA-256": img.hash_sha256,
                        "Estado de extracción": img.estado_extraccion,
                        "Ruta de destino": img.ruta_destino or "",
                        "Categoría detectada": img.categoria_detectada,
                        "Score de confianza vial": f"{img.score_confianza_vial}%"
                    })
        except Exception as e:
            obtener_logger().warning(f"Error escribiendo informe CSV en {ruta_csv}: {e}")
