"""
Módulo de utilidades para manejo seguro de archivos y rutas en Windows.
"""

import os
import re
import subprocess
from pathlib import Path
from typing import Union, Tuple


CARACTERES_INVALIDOS_WINDOWS = r'[<>:"/\\|?*\x00-\x1f]'
NOMBRES_RESERVADOS_WINDOWS = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
}


def sanitizar_nombre(nombre: str, max_longitud: int = 80) -> str:
    """
    Limpia un nombre de archivo o carpeta eliminando caracteres no permitidos en Windows
    y previniendo nombres reservados del sistema (CON, NUL, COM1...).
    """
    if not nombre:
        return "sin_nombre"
    
    # Reemplazar caracteres prohibidos por guion bajo
    nombre_limpio = re.sub(CARACTERES_INVALIDOS_WINDOWS, "_", nombre)
    
    # Eliminar espacios y puntos al inicio y al final (problemáticos en Windows)
    nombre_limpio = nombre_limpio.strip(". ")
    
    # Reducir guiones bajos repetidos
    nombre_limpio = re.sub(r"_+", "_", nombre_limpio)
    
    if not nombre_limpio:
        nombre_limpio = "archivo"

    # Evitar nombres reservados de Windows (ej. CON -> CON_doc)
    if nombre_limpio.upper() in NOMBRES_RESERVADOS_WINDOWS:
        nombre_limpio = f"{nombre_limpio}_doc"
        
    return nombre_limpio[:max_longitud]


def validar_directorio_escritura(ruta: Union[str, Path]) -> Tuple[bool, str]:
    """
    Comprueba que la ruta no esté vacía, sea creable y se tengan permisos reales de escritura.
    """
    if not ruta or not str(ruta).strip():
        return False, "La ruta de destino no puede estar vacía."
    
    try:
        path_obj = Path(ruta).resolve()
        path_obj.mkdir(parents=True, exist_ok=True)
        # Prueba real de escritura
        archivo_prueba = path_obj / ".tmp_test_permisos"
        with open(archivo_prueba, "w", encoding="utf-8") as f:
            f.write("test")
        archivo_prueba.unlink(missing_ok=True)
        return True, ""
    except Exception as e:
        return False, f"No se puede escribir en la ruta seleccionada: {e}"


def asegurar_directorio(ruta: Union[str, Path]) -> Path:
    """
    Crea el directorio y sus padres si no existen, y retorna un objeto Path.
    """
    path_obj = Path(ruta)
    path_obj.mkdir(parents=True, exist_ok=True)
    return path_obj


def generar_ruta_no_colision(directorio: Union[str, Path], nombre_base: str, extension: str) -> Path:
    """
    Genera una ruta de archivo dentro del directorio asegurando que no colisione
    con archivos existentes agregando un sufijo numérico (ej. nombre_1.ext).
    """
    dir_path = Path(directorio)
    asegurar_directorio(dir_path)
    
    ext = extension if extension.startswith(".") else f".{extension}"
    nombre_sanitizado = sanitizar_nombre(nombre_base)
    
    candidato = dir_path / f"{nombre_sanitizado}{ext}"
    contador = 1
    
    while candidato.exists():
        candidato = dir_path / f"{nombre_sanitizado}_{contador}{ext}"
        contador += 1
        
    return candidato


def abrir_en_explorador(ruta: Union[str, Path]) -> bool:
    """
    Abre una carpeta o archivo en el Explorador de Windows nativo.
    """
    try:
        path_obj = Path(ruta).resolve()
        if not path_obj.exists():
            return False
            
        # Si es un archivo, abrir la carpeta contenedora con el elemento seleccionado
        if path_obj.is_file():
            subprocess.run(["explorer.exe", f"/select,{str(path_obj)}"], check=False)
        else:
            os.startfile(str(path_obj))
        return True
    except Exception:
        return False
