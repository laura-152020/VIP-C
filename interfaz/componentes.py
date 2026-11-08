"""
Componentes gráficos reutilizables para la interfaz Tkinter / ttk:
tarjetas de imagen con miniaturas Pillow y tarjetas de métricas visuales.
"""

import io
import tkinter as tk
from tkinter import ttk
from typing import Callable, Optional
from PIL import Image, ImageTk

from extractores.modelo import ImagenExtraida
from utilidades.metadatos import formatear_tamano, formatear_dimensiones


class TarjetaMetrica(ttk.Frame):
    """
    Widget visual para presentar un indicador o estadística clave con fondo y color distintivo.
    """

    def __init__(self, parent, titulo: str, valor_inicial: str = "0", color_acento: str = "#2563EB"):
        super().__init__(parent, style="Blanco.TFrame")
        self.configure(padding=(12, 10))

        # Borde visual sutil
        self.canvas_borde = tk.Canvas(self, height=3, bg=color_acento, highlightthickness=0)
        self.canvas_borde.pack(fill=tk.X, side=tk.TOP, pady=(0, 6))

        self.lbl_titulo = tk.Label(
            self,
            text=titulo.upper(),
            font=("Segoe UI", 8, "bold"),
            fg="#64748B",
            bg="#FFFFFF"
        )
        self.lbl_titulo.pack(anchor=tk.W)

        self.var_valor = tk.StringVar(value=valor_inicial)
        self.lbl_valor = tk.Label(
            self,
            textvariable=self.var_valor,
            font=("Segoe UI", 16, "bold"),
            fg="#0F172A",
            bg="#FFFFFF"
        )
        self.lbl_valor.pack(anchor=tk.W, pady=(2, 0))

    def actualizar(self, nuevo_valor: any):
        self.var_valor.set(str(nuevo_valor))


class TarjetaImagen(tk.Frame):
    """
    Tarjeta interactiva que muestra una miniatura de la imagen, sus datos clave,
    un checkbox de selección y permite abrir el visor al hacer doble clic.
    """

    def __init__(
        self,
        parent,
        imagen: ImagenExtraida,
        al_cambiar_seleccion: Optional[Callable[[ImagenExtraida, bool], None]] = None,
        al_hacer_doble_clic: Optional[Callable[[ImagenExtraida], None]] = None
    ):
        super().__init__(parent, bg="#FFFFFF", highlightbackground="#E2E8F0", highlightthickness=1)
        self.imagen = imagen
        self.al_cambiar_seleccion = al_cambiar_seleccion
        self.al_hacer_doble_clic = al_hacer_doble_clic

        self._foto_tk = None
        self._construir_ui()

    def _construir_ui(self):
        # Cabecera con Checkbox y Badge de Duplicado
        frame_cabecera = tk.Frame(self, bg="#FFFFFF")
        frame_cabecera.pack(fill=tk.X, padx=6, pady=(6, 2))

        self.var_seleccion = tk.BooleanVar(value=self.imagen.seleccionada)
        self.chk_sel = ttk.Checkbutton(
            frame_cabecera,
            variable=self.var_seleccion,
            command=self._on_check_cambiado
        )
        self.chk_sel.pack(side=tk.LEFT)

        if self.imagen.es_duplicado:
            lbl_badge = tk.Label(
                frame_cabecera,
                text="DUPLICADA",
                font=("Segoe UI", 7, "bold"),
                bg="#FEF3C7",
                fg="#D97706",
                padx=3,
                pady=1
            )
            lbl_badge.pack(side=tk.RIGHT, padx=(2, 0))
        elif self.imagen.es_pagina_completa:
            lbl_badge = tk.Label(
                frame_cabecera,
                text="PÁG. COMPLETA",
                font=("Segoe UI", 7, "bold"),
                bg="#E0E7FF",
                fg="#4338CA",
                padx=3,
                pady=1
            )
            lbl_badge.pack(side=tk.RIGHT, padx=(2, 0))

        # Badge de Categoría Inteligente (Carretera/Naturaleza vs Gráfico)
        if self.imagen.es_carretera_o_naturaleza:
            lbl_cat = tk.Label(
                frame_cabecera,
                text="🌲 VIAL",
                font=("Segoe UI", 7, "bold"),
                bg="#DCFCE7",
                fg="#15803D",
                padx=3,
                pady=1
            )
            lbl_cat.pack(side=tk.RIGHT)
        else:
            lbl_cat = tk.Label(
                frame_cabecera,
                text="🎨 GRÁFICO",
                font=("Segoe UI", 7, "bold"),
                bg="#F1F5F9",
                fg="#64748B",
                padx=3,
                pady=1
            )
            lbl_cat.pack(side=tk.RIGHT)

        # Contenedor de miniatura
        self.lbl_imagen = tk.Label(self, bg="#F1F5F9", width=140, height=110)
        self.lbl_imagen.pack(padx=6, pady=4, fill=tk.BOTH, expand=True)
        self._cargar_miniatura()

        # Enlazar eventos de clic: clic en la miniatura abre el visor ampliado
        self.lbl_imagen.bind("<Button-1>", lambda e: self._on_doble_clic())
        self.lbl_imagen.bind("<Double-Button-1>", lambda e: self._on_doble_clic())

        # Información técnica inferior
        frame_info = tk.Frame(self, bg="#FFFFFF")
        frame_info.pack(fill=tk.X, padx=6, pady=(2, 6))

        # Origen (Doc y página/hoja)
        origen_txt = self._texto_origen_resumido()
        lbl_origen = tk.Label(
            frame_info,
            text=origen_txt,
            font=("Segoe UI", 8, "bold"),
            fg="#1E293B",
            bg="#FFFFFF",
            anchor="w",
            justify="left"
        )
        lbl_origen.pack(fill=tk.X)

        # Dimensiones y formato
        meta_txt = f"{self.imagen.formato.upper()} • {self.imagen.ancho}x{self.imagen.alto} • {formatear_tamano(self.imagen.tamano_bytes)}"
        lbl_meta = tk.Label(
            frame_info,
            text=meta_txt,
            font=("Segoe UI", 7),
            fg="#64748B",
            bg="#FFFFFF",
            anchor="w"
        )
        lbl_meta.pack(fill=tk.X)

    def _texto_origen_resumido(self) -> str:
        doc = self.imagen.nombre_archivo
        if len(doc) > 18:
            doc = doc[:15] + "..."
        if self.imagen.tipo_documento == "PDF":
            return f"{doc} (Pág. {self.imagen.pagina_pdf})"
        else:
            hoja = self.imagen.hoja_excel or "Hoja"
            if len(hoja) > 10:
                hoja = hoja[:8] + ".."
            celda = f" ({self.imagen.celda_inicio})" if self.imagen.celda_inicio else ""
            return f"{doc} [{hoja}{celda}]"

    def _cargar_miniatura(self):
        """Carga la miniatura pregenerada o genera una de respaldo."""
        try:
            bytes_img = self.imagen.miniatura_bytes or self.imagen.datos_binarios
            pil_img = Image.open(io.BytesIO(bytes_img))
            if not self.imagen.miniatura_bytes:
                pil_img.thumbnail((140, 110), Image.Resampling.BOX)
            self._foto_tk = ImageTk.PhotoImage(pil_img)
            self.lbl_imagen.configure(image=self._foto_tk)
        except Exception:
            self.lbl_imagen.configure(text="[Sin miniatura]", font=("Segoe UI", 8), fg="#64748B")

    def _on_check_cambiado(self):
        self.imagen.seleccionada = self.var_seleccion.get()
        if self.al_cambiar_seleccion:
            self.al_cambiar_seleccion(self.imagen, self.imagen.seleccionada)

    def _toggle_seleccion(self):
        nuevo_estado = not self.var_seleccion.get()
        self.var_seleccion.set(nuevo_estado)
        self._on_check_cambiado()

    def _on_doble_clic(self):
        if self.al_hacer_doble_clic:
            self.al_hacer_doble_clic(self.imagen)

    def fijar_seleccion(self, estado: bool):
        """Actualiza el estado visual y del modelo."""
        self.var_seleccion.set(estado)
        self.imagen.seleccionada = estado
