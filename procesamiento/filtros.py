"""
Módulo de filtros para catálogo y galería de imágenes.
Permite discriminar imágenes por documento, formato, dimensiones mínimas y estado de duplicado.
"""

from typing import List, Optional
from extractores.modelo import ImagenExtraida


class FiltroImagenes:
    """
    Aplica criterios de filtrado sobre colecciones de imágenes extraídas.
    """

    @staticmethod
    def filtrar(
        imagenes: List[ImagenExtraida],
        documento_filtro: Optional[str] = None,
        formato_filtro: Optional[str] = None,
        categoria_filtro: Optional[str] = None,
        ancho_min: int = 0,
        alto_min: int = 0,
        solo_unicas: bool = False,
        texto_busqueda: Optional[str] = None
    ) -> List[ImagenExtraida]:
        """
        Filtra la lista de imágenes según los criterios proporcionados.
        """
        resultado = []
        texto_busqueda_lower = texto_busqueda.strip().lower() if texto_busqueda else None

        for img in imagenes:
            # 1. Filtro por categoría (Carreteras/Naturaleza vs Gráficos)
            if categoria_filtro and categoria_filtro != "Todos":
                if categoria_filtro in ("Solo Carreteras / Naturaleza", "Carreteras / Naturaleza"):
                    if not img.es_carretera_o_naturaleza:
                        continue
                elif categoria_filtro in ("Solo Gráficos / Logos", "Gráficos / Logos"):
                    if img.es_carretera_o_naturaleza:
                        continue

            # 2. Filtro por documento
            if documento_filtro and documento_filtro != "Todos":
                if img.nombre_archivo != documento_filtro:
                    continue

            # 3. Filtro por formato (normaliza JPG/JPEG)
            if formato_filtro and formato_filtro != "Todos":
                fmt_img = "jpg" if img.formato.lower() in ("jpg", "jpeg") else img.formato.lower()
                fmt_filtro = "jpg" if formato_filtro.lower() in ("jpg", "jpeg") else formato_filtro.lower()
                if fmt_img != fmt_filtro:
                    continue

            # 4. Filtro por dimensiones mínimas
            if ancho_min > 0 and img.ancho < ancho_min:
                continue
            if alto_min > 0 and img.alto < alto_min:
                continue

            # 4. Filtro por duplicados
            if solo_unicas and img.es_duplicado:
                continue

            # 5. Búsqueda por texto (nombre, hoja, página, celda)
            if texto_busqueda_lower:
                cadena_buscable = (
                    f"{img.nombre_archivo} {img.nombre_original} "
                    f"pag {img.pagina_pdf or ''} hoja {img.hoja_excel or ''} "
                    f"celda {img.celda_inicio or ''} {img.celda_fin or ''}"
                ).lower()
                if texto_busqueda_lower not in cadena_buscable:
                    continue

            resultado.append(img)

        return resultado
