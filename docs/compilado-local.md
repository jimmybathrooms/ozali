# Compilado y uso local (para probar el repo clonado)

← [README](../README.md)

Guía para cuando **clonas este repositorio** y quieres compilarlo/empaquetarlo y **probarlo en local**
antes de publicarlo o para desarrollar sobre él.

> **Aclaración importante — no hay "compilación".** `ozali` es un CLI **Node de cero dependencias y
> ESM puro** (solo usa módulos `node:*`). **No hay build step**, ni TypeScript que transpilar, ni
> `dist/`. "Compilar" aquí significa una de dos cosas: (a) **correrlo tal cual** desde el fuente, o
> (b) **empaquetar el artefacto distribuible** (`npm pack` → un `.tgz`, el "archivo base") para
> instalarlo y probarlo como lo haría un usuario final.

---

## Requisitos

- **Node ≥ 16** (`node --version`). Es lo único imprescindible.
- **git** (el CLI lee identidad/estado del repo).
- **pnpm** o **npm** (opcional; solo para `test`, `pack`, `link` o instalación global). No hay `npm
  install` que correr: **el repo no tiene dependencias**.

```bash
git clone https://github.com/jimmybathrooms/ozali.git
cd ozali
```

---

## 1. Correr desde el fuente (sin instalar nada)

Como no hay dependencias ni build, el CLI corre directo:

```bash
node cli/bin/ozali.mjs --version     # imprime la versión de package.json (p. ej. 0.8.0)
node cli/bin/ozali.mjs --help        # lista de comandos
node cli/bin/ozali.mjs doctor        # health-check en el cwd
```

Esta es la forma **más auditable**: ejecutas exactamente el código que ves, sin capa de instalación.

---

## 2. Correr la batería de pruebas

```bash
npm test        # (o: pnpm test)  → node --test cli/test/*.test.mjs
```

Debe salir todo en verde. Los tests son `node:test` puro (sin dependencias) y cubren init, doctor,
update, workspace, seguridad del paquete y los helpers de release de Engram.

---

## 3. Empaquetar el "archivo base" (tarball distribuible)

El artefacto que se publicaría en npm es un tarball `.tgz`. Se genera con:

```bash
npm pack                 # (o: pnpm pack)
# → crea  ozali-<version>.tgz  en la raíz del repo (el cwd)
```

Para tu versión actual produce, por ejemplo, **`ozali-0.8.0.tgz`**. Es **idéntico** a lo que recibiría
un usuario desde npm: incluye solo lo declarado en `package.json > files` (`cli/`, `skill/`,
`skill-commit/`, `templates/`, `docs/`, `README.md`, `LICENSE`).

Para **ver qué contiene sin generar el archivo**:

```bash
npm pack --dry-run       # lista archivos, tamaño y nombre del tarball, sin escribir nada
```

> El `.tgz` es un artefacto temporal: **no lo commitees**. Bórralo tras probar (o añádelo a
> `.gitignore` como `ozali-*.tgz`).

### Extraer / inspeccionar el tarball

El tarball es un `.tar.gz` estándar. Para extraerlo y revisar el "archivo base" tal como quedaría
instalado:

```bash
tar -xzf ozali-0.8.0.tgz      # crea una carpeta  package/  con el contenido publicable
ls -R package                 # inspecciona la estructura
tar -tzf ozali-0.8.0.tgz      # o solo LISTA el contenido, sin extraer
```

La carpeta `package/` es exactamente lo que npm coloca en `node_modules/ozali` al instalar.

---

## 4. Usarlo en local para pruebas

Tres formas, de la más cómoda para desarrollar a la más fiel al usuario final:

### a) `npm link` — bucle de desarrollo (refleja tus cambios al instante)

```bash
npm link                 # (o: pnpm link --global)
# ahora 'ozali' está en tu PATH, apuntando al clon local
ozali --version
ozali doctor
```

Como es un symlink al repo, cualquier edición que hagas en `cli/` se ve de inmediato (no hace falta
re-linkear). Para deshacer: `npm unlink -g ozali` (o `npm rm -g ozali`).

### b) Instalar el tarball global — prueba el artefacto real

Instala el `.tgz` como lo haría un usuario, para validar el paquete exacto que publicarías:

```bash
npm i -g ./ozali-0.8.0.tgz     # (o: pnpm add -g ./ozali-0.8.0.tgz)
ozali --version
```

Para desinstalar: `npm rm -g ozali`.

### c) Efímero, sin instalar en el PATH — como `npx`/`pnpm dlx`

```bash
npx ./ozali-0.8.0.tgz init        # corre init desde el tarball, sin dejar 'ozali' instalado
pnpm dlx ./ozali-0.8.0.tgz init   # equivalente con pnpm
```

> **Nota de seguridad:** el flag `--ignore-scripts` que recomendamos para instalar desde npm es
> irrelevante aquí, porque `ozali` **no tiene dependencias ni lifecycle scripts** (nada que ejecutar
> en install). Detalle en [security.md](security.md).

---

## 5. Probar en un proyecto sandbox

Crea un repo de juguete y corre el flujo real sin ensuciar nada:

```bash
mkdir /tmp/ozali-sandbox && cd /tmp/ozali-sandbox && git init

# opción sin instalar: apunta al bin del clon
node /ruta/al/clon/ozali/cli/bin/ozali.mjs init --dry-run          # muestra el plan, no escribe
node /ruta/al/clon/ozali/cli/bin/ozali.mjs init --yes --no-engram  # init real, sin instalar Engram
node /ruta/al/clon/ozali/cli/bin/ozali.mjs doctor                  # verifica el resultado
```

Para probar **workspaces multi-repo**, crea una carpeta con varios repos git dentro y corre:

```bash
node /ruta/al/clon/ozali/cli/bin/ozali.mjs workspace --dry-run     # inventario + plan, sin escribir
node /ruta/al/clon/ozali/cli/bin/ozali.mjs workspace --doctor      # health-check de todos los miembros
```

(Si hiciste `npm link`, sustituye todo lo anterior por simplemente `ozali <comando>`.)

---

## 6. Verificar y limpiar

```bash
ozali --version                 # debe coincidir con la "version" de package.json
npm rm -g ozali                 # desinstala el global (link o tarball)
rm -f ozali-*.tgz               # borra el tarball de prueba
rm -rf package/                 # borra la extracción del tarball, si la hiciste
```

---

## Resumen

| Quiero… | Comando |
|---|---|
| Correr sin instalar | `node cli/bin/ozali.mjs <cmd>` |
| Correr los tests | `npm test` |
| Empaquetar el distribuible | `npm pack` → `ozali-<version>.tgz` |
| Ver el contenido del paquete | `npm pack --dry-run` |
| Extraer el tarball | `tar -xzf ozali-<version>.tgz` → `package/` |
| Desarrollar con `ozali` en PATH | `npm link` |
| Probar el artefacto real | `npm i -g ./ozali-<version>.tgz` |
| Probar efímero | `npx ./ozali-<version>.tgz init` |

> ¿Buscas **publicar** una versión nueva (no solo probar)? Eso es otro flujo: bump de `version` en
> `package.json` → commit → tag `vX.Y.Z` → push; el tag dispara la publicación a npm con provenance
> vía GitHub Actions.
