# Extractor Inteligente de Imágenes (PDF y Excel) - Versión 1.0

Aplicación de escritorio nativa en Python con interfaz gráfica moderna (Tkinter/ttk) diseñada para **Windows 10 y Windows 11**. Permite analizar documentos PDF y hojas de cálculo Excel (XLSX, XLSM), recuperar todas las imágenes incrustadas en su resolución y formato original (sin capturas de pantalla), organizarlas por carpetas, deduplicarlas mediante SHA-256, previsualizarlas en una galería visual interactiva y generar informes CSV de auditoría.

---

## 🌟 Características Principales

1. **Extracción Fiel de Documentos PDF:**
   - Basado en el motor de alto rendimiento `PyMuPDF` (`fitz`).
   - Recupera flujos de imágenes nativos (JPEG, PNG, etc.) con sus dimensiones originales.
   - Manejo de transparencias y máscaras (`smask`).
   - Mapeo exacto del número de página donde aparece cada elemento.
   - Opción complementaria para renderizar páginas completas a alta resolución (DPI 150+).

2. **Extracción Estructural de Hojas de Cálculo Excel (XLSX, XLSM):**
   - Inspección directa de paquetes OpenXML mediante `zipfile` y `xml.etree.ElementTree`.
   - Recupera los archivos binarios directamente de `xl/media/`.
   - Detecta hojas visibles y hojas ocultas (`state="hidden"`).
   - Analiza los archivos de dibujo (`drawing*.xml`) para determinar las coordenadas exactas de las celdas de inicio y fin (ej. `A1 -> C4`, `A8 -> E16`).
   - Recupera el 100% de las imágenes internas, incluyendo aquellas no ancladas formalmente.

3. **Clasificación Inteligente de Carreteras y Naturaleza:**
   - Motor de visión computacional y colorimetría (espacios RGB y HSV) especializado en obras viales y paisajes.
   - Detecta asfalto, calzadas, vegetación, follaje, taludes y cielo con cálculo de score de confianza (0 - 100%).
   - Descarta automáticamente el ruido documental: logotipos corporativos (ej. *JERA*, *Rentan*), franjas y banners alargados de encabezados, firmas manuscritas y tablas de texto escaneadas.
   - Filtro dedicado en la Galería (`Solo Carreteras / Naturaleza`) y opción de exportación selectiva que omite automáticamente cualquier elemento gráfico.

4. **Detección Criptográfica de Duplicados (SHA-256):**
   - Calcula el hash SHA-256 sobre el flujo binario crudo.
   - Identifica duplicados exactos dentro y entre documentos.
   - Opciones para exportar una sola copia física o conservar todas las copias en disco, manteniendo siempre el registro completo en los informes.

5. **Interfaz Gráfica Moderna (Tkinter / ttk):**
   - **No Bloqueante:** Procesamiento en segundo plano con `threading.Thread` y cola `queue.Queue`. La interfaz responde en todo momento.
   - **Métricas en Vivo:** Indicadores en tiempo real de documentos, imágenes encontradas, imágenes únicas, duplicados y errores.
   - **Galería Visual:** Miniaturas optimizadas con `Pillow` conservando relación de aspecto, badges inteligentes (`🌲 VIAL` / `🎨 GRÁFICO` / `DUPLICADA`), checkboxes para selección granular y botones de selección masiva.
   - **Visor Ampliado:** Ventana modal emergente al hacer doble clic para inspección detallada, diagnóstico colorimétrico y exportación individual rápida.
   - **Filtros Dinámicos:** Por tipo de contenido (Carreteras/Naturaleza vs Gráficos), documento, formato (PNG, JPG) y dimensiones mínimas.

6. **Organización Jerárquica y Auditoría:**
   - Carpetas sanitizadas para evitar errores de nomenclatura en Windows.
   - Informes `manifest.csv` por documento y `resumen_general.csv` codificados en `utf-8-sig` para compatibilidad nativa e inmediata con Microsoft Excel.
   - Botón directo para abrir la carpeta de resultados en el Explorador de Windows.

---

## 📁 Estructura del Proyecto

```
Version 1/
│
├── main.py                         # Punto de entrada de la aplicación
├── requirements.txt                # Dependencias de Python
├── README.md                       # Documentación técnica completa
├── ExtractorImagenes.spec          # Archivo de especificación de PyInstaller
│
├── extractores/                    # Motores de análisis y extracción
│   ├── __init__.py
│   ├── modelo.py                   # Modelos de datos 'ImagenExtraida' y 'DocumentoAnalizado'
│   ├── extractor_pdf.py            # Motor de extracción PyMuPDF
│   └── extractor_excel.py          # Motor OpenXML/ZIP para hojas y celdas
│
├── procesamiento/                  # Lógica de negocio
│   ├── __init__.py
│   ├── duplicados.py               # Algoritmo de deduplicación SHA-256
│   ├── filtros.py                  # Filtrado multicriterio de catálogo
│   └── exportador.py               # Escritura en disco e informes CSV
│
├── interfaz/                       # Capa visual (Tkinter / ttk)
│   ├── __init__.py
│   ├── estilos.py                  # Paleta Slate/Blue, fuentes y temas ttk
│   ├── componentes.py              # Tarjetas visuales de imagen y métricas
│   ├── visor_imagen.py             # Ventana modal de vista ampliada
│   ├── panel_documentos.py         # Selector de archivos y carpetas
│   ├── galeria.py                  # Galería interactiva con scroll fluido
│   ├── configuracion.py            # Panel de opciones de destino y exportación
│   └── ventana_principal.py        # Ventana principal y cola de eventos
│
├── utilidades/                     # Funciones transversales
│   ├── __init__.py
│   ├── archivos.py                 # Sanitización Windows y apertura en Explorer
│   ├── metadatos.py                # Formateo de bytes y cálculo SHA-256
│   └── registro.py                 # Logging a consola y archivo
│
├── pruebas/                        # Scripts de pruebas automatizadas
│   ├── test_extractor_pdf.py       # Prueba con PDF de inspección vial
│   ├── test_extractor_excel.py     # Prueba con Excel de informe de avanzada
│   ├── test_integracion_completa.py# Prueba de integración de extremo a extremo
│   └── resultados_pruebas/         # Resultados de validaciones
│
├── resultados/                     # Directorio predeterminado de salida
├── logs/                           # Archivos de registro (extractor.log)
└── dist/                           # Ejecutable final compilado (.exe)
```

---

## ⚙️ Instalación y Requisitos

### Requisitos del Sistema
- **Sistema Operativo:** Windows 10 o Windows 11 (64 bits).
- **Python:** Versión 3.11, 3.12 o 3.13.

### Instalación de Dependencias
Abre una terminal (PowerShell o CMD) en la carpeta `Version 1`:
```powershell
pip install -r requirements.txt
```

---

## 🚀 Ejecución de la Aplicación

Para iniciar la aplicación directamente desde el código fuente:
```powershell
python main.py
```

### Guía Rápida de Uso:
1. En la pestaña **Documentos y Configuración**, haz clic en `➕ Agregar Archivo(s)` o `📁 Agregar Carpeta` para cargar documentos PDF o Excel.
2. Configura la carpeta de destino y las opciones deseadas (deduplicación, organización por carpetas, etc.).
3. Presiona el botón azul **🔍 ANALIZAR DOCUMENTOS**.
4. La aplicación analizará los documentos en segundo plano y te llevará a la pestaña **🖼 Galería de Imágenes**.
5. Usa los filtros superiores para explorar las imágenes, haz doble clic en cualquier miniatura para verla en grande y selecciona cuáles deseas exportar.
6. Presiona el botón verde **🚀 INICIAR EXTRACCIÓN**.
7. Al finalizar, podrás abrir la carpeta con el botón **📂 Abrir Carpeta de Resultados**.

---

## 🧪 Pruebas Realizadas con los Documentos de Referencia

La aplicación fue validada rigurosamente utilizando los dos documentos de prueba en el entorno:

1. **Documento PDF:** `C:\Users\juand\OneDrive\Escritorio\2026051307900.pdf`
   - **Páginas analizadas:** 6 páginas completas.
   - **Objetos de imagen detectados:** 26 objetos.
   - **Imágenes únicas (SHA-256):** 16 imágenes únicas (fotografías de inspección vial, gráficos y encabezados repetidos).
   - **Resultado:** 100% de éxito en extracción sin modificación del archivo original.

2. **Documento Excel:** `C:\Users\juand\OneDrive\Escritorio\EI-F140-13 Informe de avanzada Molino Viejo - Santo Domingo.xlsx`
   - **Hojas detectadas:** 4 hojas (incluyendo la hoja oculta `Versión`).
   - **Apariciones de imagen en celdas:** 8 instancias detectadas con precisión:
     - Hoja 1 (`EI-F140-13`): Celdas `A1 -> C4` (Logotipo PNG).
     - Hoja 2 (`EI-F140-13.`): 6 fotografías de alta resolución en celdas `A8->E16`, `E8->K16`, `K8->P16`, `A16->E25`, `E16->K25`, `K16->P25`, más el logotipo en `B1->D4`.
   - **Imágenes únicas internas:** 7 archivos de imagen originales en `xl/media/`.
   - **Resultado:** 100% de éxito en detección de hojas, celdas y extracción de fotos en calidad original (1600x1200 px).

Para re-ejecutar las pruebas en cualquier momento:
```powershell
python pruebas/test_extractor_pdf.py
python pruebas/test_extractor_excel.py
python pruebas/test_integracion_completa.py
```

---

## 📦 Generación del Ejecutable Autónomo (PyInstaller)

Para compilar la aplicación en un único archivo ejecutable `.exe` independiente que no requiere tener Python instalado:

```powershell
pip install -r requirements-dev.txt
python -m PyInstaller ExtractorImagenes.spec --noconfirm
```

El archivo ejecutable generado se encuentra en:
`C:\Users\juand\OneDrive\Escritorio\Programacion\Estractor de imagenes PDF y Excel\Version 1\dist\ExtractorImagenes.exe`
