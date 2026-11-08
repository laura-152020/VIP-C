"""
Panel de carga y gestión de documentos (PDF, XLSX, XLSM).
Permite seleccionar archivos individualmente, por lotes o carpetas completas.
"""

from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from typing import List, Callable, Optional

from utilidades.metadatos import formatear_tamano

EXTENSIONES_PERMITIDAS = {".pdf", ".xlsx", ".xlsm"}


class PanelDocumentos(ttk.Frame):
    """
    Componente para la selección, inspección y descarte de archivos de entrada.
    """

    def __init__(self, parent, al_modificar_lista: Optional[Callable[[List[Path]], None]] = None):
        super().__init__(parent)
        self.al_modificar_lista = al_modificar_lista
        self.rutas_archivos: List[Path] = []

        self._construir_ui()

    def _construir_ui(self):
        # 1. Barra de herramientas superior
        frame_toolbar = ttk.Frame(self, padding=(0, 0, 0, 8))
        frame_toolbar.pack(fill=tk.X)

        btn_agregar_archivos = ttk.Button(
            frame_toolbar,
            text="➕ Agregar Archivo(s)",
            style="Secundario.TButton",
            command=self._agregar_archivos_dialogo
        )
        btn_agregar_archivos.pack(side=tk.LEFT, padx=(0, 6))

        btn_agregar_carpeta = ttk.Button(
            frame_toolbar,
            text="📁 Agregar Carpeta",
            style="Secundario.TButton",
            command=self._agregar_carpeta_dialogo
        )
        btn_agregar_carpeta.pack(side=tk.LEFT, padx=(0, 6))

        btn_eliminar = ttk.Button(
            frame_toolbar,
            text="🗑 Eliminar Seleccionado",
            style="Secundario.TButton",
            command=self._eliminar_seleccionado
        )
        btn_eliminar.pack(side=tk.LEFT, padx=(0, 6))

        btn_limpiar = ttk.Button(
            frame_toolbar,
            text="🧹 Limpiar Todo",
            style="Secundario.TButton",
            command=self._limpiar_todo
        )
        btn_limpiar.pack(side=tk.LEFT)

        self.lbl_total_docs = ttk.Label(
            frame_toolbar,
            text="0 documentos cargados",
            font=("Segoe UI", 9, "bold"),
            foreground="#64748B"
        )
        self.lbl_total_docs.pack(side=tk.RIGHT)

        # 2. Treeview de archivos con scrollbar
        frame_tree = ttk.Frame(self)
        frame_tree.pack(fill=tk.BOTH, expand=True)

        columnas = ("nombre", "tipo", "tamano", "ruta")
        self.tree = ttk.Treeview(
            frame_tree,
            columns=columnas,
            show="headings",
            selectmode="extended"
        )

        self.tree.heading("nombre", text="Nombre del Archivo")
        self.tree.heading("tipo", text="Tipo")
        self.tree.heading("tamano", text="Tamaño")
        self.tree.heading("ruta", text="Ruta Completa")

        self.tree.column("nombre", width=250, minwidth=150)
        self.tree.column("tipo", width=70, minwidth=50, anchor=tk.CENTER)
        self.tree.column("tamano", width=90, minwidth=70, anchor=tk.E)
        self.tree.column("ruta", width=400, minwidth=200)

        scrollbar_y = ttk.Scrollbar(frame_tree, orient=tk.VERTICAL, command=self.tree.yview)
        scrollbar_x = ttk.Scrollbar(frame_tree, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=scrollbar_y.set, xscrollcommand=scrollbar_x.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar_y.pack(side=tk.RIGHT, fill=tk.Y)
        scrollbar_x.pack(side=tk.BOTTOM, fill=tk.X)

    def _agregar_archivos_dialogo(self):
        """Abre diálogo para seleccionar uno o varios archivos PDF/Excel."""
        rutas = filedialog.askopenfilenames(
            parent=self.winfo_toplevel(),
            title="Seleccionar archivos PDF o Excel",
            filetypes=[
                ("Documentos compatibles (*.pdf, *.xlsx, *.xlsm)", "*.pdf *.xlsx *.xlsm"),
                ("Archivos PDF (*.pdf)", "*.pdf"),
                ("Archivos Excel (*.xlsx, *.xlsm)", "*.xlsx *.xlsm"),
                ("Todos los archivos", "*.*")
            ]
        )
        if rutas:
            self.agregar_rutas([Path(r) for r in rutas])

    def _agregar_carpeta_dialogo(self):
        """Abre diálogo para seleccionar una carpeta y busca documentos compatibles recursivamente."""
        directorio = filedialog.askdirectory(
            parent=self.winfo_toplevel(),
            title="Seleccionar carpeta con documentos"
        )
        if directorio:
            dir_path = Path(directorio)
            rutas_encontradas = []
            for ext in EXTENSIONES_PERMITIDAS:
                rutas_encontradas.extend(dir_path.rglob(f"*{ext}"))
            
            if rutas_encontradas:
                self.agregar_rutas(rutas_encontradas)
            else:
                messagebox.showinfo(
                    "Información",
                    "No se encontraron archivos PDF o Excel en la carpeta seleccionada.",
                    parent=self.winfo_toplevel()
                )

    def agregar_rutas(self, nuevas_rutas: List[Path]):
        """Agrega rutas válidas evitando duplicados en la lista de trabajo."""
        rutas_existentes = {p.resolve() for p in self.rutas_archivos}
        agregados = 0

        for r in nuevas_rutas:
            path_obj = Path(r).resolve()
            # Ignorar archivos temporales de bloqueo de Microsoft Office (~$*)
            if path_obj.name.startswith("~$"):
                continue

            if path_obj.suffix.lower() in EXTENSIONES_PERMITIDAS and path_obj.is_file():
                if path_obj not in rutas_existentes:
                    self.rutas_archivos.append(path_obj)
                    rutas_existentes.add(path_obj)
                    
                    tam = formatear_tamano(path_obj.stat().st_size)
                    tipo = path_obj.suffix.upper().replace(".", "")
                    self.tree.insert("", tk.END, values=(path_obj.name, tipo, tam, str(path_obj)))
                    agregados += 1

        self._actualizar_estado_lista()

    def _eliminar_seleccionado(self):
        """Elimina los elementos seleccionados en el Treeview."""
        seleccionados = self.tree.selection()
        if not seleccionados:
            return

        for item in seleccionados:
            valores = self.tree.item(item, "values")
            ruta_str = valores[3]
            self.rutas_archivos = [p for p in self.rutas_archivos if str(p) != ruta_str]
            self.tree.delete(item)

        self._actualizar_estado_lista()

    def _limpiar_todo(self):
        """Limpia todos los documentos de la lista."""
        if not self.rutas_archivos:
            return
        self.tree.delete(*self.tree.get_children())
        self.rutas_archivos.clear()
        self._actualizar_estado_lista()

    def _actualizar_estado_lista(self):
        total = len(self.rutas_archivos)
        self.lbl_total_docs.configure(text=f"{total} documento(s) cargado(s)")
        if self.al_modificar_lista:
            self.al_modificar_lista(self.rutas_archivos)

    def obtener_rutas(self) -> List[Path]:
        return list(self.rutas_archivos)
