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

### Uso del CLI

```bash
ozali init      # detecta agente, instala la skill, aísla el histórico, configura Engram
ozali doctor    # health-check read-only (fuente de verdad, Engram, Strict TDD, runner…)
ozali update    # actualiza la skill instalada a la versión del paquete
ozali sync      # lleva el histórico (docs + Engram) al repo de conocimiento de equipo
```

Flags útiles: `--yes` (no interactivo), `--dry-run` (init sin escribir), `--agent`, `--scope`,
`--knowledge-repo`, `--import`/`--push` (sync). Modelo mental completo en
[docs/intended-usage.md](docs/intended-usage.md).

## Agentes soportados

Claude Code y opencode (perfiles de permisos para ambos en
[skill/references/permissions-bypass.md](skill/references/permissions-bypass.md)).

## Documentación

| Tema | Doc |
|---|---|
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
