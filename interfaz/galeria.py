"""
Módulo de la galería visual interactiva.
Renderiza una cuadrícula responsiva de imágenes con scroll vertical,
filtros avanzados y selección masiva.
"""

import tkinter as tk
from tkinter import ttk
from typing import List, Optional, Callable

from extractores.modelo import ImagenExtraida
from procesamiento.filtros import FiltroImagenes
from .componentes import TarjetaImagen
from .visor_imagen import VisorImagenModal


class GaleriaImagenes(ttk.Frame):
    """
    Contenedor principal de la galería de imágenes con herramientas de filtrado y selección.
    """

    def __init__(self, parent, al_cambiar_conteo_seleccion: Optional[Callable[[], None]] = None):
        super().__init__(parent)
        self.al_cambiar_conteo_seleccion = al_cambiar_conteo_seleccion

        self.imagenes_todas: List[ImagenExtraida] = []
        self.imagenes_visibles: List[ImagenExtraida] = []
        self.tarjetas_activas: List[TarjetaImagen] = []

        self.ancho_tarjeta = 175
        self.alto_tarjeta = 205

        self._construir_ui()

    def _construir_ui(self):
        # 1. Barra de Filtros y Búsqueda Superior
        frame_filtros = ttk.Frame(self, padding=(10, 8))
        frame_filtros.pack(fill=tk.X)

        # Filtro por tipo de contenido (Carreteras / Naturaleza vs Gráficos)
        ttk.Label(frame_filtros, text="Contenido:", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=(0, 4))
        self.var_filtro_categoria = tk.StringVar(value="Solo Carreteras / Naturaleza")
        self.combo_filtro_categoria = ttk.Combobox(
            frame_filtros,
            textvariable=self.var_filtro_categoria,
            values=["Solo Carreteras / Naturaleza", "Todos", "Solo Gráficos / Logos"],
            state="readonly",
            width=24
        )
        self.combo_filtro_categoria.pack(side=tk.LEFT, padx=(0, 12))
        self.combo_filtro_categoria.bind("<<ComboboxSelected>>", lambda e: self.aplicar_filtros())

        # Filtro por documento
        ttk.Label(frame_filtros, text="Documento:", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=(0, 4))
        self.var_filtro_doc = tk.StringVar(value="Todos")
        self.combo_filtro_doc = ttk.Combobox(
            frame_filtros,
            textvariable=self.var_filtro_doc,
            state="readonly",
            width=18
        )
        self.combo_filtro_doc.pack(side=tk.LEFT, padx=(0, 12))
        self.combo_filtro_doc.bind("<<ComboboxSelected>>", lambda e: self.aplicar_filtros())

        # Filtro por formato
        ttk.Label(frame_filtros, text="Formato:", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=(0, 4))
        self.var_filtro_formato = tk.StringVar(value="Todos")
        self.combo_filtro_formato = ttk.Combobox(
            frame_filtros,
            textvariable=self.var_filtro_formato,
            values=["Todos", "PNG", "JPG", "EMF", "WMF"],
            state="readonly",
            width=9
        )
        self.combo_filtro_formato.pack(side=tk.LEFT, padx=(0, 12))
        self.combo_filtro_formato.bind("<<ComboboxSelected>>", lambda e: self.aplicar_filtros())

        # Filtro de solo únicas
        self.var_solo_unicas = tk.BooleanVar(value=False)
        self.chk_solo_unicas = ttk.Checkbutton(
            frame_filtros,
            text="Ocultar duplicadas",
            variable=self.var_solo_unicas,
            command=self.aplicar_filtros
        )
        self.chk_solo_unicas.pack(side=tk.LEFT, padx=(0, 12))

        # Tamaño mínimo (filtro para iconos pequeños)
        ttk.Label(frame_filtros, text="Mín. px:", font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=(0, 4))
        self.var_tam_min = tk.StringVar(value="0")
        self.spin_tam_min = ttk.Spinbox(
            frame_filtros,
            from_=0,
            to=2000,
            increment=50,
            textvariable=self.var_tam_min,
            width=6,
            command=self.aplicar_filtros
        )
        self.spin_tam_min.pack(side=tk.LEFT, padx=(0, 12))
        self.spin_tam_min.bind("<Return>", lambda e: self.aplicar_filtros())

        # Botón restablecer filtros
        btn_reset_filtros = ttk.Button(
            frame_filtros,
            text="Restablecer",
            style="Secundario.TButton",
            command=self._restablecer_filtros
        )
        btn_reset_filtros.pack(side=tk.RIGHT)

        # 2. Barra de Acciones de Selección Masiva
        frame_acciones = ttk.Frame(self, padding=(10, 4))
        frame_acciones.pack(fill=tk.X)

        btn_sel_todas = ttk.Button(
            frame_acciones,
            text="✔ Seleccionar Todas",
            style="Secundario.TButton",
            command=self.seleccionar_todas
        )
        btn_sel_todas.pack(side=tk.LEFT, padx=(0, 6))

        btn_desel_todas = ttk.Button(
            frame_acciones,
            text="✖ Deseleccionar Todas",
            style="Secundario.TButton",
            command=self.deseleccionar_todas
        )
        btn_desel_todas.pack(side=tk.LEFT, padx=(0, 6))

        btn_invertir = ttk.Button(
            frame_acciones,
            text="⇄ Invertir Selección",
            style="Secundario.TButton",
            command=self.invertir_seleccion
        )
        btn_invertir.pack(side=tk.LEFT, padx=(0, 12))

        self.var_contador_galeria = tk.StringVar(value="0 imágenes")
        self.lbl_contador_galeria = ttk.Label(
            frame_acciones,
            textvariable=self.var_contador_galeria,
            font=("Segoe UI", 9, "bold"),
            foreground="#2563EB"
        )
        self.lbl_contador_galeria.pack(side=tk.RIGHT)

        ttk.Separator(self, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=(2, 0))

        # 3. Canvas y Scrollbar para la Cuadrícula
        self.frame_canvas = ttk.Frame(self)
        self.frame_canvas.pack(fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(self.frame_canvas, bg="#F1F5F9", highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self.frame_canvas, orient=tk.VERTICAL, command=self.canvas.yview)

        self.frame_grid = tk.Frame(self.canvas, bg="#F1F5F9")
        self.frame_grid_id = self.canvas.create_window((0, 0), window=self.frame_grid, anchor="nw")

        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Enlazar eventos de redimensionamiento y scroll acotado exclusivamente al área del canvas
        self.frame_grid.bind("<Configure>", self._on_frame_grid_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind("<Enter>", lambda e: self.canvas.bind_all("<MouseWheel>", self._on_mousewheel))
        self.canvas.bind("<Leave>", lambda e: self.canvas.unbind_all("<MouseWheel>"))

    def _on_frame_grid_configure(self, event=None):
        """Actualiza el área de scroll del canvas al cambiar el contenido."""
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        """Ajusta el ancho del frame_grid al ancho del canvas y recoloca tarjetas."""
        nuevo_ancho = event.width
        self.canvas.itemconfig(self.frame_grid_id, width=nuevo_ancho)
        self._reorganizar_cuadricula()

    def _on_mousewheel(self, event):
        """Permite desplazamiento fluido con la rueda del ratón."""
        # Evitar desplazamiento si no hay contenido scrollable
        if self.canvas.winfo_exists():
            self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    def cargar_imagenes(self, lista_imagenes: List[ImagenExtraida]):
        """Carga y muestra un nuevo lote de imágenes en la galería."""
        self.imagenes_todas = lista_imagenes
        self._actualizar_opciones_filtro_documentos()
        self.aplicar_filtros()

    def _actualizar_opciones_filtro_documentos(self):
        docs_unicos = sorted(list({img.nombre_archivo for img in self.imagenes_todas}))
        self.combo_filtro_doc["values"] = ["Todos"] + docs_unicos
        self.var_filtro_doc.set("Todos")

    def aplicar_filtros(self):
        """Aplica los filtros activos y reconstruye las tarjetas visibles."""
        doc_sel = self.var_filtro_doc.get()
        formato_sel = self.var_filtro_formato.get()
        categoria_sel = self.var_filtro_categoria.get()
        solo_unicas = self.var_solo_unicas.get()
        
        try:
            tam_min = int(self.var_tam_min.get() or "0")
        except ValueError:
            tam_min = 0

        self.imagenes_visibles = FiltroImagenes.filtrar(
            self.imagenes_todas,
            documento_filtro=doc_sel,
            formato_filtro=formato_sel,
            categoria_filtro=categoria_sel,
            ancho_min=tam_min,
            alto_min=tam_min,
            solo_unicas=solo_unicas
        )

        self._renderizar_galeria()
        self._actualizar_etiqueta_conteo()

    def _renderizar_galeria(self):
        """Destruye widgets anteriores y crea las tarjetas en la cuadrícula."""
        for t in self.tarjetas_activas:
            t.destroy()
        self.tarjetas_activas.clear()

        # Limpiar frame
        for child in self.frame_grid.winfo_children():
            child.destroy()

        if not self.imagenes_visibles:
            lbl_vacio = tk.Label(
                self.frame_grid,
                text="No hay imágenes para mostrar con los filtros seleccionados.\n(Analiza documentos o restablece los filtros)",
                font=("Segoe UI", 11),
                fg="#64748B",
                bg="#F1F5F9",
                pady=50
            )
            lbl_vacio.pack(fill=tk.BOTH, expand=True)
            return

        # Renderizado progresivo en lotes de 24 tarjetas para mantener la interfaz ultra fluida
        lote_tam = 24

        def render_lote(inicio_idx):
            fin_idx = min(inicio_idx + lote_tam, len(self.imagenes_visibles))
            for i in range(inicio_idx, fin_idx):
                img = self.imagenes_visibles[i]
                tarjeta = TarjetaImagen(
                    self.frame_grid,
                    imagen=img,
                    al_cambiar_seleccion=self._on_tarjeta_cambio_seleccion,
                    al_hacer_doble_clic=self._abrir_visor_modal
                )
                self.tarjetas_activas.append(tarjeta)

            self._reorganizar_cuadricula()

            if fin_idx < len(self.imagenes_visibles):
                self.after(10, lambda: render_lote(fin_idx))

        render_lote(0)

    def _reorganizar_cuadricula(self):
        """Calcula cuántas columnas caben según el ancho actual y posiciona las tarjetas."""
        if not self.tarjetas_activas:
            return

        ancho_disp = self.canvas.winfo_width() - 25
        if ancho_disp < 200:
            ancho_disp = 600

        cols = max(1, ancho_disp // self.ancho_tarjeta)

        for idx, tarjeta in enumerate(self.tarjetas_activas):
            fila = idx // cols
            col = idx % cols
            tarjeta.grid(row=fila, column=col, padx=6, pady=6, sticky="nw")

    def _on_tarjeta_cambio_seleccion(self, imagen: ImagenExtraida, estado: bool):
        self._actualizar_etiqueta_conteo()
        if self.al_cambiar_conteo_seleccion:
            self.al_cambiar_conteo_seleccion()

    def _abrir_visor_modal(self, imagen: ImagenExtraida):
        """Abre la ventana emergente de vista previa ampliada."""
        VisorImagenModal(self.winfo_toplevel(), imagen)

    def _actualizar_etiqueta_conteo(self):
        total_visibles = len(self.imagenes_visibles)
        total_todas = len(self.imagenes_todas)
        total_seleccionadas = sum(1 for img in self.imagenes_todas if img.seleccionada)
        
        texto = f"{total_visibles} de {total_todas} mostradas | {total_seleccionadas} seleccionadas para exportar"
        self.var_contador_galeria.set(texto)

    def seleccionar_todas(self):
        for img in self.imagenes_visibles:
            img.seleccionada = True
        for t in self.tarjetas_activas:
            t.fijar_seleccion(True)
        self._actualizar_etiqueta_conteo()
        if self.al_cambiar_conteo_seleccion:
            self.al_cambiar_conteo_seleccion()

    def deseleccionar_todas(self):
        for img in self.imagenes_visibles:
            img.seleccionada = False
        for t in self.tarjetas_activas:
            t.fijar_seleccion(False)
        self._actualizar_etiqueta_conteo()
        if self.al_cambiar_conteo_seleccion:
            self.al_cambiar_conteo_seleccion()

    def invertir_seleccion(self):
        for img in self.imagenes_visibles:
            img.seleccionada = not img.seleccionada
        for t in self.tarjetas_activas:
            t.fijar_seleccion(t.imagen.seleccionada)
        self._actualizar_etiqueta_conteo()
        if self.al_cambiar_conteo_seleccion:
            self.al_cambiar_conteo_seleccion()

    def _restablecer_filtros(self):
        self.var_filtro_categoria.set("Solo Carreteras / Naturaleza")
        self.var_filtro_doc.set("Todos")
        self.var_filtro_formato.set("Todos")
        self.var_solo_unicas.set(False)
        self.var_tam_min.set("0")
        self.aplicar_filtros()
