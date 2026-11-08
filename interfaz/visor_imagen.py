"""
Ventana modal para visualizar imágenes ampliadas y examinar sus metadatos técnicos.
"""

import io
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk

from extractores.modelo import ImagenExtraida
from utilidades.metadatos import formatear_tamano, formatear_dimensiones
from utilidades.archivos import sanitizar_nombre


class VisorImagenModal(tk.Toplevel):
    """
    Ventana emergente que muestra la imagen en alta resolución con todos sus metadatos.
    """

    def __init__(self, parent: tk.Tk, imagen: ImagenExtraida):
        super().__init__(parent)
        self.imagen = imagen
        self.title(f"Vista previa: {imagen.nombre_original} - {imagen.nombre_archivo}")
        self.geometry("900x700")
        self.minsize(600, 500)
        self.configure(bg="#F8FAFC")

        # Mantener referencia a la imagen de Pillow para evitar recolección de basura
        self._foto_tk = None

        self._construir_ui()
        self.transient(parent)
        self.grab_set()

    def _construir_ui(self):
        # 1. Contenedor principal
        frame_top = ttk.Frame(self, padding=12)
        frame_top.pack(fill=tk.BOTH, expand=True)

        # 2. Área izquierda: Visor de Imagen
        frame_canvas = ttk.Frame(frame_top)
        frame_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 10))

        self.canvas_img = tk.Canvas(frame_canvas, bg="#0F172A", highlightthickness=0)
        self.canvas_img.pack(fill=tk.BOTH, expand=True)
        self.canvas_img.bind("<Configure>", lambda e: self._actualizar_imagen_en_canvas())

        # 3. Área derecha: Panel de Metadatos
        frame_meta = ttk.Frame(frame_top, width=320)
        frame_meta.pack(side=tk.RIGHT, fill=tk.Y, padx=(10, 0))
        frame_meta.pack_propagate(False)

        ttk.Label(frame_meta, text="Metadatos Técnicos", font=("Segoe UI", 12, "bold")).pack(anchor=tk.W, pady=(0, 10))

        datos = [
            ("Documento origen:", self.imagen.nombre_archivo),
            ("Tipo de documento:", self.imagen.tipo_documento),
            ("Identificador interno:", self.imagen.nombre_original),
            ("Ubicación:", self._obtener_ubicacion_texto()),
            ("Clasificación de contenido:", f"{self.imagen.categoria_detectada} (Confianza: {self.imagen.score_confianza_vial}%)"),
            ("Diagnóstico visual:", self.imagen.detalle_clasificacion or "Analizado"),
            ("Formato:", self.imagen.formato.upper()),
            ("Dimensiones nativas:", formatear_dimensiones(self.imagen.ancho, self.imagen.alto)),
            ("Tamaño en bytes:", f"{formatear_tamano(self.imagen.tamano_bytes)} ({self.imagen.tamano_bytes:,} B)"),
            ("Es duplicado:", "Sí (idéntico por SHA-256)" if self.imagen.es_duplicado else "No (imagen única)"),
            ("SHA-256:", self.imagen.hash_sha256)
        ]

        for etiqueta, valor in datos:
            f_dato = ttk.Frame(frame_meta)
            f_dato.pack(fill=tk.X, pady=4)
            ttk.Label(f_dato, text=etiqueta, font=("Segoe UI", 8, "bold"), foreground="#475569").pack(anchor=tk.W)
            # Entrada de solo lectura para poder copiar SHA-256 fácilmente
            if etiqueta == "SHA-256:":
                entry_sha = ttk.Entry(f_dato, font=("Segoe UI", 8))
                entry_sha.insert(0, valor)
                entry_sha.configure(state="readonly")
                entry_sha.pack(fill=tk.X, pady=(2, 0))
            else:
                lbl_val = ttk.Label(f_dato, text=str(valor), font=("Segoe UI", 9), wraplength=300)
                lbl_val.pack(anchor=tk.W)

        ttk.Separator(frame_meta, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=15)

        # Botón para guardar solo esta imagen
        btn_guardar = ttk.Button(
            frame_meta,
            text="💾 Guardar esta imagen como...",
            command=self._guardar_imagen_individual
        )
        btn_guardar.pack(fill=tk.X, pady=6)

        # Botón cerrar
        btn_cerrar = ttk.Button(
            frame_meta,
            text="Cerrar",
            command=self.destroy
        )
        btn_cerrar.pack(fill=tk.X, pady=6)

    def _obtener_ubicacion_texto(self) -> str:
        if self.imagen.tipo_documento == "PDF":
            return f"Página {self.imagen.pagina_pdf}"
        else:
            celda = f"Celdas: {self.imagen.celda_inicio or '?'}"
            if self.imagen.celda_fin:
                celda += f" a {self.imagen.celda_fin}"
            return f"Hoja '{self.imagen.hoja_excel or 'N/A'}' ({celda})"

    def _actualizar_imagen_en_canvas(self):
        """Redimensiona y centra la imagen en el canvas manteniendo aspect ratio."""
        w_canv = self.canvas_img.winfo_width()
        h_canv = self.canvas_img.winfo_height()
        if w_canv < 20 or h_canv < 20:
            return

        try:
            pil_img = Image.open(io.BytesIO(self.imagen.datos_binarios))
            orig_w, orig_h = pil_img.size

            # Calcular escala manteniendo aspecto
            escala = min((w_canv - 20) / orig_w, (h_canv - 20) / orig_h)
            nuevo_w = max(1, int(orig_w * escala))
            nuevo_h = max(1, int(orig_h * escala))

            # Redimensionar usando Lanczos
            img_res = pil_img.resize((nuevo_w, nuevo_h), Image.Resampling.LANCZOS)
            self._foto_tk = ImageTk.PhotoImage(img_res)

            self.canvas_img.delete("all")
            x = w_canv // 2
            y = h_canv // 2
            self.canvas_img.create_image(x, y, image=self._foto_tk, anchor=tk.CENTER)
        except Exception:
            self.canvas_img.delete("all")
            self.canvas_img.create_text(
                w_canv // 2, h_canv // 2,
                text="No se pudo previsualizar la imagen",
                fill="white", font=("Segoe UI", 11)
            )

    def _guardar_imagen_individual(self):
        """Permite guardar individualmente la imagen con un diálogo nativo."""
        ext = f".{self.imagen.formato.lstrip('.')}"
        nombre_propuesto = f"{sanitizar_nombre(Path(self.imagen.archivo_origen).stem)}_{self.imagen.nombre_original}{ext}"
        
        ruta = filedialog.asksaveasfilename(
            parent=self,
            title="Guardar imagen",
            initialfile=nombre_propuesto,
            defaultextension=ext,
            filetypes=[(f"Imagen {self.imagen.formato.upper()}", f"*{ext}"), ("Todos los archivos", "*.*")]
        )
        if ruta:
            try:
                with open(ruta, "wb") as f:
                    f.write(self.imagen.datos_binarios)
                messagebox.showinfo("Éxito", f"Imagen guardada correctamente en:\n{ruta}", parent=self)
            except Exception as e:
                messagebox.showerror("Error", f"No se pudo guardar la imagen: {e}", parent=self)
