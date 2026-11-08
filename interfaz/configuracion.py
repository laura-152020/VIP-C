"""
Panel de configuración de extracción y exportación.
Permite definir rutas de salida, opciones de duplicados y jerarquía de carpetas.
"""

from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog

from utilidades.archivos import abrir_en_explorador, asegurar_directorio


class PanelConfiguracion(ttk.LabelFrame):
    """
    Control de opciones de exportación para la aplicación.
    """

    def __init__(self, parent, ruta_predeterminada: Path):
        super().__init__(parent, text="Opciones de Extracción y Destino", padding=12)
        self.ruta_predeterminada = ruta_predeterminada

        self._construir_ui()

    def _construir_ui(self):
        # 1. Selector de Carpeta de Destino
        frame_dir = ttk.Frame(self)
        frame_dir.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(frame_dir, text="Carpeta de destino:", font=("Segoe UI", 9, "bold")).pack(anchor=tk.W, pady=(0, 2))

        f_input = ttk.Frame(frame_dir)
        f_input.pack(fill=tk.X)

        self.var_ruta_destino = tk.StringVar(value=str(self.ruta_predeterminada))
        self.entry_ruta = ttk.Entry(f_input, textvariable=self.var_ruta_destino, font=("Segoe UI", 9))
        self.entry_ruta.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        btn_examinar = ttk.Button(
            f_input,
            text="Examinar...",
            style="Secundario.TButton",
            command=self._seleccionar_carpeta
        )
        btn_examinar.pack(side=tk.LEFT, padx=(0, 6))

        btn_abrir_dir = ttk.Button(
            f_input,
            text="📂 Abrir Carpeta",
            style="Secundario.TButton",
            command=self._abrir_carpeta_destino
        )
        btn_abrir_dir.pack(side=tk.LEFT)

        # 2. Opciones de Organización y Deduplicación
        f_opciones = ttk.Frame(self)
        f_opciones.pack(fill=tk.X, pady=(4, 0))

        # Columna Izquierda de Opciones
        f_col1 = ttk.Frame(f_opciones)
        f_col1.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.var_organizar_doc = tk.BooleanVar(value=True)
        chk_organizar = ttk.Checkbutton(
            f_col1,
            text="Organizar imágenes en carpetas por documento",
            variable=self.var_organizar_doc
        )
        chk_organizar.pack(anchor=tk.W, pady=3)

        self.var_conservar_formato = tk.BooleanVar(value=True)
        chk_formato = ttk.Checkbutton(
            f_col1,
            text="Conservar formato y resolución original",
            variable=self.var_conservar_formato
        )
        chk_formato.pack(anchor=tk.W, pady=3)

        self.var_sobrescribir = tk.BooleanVar(value=False)
        chk_sobrescribir = ttk.Checkbutton(
            f_col1,
            text="Sobrescribir archivos si ya existen",
            variable=self.var_sobrescribir
        )
        chk_sobrescribir.pack(anchor=tk.W, pady=3)

        # Columna Derecha de Opciones
        f_col2 = ttk.Frame(f_opciones)
        f_col2.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(15, 0))

        self.var_solo_carreteras = tk.BooleanVar(value=True)
        chk_solo_carreteras = ttk.Checkbutton(
            f_col2,
            text="🌲 Extraer solo fotos de carreteras y naturaleza (omitir logos/firmas)",
            variable=self.var_solo_carreteras
        )
        chk_solo_carreteras.pack(anchor=tk.W, pady=3)

        self.var_omitir_duplicados = tk.BooleanVar(value=True)
        chk_duplicados = ttk.Checkbutton(
            f_col2,
            text="Omitir duplicados exactos al exportar (guardar 1 copia física)",
            variable=self.var_omitir_duplicados
        )
        chk_duplicados.pack(anchor=tk.W, pady=3)

        self.var_exportar_pag_pdf = tk.BooleanVar(value=False)
        chk_pag_pdf = ttk.Checkbutton(
            f_col2,
            text="Exportar también páginas completas de PDF en PNG",
            variable=self.var_exportar_pag_pdf
        )
        chk_pag_pdf.pack(anchor=tk.W, pady=3)

    def _seleccionar_carpeta(self):
        dir_sel = filedialog.askdirectory(
            parent=self.winfo_toplevel(),
            title="Seleccionar carpeta de destino para las imágenes extraídas",
            initialdir=self.var_ruta_destino.get()
        )
        if dir_sel:
            self.var_ruta_destino.set(str(Path(dir_sel).resolve()))

    def _abrir_carpeta_destino(self):
        ruta = Path(self.var_ruta_destino.get())
        asegurar_directorio(ruta)
        abrir_en_explorador(ruta)

    def obtener_configuracion(self) -> dict:
        return {
            "ruta_destino": self.var_ruta_destino.get(),
            "organizar_por_documento": self.var_organizar_doc.get(),
            "conservar_formato": self.var_conservar_formato.get(),
            "sobrescribir_existentes": self.var_sobrescribir.get(),
            "omitir_duplicados_exactos": self.var_omitir_duplicados.get(),
            "solo_carreteras_naturaleza": self.var_solo_carreteras.get(),
            "exportar_paginas_pdf": self.var_exportar_pag_pdf.get()
        }
