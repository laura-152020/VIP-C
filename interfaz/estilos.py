"""
Módulo de estilos visuales para la aplicación Tkinter / ttk.
Define una paleta moderna, sobria y profesional compatible con Windows 10 y 11.
"""

import tkinter as tk
from tkinter import ttk

# Paleta de colores sobria y profesional (Slate / Blue UI)
COLOR_FONDO_APP = "#F1F5F9"        # Fondo suave general
COLOR_PANEL_BLANCO = "#FFFFFF"     # Fondo tarjetas y contenedores
COLOR_TEXTO_PRINCIPAL = "#0F172A"  # Texto oscuro casi negro
COLOR_TEXTO_SECUNDARIO = "#64748B"# Texto secundario gris
COLOR_BORDE = "#CBD5E1"            # Bordes sutiles

COLOR_PRIMARIO = "#2563EB"         # Azul moderno primario
COLOR_PRIMARIO_HOVER = "#1D4ED8"   # Azul hover
COLOR_PRIMARIO_ACTIVE = "#1E40AF"

COLOR_EXITO = "#10B981"            # Verde esmeralda
COLOR_EXITO_HOVER = "#059669"
COLOR_ADVERTENCIA = "#F59E0B"      # Ámbar para duplicados
COLOR_PELIGRO = "#EF4444"          # Rojo para errores o eliminar

FUENTE_TITULO = ("Segoe UI", 13, "bold")
FUENTE_SUBTITULO = ("Segoe UI", 11, "bold")
FUENTE_TEXTO = ("Segoe UI", 9)
FUENTE_TEXTO_BOLD = ("Segoe UI", 9, "bold")
FUENTE_METRICA = ("Segoe UI", 15, "bold")
FUENTE_PEQUENA = ("Segoe UI", 8)


def aplicar_estilos_modernos(root: tk.Tk) -> ttk.Style:
    """Configura los estilos de ttk para lograr una apariencia limpia y profesional."""
    style = ttk.Style(root)
    
    # Usar tema 'clam' o 'vista' como base sólida
    temas_disponibles = style.theme_names()
    if "clam" in temas_disponibles:
        style.theme_use("clam")

    # Configuración de frames y labels
    style.configure("TFrame", background=COLOR_FONDO_APP)
    style.configure("Blanco.TFrame", background=COLOR_PANEL_BLANCO)
    
    style.configure("TLabel", background=COLOR_FONDO_APP, foreground=COLOR_TEXTO_PRINCIPAL, font=FUENTE_TEXTO)
    style.configure("Blanco.TLabel", background=COLOR_PANEL_BLANCO, foreground=COLOR_TEXTO_PRINCIPAL, font=FUENTE_TEXTO)
    style.configure("Secundario.TLabel", background=COLOR_PANEL_BLANCO, foreground=COLOR_TEXTO_SECUNDARIO, font=FUENTE_PEQUENA)
    
    # Botón Primario (Azul)
    style.configure(
        "Primario.TButton",
        background=COLOR_PRIMARIO,
        foreground="#FFFFFF",
        font=FUENTE_TEXTO_BOLD,
        borderwidth=0,
        focuscolor="none",
        padding=(12, 6)
    )
    style.map(
        "Primario.TButton",
        background=[("pressed", COLOR_PRIMARIO_ACTIVE), ("active", COLOR_PRIMARIO_HOVER), ("disabled", "#94A3B8")],
        foreground=[("disabled", "#E2E8F0")]
    )

    # Botón Éxito (Verde para Iniciar Extracción)
    style.configure(
        "Exito.TButton",
        background=COLOR_EXITO,
        foreground="#FFFFFF",
        font=FUENTE_TEXTO_BOLD,
        borderwidth=0,
        focuscolor="none",
        padding=(14, 8)
    )
    style.map(
        "Exito.TButton",
        background=[("pressed", "#047857"), ("active", COLOR_EXITO_HOVER), ("disabled", "#94A3B8")],
        foreground=[("disabled", "#E2E8F0")]
    )

    # Botón Secundario / Estándar
    style.configure(
        "Secundario.TButton",
        background="#E2E8F0",
        foreground=COLOR_TEXTO_PRINCIPAL,
        font=FUENTE_TEXTO,
        borderwidth=0,
        focuscolor="none",
        padding=(8, 4)
    )
    style.map(
        "Secundario.TButton",
        background=[("pressed", "#CBD5E1"), ("active", "#D1D5DB")]
    )

    # Notebook (Pestañas)
    style.configure("TNotebook", background=COLOR_FONDO_APP, tabmargins=[2, 5, 2, 0])
    style.configure(
        "TNotebook.Tab",
        background="#E2E8F0",
        foreground=COLOR_TEXTO_PRINCIPAL,
        font=FUENTE_TEXTO_BOLD,
        padding=[14, 6]
    )
    style.map(
        "TNotebook.Tab",
        background=[("selected", COLOR_PANEL_BLANCO), ("active", "#F8FAFC")],
        foreground=[("selected", COLOR_PRIMARIO)]
    )

    # Barra de progreso
    style.configure(
        "Horizontal.TProgressbar",
        troughcolor="#E2E8F0",
        background=COLOR_PRIMARIO,
        thickness=8
    )

    # Treeview
    style.configure(
        "Treeview",
        background="#FFFFFF",
        foreground=COLOR_TEXTO_PRINCIPAL,
        fieldbackground="#FFFFFF",
        font=FUENTE_TEXTO,
        rowheight=26
    )
    style.configure(
        "Treeview.Heading",
        background="#E2E8F0",
        foreground=COLOR_TEXTO_PRINCIPAL,
        font=FUENTE_TEXTO_BOLD,
        padding=[6, 4]
    )

    return style
