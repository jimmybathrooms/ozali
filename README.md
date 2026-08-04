<div align="center">

# ozali

[![npm version](https://img.shields.io/npm/v/ozali.svg)](https://www.npmjs.com/package/ozali)

**Bootstrap de IA por equipo — calibra tus proyectos, genera una skill de ejecución con TDD/SDD, y mantiene memoria de equipo (Engram) con histórico aislado.**

</div>

---

## 🗞️ Novedades

| Versión | Novedad |
|---------|---------|
| **v0.16.3** | **`install-skills` + `needsNode` + Opción B + fix copsis-commit**: Nuevo comando `install-skills` instala skills globales sin `init`. `ozali update` detecta Engram faltante y skills ausentes. `ozali doctor` solo valida Node ≥ 16 cuando el proyecto lo usa (detecta `package.json` o archivos `.js/.ts`); en backends Java/Go/Python muestra "no aplica" en vez de warning. `ozali init` defaultea a `global` cuando ya existe skill global (Opción B, evita duplicados). Fix de falso positivo de `copsis-commit` en `doctor`. |
| **v0.16.0** | **Verificación real del plugin Engram MCP + fix de corrupción de `knowledgeRepo`**: `ozali doctor`/`init`/`update`/`install-engram` ahora leen `~/.claude/plugins/installed_plugins.json` y distinguen entre "plugin no instalado" y "instalado pero deshabilitado", con mensajes explícitos y pasos exactos para habilitarlo (`/plugin install engram@engram`). Fix en `toPortablePath` para expandir `~` antes de `path.resolve`, preferir `base-relative` sobre `home-relative`, y defenderse de paths corruptos con `~` interno. Handshake Engram en `ozali-jarvis` y skill `ozali` para detectar MCP inactivo al inicio de cada sesión. |
| v0.15.0 | Clasificación cognitiva de agentes: cada subagente CDK tiene un `model:` (`low`/`medium`/`high`) que se resuelve a modelo real de Claude u opencode vía `.ozali/config.json`. Reglas híbridas para `project-documenter` (técnico vs sencillo) y `tester` (ejecución vs diagnóstico). Configuración local `.ozali/config.local.json`. `ozali doctor` detecta si el config fue editado después de generar los subagentes. |
| v0.14.0 | Dashboard `ozali dashboard`, checkpoints obligatorios entre fases CDK, reanudación automática de hitos, micro-checkpoints intra-fase. Co-authored-by automático en `ozali-commit`. |
| v0.13.0 | Cloud sync auto (`ozali sync --auto`), workspace multi-repo, `ozali audit --tui`, Engram Cloud con enrolamiento, deploy guides VPS y GCloud. |
| v0.12.0 | Skill `skill-generator`, CDK contrato v2 (seguridad PII + integración skill-generator), `ozali doctor --fix`, `ozali init --knowledge-only`. |
| v0.11.0 | Memoria híbrida (Engram + docs), recall-first, telemetría de tokens, `ozali-jarvis` always-on. |

---

## Qué es

`ozali` lleva a cualquier repositorio existente a un flujo de desarrollo asistido por IA,
**disciplinado y trazable**, pensado para equipos. No es un chatbot: es un método.

- **Diagnostica y calibra** el proyecto: detecta stack, arquitectura, convenciones, capacidades de
  testing y resuelve **Strict TDD** (test-first sí/no) contra lo que el proyecto realmente soporta.
- **Fuente de verdad** legible: `AI.md` + `.ai/` (el "Project Brain") — generado evaluando el
  código real, nunca inventado.
- **Genera `cdk`**, la skill de ejecución con **8 subagentes** (owner, manager, analyzer,
  orchestrator, executioners, proposer, documenter, tester), **GATE de aprobación** y plan
  congelado inmutable.
- **Memoria híbrida**: documentos legibles por humanos **+** Engram buscable/acumulable, para que
  la herramienta **aprenda de lo que el equipo va haciendo**.
- **Histórico aislado**: el registro que crece vive en un repo de conocimiento aparte, sin
  sobrecargar el repo principal.

## Dos piezas

1. **Proyecto completo** (este repo): la skill `ozali`, las `references/`, el harness, el CLI y los docs.
2. **Plug-n-play CLI**: instala y arranca el método en cualquier repo, de forma interogativa.

## Instalación (segura por diseño)

CLI **Node de cero dependencias y sin lifecycle scripts** → sin vector de supply-chain.
Detalle en [docs/security.md](docs/security.md).

```bash
# Recomendado (pnpm 10 deshabilita postinstall de deps por defecto)
pnpm dlx ozali@<versión> init

# npm con scripts desactivados
npx --ignore-scripts ozali@<versión> init

# Máxima auditabilidad
git clone <repo> && node ozali/cli/bin/ozali.mjs init
```

> **`dlx`/`npx` son efímeros:** ejecutan `init` pero **no dejan `ozali` en tu PATH**. Para usar
> `ozali doctor`/`update`/`sync` después, instala globalmente (el propio `init` te lo recuerda):
>
> ```bash
> pnpm add -g ozali@<versión>      # recomendado
> npm install -g ozali@<versión>
> ```

### Uso del CLI

```bash
ozali init           # detecta agente, instala skills ozali + ozali-commit, aísla histórico, configura Engram
ozali install-skills # instala skills globales cuando el repo ya está calibrado y solo faltan las skills
ozali workspace      # multi-repo: escanea la carpeta raíz, remedia init/calibración y cablea la config conjunta
ozali doctor         # health-check read-only (fuente de verdad, Engram, Cloud, versión de cdk, Strict TDD…)
ozali update         # actualiza skills + permisos; avisa si cdk quedó atrás; detecta Engram y skills globales
ozali sync           # lleva el histórico (docs + Engram) al repo de conocimiento de equipo
ozali audit          # navega/audita la memoria de Engram del proyecto (o general)
```

`ozali audit` recorre lo que el equipo ha acumulado en Engram: dentro de un repo propone auditar
**ese proyecto** o **general** (todos los proyectos); fuera de un repo va directo a general. Usa
`--tui` para el navegador interactivo, `--search "<texto>"` para buscar y `--general` para forzar el
alcance. Sin Engram, audita el histórico local de `.ozali/docs/`.

### Workspaces multi-repo

Cuando abres en tu editor (VSCode, **Antigravity**) una **carpeta raíz con varios repos** que se
referencian entre sí, corre **una vez** en esa raíz:

```bash
ozali workspace           # escanea repos hijos, remedia los que faltan y escribe la config conjunta
ozali workspace --dry-run # solo muestra el inventario y el plan, sin escribir
ozali workspace --yes     # no interactivo: acepta defaults y todas las referencias detectadas
ozali workspace --depth 2 # busca repos hasta 2 niveles (para raíces con subcarpetas de grupo)
ozali workspace --doctor  # health-check de TODOS los repos miembros + resumen (solo CLI)
ozali workspace --update  # actualiza skills/permisos/jarvis de TODOS los repos miembros (solo CLI)
```

Qué hace, en orden: (1) **escanea** los repos hijos y reporta su estado —`✔ listo`, `⚠ sin calibrar`
(falta `cdk`) o `✖ sin init`—; (2) **remedia** con `ozali init` los que no lo tienen y te **guía** para
calibrar (correr la skill `ozali` en cada repo — eso lo hace el agente, no el CLI); (3) **infiere las
referencias** entre repos (dependencias npm cruzadas, submódulos git, `docker-compose`) y las confirma
contigo; y (4) escribe la config para **trabajar en conjunto**:

- `ozali-workspace.json` — manifiesto de miembros, estado y referencias.
- `<carpeta>.code-workspace` — workspace multi-root que abre todos los repos juntos.
- Orquestador **`ozali-workspace-jarvis`** en `CLAUDE.md`/`AGENTS.md` de la raíz: coordina los repos
  según el manifiesto y delega la ejecución en el `cdk` de cada uno.
- La skill **`ozali`** en la raíz (`.claude/skills/ozali/`) para **calibrar los miembros desde el
  workspace** (modo target), sin abrir cada proyecto.

**Operar todo desde la raíz:** `ozali workspace --doctor` y `--update` corren el health-check y la
actualización sobre **todos** los repos miembros (solo CLI). Y para calibrar los `⚠ sin calibrar`,
abre el agente en la raíz y pídele a `ozali-workspace-jarvis` que *"calibre los repos pendientes"*: los
recorre uno por uno (con su GATE) sin que cambies de proyecto.

Es **idempotente**: re-córrelo cuando agregues repos o cambien las referencias. Detalle completo en
[`docs/workspaces.md`](docs/workspaces.md).

### Actualizar a una versión nueva

```bash
pnpm add -g ozali@<versión>   # actualiza el CLI global (pinea la versión por el cooldown de pnpm)
ozali update                  # en cada repo: refresca skill ozali + ozali-jarvis + permisos
```

`ozali update` también **crea ozali-jarvis** y **instala la skill `ozali-commit`** en repos
inicializados con versiones anteriores. Ahora también **detecta si Engram falta** y ofrece instalarlo,
y **avisa si las skills globales no están presentes**. La skill `cdk` la **regenera/migra tu agente**
(no el CLI): `ozali update` **detecta la versión de contrato** de `cdk` y, si quedó atrás (o aún
referencia activa `copsis-commit` de versiones viejas), te avisa y te da los pasos manuales. Tras
`ozali update`, abre el agente y vuelve a correr la skill `ozali`: su **pre-flight** detecta el `cdk`
existente, lo **migra automáticamente** al contrato vigente (eliminando `copsis-commit` y cableando
`ozali-commit`) y estampa la versión — tus docs por hito y el plan congelado se conservan.

> **Repo ya calibrado, solo faltan las skills?** Si el proyecto ya tiene `cdk` generado y `.ozali/config.json`,
> pero no tienes las skills en el agente, usa `ozali install-skills` para instalar `ozali`, `ozali-commit`
> y `skill-generator` globalmente sin pasar por `init`.

> **Commit del hito (`ozali-commit`):** `init`/`update` instalan la skill `ozali-commit`
> (`.claude/skills/ozali-commit/`). `cdk` la invoca al cerrar cada hito
> para generar el commit convencional (feat/fix/hotfix/refactor + scope) tras tu aprobación.

`init` también escribe un **perfil base de permisos** (`.claude/settings.json` para Claude Code,
`opencode.json` para opencode) para reducir confirmaciones: deja libres comandos seguros y bloquea
los destructivos. Es un template — tus reglas se conservan al re-correr `init`. Como Claude Code
**ignora** los permisos de un proyecto hasta confiar en él, `init` ofrece marcar el workspace como
confiable (`hasTrustDialogAccepted` en `~/.claude.json`); usa `--no-trust` para omitirlo.

`init` también **instala Engram** y registra su MCP con `engram setup <agente>`: en modo
interactivo te pregunta (default sí), y con `--yes` lo instala automáticamente. En **Linux**
descarga el **binario precompilado** correcto según tu arquitectura (amd64/arm64) a `~/.local/bin`
(sin sudo); en **macOS** usa brew → `go install` con el binario como fallback; en **Windows**
usa `go install`. Si algún paso falla, imprime instrucciones específicas de tu SO. Si prefieres no
instalarlo, pasa `--no-engram` (arranca en modo `docs`). Más tarde puedes instalarlo con
`ozali install-engram` bajo demanda. Opcionalmente habilita **Engram Cloud**
(réplica de equipo opt-in) además del git-sync.

> **Gotcha conocido (Engram MCP):** a veces el binario `engram` está en PATH y el marketplace está
> añadido, pero el plugin `engram@engram` no aparece en `/mcp`. Eso ocurre cuando el plugin está
> **deshabilitado** en Claude Code (`/plugin`). `ozali doctor` lo detecta y avisa; la solución rápida
> está en [`docs/troubleshooting/engram-mcp-no-carga.md`](docs/troubleshooting/engram-mcp-no-carga.md).

`init` también crea **ozali-jarvis**, un **orquestador always-on**: persona en `CLAUDE.md`/`AGENTS.md`
+ subagente + hooks de recordatorio que hace que el agente, **en toda sesión y sin necesidad de
`/cdk`**, recupere contexto de Engram, registre el trabajo del equipo (memoria en contexto) y delegue
la ejecución disciplinada en `cdk`. Fija el proyecto en `.engram/config.json` para memoria
determinista. Con Engram en línea, jarvis y `cdk` operan **recall-first** (reusan memoria en vez de
releer) para gastar menos tokens/contexto. Omítelo con `--no-jarvis`.

Flags útiles: `--yes` (no interactivo), `--dry-run` (init sin escribir), `--no-engram`, `--no-trust`,
`--no-jarvis`, `--agent`, `--scope`, `--knowledge-repo`, `--import`/`--push`/`--cloud` (sync). Modelo
mental completo en [docs/intended-usage.md](docs/intended-usage.md).

## Agentes soportados

Claude Code y opencode (perfiles de permisos para ambos en
[skill/references/permissions-bypass.md](skill/references/permissions-bypass.md)).

## Documentación

| Tema | Doc |
|---|---|
| Guía de uso (usuarios generales) | [docs/guia-de-uso.md](docs/guia-de-uso.md) |
| Uso previsto (modelo mental) | [docs/intended-usage.md](docs/intended-usage.md) |
| Compilado y uso local (repo clonado) | [docs/compilado-local.md](docs/compilado-local.md) |
| Seguridad del instalador (npx/pnpm) | [docs/security.md](docs/security.md) |
| Histórico aislado y memoria de equipo | [docs/team-history.md](docs/team-history.md) |
| Desplegar Engram Cloud (VPS) | [docs/deploy-cloud-vps.md](docs/deploy-cloud-vps.md) |
| Desplegar Engram Cloud (Google Cloud) | [docs/deploy-cloud-gcloud.md](docs/deploy-cloud-gcloud.md) |
| Integración con Obsidian | [docs/obsidian-integration.md](docs/obsidian-integration.md) |
| Troubleshooting: Engram MCP no carga | [docs/troubleshooting/engram-mcp-no-carga.md](docs/troubleshooting/engram-mcp-no-carga.md) |
| Skill bootstrap | [skill/SKILL.md](skill/SKILL.md) |
| Calibración de testing + TDD | [skill/references/calibration-blueprint.md](skill/references/calibration-blueprint.md) |
| Contrato y versión de `cdk` | [skill/references/cdk-contract.md](skill/references/cdk-contract.md) |
| Blueprint de agentes | [skill/references/agents-blueprint.md](skill/references/agents-blueprint.md) |
| Memoria híbrida (docs + Engram) | [skill/references/engram-convention.md](skill/references/engram-convention.md) |

### Agentes y Modelos

Cada agente del ecosistema `ozali` / `cdk` se clasifica por **categoría cognitiva** y se le asigna un **nivel de modelo** (`low` / `medium` / `high`). El modelo real (Claude u opencode) se resuelve consultando `.ozali/config.json` → `agents.models.{claude\|opencode}.{low\|medium\|high}`.

| # | Agente / Skill | Categoría | Nivel | Modelo Claude | Modelo Opencode |
|---|---------------|-----------|-------|---------------|-----------------|
| 1 | `project-analyzer` | A — Análisis Profundo | **High** | `claude-opus-4` | `mimo-v2.5` |
| 2 | `project-owner` | A — Análisis Profundo | **High** | `claude-opus-4` | `mimo-v2.5` |
| 3 | `ozali` | A — Análisis Profundo | **High** | `claude-opus-4` | `mimo-v2.5` |
| 4 | `executioners` | C — Escritura Código | **High** | `claude-opus-4` | `mimo-v2.5` |
| 5 | `project-orchestrator` | B — Orquestación | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 6 | `ozali-jarvis` | B — Orquestación | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 7 | `cdk` | B — Orquestación | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 8 | `project-manager` | E — Lectura/Propuesta | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 9 | `project-proposer` | E — Lectura/Propuesta | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 10 | `skill-generator` | E — Lectura/Propuesta | **Medium** | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 11 | `tester` | D — Validación | **Medium** (híbrido) | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 12 | `project-documenter` | C — Escritura Docs | **Medium** (híbrido) | `claude-sonnet-4-5` | `deepseek-v4-pro` |
| 13 | `ozali-commit` | D — Validación | **Low** | `claude-haiku-4-5` | `kimi-k3` |

> **Reglas híbridas:**
> - `project-documenter`: usa **High** para docs técnicos (`03-resumen-tecnico.md`, `05-bitacora-ejecucion.md`), **Medium** para docs sencillas (`01-prompt-entrada.md`, `04-resumen-usuario.md`).
> - `tester`: usa **Low** para ejecución mecánica de tests (pass/fail), **Medium** para diagnóstico de fallos.
>
> **Configuración local:** `.ozali/config.local.json` hace shallow merge sobre `.ozali/config.json` (igual que `.claude/settings.local.json`). Úsalo para ajustar modelos sin tocar el config compartido del equipo.

### Formato canónico de `.ozali/config.json`

`ozali init` genera este archivo con la siguiente estructura mínima (v0.16.2+):

```json
{
  "version": "0.16.2",
  "knowledgeRepo": "~/.ozali/knowledge",
  "project": "nombre-repo",
  "mode": "hybrid",
  "docsPath": ".ozali/docs",
  "metricsPath": ".ozali/metrics",
  "sessionState": ".ozali/.session-state.json",
  "createdAt": "2026-...",
  "agents": {
    "models": {
      "claude": {
        "low": "claude-haiku-4-5",
        "medium": "claude-sonnet-4-5",
        "high": "claude-opus-4"
      },
      "opencode": {
        "low": "kimi-k3",
        "medium": "deepseek-v4-pro",
        "high": "mimo-v2.5"
      },
      "mapping": { ... },
      "hybridRules": { ... }
    }
  },
  "testing": {
    "strict_tdd": false,
    "runner": null,
    "greenCommand": null,
    "singleTestCommand": null
  }
}
```

- `version` — versión del CLI que generó el config.
- `knowledgeRepo` — ruta portable al repo de conocimiento aislado.
- `project` — nombre del proyecto (derivado de la carpeta git).
- `mode` — modo de memoria: `hybrid` (docs + Engram) o `docs` (sin Engram). Se genera automáticamente desde v0.16.2.
- `docsPath` — ruta del histórico aislado de documentación por hito.
- `metricsPath` — ruta de métricas (tokens, telemetría).
- `sessionState` — ruta del archivo de estado de sesión para reanudación de hitos.
- `agents` — configuración de modelos para cada subagente; se genera automáticamente desde v0.16.2.
- `testing` — calibración de testing y TDD; se genera automáticamente con defaults y se
  calibra en Fase 3.5 del bootstrap. El flujo de llenado es:
  1. **`ozali init`** genera `testing` con valores nulos (`strict_tdd: false`, runners nulos).
  2. **Skill `ozali` (Fase 3.5)** detecta el stack real y escribe `.ozali/config.json` → `testing`.
  3. **Skill `cdk`** lee `testing` del config como primera fuente; si está vacío, recurre a
     `.ai/context/tech-stack.md` o Engram.
  4. **CLI `ozali doctor`/`update`** sincronizan inversamente desde `.ai/context/tech-stack.md`
     si ya existe (para repos calibrados antes de v0.16.2).

- `frozen` — **red de seguridad** (v0.16.3+): si es `true`, `ozali update` no toca las skills
  (`ozali`, `ozali-commit`, `skill-generator`). Solo actualiza el config JSON, permisos y jarvis.
  Útil para repos en producción que no quieren breaking changes por un update global accidental.
  Para forzar: `ozali update --skills`.

### Red de seguridad de `ozali update` (v0.16.3+)

Como ozali está en desarrollo activo, `ozali update` puede traer cambios breaking. El CLI
implementa **3 capas de protección**:

1. **Semver Guard** (Capa 1): antes de copiar skills, compara la versión del config con la del
   CLI. Si hay un **bump mayor** (ej. 0.16.x → 0.17.0), pide confirmación interactiva.
   En modo `--yes` permite el update pero muestra un warning.
2. **Backup automático** (Capa 2): antes de sobreescribir cada skill, el CLI copia la versión
   anterior a `.ozali/backups/skills/v{version}/{skill}/`. Si algo se rompe, recuperás con:
   ```bash
   ozali update --rollback
   ```
3. **Modo frozen** (Capa 3): agregá `"frozen": true` a `.ozali/config.json` y `ozali update`
   **nunca** tocará skills (solo config, permisos y jarvis). Para forzar el update de skills:
   ```bash
   ozali update --skills
   ```

> **Nota:** repos inicializados antes de v0.16.2 pueden tener `memoryMode` (legacy) en vez de `mode`. Corre `ozali update` o `ozali doctor --fix` para migrar al formato canónico completo.

> Linaje: `ozali` se nutre de conceptos de
> [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (Engram, calibración SDD/TDD,
> distribución plug-n-play).

## Licencia

MIT
