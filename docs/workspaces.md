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
ozali workspace --scan-all   # incluye también repos en disco no declarados en el .code-workspace
ozali workspace --no-code-workspace  # ignora el .code-workspace; solo escaneo de carpetas
ozali workspace --no-trust   # no marca la raíz como confiable en Claude Code
```

Si lo corres **parado dentro de uno de los repos** (lo más común al venir de trabajar), no falla:
sube hasta 3 niveles buscando la carpeta que los agrupa —por su `*.code-workspace` o por sus repos
hijos— y te pregunta si la usa como raíz.

Un CLI **no puede auto-dispararse** con solo hacer `cd`; por eso es un comando explícito e
**idempotente**: re-córrelo cuando agregues repos o cambien las referencias.

### Operar todos los repos desde la raíz

Para no entrar repo por repo, dos modos batch corren un comando sobre **todos los miembros**:

```bash
ozali workspace --doctor     # health-check de cada repo miembro + resumen consolidado
ozali workspace --update     # actualiza skills/permisos/jarvis de cada repo + avisa de cdk desfasado
```

Ambos son **solo CLI** (no necesitan el agente) y saltan los repos `✖ sin init`. La **calibración**
(generar `cdk`) sí la hace el agente, pero también **sin cambiar de proyecto** — ver abajo.

## Qué hace, paso a paso

1. **Escaneo (read-only).** Determina los miembros y reporta el estado ozali de cada uno.

   **De dónde salen los miembros:** si la raíz tiene un `*.code-workspace` (el multi-root que ya
   usas en VSCode/Antigravity), **manda él**: sus `folders[]` son la lista **cerrada** de miembros,
   y pueden vivir **fuera** de la raíz (`"path": "../otra/carpeta/repo"`). Los repos git que estén
   en disco pero **no** declarados ahí quedan fuera y solo se **reportan** —para que te enteres si
   agregaste uno y olvidaste meterlo al workspace—; los incluyes agregándolos en tu editor o con
   `--scan-all`. Sin `*.code-workspace`, se escanean los repos git hijos de la raíz.

   Estados:
   - `✔ listo` — tiene `.ozali/config.json` **y** su skill `cdk` (`.claude/skills/cdk/SKILL.md`).
   - `⚠ sin calibrar` — tiene `ozali init` pero **falta `cdk`** (aún no se calibró).
   - `✖ sin init` — no tiene `.ozali/config.json`.

2. **Remediación.** Por cada repo `✖ sin init`, ofrece correr **`ozali init`** (el "prepare":
   instala skills, aísla histórico, configura Engram). Hereda `agent`/`scope`/`knowledge-repo` de un
   repo ya inicializado para mantener el equipo consistente.

3. **Guía de calibración.** El CLI **no calibra** (eso lo hace el agente), pero ya **no** tienes que
   abrir cada repo por separado: `ozali workspace` instala la skill **`ozali`** en la **raíz**, y el
   orquestador `ozali-workspace-jarvis` la usa **en modo target** para calibrar cada repo
   `⚠ sin calibrar` **desde el workspace**, repo por repo y con su propio 🛑 GATE. Abre el agente en la
   raíz y pídele *"calibra los repos pendientes"*.

4. **Referencias (auto-detección + confirmación).** Infiere aristas dirigidas `from → to`:
   - `npm-dep` — el `name` de un repo aparece en `dependencies`/`devDependencies`/`peerDependencies` de otro.
   - `maven-dep` — un `pom.xml` declara como dependencia el artefacto que publica un repo hermano.
     El cruce es por `groupId:artifactId` (con fallback al `artifactId` solo), así que **la carpeta
     puede llamarse distinto que el artefacto** (`sio4-core-polizas-new` publica `sio4-core-polizas`).
     Se revisan el `pom.xml` de la raíz del repo y el de sus `<module>` de primer nivel.
   - `git-submodule` — un `path` de `.gitmodules` apunta a un repo hermano.
   - `compose` — un `build.context` de `docker-compose.yml` apunta a un repo hermano.

   Te muestra lo detectado y lo confirmas (con `--yes` se aceptan todas).

   **Referencias a mano.** Lo detectado se guarda con `"source": "auto"`. Si una relación no se puede
   inferir (un consumo REST, una cola, un contrato compartido), **agrégala tú** al
   `ozali-workspace.json` con el `kind` que la describa: al re-correr, ozali **la conserva** y la marca
   `"source": "manual"`. Solo se reescriben las `auto`.

## Qué escribe

En la carpeta raíz:

| Artefacto | Qué es |
|---|---|
| `ozali-workspace.json` | Manifiesto: miembros (ruta, proyecto, estado, fuente de verdad), referencias (`from`, `to`, `kind`, `source`), `knowledgeRepo`, cloud. Fuente de verdad del workspace. |
| `<carpeta>.code-workspace` | Workspace **multi-root** de VSCode/Antigravity: abre todos los repos juntos. Merge idempotente si ya existe; si ya lo tenías armado, **él define los miembros**. |
| `CLAUDE.md` / `AGENTS.md` (raíz) | Bloque marcado del orquestador **`ozali-workspace-jarvis`** + subagente / agente de opencode. |
| `.claude/skills/ozali/` (raíz) | La skill **`ozali`** instalada en la raíz para **calibrar miembros en modo target** sin cambiar de proyecto (solo Claude Code). |

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
- `ozali sync` agregado a nivel workspace (`--doctor`/`--update` ya existen; falta `--sync`).
- Detección de referencias más allá de npm/Maven/submódulos/compose (imports TS/py, `go.work`,
  Gradle). Mientras tanto, agrégalas a mano: se preservan (`"source": "manual"`).
- Automatizar el push: las `references` las usa el **agente** para secuenciar el trabajo
  (proveedor → consumidor); no hay hook de git que se dispare al subir cambios.
