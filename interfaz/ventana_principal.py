"""
Ventana Principal del Extractor Inteligente de Imágenes.
Orquesta los extractores, la deduplicación, la galería visual y la exportación
mediante una arquitectura multihilo asíncrona y segura.
"""

from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import ttk, messagebox
from tkinter.scrolledtext import ScrolledText
from typing import List, Dict

from extractores.modelo import ImagenExtraida, DocumentoAnalizado
from extractores.extractor_pdf import ExtractorPDF
from extractores.extractor_excel import ExtractorExcel
from procesamiento.duplicados import GestorDuplicados
from procesamiento.exportador import ExportadorImagenes
from procesamiento.clasificador_vial import ClasificadorVialNaturaleza
from utilidades.archivos import asegurar_directorio, abrir_en_explorador
from utilidades.registro import configurar_logger, obtener_logger

from .estilos import aplicar_estilos_modernos
from .componentes import TarjetaMetrica
from .panel_documentos import PanelDocumentos
from .galeria import GaleriaImagenes
from .configuracion import PanelConfiguracion


class VentanaPrincipal(tk.Tk):
    """
    Aplicación de escritorio para la extracción masiva de imágenes de PDF y Excel.
    """

    def __init__(self, ruta_raiz: Path):
        super().__init__()
        self.ruta_raiz = ruta_raiz
        self.ruta_resultados = self.ruta_raiz / "resultados"
        asegurar_directorio(self.ruta_resultados)

        self.logger = configurar_logger(self.ruta_raiz / "logs")
        self.logger.info("Iniciando Extractor Inteligente de Imágenes...")

        # Configuración básica de la ventana
        self.title("Extractor Inteligente de Imágenes • PDF y Excel")
        self.geometry("1100x750")
        self.minsize(900, 600)

        # Aplicar tema y estilos personalizados
        self.estilos = aplicar_estilos_modernos(self)

        # Estado y datos de la aplicación
        self.documentos_cargados: List[DocumentoAnalizado] = []
        self.todas_imagenes: List[ImagenExtraida] = []
        self.gestor_duplicados = GestorDuplicados()
        self.exportador = ExportadorImagenes()

        # Cola de comunicación entre hilos
        self.cola_eventos = queue.Queue()
        self.hilo_trabajo = None
        self.cancelar_operacion = False

        self._construir_ui()
        self._iniciar_escucha_cola()

    def _construir_ui(self):
        # 1. Encabezado principal
        frame_header = ttk.Frame(self, padding=(15, 12))
        frame_header.pack(fill=tk.X)

        lbl_titulo = ttk.Label(
            frame_header,
            text="Extractor Inteligente de Imágenes",
            font=("Segoe UI", 16, "bold"),
            foreground="#1E293B"
        )
        lbl_titulo.pack(anchor=tk.W)

        lbl_subtitulo = ttk.Label(
            frame_header,
            text="Recupera imágenes incrustadas en formato y resolución nativa desde archivos PDF y Excel (XLSX/XLSM)",
            font=("Segoe UI", 9),
            foreground="#64748B"
        )
        lbl_subtitulo.pack(anchor=tk.W, pady=(2, 0))

        # 2. Barra de Métricas Visuales
        frame_metricas = ttk.Frame(self, padding=(15, 0, 15, 10))
        frame_metricas.pack(fill=tk.X)

        self.card_docs = TarjetaMetrica(frame_metricas, "Documentos", "0", "#2563EB")
        self.card_docs.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        self.card_encontradas = TarjetaMetrica(frame_metricas, "Imágenes Encontradas", "0", "#3B82F6")
        self.card_encontradas.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        self.card_unicas = TarjetaMetrica(frame_metricas, "Imágenes Únicas", "0", "#10B981")
        self.card_unicas.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        self.card_duplicadas = TarjetaMetrica(frame_metricas, "Duplicados Detectados", "0", "#F59E0B")
        self.card_duplicadas.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        self.card_errores = TarjetaMetrica(frame_metricas, "Errores de Lectura", "0", "#EF4444")
        self.card_errores.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # 3. Pestañas de Trabajo (Notebook)
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=15, pady=(0, 10))

        # Pestaña 1: Carga y Configuración
        frame_tab1 = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame_tab1, text="  📁 Documentos y Configuración  ")

        self.panel_documentos = PanelDocumentos(
            frame_tab1,
            al_modificar_lista=self._al_modificar_lista_documentos
        )
        self.panel_documentos.pack(fill=tk.BOTH, expand=True, pady=(0, 10))

        self.panel_configuracion = PanelConfiguracion(frame_tab1, self.ruta_resultados)
        self.panel_configuracion.pack(fill=tk.X)

        # Pestaña 2: Galería de Imágenes
        frame_tab2 = ttk.Frame(self.notebook)
        self.notebook.add(frame_tab2, text="  🖼 Galería de Imágenes  ")

        self.galeria = GaleriaImagenes(
            frame_tab2,
            al_cambiar_conteo_seleccion=self._actualizar_estadisticas_interfaz
        )
        self.galeria.pack(fill=tk.BOTH, expand=True)

        # Pestaña 3: Registro de Actividad (Logs)
        frame_tab3 = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame_tab3, text="  📝 Registro de Actividad  ")

        self.txt_log = ScrolledText(
            frame_tab3,
            wrap=tk.WORD,
            bg="#0F172A",
            fg="#F8FAFC",
            font=("Consolas", 9),
            insertbackground="white"
        )
        self.txt_log.pack(fill=tk.BOTH, expand=True)

        # 4. Barra Inferior de Estado y Controles de Acción
        frame_bottom = ttk.Frame(self, padding=(15, 6, 15, 12))
        frame_bottom.pack(fill=tk.X)

        # Fila superior de la barra inferior: Progreso y Estado
        f_prog = ttk.Frame(frame_bottom)
        f_prog.pack(fill=tk.X, pady=(0, 8))

        self.var_estado = tk.StringVar(value="Listo para comenzar. Agrega documentos y presiona 'Analizar'.")
        self.lbl_estado = ttk.Label(
            f_prog,
            textvariable=self.var_estado,
            font=("Segoe UI", 9),
            foreground="#334155"
        )
        self.lbl_estado.pack(side=tk.LEFT, fill=tk.X, expand=True)

        self.progressbar = ttk.Progressbar(f_prog, orient=tk.HORIZONTAL, mode="determinate", length=250)
        self.progressbar.pack(side=tk.RIGHT)

        # Fila inferior: Botones de Acción
        f_botones = ttk.Frame(frame_bottom)
        f_botones.pack(fill=tk.X)

        self.btn_analizar = ttk.Button(
            f_botones,
            text="🔍 ANALIZAR DOCUMENTOS",
            style="Primario.TButton",
            command=self.iniciar_analisis
        )
        self.btn_analizar.pack(side=tk.LEFT, padx=(0, 10))

        self.btn_exportar = ttk.Button(
            f_botones,
            text="🚀 INICIAR EXTRACCIÓN",
            style="Exito.TButton",
            command=self.iniciar_extraccion
        )
        self.btn_exportar.pack(side=tk.LEFT, padx=(0, 10))
        self.btn_exportar.state(["disabled"])

        self.btn_abrir_resultados = ttk.Button(
            f_botones,
            text="📂 Abrir Carpeta de Resultados",
            style="Secundario.TButton",
            command=self._abrir_carpeta_resultados
        )
        self.btn_abrir_resultados.pack(side=tk.LEFT)

    def _agregar_log_ui(self, mensaje: str):
        """Escribe un mensaje en el visor de logs de la pestaña 3."""
        self.txt_log.insert(tk.END, f"{mensaje}\n")
        self.txt_log.see(tk.END)

    def _al_modificar_lista_documentos(self, lista_rutas: List[Path]):
        self.card_docs.actualizar(len(lista_rutas))

    def _iniciar_escucha_cola(self):
        """Sondeo periódico de la cola en el hilo principal de Tkinter."""
        self._procesar_cola()

    def _procesar_cola(self):
        try:
            while True:
                evento = self.cola_eventos.get_nowait()
                tipo = evento.get("tipo")
                datos = evento.get("datos", {})

                if tipo == "ESTADO":
                    self.var_estado.set(datos.get("mensaje", ""))
                    self._agregar_log_ui(datos.get("mensaje", ""))

                elif tipo == "PROGRESO":
                    actual = datos.get("actual", 0)
                    total = datos.get("total", 1)
                    porcentaje = int((actual / max(total, 1)) * 100)
                    self.progressbar["value"] = porcentaje

                elif tipo == "ANALISIS_DOC_COMPLETADO":
                    doc: DocumentoAnalizado = datos.get("documento")
                    self.documentos_cargados.append(doc)
                    self._agregar_log_ui(
                        f"✔ Analizado '{doc.nombre_archivo}': {len(doc.imagenes)} imágenes encontradas."
                    )

                elif tipo == "ANALISIS_FINALIZADO":
                    self._on_analisis_finalizado(datos)

                elif tipo == "EXPORTACION_FINALIZADA":
                    self._on_exportacion_finalizada(datos)

                elif tipo == "ERROR":
                    msg = datos.get("mensaje", "Ocurrió un error inesperado")
                    self._agregar_log_ui(f"❌ ERROR: {msg}")
                    self._bloquear_ui_durante_proceso(False)
                    messagebox.showerror("Error", msg, parent=self)

                self.cola_eventos.task_done()
        except queue.Empty:
            pass
        finally:
            self.after(50, self._procesar_cola)

    # --- FLUJO DE ANÁLISIS ---

    def iniciar_analisis(self):
        """Inicia el proceso de análisis de los documentos en un hilo secundario."""
        rutas = self.panel_documentos.obtener_rutas()
        if not rutas:
            messagebox.showwarning(
                "Atención",
                "Por favor agrega al menos un archivo PDF o Excel para analizar.",
                parent=self
            )
            return

        self._bloquear_ui_durante_proceso(True)
        self.documentos_cargados.clear()
        self.todas_imagenes.clear()
        self.progressbar["value"] = 0

        # Leer configuración en el hilo principal antes de lanzar el hilo worker
        config = self.panel_configuracion.obtener_configuracion()

        self.hilo_trabajo = threading.Thread(
            target=self._hilo_worker_analisis,
            args=(rutas, config),
            daemon=True
        )
        self.hilo_trabajo.start()

    def _hilo_worker_analisis(self, rutas: List[Path], config: dict):
        """Hilo secundario para analizar documentos sin congelar la interfaz."""
        try:
            extractor_pdf = ExtractorPDF()
            extractor_excel = ExtractorExcel()
            total_docs = len(rutas)

            self.cola_eventos.put({
                "tipo": "ESTADO",
                "datos": {"mensaje": f"Iniciando análisis de {total_docs} documento(s)..."}
            })

            todas_imgs: List[ImagenExtraida] = []
            total_errores = 0

            exportar_pag_pdf = config.get("exportar_paginas_pdf", False)

            for idx, ruta in enumerate(rutas, 1):
                self.cola_eventos.put({
                    "tipo": "PROGRESO",
                    "datos": {"actual": idx, "total": total_docs}
                })
                self.cola_eventos.put({
                    "tipo": "ESTADO",
                    "datos": {"mensaje": f"Analizando ({idx}/{total_docs}): {ruta.name}"}
                })

                ext = ruta.suffix.lower()
                if ext == ".pdf":
                    doc_res = extractor_pdf.analizar_documento(str(ruta))
                    # Si se solicitó exportar páginas completas de PDF
                    if exportar_pag_pdf and doc_res.estado == "Analizado":
                        for p in range(1, doc_res.total_paginas_o_hojas + 1):
                            p_img = extractor_pdf.renderizar_pagina_completa(str(ruta), p)
                            if p_img:
                                doc_res.imagenes.append(p_img)
                elif ext in (".xlsx", ".xlsm"):
                    doc_res = extractor_excel.analizar_documento(str(ruta))
                else:
                    continue

                total_errores += len(doc_res.errores)
                todas_imgs.extend(doc_res.imagenes)

                self.cola_eventos.put({
                    "tipo": "ANALISIS_DOC_COMPLETADO",
                    "datos": {"documento": doc_res}
                })

            # Deduplicación con SHA-256
            self.cola_eventos.put({
                "tipo": "ESTADO",
                "datos": {"mensaje": "Calculando deduplicación SHA-256 entre imágenes..."}
            })
            resumen_duplicados = self.gestor_duplicados.procesar_duplicados(todas_imgs)

            # Clasificación Inteligente de Carreteras y Naturaleza
            self.cola_eventos.put({
                "tipo": "ESTADO",
                "datos": {"mensaje": "Clasificando contenido (Carreteras/Naturaleza vs Gráficos/Logos)..."}
            })
            clasificador_vial = ClasificadorVialNaturaleza()
            total_viales = 0
            total_graficos = 0
            solo_carreteras_cfg = config.get("solo_carreteras_naturaleza", True)

            for img in todas_imgs:
                if img.es_pagina_completa:
                    img.es_carretera_o_naturaleza = True
                    img.categoria_detectada = "Página Completa"
                    img.score_confianza_vial = 100.0
                    img.detalle_clasificacion = "Página completa de PDF"
                    img.seleccionada = True
                    continue

                es_vial = clasificador_vial.clasificar(img)
                if es_vial:
                    total_viales += 1
                    img.seleccionada = True
                else:
                    total_graficos += 1
                    if solo_carreteras_cfg:
                        img.seleccionada = False

            self.cola_eventos.put({
                "tipo": "ANALISIS_FINALIZADO",
                "datos": {
                    "todas_imagenes": todas_imgs,
                    "resumen_duplicados": resumen_duplicados,
                    "total_errores": total_errores,
                    "total_viales": total_viales,
                    "total_graficos": total_graficos
                }
            })
        except Exception as e_analisis:
            self.cola_eventos.put({
                "tipo": "ERROR",
                "datos": {"mensaje": f"Fallo durante el análisis de documentos: {str(e_analisis)}"}
            })

    def _on_analisis_finalizado(self, datos: dict):
        self.todas_imagenes = datos["todas_imagenes"]
        res_dup = datos["resumen_duplicados"]
        total_errores = datos["total_errores"]
        total_viales = datos.get("total_viales", 0)
        total_graficos = datos.get("total_graficos", 0)

        # Cargar imágenes en la galería
        self.galeria.cargar_imagenes(self.todas_imagenes)

        # Actualizar métricas
        self.card_encontradas.actualizar(len(self.todas_imagenes))
        self.card_unicas.actualizar(res_dup["unicas"])
        self.card_duplicadas.actualizar(res_dup["duplicados"])
        self.card_errores.actualizar(total_errores)

        self._bloquear_ui_durante_proceso(False)
        self.progressbar["value"] = 100
        self.btn_exportar.state(["!disabled"])

        msg_final = (
            f"Análisis completado: {len(self.todas_imagenes)} imágenes detectadas "
            f"({total_viales} de carreteras/naturaleza, {total_graficos} gráficos/logos descartados, {res_dup['unicas']} únicas)."
        )
        self.var_estado.set(msg_final)
        self._agregar_log_ui(f"🎉 {msg_final}")

        # Cambiar automáticamente a la pestaña de Galería si se encontraron imágenes
        if self.todas_imagenes:
            self.notebook.select(1)

    # --- FLUJO DE EXPORTACIÓN ---

    def iniciar_extraccion(self):
        """Inicia el proceso de exportación a disco de las imágenes seleccionadas."""
        seleccionadas = [img for img in self.todas_imagenes if img.seleccionada]
        if not seleccionadas:
            messagebox.showwarning(
                "Sin selección",
                "No has seleccionado ninguna imagen para exportar. Marca al menos una casilla en la galería.",
                parent=self
            )
            return

        config = self.panel_configuracion.obtener_configuracion()
        dir_destino = config["ruta_destino"]

        self._bloquear_ui_durante_proceso(True)
        self.progressbar["value"] = 0

        self.hilo_trabajo = threading.Thread(
            target=self._hilo_worker_exportacion,
            args=(self.todas_imagenes, config),
            daemon=True
        )
        self.hilo_trabajo.start()

    def _hilo_worker_exportacion(self, imagenes: List[ImagenExtraida], config: dict):
        """Hilo secundario para exportación a disco."""
        try:
            def callback_prog(actual, total, msg):
                self.cola_eventos.put({
                    "tipo": "PROGRESO",
                    "datos": {"actual": actual, "total": total}
                })
                self.cola_eventos.put({
                    "tipo": "ESTADO",
                    "datos": {"mensaje": msg}
                })

            resumen = self.exportador.exportar(
                imagenes=imagenes,
                directorio_destino=config["ruta_destino"],
                organizar_por_documento=config["organizar_por_documento"],
                omitir_duplicados_exactos=config["omitir_duplicados_exactos"],
                sobrescribir_existentes=config["sobrescribir_existentes"],
                callback_progreso=callback_prog
            )

            self.cola_eventos.put({
                "tipo": "EXPORTACION_FINALIZADA",
                "datos": {"resumen": resumen}
            })
        except Exception as e_exp:
            self.cola_eventos.put({
                "tipo": "ERROR",
                "datos": {"mensaje": f"Fallo durante la exportación a disco: {str(e_exp)}"}
            })

    def _on_exportacion_finalizada(self, datos: dict):
        resumen = datos["resumen"]
        self._bloquear_ui_durante_proceso(False)
        self.progressbar["value"] = 100

        lineas_detalle = [
            f"Extracción finalizada: {resumen['exportadas']} imágenes guardadas exitosamente en:",
            f"{resumen['carpeta_destino']}\n",
            f"• Total exportadas: {resumen['exportadas']}"
        ]

        if resumen.get("duplicadas_omitidas", 0) > 0:
            lineas_detalle.append(f"• Duplicados exactos omitidos: {resumen['duplicadas_omitidas']}")
        
        no_sel_count = max(0, resumen.get("omitidas", 0) - resumen.get("duplicadas_omitidas", 0))
        if no_sel_count > 0:
            lineas_detalle.append(f"• Elementos gráficos / no seleccionados omitidos: {no_sel_count}")

        lineas_detalle.append(f"• Errores: {resumen.get('errores', 0)}")
        lineas_detalle.append("• Informes CSV (manifest.csv y resumen_general.csv) generados en UTF-8 con BOM.")

        msg_fin = "\n".join(lineas_detalle)
        self.var_estado.set(f"Exportadas {resumen['exportadas']} imágenes con éxito.")
        self._agregar_log_ui(f"✅ {msg_fin}")

        resp = messagebox.askyesno(
            "Extracción Exitosa",
            f"{msg_fin}\n\n¿Deseas abrir la carpeta de resultados ahora?",
            parent=self
        )
        if resp:
            abrir_en_explorador(resumen["carpeta_destino"])

    def _actualizar_estadisticas_interfaz(self):
        """Actualiza los contadores cuando el usuario marca o desmarca en la galería."""
        total_sel = sum(1 for img in self.todas_imagenes if img.seleccionada)
        if total_sel > 0:
            self.btn_exportar.state(["!disabled"])
        else:
            self.btn_exportar.state(["disabled"])

    def _bloquear_ui_durante_proceso(self, bloqueado: bool):
        estado_btn = ["disabled"] if bloqueado else ["!disabled"]
        self.btn_analizar.state(estado_btn)
        if not bloqueado:
            self._actualizar_estadisticas_interfaz()
        else:
            self.btn_exportar.state(["disabled"])

    def _abrir_carpeta_resultados(self):
        config = self.panel_configuracion.obtener_configuracion()
        ruta = Path(config["ruta_destino"])
        asegurar_directorio(ruta)
        abrir_en_explorador(ruta)
