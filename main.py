"""
Punto de entrada principal para el Extractor Inteligente de Imágenes.
Aplicación de escritorio para Windows 10 y Windows 11.
"""

import sys
import ctypes
from pathlib import Path

# Determinar directorio raíz de forma segura para ejecución como script o como .exe (frozen)
if getattr(sys, "frozen", False):
    DIRECTORIO_RAIZ = Path(sys.executable).resolve().parent
else:
    DIRECTORIO_RAIZ = Path(__file__).resolve().parent

if str(DIRECTORIO_RAIZ) not in sys.path:
    sys.path.insert(0, str(DIRECTORIO_RAIZ))

from interfaz.ventana_principal import VentanaPrincipal


def activar_soporte_alta_resolucion_windows():
    """Habilita compatibilidad DPI consciente en Windows 10 y 11 para nitidez de fuentes."""
    if sys.platform == "win32":
        try:
            # Per-monitor DPI awareness (Windows 8.1+)
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            try:
                # System DPI awareness (Windows Vista+)
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass


def main():
    """Inicializa la interfaz gráfica y el bucle principal de eventos."""
    activar_soporte_alta_resolucion_windows()
    app = VentanaPrincipal(DIRECTORIO_RAIZ)
    app.mainloop()


if __name__ == "__main__":
    main()
