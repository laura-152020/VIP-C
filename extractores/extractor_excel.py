"""
Módulo de extracción de imágenes de archivos Excel (XLSX, XLSM).
Analiza directamente la estructura de paquetes OpenXML mediante zipfile y XML,
identificando hojas, dibujos, coordenadas de celdas y extrayendo los flujos binarios
originales sin capturas de pantalla ni recodificación.
"""

import io
import posixpath
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Callable
from PIL import Image

from .modelo import ImagenExtraida, DocumentoAnalizado
from utilidades.metadatos import calcular_sha256
from utilidades.registro import obtener_logger


# Espacios de nombres estándar de Office OpenXML
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_RELS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def columna_a_letra(col_idx: int) -> str:
    """Convierte un índice de columna base 0 a notación de letras Excel (0 -> A, 27 -> AB)."""
    resultado = ""
    col_idx += 1
    while col_idx > 0:
        col_idx, residuo = divmod(col_idx - 1, 26)
        resultado = chr(65 + residuo) + resultado
    return resultado


class ExtractorExcel:
    """
    Extractor de imágenes para hojas de cálculo Excel (XLSX, XLSM).
    Analiza la estructura ZIP y el árbol de relaciones XML para correlacionar
    hojas, dibujos, celdas y medios.
    """

    def __init__(self):
        self.logger = obtener_logger()

    def analizar_documento(
        self,
        ruta_archivo: str,
        callback_progreso: Optional[Callable[[int, int, str], None]] = None
    ) -> DocumentoAnalizado:
        """
        Analiza un archivo Excel XLSX/XLSM, extrayendo las imágenes originales y mapeando
        a qué hoja y coordenadas de celda pertenecen.
        """
        path_excel = Path(ruta_archivo)
        doc_analizado = DocumentoAnalizado(
            ruta_archivo=str(path_excel.resolve()),
            nombre_archivo=path_excel.name,
            tipo_documento="Excel"
        )

        if not path_excel.exists():
            doc_analizado.estado = "Error"
            doc_analizado.errores.append(f"El archivo no existe: {ruta_archivo}")
            return doc_analizado

        try:
            doc_analizado.tamano_bytes = path_excel.stat().st_size
            zf = zipfile.ZipFile(str(path_excel), "r")
        except Exception as e:
            self.logger.error(f"Error al abrir archivo Excel {path_excel.name}: {e}")
            doc_analizado.estado = "Error"
            doc_analizado.errores.append(f"No es un archivo ZIP/XLSX válido: {str(e)}")
            return doc_analizado

        with zf:
            try:
                # 1. Obtener lista de archivos en el contenedor
                nombres_archivos = set(zf.namelist())

                # 2. Mapear hojas desde xl/workbook.xml y xl/_rels/workbook.xml.rels
                mapa_hojas = self._mapear_hojas(zf, nombres_archivos)
                doc_analizado.total_paginas_o_hojas = len(mapa_hojas)
                doc_analizado.nombres_hojas = [h["nombre"] for h in mapa_hojas.values()]

                if callback_progreso:
                    callback_progreso(1, 3, "Mapeando estructura interna de hojas...")

                # 3. Mapear relaciones de hojas con archivos de dibujo (drawings)
                # target_dibujo -> nombre_hoja
                mapa_dibujos_a_hoja = self._mapear_dibujos_a_hojas(zf, mapa_hojas)

                if callback_progreso:
                    callback_progreso(2, 3, "Analizando relaciones de dibujos y celdas...")

                # 4. Analizar los archivos de dibujo para extraer anclajes de imágenes
                imagenes_mapeadas = self._analizar_dibujos(zf, mapa_dibujos_a_hoja, path_excel)

                # 5. Descubrir imágenes residuales en xl/media/ que no tengan anclaje formal
                todas_imagenes = self._agregar_imagenes_residuales(zf, imagenes_mapeadas, path_excel)

                doc_analizado.imagenes = todas_imagenes
                doc_analizado.estado = "Analizado"
                self.logger.info(
                    f"Excel '{path_excel.name}' analizado con éxito: {len(todas_imagenes)} imágenes detectadas."
                )

                if callback_progreso:
                    callback_progreso(3, 3, "Análisis de Excel completado")

                return doc_analizado

            except Exception as e_proc:
                self.logger.error(f"Error procesando estructura XML de Excel {path_excel.name}: {e_proc}")
                doc_analizado.estado = "Error"
                doc_analizado.errores.append(f"Error analizando estructura XML: {str(e_proc)}")
                return doc_analizado

    def _mapear_hojas(self, zf: zipfile.ZipFile, nombres: set) -> Dict[str, dict]:
        """
        Lee xl/workbook.xml y sus relaciones para asociar rId -> {nombre, ruta_sheet_xml, oculta}.
        """
        mapa = {}
        if "xl/workbook.xml" not in nombres or "xl/_rels/workbook.xml.rels" not in nombres:
            return mapa

        try:
            # Leer relaciones de workbook
            rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
            mapa_rels = {}
            for rel in rels_root.findall(f"{{{NS_RELS}}}Relationship"):
                r_id = rel.attrib.get("Id")
                target = rel.attrib.get("Target")
                if r_id and target:
                    # Normalizar ruta relativa (ej. worksheets/sheet1.xml -> xl/worksheets/sheet1.xml)
                    ruta_norm = posixpath.normpath(posixpath.join("xl", target))
                    mapa_rels[r_id] = ruta_norm

            # Leer workbook.xml
            wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
            sheets = wb_root.findall(f".//{{{NS_MAIN}}}sheet")
            for sheet in sheets:
                nombre = sheet.attrib.get("name", "Hoja")
                r_id = sheet.attrib.get(f"{{{NS_OFFICE_RELS}}}id")
                estado = sheet.attrib.get("state", "visible")
                es_oculta = estado in ("hidden", "veryHidden")

                if r_id and r_id in mapa_rels:
                    mapa[r_id] = {
                        "nombre": nombre,
                        "ruta_xml": mapa_rels[r_id],
                        "es_oculta": es_oculta
                    }
        except Exception as e:
            self.logger.warning(f"Error al mapear hojas del libro: {e}")

        return mapa

    def _mapear_dibujos_a_hojas(self, zf: zipfile.ZipFile, mapa_hojas: Dict[str, dict]) -> Dict[str, str]:
        """
        Para cada hoja, lee su archivo .rels correspondiente para saber a qué drawing*.xml apunta.
        Retorna: ruta_dibujo_xml -> nombre_hoja
        """
        mapa_dibujos = {}
        for hoja_info in mapa_hojas.values():
            ruta_sheet = hoja_info["ruta_xml"]
            dir_sheet, nombre_xml = posixpath.split(ruta_sheet)
            ruta_rels = posixpath.join(dir_sheet, "_rels", f"{nombre_xml}.rels")

            if ruta_rels in zf.namelist():
                try:
                    rels_root = ET.fromstring(zf.read(ruta_rels))
                    for rel in rels_root.findall(f"{{{NS_RELS}}}Relationship"):
                        tipo = rel.attrib.get("Type", "")
                        # Ignorar vmlDrawing (formas vectoriales heredadas para comentarios)
                        if "drawing" in tipo and "vmlDrawing" not in tipo:
                            target = rel.attrib.get("Target")
                            if target:
                                ruta_dibujo = posixpath.normpath(posixpath.join(dir_sheet, target))
                                mapa_dibujos[ruta_dibujo] = hoja_info["nombre"]
                except Exception as e:
                    self.logger.warning(f"Error leyendo {ruta_rels}: {e}")

        return mapa_dibujos

    def _analizar_dibujos(
        self,
        zf: zipfile.ZipFile,
        mapa_dibujos_a_hoja: Dict[str, str],
        path_excel: Path
    ) -> List[ImagenExtraida]:
        """
        Examina cada drawing*.xml y su .rels para ubicar coordenadas y vincular con xl/media/*.
        """
        imagenes: List[ImagenExtraida] = []
        contador = 1

        for ruta_dibujo, nombre_hoja in mapa_dibujos_a_hoja.items():
            if ruta_dibujo not in zf.namelist():
                continue

            dir_dibujo, nombre_d_xml = posixpath.split(ruta_dibujo)
            ruta_d_rels = posixpath.join(dir_dibujo, "_rels", f"{nombre_d_xml}.rels")

            # Mapa de rId a ruta de imagen en xl/media/
            mapa_media_rels = {}
            if ruta_d_rels in zf.namelist():
                try:
                    d_rels_root = ET.fromstring(zf.read(ruta_d_rels))
                    for rel in d_rels_root.findall(f"{{{NS_RELS}}}Relationship"):
                        r_id = rel.attrib.get("Id")
                        target = rel.attrib.get("Target")
                        if r_id and target and "image" in rel.attrib.get("Type", ""):
                            ruta_media = posixpath.normpath(posixpath.join(dir_dibujo, target))
                            mapa_media_rels[r_id] = ruta_media
                except Exception as e:
                    self.logger.warning(f"Error leyendo {ruta_d_rels}: {e}")

            # Analizar el XML del dibujo
            try:
                root_d = ET.fromstring(zf.read(ruta_dibujo))
                # Buscar twoCellAnchor, oneCellAnchor y absoluteAnchor
                anchors = root_d.findall(f".//{{{NS_DRAWING}}}twoCellAnchor") + \
                          root_d.findall(f".//{{{NS_DRAWING}}}oneCellAnchor") + \
                          root_d.findall(f".//{{{NS_DRAWING}}}absoluteAnchor")

                for anchor in anchors:
                    blips = anchor.findall(f".//{{{NS_A}}}blip")
                    if not blips:
                        continue

                    # Extraer coordenadas de anclaje (si están disponibles)
                    celda_inicio, celda_fin = self._extraer_celdas_anclaje(anchor)

                    for blip in blips:
                        embed_id = blip.attrib.get(f"{{{NS_OFFICE_RELS}}}embed")
                        if not embed_id or embed_id not in mapa_media_rels:
                            continue

                        ruta_media = mapa_media_rels[embed_id]
                        if ruta_media not in zf.namelist():
                            continue

                        # Leer bytes originales
                        img_bytes = zf.read(ruta_media)
                        nombre_archivo_media = posixpath.basename(ruta_media)
                        
                        # Obtener formato y dimensiones nativas con Pillow
                        formato, ancho, alto = self._inspeccionar_imagen(img_bytes, nombre_archivo_media)

                        sha256 = calcular_sha256(img_bytes)
                        id_img = f"XLS_{path_excel.stem}_h_{nombre_hoja}_{contador:03d}"

                        img_obj = ImagenExtraida(
                            id_imagen=id_img,
                            archivo_origen=str(path_excel.resolve()),
                            nombre_archivo=path_excel.name,
                            tipo_documento="Excel",
                            nombre_original=nombre_archivo_media,
                            formato=formato,
                            ancho=ancho,
                            alto=alto,
                            tamano_bytes=len(img_bytes),
                            hash_sha256=sha256,
                            datos_binarios=img_bytes,
                            hoja_excel=nombre_hoja,
                            celda_inicio=celda_inicio,
                            celda_fin=celda_fin,
                            seleccionada=True
                        )
                        imagenes.append(img_obj)
                        contador += 1

            except Exception as e_draw:
                self.logger.warning(f"Error procesando dibujo {ruta_dibujo}: {e_draw}")

        return imagenes

    def _extraer_celdas_anclaje(self, anchor_elem) -> Tuple[Optional[str], Optional[str]]:
        """Extrae las coordenadas de celda inicial y final (ej. 'A1', 'C4')."""
        celda_ini = None
        celda_fin = None

        from_elem = anchor_elem.find(f"{{{NS_DRAWING}}}from")
        if from_elem is not None:
            col_e = from_elem.find(f"{{{NS_DRAWING}}}col")
            row_e = from_elem.find(f"{{{NS_DRAWING}}}row")
            if col_e is not None and row_e is not None and col_e.text and row_e.text:
                try:
                    c = int(col_e.text)
                    r = int(row_e.text)
                    celda_ini = f"{columna_a_letra(c)}{r + 1}"
                except ValueError:
                    pass

        to_elem = anchor_elem.find(f"{{{NS_DRAWING}}}to")
        if to_elem is not None:
            col_e = to_elem.find(f"{{{NS_DRAWING}}}col")
            row_e = to_elem.find(f"{{{NS_DRAWING}}}row")
            if col_e is not None and row_e is not None and col_e.text and row_e.text:
                try:
                    c = int(col_e.text)
                    r = int(row_e.text)
                    celda_fin = f"{columna_a_letra(c)}{r + 1}"
                except ValueError:
                    pass

        return celda_ini, celda_fin

    def _agregar_imagenes_residuales(
        self,
        zf: zipfile.ZipFile,
        imagenes_existentes: List[ImagenExtraida],
        path_excel: Path
    ) -> List[ImagenExtraida]:
        """
        Garantiza que cualquier archivo de imagen en xl/media/ que no haya tenido
        anclaje XML en drawing*.xml sea recuperado.
        """
        nombres_ya_extraidos = {img.nombre_original for img in imagenes_existentes}
        todos_media = [
            n for n in zf.namelist() 
            if n.startswith("xl/media/") and not n.endswith("/")
        ]

        contador = len(imagenes_existentes) + 1
        for ruta_media in todos_media:
            nombre_base = posixpath.basename(ruta_media)
            if nombre_base in nombres_ya_extraidos:
                continue

            try:
                img_bytes = zf.read(ruta_media)
                formato, ancho, alto = self._inspeccionar_imagen(img_bytes, nombre_base)
                sha256 = calcular_sha256(img_bytes)
                id_img = f"XLS_{path_excel.stem}_media_{contador:03d}"

                img_obj = ImagenExtraida(
                    id_imagen=id_img,
                    archivo_origen=str(path_excel.resolve()),
                    nombre_archivo=path_excel.name,
                    tipo_documento="Excel",
                    nombre_original=nombre_base,
                    formato=formato,
                    ancho=ancho,
                    alto=alto,
                    tamano_bytes=len(img_bytes),
                    hash_sha256=sha256,
                    datos_binarios=img_bytes,
                    hoja_excel="Sin hoja asignada (xl/media)",
                    celda_inicio=None,
                    celda_fin=None,
                    seleccionada=True
                )
                imagenes_existentes.append(img_obj)
                contador += 1
            except Exception as e:
                self.logger.warning(f"Error al leer imagen residual {ruta_media}: {e}")

        return imagenes_existentes

    @staticmethod
    def _inspeccionar_imagen(img_bytes: bytes, nombre_archivo: str) -> Tuple[str, int, int]:
        """Identifica formato real y dimensiones en píxeles usando Pillow."""
        formato_fallback = Path(nombre_archivo).suffix.lstrip(".").lower()
        if formato_fallback in ("jpeg", "jpe"):
            formato_fallback = "jpg"
            
        try:
            with Image.open(io.BytesIO(img_bytes)) as im:
                ancho, alto = im.size
                formato = (im.format or formato_fallback).lower()
                if formato in ("jpeg", "jpe"):
                    formato = "jpg"
                return formato, ancho, alto
        except Exception:
            return formato_fallback, 0, 0
