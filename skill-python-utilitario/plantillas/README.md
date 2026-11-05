# {{NOMBRE}}

{{DESCRIPCION}}

## Ejecución rápida (recomendado)

El `.sh` se encarga de todo: crea el entorno virtual si no existe, instala las
dependencias, elige el archivo de `entrada/` y corre el Python. **No instala nada en tu
máquina** — todo vive dentro de `venv/`.

```bash
chmod +x run_{{NOMBRE}}.sh

./run_{{NOMBRE}}.sh                          # menú con los archivos de entrada/
./run_{{NOMBRE}}.sh entrada/datos.xlsx       # archivo directo
./run_{{NOMBRE}}.sh entrada/datos.xlsx --dry-run
./run_{{NOMBRE}}.sh entrada/datos.xlsx --desde 25
```

- Si no le pasas archivo, busca en `entrada/`: si hay uno solo lo toma, si hay varios
  muestra un menú numerado.
- Cualquier flag extra se pasa tal cual al Python.
- La primera corrida tarda un poco más porque crea el venv e instala dependencias. Las
  siguientes arrancan al instante.

## Flags

| Flag | Descripción |
|---|---|
| `--desde N` | Empieza en el registro N. Sirve para reanudar una corrida interrumpida. |
| `--espera S` | Segundos de espera entre operaciones. |
| `--dry-run` | Valida y muestra lo que se enviaría, sin escribir en el destino real. |

## Layout de entrada

<!-- Si el utilitario lee un archivo, documenta aquí las columnas. Se leen POR NOMBRE,
     así que el orden puede variar. Borra esta sección si no aplica. -->

| Columna | Obligatoria | Descripción |
|---|---|---|
| `COLUMNA_A` | Sí | … |
| `COLUMNA_B` | No | … |

## Variables de entorno

<!-- Documenta solo los NOMBRES. Nunca pongas valores reales en el README. -->

Se leen del archivo `.env` en esta misma carpeta (no versionado) o del shell:

| Variable | Descripción |
|---|---|
| `DB_HOST` | Host del servidor de base de datos |
| `DB_USER` | Usuario de conexión |
| `DB_PASS` | Contraseña de conexión |

## Salida

Cada corrida deja una bitácora en `logs/{{NOMBRE}}_<fecha>.log` con el detalle registro por
registro.

Códigos de salida:

| Código | Significado |
|---|---|
| `0` | Todo correcto |
| `1` | Terminó con registros fallidos — revisa el log |
| `2` | Interrumpido por credencial vencida — renuévala y reanuda con `--desde` |
| `130` | Cancelado por el usuario (Ctrl-C) |

## Instalación manual (opcional)

Solo si prefieres correr el Python directo, sin el `.sh`:

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python {{NOMBRE}}.py entrada/datos.xlsx
```
