<div align="center">

# ozali

**Bootstrap de IA por equipo — calibra tus proyectos, genera una skill de ejecución con TDD/SDD, y mantiene memoria de equipo (Engram) con histórico aislado.**

</div>

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
ozali init      # detecta agente, instala la skill, aísla el histórico, instala+configura Engram
ozali doctor    # health-check read-only (fuente de verdad, Engram, Cloud, Strict TDD, runner…)
ozali update    # actualiza la skill instalada a la versión del paquete
ozali sync      # lleva el histórico (docs + Engram) al repo de conocimiento de equipo
ozali audit     # navega/audita la memoria de Engram del proyecto (o general)
```

`ozali audit` recorre lo que el equipo ha acumulado en Engram: dentro de un repo propone auditar
**ese proyecto** o **general** (todos los proyectos); fuera de un repo va directo a general. Usa
`--tui` para el navegador interactivo, `--search "<texto>"` para buscar y `--general` para forzar el
alcance. Sin Engram, audita el histórico local de `.ozali/docs/`.

`init` también escribe un **perfil base de permisos** (`.claude/settings.json` para Claude Code,
`opencode.json` para opencode) para reducir confirmaciones: deja libres comandos seguros y bloquea
los destructivos. Es un template — tus reglas se conservan al re-correr `init`. Como Claude Code
**ignora** los permisos de un proyecto hasta confiar en él, `init` ofrece marcar el workspace como
confiable (`hasTrustDialogAccepted` en `~/.claude.json`); usa `--no-trust` para omitirlo.

`init` también **instala Engram** y registra su MCP con `engram setup <agente>`: en modo
interactivo te pregunta (default sí), y con `--yes` lo instala automáticamente. Usa brew en
macOS/Linux, `go install` en Windows, con binario precompilado como fallback. Si prefieres no
instalarlo, pasa `--no-engram` (arranca en modo `docs`). Opcionalmente habilita **Engram Cloud**
(réplica de equipo opt-in) además del git-sync.

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
| Seguridad del instalador (npx/pnpm) | [docs/security.md](docs/security.md) |
| Histórico aislado y memoria de equipo | [docs/team-history.md](docs/team-history.md) |
| Skill bootstrap | [skill/SKILL.md](skill/SKILL.md) |
| Calibración de testing + TDD | [skill/references/calibration-blueprint.md](skill/references/calibration-blueprint.md) |
| Blueprint de agentes | [skill/references/agents-blueprint.md](skill/references/agents-blueprint.md) |
| Memoria híbrida (docs + Engram) | [skill/references/engram-convention.md](skill/references/engram-convention.md) |

## Estado del roadmap

- [x] **Fase A** — Calibración + Strict TDD en el bootstrap.
- [x] **Fase B** — Memoria híbrida (docs + Engram, `state` recuperable, contrato de arranque).
- [x] **Fase C** — CLI plug-n-play (`init`/`doctor`/`update`/`sync`), Node cero-deps.
- [x] **Fase D** — Repo distribuible: tests (node:test), CI (matriz Node 16–22 + invariantes de seguridad), publicación npm con provenance.

> Siguiente paso natural: crear el repo en GitHub y publicar la primera versión (`pnpm publish` vía tag), más probar el bootstrap en un repo real del equipo.

> Linaje: `ozali` evoluciona la skill `copsis-doctor`, nutrida con conceptos de
> [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (Engram, calibración SDD/TDD,
> distribución plug-n-play).

## Licencia

MIT
