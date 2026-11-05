#!/usr/bin/env bash
# -*- coding: utf-8 -*-
# run_{{NOMBRE}}.sh — Ejecuta {{NOMBRE}}.py dentro de su propio entorno virtual.
#
# Es el UNICO script de arranque: crea el venv si no existe, instala las dependencias
# de requirements.txt y corre el Python. No instala nada en la PC del usuario.
#
# Uso:
#   chmod +x run_{{NOMBRE}}.sh
#   ./run_{{NOMBRE}}.sh                        # menu con los archivos de entrada/
#   ./run_{{NOMBRE}}.sh entrada/datos.xlsx     # archivo directo
#   ./run_{{NOMBRE}}.sh entrada/datos.xlsx --desde 25
#   ./run_{{NOMBRE}}.sh entrada/datos.xlsx --dry-run
#
# Cualquier flag extra se pasa tal cual al Python.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/venv"
PYTHON_SCRIPT="${SCRIPT_DIR}/{{NOMBRE}}.py"
REQUIREMENTS="${SCRIPT_DIR}/requirements.txt"
DIR_ENTRADA="${SCRIPT_DIR}/entrada"
SELLO_DEPS="${VENV_DIR}/.requirements.sha"

echo "📂 Directorio del proyecto: ${SCRIPT_DIR}"
echo "🐍 Entorno virtual: ${VENV_DIR}"

# ─── 1. Crear el venv si no existe ──────────────────────────────────────────
if [ ! -d "${VENV_DIR}" ]; then
    echo "⚙️  Creando entorno virtual..."
    python3 -m venv "${VENV_DIR}"
fi

# ─── 2. Activar el venv ─────────────────────────────────────────────────────
# A partir de aqui 'python' y 'pip' son los del venv: nada toca la PC.
source "${VENV_DIR}/bin/activate"

# ─── 3. Instalar dependencias si requirements.txt cambio ────────────────────
# Se guarda el hash de requirements.txt dentro del venv. Mientras no cambie, no
# se vuelve a llamar a pip: el arranque es instantaneo.
_hash_archivo() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        sha256sum "$1" | awk '{print $1}'
    fi
}

if [ ! -f "${REQUIREMENTS}" ]; then
    echo "❌ No se encontro requirements.txt en ${SCRIPT_DIR}"
    exit 1
fi

HASH_ACTUAL="$(_hash_archivo "${REQUIREMENTS}")"

if [ ! -f "${SELLO_DEPS}" ] || [ "$(cat "${SELLO_DEPS}")" != "${HASH_ACTUAL}" ]; then
    echo "📦 Instalando / actualizando dependencias..."
    pip install --quiet --upgrade pip
    pip install --quiet -r "${REQUIREMENTS}"
    echo "${HASH_ACTUAL}" > "${SELLO_DEPS}"
else
    echo "✅ Dependencias ya instaladas."
fi

# ─── 4. Determinar el archivo de entrada ────────────────────────────────────
# BLOQUE OPCIONAL — borralo completo si el utilitario no recibe un archivo.
ARCHIVO=""
ARGS=()

# Si el primer argumento no empieza con "-", se toma como el archivo de entrada.
if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
    ARCHIVO="$1"
    shift
fi
ARGS=("$@")

if [ -z "${ARCHIVO}" ]; then
    ARCHIVOS=()
    while IFS= read -r linea; do
        ARCHIVOS+=("${linea}")
    done < <(find "${DIR_ENTRADA}" -maxdepth 1 -type f \
                \( -iname "*.xlsx" -o -iname "*.xlsm" -o -iname "*.xls" \
                   -o -iname "*.csv" -o -iname "*.txt" -o -iname "*.tsv" \) 2>/dev/null | sort)

    if [ "${#ARCHIVOS[@]}" -eq 0 ]; then
        echo "❌ No hay archivos en ${DIR_ENTRADA}"
        echo "   Copia ahi tu layout (xlsx, xls, csv o txt) o pasalo como argumento:"
        echo "   ./run_{{NOMBRE}}.sh /ruta/a/tu/archivo.xlsx"
        exit 1
    elif [ "${#ARCHIVOS[@]}" -eq 1 ]; then
        ARCHIVO="${ARCHIVOS[0]}"
        echo "📄 Archivo detectado: $(basename "${ARCHIVO}")"
    else
        echo ""
        echo "📄 Archivos disponibles en entrada/:"
        for i in "${!ARCHIVOS[@]}"; do
            printf "   %2d) %s\n" "$((i + 1))" "$(basename "${ARCHIVOS[$i]}")"
        done
        echo ""
        while true; do
            read -r -p "👉 Selecciona el archivo (1-${#ARCHIVOS[@]}): " OPCION
            if [[ "${OPCION}" =~ ^[0-9]+$ ]] && [ "${OPCION}" -ge 1 ] && [ "${OPCION}" -le "${#ARCHIVOS[@]}" ]; then
                ARCHIVO="${ARCHIVOS[$((OPCION - 1))]}"
                break
            fi
            echo "   ⚠️  Opcion invalida."
        done
    fi
fi

if [ ! -f "${ARCHIVO}" ]; then
    echo "❌ No se encontro el archivo: ${ARCHIVO}"
    exit 1
fi
# ─── FIN DEL BLOQUE OPCIONAL ────────────────────────────────────────────────

# ─── 5. Ejecutar el script ──────────────────────────────────────────────────
# Los secretos NO se piden aqui. Si el utilitario necesita un token o una
# credencial, la pide el Python (o se toma de .env / variable de entorno).
echo ""
echo "🚀 Ejecutando {{NOMBRE}}.py..."
echo ""

set +e
python "${PYTHON_SCRIPT}" "${ARCHIVO}" ${ARGS[@]+"${ARGS[@]}"}
CODIGO=$?
set -e

# ─── 6. Traducir el codigo de salida ────────────────────────────────────────
echo ""
case "${CODIGO}" in
    0)   echo "🏁 Proceso finalizado sin errores." ;;
    1)   echo "🏁 Proceso finalizado CON REGISTROS FALLIDOS — revisa el log en logs/." ;;
    2)   echo "🔒 Proceso INTERRUMPIDO por una credencial vencida."
         echo "   Renuevala y reanuda con el --desde que indica el log." ;;
    130) echo "⚠️  Proceso cancelado por el usuario." ;;
    *)   echo "🏁 Proceso finalizado con codigo ${CODIGO}." ;;
esac

exit "${CODIGO}"
