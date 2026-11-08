"""
Módulo de extracción de imágenes de archivos PDF utilizando PyMuPDF.
Recupera imágenes incrustadas en su resolución y formato original,
registrando metadatos técnicos y ubicación por página.
"""

from pathlib import Path
from typing import List, Optional, Tuple, Callable
import pymupdf as fitz

from .modelo import ImagenExtraida, DocumentoAnalizado
from utilidades.metadatos import calcular_sha256
from utilidades.registro import obtener_logger


class ExtractorPDF:
    """
    Extractor de alta fidelidad para documentos PDF.
    Identifica y extrae flujos de imagen crudos sin pérdida de resolución.
    """
    
    def __init__(self):
        self.logger = obtener_logger()

    def analizar_documento(
        self,
        ruta_archivo: str,
        callback_progreso: Optional[Callable[[int, int, str], None]] = None
    ) -> DocumentoAnalizado:
        """
        Analiza un archivo PDF e identifica todas las imágenes incrustadas página por página.
        No modifica el archivo original.
        """
        path_pdf = Path(ruta_archivo)
        doc_analizado = DocumentoAnalizado(
            ruta_archivo=str(path_pdf.resolve()),
            nombre_archivo=path_pdf.name,
            tipo_documento="PDF"
        )

        if not path_pdf.exists():
            doc_analizado.estado = "Error"
            doc_analizado.errores.append(f"El archivo no existe: {ruta_archivo}")
            return doc_analizado

        try:
            doc_analizado.tamano_bytes = path_pdf.stat().st_size
            doc = fitz.open(str(path_pdf))
        except Exception as e:
            self.logger.error(f"Error al abrir PDF {path_pdf.name}: {e}")
            doc_analizado.estado = "Error"
            doc_analizado.errores.append(f"Error al abrir PDF: {str(e)}")
            return doc_analizado

        try:
            total_paginas = len(doc)
            doc_analizado.total_paginas_o_hojas = total_paginas
            imagenes_detectadas: List[ImagenExtraida] = []
            
            # Cache de hashes y bytes para optimizar imágenes reutilizadas (xrefs)
            cache_xrefs = {}
            contador_imagen = 1

            for num_pagina in range(total_paginas):
                pagina_humana = num_pagina + 1
                if callback_progreso:
                    callback_progreso(pagina_humana, total_paginas, f"Analizando pág. {pagina_humana}/{total_paginas}")

                try:
                    pagina = doc[num_pagina]
                    lista_info_img = pagina.get_images(full=True)
                except Exception as e:
                    self.logger.warning(f"Error al leer imágenes de la pág {pagina_humana} en {path_pdf.name}: {e}")
                    doc_analizado.errores.append(f"Error en página {pagina_humana}: {str(e)}")
                    continue

                for info_img in lista_info_img:
                    xref = info_img[0]
                    smask = info_img[1]
                    ancho_info = info_img[2]
                    alto_info = info_img[3]
                    
                    try:
                        # Extraer o recuperar del cache
                        if xref in cache_xrefs:
                            datos_img = cache_xrefs[xref]
                        else:
                            # 1. Si tiene máscara de transparencia (smask), combinar pixmaps para PNG con canal alfa
                            if smask > 0:
                                try:
                                    pix_base = fitz.Pixmap(doc, xref)
                                    if pix_base.colorspace and pix_base.colorspace.n > 3:
                                        pix_base = fitz.Pixmap(fitz.csRGB, pix_base)
                                    mask_pix = fitz.Pixmap(doc, smask)
                                    pix_comb = fitz.Pixmap(pix_base, mask_pix)
                                    img_bytes = pix_comb.tobytes("png")
                                    ext = "png"
                                    ancho = pix_comb.width
                                    alto = pix_comb.height
                                except Exception:
                                    img_bytes = None
                            else:
                                img_bytes = None

                            # 2. Si no tenía smask o falló la combinación, extraer flujo directo
                            if not img_bytes:
                                extraida = doc.extract_image(xref)
                                colorspace = extraida.get("colorspace", 3) if extraida else 3
                                if not extraida or not extraida.get("image") or colorspace > 3:
                                    # Pixmap con conversión segura de CMYK u otros espacios a RGB
                                    pix = fitz.Pixmap(doc, xref)
                                    if pix.colorspace and pix.colorspace.n > 3:
                                        pix = fitz.Pixmap(fitz.csRGB, pix)
                                    img_bytes = pix.tobytes("png")
                                    ext = "png"
                                    ancho = pix.width
                                    alto = pix.height
                                else:
                                    img_bytes = extraida["image"]
                                    ext = extraida.get("ext", "png").lower()
                                    ancho = extraida.get("width", ancho_info)
                                    alto = extraida.get("height", alto_info)

                            # Normalizar extensión jpg
                            if ext in ("jpeg", "jpe"):
                                ext = "jpg"

                            sha256_hash = calcular_sha256(img_bytes)
                            tamano_bytes = len(img_bytes)
                            
                            datos_img = {
                                "bytes": img_bytes,
                                "ext": ext,
                                "ancho": ancho,
                                "alto": alto,
                                "sha256": sha256_hash,
                                "tamano": tamano_bytes
                            }
                            cache_xrefs[xref] = datos_img

                        id_img = f"PDF_{path_pdf.stem}_p{pagina_humana}_{contador_imagen:03d}"
                        
                        img_obj = ImagenExtraida(
                            id_imagen=id_img,
                            archivo_origen=str(path_pdf.resolve()),
                            nombre_archivo=path_pdf.name,
                            tipo_documento="PDF",
                            nombre_original=f"xref_{xref}",
                            formato=datos_img["ext"],
                            ancho=datos_img["ancho"],
                            alto=datos_img["alto"],
                            tamano_bytes=datos_img["tamano"],
                            hash_sha256=datos_img["sha256"],
                            datos_binarios=datos_img["bytes"],
                            pagina_pdf=pagina_humana,
                            seleccionada=True
                        )
                        
                        imagenes_detectadas.append(img_obj)
                        contador_imagen += 1

                    except Exception as e_img:
                        self.logger.warning(f"Error al extraer imagen xref {xref} en pág {pagina_humana}: {e_img}")
                        doc_analizado.errores.append(f"Página {pagina_humana}, xref {xref}: {str(e_img)}")

            doc_analizado.imagenes = imagenes_detectadas
            doc_analizado.estado = "Analizado"
            self.logger.info(
                f"PDF '{path_pdf.name}' analizado: {total_paginas} páginas, {len(imagenes_detectadas)} imágenes encontradas."
            )
            return doc_analizado

        except Exception as e_total:
            self.logger.error(f"Error procesando PDF {path_pdf.name}: {e_total}")
            doc_analizado.estado = "Error"
            doc_analizado.errores.append(f"Fallo general en análisis: {str(e_total)}")
            return doc_analizado
        finally:
            try:
                doc.close()
            except Exception:
                pass

    @staticmethod
    def renderizar_pagina_completa(ruta_archivo: str, numero_pagina: int, dpi: int = 150) -> Optional[ImagenExtraida]:
        """
        Exporta una página completa como imagen PNG en alta definición.
        Útil para páginas escaneadas o a solicitud del usuario.
        """
        path_pdf = Path(ruta_archivo)
        if not path_pdf.exists():
            return None
            
        doc = None
        try:
            doc = fitz.open(str(path_pdf))
            idx = numero_pagina - 1
            if idx < 0 or idx >= len(doc):
                return None
                
            pagina = doc[idx]
            pix = pagina.get_pixmap(dpi=dpi)
            img_bytes = pix.tobytes("png")
            hash_sha256 = calcular_sha256(img_bytes)
            
            id_img = f"PDF_{path_pdf.stem}_pag_completa_{numero_pagina:03d}"
            return ImagenExtraida(
                id_imagen=id_img,
                archivo_origen=str(path_pdf.resolve()),
                nombre_archivo=path_pdf.name,
                tipo_documento="PDF",
                nombre_original=f"pagina_{numero_pagina:03d}_render",
                formato="png",
                ancho=pix.width,
                alto=pix.height,
                tamano_bytes=len(img_bytes),
                hash_sha256=hash_sha256,
                datos_binarios=img_bytes,
                pagina_pdf=numero_pagina,
                es_pagina_completa=True,
                seleccionada=True
            )
        except Exception:
            return None
        finally:
            if doc:
                try:
                    doc.close()
                except Exception:
                    pass
