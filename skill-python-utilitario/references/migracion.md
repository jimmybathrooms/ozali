# Migrar un `.py` suelto a utilitario empaquetado

Cómo tomar un script que hoy vive suelto —o empaquetado con la variante vieja— y dejarlo
autocontenido, sin cambiar lo que hace.

> **Principio:** la migración es **estructural**, no funcional. Si de paso quieres arreglar
> un bug o cambiar el comportamiento, hazlo en un commit aparte. Así, si algo se rompe,
> sabes si fue la migración o el cambio.

---

## 1. Inventariar el script actual

Antes de mover nada, responde:

| Pregunta | Cómo averiguarlo |
|---|---|
| ¿Qué importa de terceros? | `grep -nE '^\s*(import|from) ' script.py` y descarta la stdlib |
| ¿Qué rutas usa? | Busca rutas absolutas y `open(`, `os.path.join(` |
| ¿Cómo recibe parámetros? | ¿`argparse`, `sys.argv`, o constantes hardcodeadas arriba? |
| ¿Qué credenciales usa? | Busca los **nombres** de variables de entorno y constantes de configuración |
| ¿Escribe en algún lado? | BD, API, storage — determina si necesita `--dry-run` |

**Rutas absolutas hardcodeadas** (`/Users/tuusuario/...`) son el hallazgo más común. Hay
que reemplazarlas por rutas derivadas de `BASE_DIR`; si no, el utilitario no es portable y
la migración no sirvió de nada.

**Credenciales hardcodeadas en el `.py`** son el segundo hallazgo más común. Se sacan a
`.env`. Cuando encuentres una: sácala, no la copies al mensaje ni al log, y avísale al
usuario que esa credencial estuvo en el repo y conviene rotarla.

---

## 2. Armar la carpeta

```
<nombreUtilitario>/
├── <nombreUtilitario>.py
├── run_<nombreUtilitario>.sh
├── requirements.txt
├── README.md
└── .gitignore
```

Copia las plantillas de `plantillas/` y sustituye `{{NOMBRE}}` y `{{DESCRIPCION}}`.

Mueve el script con `git mv` si ya estaba versionado — así git conserva el historial en
lugar de verlo como un borrado más un archivo nuevo.

---

## 3. Injertar la lógica en el esqueleto

Conserva del template, **sin modificar su contrato**:

- el bloque de rutas (`BASE_DIR`, `DIR_LOGS`, `DIR_ENTRADA`),
- el guard `_FALTANTES` de dependencias,
- la clase `Log`,
- el `main()` con `argparse`,
- el bloque `__main__` con el manejo de `KeyboardInterrupt`.

Del script original conserva su lógica de negocio, y adáptala así:

| En el script viejo | En el utilitario |
|---|---|
| `print()` de detalle | `log.escribir(...)`; en pantalla solo el resumen |
| Constantes de configuración arriba | Siguen arriba, en la sección *Configuración* |
| Credenciales hardcodeadas | `.env` + `exigir_env("NOMBRE")` |
| Rutas absolutas | `os.path.join(BASE_DIR, ...)` |
| `sys.argv[1]` | argumento de `argparse` |
| Sin salida de error | Códigos de salida `0/1/2/130` |

---

## 4. Cerrar el `requirements.txt`

Con el venv ya creado por el `.sh`, esto te da las versiones exactas que sí funcionan:

```bash
./venv/bin/pip freeze
```

No pegues el `freeze` completo — trae las dependencias transitivas. Toma solo los paquetes
que el script importa directamente y fíjales la versión que reportó `freeze` como mínimo
(`>=`).

---

## 5. Verificar que no cambió el comportamiento

```bash
chmod +x run_<nombre>.sh
./run_<nombre>.sh --dry-run
```

- [ ] El `--dry-run` procesa la misma entrada que procesaba antes
- [ ] Se creó `venv/` dentro de la carpeta
- [ ] Nada se instaló fuera del venv
- [ ] Se generó el log en `logs/`
- [ ] Corre desde otro directorio: `cd / && /ruta/completa/run_<nombre>.sh --dry-run`
- [ ] `git status` no muestra `venv/`, `logs/` ni `.env`

Recién entonces, una corrida real contra un subconjunto chico (`--desde` / pocos
registros) antes de soltarlo contra el archivo completo.

---

## 6. Caso especial: migrar de la variante vieja

Los utilitarios de `inter/scotiabank/` usan `.venv_<nombre>/` y declaran los paquetes con
`pip install` en línea dentro del `.sh`. Para normalizarlos:

1. Crea `requirements.txt` con los paquetes que hoy están en línea en el `.sh`, con versión
   fijada.
2. Reemplaza el `.sh` completo por `plantillas/run_TEMPLATE.sh` sustituido.
3. Borra el `.venv_<nombre>/` viejo — el nuevo `.sh` crea `venv/` solo.
4. Agrega el guard `_FALTANTES` al `.py` si no lo tiene.
5. Verifica que `.gitignore` cubra `venv/` (y quita la entrada del `.venv_<nombre>/` viejo).
