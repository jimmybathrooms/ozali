---
name: python-utilitario
description: Crea utilitarios Python autocontenidos que se ejecutan en su propio entorno virtual mediante UN SOLO script .sh, sin instalar librerías en la PC del usuario. Genera la carpeta completa - script.py, run_script.sh, requirements.txt, README.md, .gitignore - con log por corrida, --dry-run y códigos de salida estándar. También empaqueta un .py suelto ya existente. Úsala cuando el usuario quiera "hazme un utilitario", "un script de python empaquetado", "un proceso de carga masiva/importación", "que corra en su venv", "que no instale nada en mi máquina", "empaqueta este .py" o "arma la estructura de este script".
---

# python-utilitario

Fabrica **utilitarios Python autocontenidos**: una carpeta que trae su propia lógica, su
propio entorno virtual y un único script de arranque. Quien lo recibe solo hace
`./run_<nombre>.sh` — no instala dependencias a mano, no toca el Python del sistema y no
necesita saber qué librerías hacen falta.

Implementación de referencia en este ecosistema:
`pythonfiles/jimmy/utils/importacionClientePento/`.

---

## When to Use

Actívala cuando el usuario pida, en cualquiera de estas formas:

- "hazme un utilitario / un script de Python para …"
- "un proceso de importación / de carga masiva / de movimiento de archivos"
- "que corra en su propio venv", "que no me instale nada en la máquina",
  "que se ejecute empaquetado", "autocontenido"
- "empaqueta este `.py`", "arma la estructura de este script",
  "ponle su `.sh` y su README", "migra este script suelto"
- "necesito leer un layout xlsx/csv y mandarlo a la API / a la base"

**No la actives** para: modificar la lógica de negocio de un utilitario que ya está
empaquetado (eso es edición normal), ni para scripts de un solo uso que se corren una vez
y se tiran.

---

## Reglas duras (no negociables)

1. **UN SOLO `.sh`.** `run_<nombre>.sh` crea el venv si no existe, instala las
   dependencias y ejecuta el Python. Está **prohibido** partirlo en un script de setup y
   otro de ejecución.
2. **Cero instalación global.** Todo `pip install` ocurre dentro del `venv/` de la propia
   carpeta, después de activarlo. Nunca `sudo pip`, nunca `pip install --user`, nunca
   `brew install` de una librería de Python.
3. **`requirements.txt` es la fuente única** de dependencias, con versiones fijadas
   (`>=`). El `.sh` hace `pip install -r`; el `.py` lleva un guard con
   `importlib.util.find_spec` que dice qué falta y con qué comando instalarlo.
4. **Portable.** `SCRIPT_DIR` se resuelve con `BASH_SOURCE`, de modo que el utilitario
   corre desde cualquier directorio. Siempre `set -euo pipefail`.
5. **Seguridad.** El `.gitignore` generado incluye siempre `venv/`, `logs/`, `.env`,
   `entrada/*`, `__pycache__/`, `.DS_Store`. Las variables de entorno se documentan
   **por nombre**; jamás se lee, imprime ni copia su valor. Ver
   [`references/convenciones.md`](references/convenciones.md) §6.
6. **Trazabilidad.** Cada corrida deja `logs/<nombre>_<YYYYmmdd_HHMMSS>.log`.
7. **`--dry-run` obligatorio** en todo utilitario que escriba en algún lado (base de
   datos, API, storage, SFTP). Debe validar y mostrar lo que enviaría, sin enviarlo.
8. **Códigos de salida estándar:** `0` correcto · `1` terminó con registros fallidos ·
   `2` interrupción de negocio reanudable (token expirado, credencial vencida) ·
   `130` cancelado por el usuario. El `.sh` los traduce a un mensaje legible.

---

## Anatomía que se genera

```
<nombreUtilitario>/
├── <nombreUtilitario>.py        # lógica: guard de deps, argparse, clase Log, exit codes
├── run_<nombreUtilitario>.sh    # ÚNICO .sh: venv + deps + ejecución + mensaje de cierre
├── requirements.txt             # dependencias con versión fijada, comentadas
├── README.md                    # uso, flags, layout de entrada, variables .env (por nombre)
├── .gitignore
├── entrada/                     # insumos del usuario (ignorada, salvo un layout de ejemplo)
└── logs/                        # una bitácora por corrida (ignorada)
```

---

## Steps

### 1. Detectar el modo

- **Crear** — no existe código previo. Sigue con el paso 2.
- **Migrar** — ya hay un `.py` suelto que hay que empaquetar. Ve a
  [`references/migracion.md`](references/migracion.md) y vuelve aquí en el paso 4.

### 2. Recopilar los requisitos

Pregunta al usuario lo que no puedas deducir del contexto:

- ¿Qué hace el utilitario, en una frase?
- **Entrada:** ¿lee un layout (`xlsx`/`xls`/`csv`/`txt`)? ¿una carpeta de archivos?
  ¿nada, solo parámetros?
- **Salida / destino:** ¿base de datos, API REST, Google Cloud Storage, SFTP, archivos
  locales?
- **Dependencias** que eso implica (ver la tabla de
  [`references/convenciones.md`](references/convenciones.md) §3).
- **Variables de entorno** que necesitará, **por nombre** (`DB_HOST`, `GCS_BUCKET_DESTINO`…).
  Nunca pidas ni registres sus valores.
- ¿Necesita reanudarse a media corrida (`--desde`)? Es lo normal en cargas masivas largas.

### 3. Definir nombre y ubicación

- **Nombre canónico:** camelCase, sustantivo de la acción — `importacionClientePento`,
  `scotiaMoveFile`, `importacionPagos`. Sin guiones, sin prefijos genéricos.
- El `.py`, el `.sh` y la carpeta comparten ese nombre.
- **Ubicación:** junto a los utilitarios del mismo dominio; si no hay un dominio claro,
  pregunta.

### 4. Copiar las plantillas y sustituir marcadores

Copia desde `plantillas/` y reemplaza `{{NOMBRE}}` por el nombre canónico y
`{{DESCRIPCION}}` por la frase del paso 2:

| Plantilla | Destino |
|---|---|
| `plantillas/TEMPLATE.py` | `<nombre>/<nombre>.py` |
| `plantillas/run_TEMPLATE.sh` | `<nombre>/run_<nombre>.sh` |
| `plantillas/requirements.txt` | `<nombre>/requirements.txt` |
| `plantillas/gitignore` | `<nombre>/.gitignore` |
| `plantillas/README.md` | `<nombre>/README.md` |

Borra de las plantillas los bloques marcados como opcionales que no apliquen (el menú de
`entrada/`, el cargador de `.env`, el lector de layouts).

### 5. Implementar la lógica de negocio

Escribe la funcionalidad **dentro del esqueleto**, sin alterar su contrato: el guard de
dependencias, la clase `Log`, el `main()` con `argparse` y el bloque `__main__` con el
manejo de `KeyboardInterrupt` se conservan tal cual.

### 6. Fijar dependencias y documentar

- `requirements.txt` con las librerías reales y su versión mínima, cada una comentada.
- Registra los módulos en la tupla del guard de dependencias del `.py`.
- `README.md`: qué hace, ejecución rápida con el `.sh`, tabla de flags, layout de entrada
  si aplica, variables `.env` **por nombre**, y qué deja en `logs/`.

### 7. Verificar

```bash
chmod +x run_<nombre>.sh
./run_<nombre>.sh --dry-run          # o el flag que aplique
```

Confirma las cuatro cosas:

- [ ] Se creó `venv/` **dentro de la carpeta del utilitario**.
- [ ] No se instaló nada fuera del venv (`pip list` del sistema, sin cambios).
- [ ] El `--dry-run` no escribió en ningún destino real.
- [ ] Se generó el log en `logs/`.

---

## References

- [`references/convenciones.md`](references/convenciones.md) — anatomía detallada, naming,
  tabla de dependencias por tipo de destino, códigos de salida, manejo de `.env`, logs y
  checklist de seguridad.
- [`references/migracion.md`](references/migracion.md) — cómo empaquetar un `.py` suelto ya
  existente sin romper su comportamiento.
- `plantillas/` — archivos listos para copiar y sustituir.

---

## Examples

**Crear desde cero**
> "Hazme un utilitario que lea un xlsx de pólizas y las dé de alta en la API de Element,
> que corra en su venv y no me instale nada en la máquina."

**Migrar uno existente**
> "Empaqueta `RevisaPeso.py` con su `.sh`, su README y su venv como hicimos con
> `importacionClientePento`."

**Proceso de carga masiva**
> "Necesito un proceso que suba los PDFs de una carpeta a un bucket de GCS, con dry-run y
> que me deje log de cada corrida."

---

## Integration notes

- **`ozali-commit`** — al cerrar el utilitario, delega el commit ahí. Verifica antes que
  `venv/` y `logs/` **no** hayan quedado en stage.
- **`skill-generator`** — si aparece un patrón nuevo que se repite dentro de los
  utilitarios (p. ej. siempre el mismo flujo de conexión a una BD concreta), extráelo a su
  propia skill en lugar de engordar esta.
