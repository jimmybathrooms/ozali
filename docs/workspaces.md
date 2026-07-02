# Workspaces multi-repo (`ozali workspace`)

← [README](../README.md)

Objetivo: cuando abres en tu editor (VSCode, **Antigravity** — ambos de la familia VSCode) una
**carpeta raíz que agrupa varios repositorios relacionados** (una API, su front, librerías
compartidas), que el agente pueda **trabajar en conjunto** con todos, porque tienen **referencias
entre ellos**.

`ozali` opera por defecto **repo por repo**. El comando `ozali workspace` añade una capa de
coordinación **a nivel de la carpeta raíz**, sin quitarle autonomía a ningún repo miembro (cada uno
conserva su `ozali-jarvis`, su skill `cdk`, su fuente de verdad y su memoria Engram).

## Uso

Corre **una vez** en la carpeta raíz (la que contiene los repos):

```bash
ozali workspace              # escanea, remedia y escribe la config conjunta
ozali workspace --dry-run    # solo inventario + plan, sin escribir nada
ozali workspace --yes        # no interactivo (acepta defaults y todas las referencias detectadas)
ozali workspace --depth 2    # busca repos hasta 2 niveles bajo la raíz
ozali workspace --no-trust   # no marca la raíz como confiable en Claude Code
```

Un CLI **no puede auto-dispararse** con solo hacer `cd`; por eso es un comando explícito e
**idempotente**: re-córrelo cuando agregues repos o cambien las referencias.

## Qué hace, paso a paso

1. **Escaneo (read-only).** Enumera los repos git hijos y reporta el estado ozali de cada uno:
   - `✔ listo` — tiene `.ozali/config.json` **y** su skill `cdk` (`.claude/skills/cdk/SKILL.md`).
   - `⚠ sin calibrar` — tiene `ozali init` pero **falta `cdk`** (aún no se calibró).
   - `✖ sin init` — no tiene `.ozali/config.json`.

2. **Remediación.** Por cada repo `✖ sin init`, ofrece correr **`ozali init`** (el "prepare":
   instala skills, aísla histórico, configura Engram). Hereda `agent`/`scope`/`knowledge-repo` de un
   repo ya inicializado para mantener el equipo consistente.

3. **Guía de calibración.** El CLI **no calibra** (eso lo hace el agente). Para cada repo
   `⚠ sin calibrar`, imprime la instrucción: abre ese repo en tu agente y corre la skill **`ozali`**
   ("diagnostica el proyecto") para generar su `cdk`. El orquestador de workspace también queda
   cableado para conducir esa calibración repo por repo.

4. **Referencias (auto-detección + confirmación).** Infiere aristas dirigidas `from → to`:
   - `npm-dep` — el `name` de un repo aparece en `dependencies`/`devDependencies`/`peerDependencies` de otro.
   - `git-submodule` — un `path` de `.gitmodules` apunta a un repo hermano.
   - `compose` — un `build.context` de `docker-compose.yml` apunta a un repo hermano.

   Te muestra lo detectado y lo confirmas (con `--yes` se aceptan todas).

## Qué escribe

En la carpeta raíz:

| Artefacto | Qué es |
|---|---|
| `ozali-workspace.json` | Manifiesto: miembros (ruta, proyecto, estado, fuente de verdad), referencias, `knowledgeRepo`, cloud. Fuente de verdad del workspace. |
| `<carpeta>.code-workspace` | Workspace **multi-root** de VSCode/Antigravity: abre todos los repos juntos. Merge idempotente si ya existe. |
| `CLAUDE.md` / `AGENTS.md` (raíz) | Bloque marcado del orquestador **`ozali-workspace-jarvis`** + subagente / agente de opencode. |

Si la raíz es a su vez un repo git, se añade `.claude/`, `.engram/` y `.ozali/` a su `.gitignore`
(los artefactos locales del agente no se commitean). `ozali-workspace.json` y `.code-workspace` **sí**
son commiteables/compartibles.

## El orquestador `ozali-workspace-jarvis`

Es una persona de agente que **lee `ozali-workspace.json` en runtime** (no se re-templatiza al cambiar
miembros). Su trabajo:

- Recall-first **a nivel workspace**: ubica qué repo(s) toca la tarea y recupera memoria **solo** de
  los proyectos involucrados.
- Verifica que el repo esté `listo` antes de tocar código; si está `sin init`/`sin calibrar`, lo dice.
- **Delega la ejecución** al `cdk` del repo correspondiente (plan, GATE, TDD, docs por hito).
- En cambios que **cruzan repos**, secuencia según las `references` (primero el proveedor/`to`, luego
  el consumidor/`from`) y anota el cambio en la memoria de **ambos** repos.

## Fuera de alcance (por ahora)

- Auto-sugerencia al abrir la carpeta (tarea de editor/hook).
- `ozali doctor`/`sync` agregados a nivel workspace.
- Detección de referencias más allá de npm/submódulos/compose (imports TS/py, `go.work`).
