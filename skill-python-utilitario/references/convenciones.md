# Convenciones de los utilitarios Python

Fuente de verdad de la skill `python-utilitario`. Implementación de referencia:
`pythonfiles/jimmy/utils/importacionClientePento/`.

---

## 1. Anatomía de la carpeta

```
<nombreUtilitario>/
├── <nombreUtilitario>.py        # lógica de negocio
├── run_<nombreUtilitario>.sh    # ÚNICO script de arranque
├── requirements.txt             # dependencias, versiones fijadas
├── README.md                    # cómo se usa
├── .gitignore
├── entrada/                     # insumos del usuario (ignorada)
├── logs/                        # una bitácora por corrida (ignorada)
└── venv/                        # entorno virtual (ignorada, se regenera sola)
```

La carpeta es **autocontenida**: se puede copiar a otra máquina, correr el `.sh` y
funciona. No depende de nada instalado globalmente más allá de `python3`.

---

## 2. Naming

| Elemento | Convención | Ejemplo |
|---|---|---|
| Carpeta | camelCase, igual que el script | `importacionClientePento` |
| Script Python | `<nombre>.py` | `importacionClientePento.py` |
| Runner | `run_<nombre>.sh` | `run_importacionClientePento.sh` |
| Entorno virtual | siempre `venv/` | — |
| Log | `<nombre>_<YYYYmmdd_HHMMSS>.log` | `importacionClientePento_20260902_141530.log` |

El nombre describe **la acción sobre el objeto**: `importacionPagos`, `scotiaMoveFile`,
`usuarioGenToken`. Sin guiones, sin snake_case, sin prefijos genéricos (`test`, `script`,
`proceso1`).

> **Nota sobre el repo actual:** algunos utilitarios de `inter/scotiabank/` usan
> `.venv_<nombre>/` y declaran las dependencias con `pip install` en línea dentro del `.sh`.
> Esa es la variante **vieja**. Lo canónico es `venv/` + `requirements.txt`. Si tocas uno de
> esos, aprovecha para migrarlo (ver `migracion.md`).

---

## 3. Dependencias según el destino

| El utilitario habla con… | Paquetes |
|---|---|
| API REST | `requests>=2.31.0` |
| Excel `.xlsx` / `.xlsm` | `openpyxl>=3.1.0` |
| Excel `.xls` (viejo) | `xlrd>=2.0.1` |
| CSV / TXT | nada — `csv` es de la stdlib |
| MySQL / MariaDB | `mysql-connector-python>=8.3.0` |
| Google Cloud Storage | `google-cloud-storage>=2.14.0` |
| SFTP | `paramiko>=3.4.0` |
| Barra de progreso | nada — el template ya trae `barra_progreso()`; `tqdm` solo si hace falta algo más |

**El `.env` no necesita `python-dotenv`.** El template trae `cargar_env()` con stdlib pura.
Una dependencia menos que instalar y una menos que puede fallar.

---

## 4. El único `.sh`

Un solo script hace las tres cosas, en este orden:

1. Crea `venv/` si no existe (`python3 -m venv`).
2. Lo activa y, **si `requirements.txt` cambió**, instala las dependencias.
3. Ejecuta el Python y traduce su código de salida a un mensaje legible.

**Por qué uno solo:** dos scripts (uno de setup y otro de ejecución) obligan a recordar
cuál corrió antes y en qué orden, y garantizan que tarde o temprano alguien ejecute el de
ejecución sin haber corrido el de setup. Un solo punto de entrada elimina esa clase entera
de errores.

**Detección de cambios en dependencias.** El `.sh` guarda el SHA-256 de `requirements.txt`
en `venv/.requirements.sha`. Mientras el hash no cambie, no llama a `pip` y el arranque es
instantáneo. Es más robusto que la variante vieja de comprobar módulo por módulo con
`python -c "import x"`, porque no hay que mantener la lista de módulos duplicada dentro del
`.sh`.

**Portabilidad.** `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` hace que el
utilitario corra igual desde cualquier directorio. Todas las rutas se derivan de ahí.

**Siempre `set -euo pipefail`**, salvo alrededor de la llamada al Python, donde se
desactiva con `set +e` para poder capturar el código de salida.

---

## 5. Códigos de salida

| Código | Significado | Quién lo emite |
|---|---|---|
| `0` | Todo correcto | `sys.exit(0)` |
| `1` | Terminó con registros fallidos, o error de validación de argumentos | `sys.exit(1)` |
| `2` | Interrupción de negocio **reanudable** — credencial o token vencido | el flujo de negocio |
| `130` | Cancelado por el usuario | `except KeyboardInterrupt` |

El `2` es el que hace útil a `--desde`: el log dice en qué registro se cortó, el usuario
renueva la credencial y reanuda desde ahí sin reprocesar lo que ya pasó.

---

## 6. Seguridad

> **Regla:** un utilitario documenta y consume secretos, pero nunca los expone.

- Las variables de entorno se documentan **por nombre** (`DB_PASS`), jamás por valor.
- `exigir_env()` reporta qué variables faltan **por nombre**; nunca imprime lo que sí hay.
- El `.env` va en `.gitignore` desde el primer commit, junto con `*.key`, `*.pem` y
  `*-service-account.json`.
- Un token largo **no se pide desde el `.sh`**. En macOS la terminal en modo canónico corta
  la línea en 1024 bytes (`MAX_CANON`), así que un `read -s` de un JWT largo descarta el
  resto y parece colgado. Si hace falta pedirlo interactivamente, lo hace el Python
  leyendo byte a byte con `ICANON` apagado, o se pasa con `--token-file`.
- Los logs no deben contener credenciales. Si se registra un request, el header de
  autorización va como `***`.
- `entrada/` se ignora en git porque suele traer datos reales de clientes. Solo se versiona
  un `layout_ejemplo.csv` con datos ficticios.

### Checklist antes de dar por terminado un utilitario

- [ ] `.gitignore` incluye `venv/`, `logs/`, `.env`, `entrada/*`
- [ ] Ningún valor de credencial aparece en el `.py`, el `.sh` o el `README.md`
- [ ] Los logs no imprimen tokens ni contraseñas
- [ ] `git status` no muestra `venv/` ni `logs/` como archivos por commitear

---

## 7. `--dry-run`

Obligatorio en todo utilitario que escriba en algún destino (base de datos, API, storage,
SFTP). En modo dry-run el proceso:

- lee y **valida** la entrada completa,
- arma los payloads o sentencias reales,
- los registra en el log,
- y **no ejecuta ninguna escritura**.

Es la única forma barata de verificar un layout de 3000 registros antes de mandarlo.

---

## 8. Logs

Una bitácora por corrida, con timestamp en el nombre — así quedan todas y se puede
comparar. El encabezado del log registra siempre: inicio, archivo de entrada, destino,
número de registros, punto de arranque (`--desde`) y modo (REAL o DRY-RUN). El cierre
registra exitosos, fallidos y duración.

Lo que se ve en pantalla es un resumen; lo que se ve en el log es el detalle registro por
registro. No al revés.
