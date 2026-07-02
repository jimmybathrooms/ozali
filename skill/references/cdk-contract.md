<!-- CDK_CONTRACT_VERSION: 1 -->

# Contrato de la skill `cdk` — versión y migración

Esta es la **fuente de verdad única** de la versión del contrato con el que `ozali` genera (y
mantiene) la skill `cdk`. La lee el **agente** (en la Fase 0.5 y la Fase 6 de
[`../SKILL.md`](../SKILL.md)) y la parsea el **CLI** (`ozali doctor`/`ozali update`) del paquete.
Para subir el contrato: incrementa el número del marcador `CDK_CONTRACT_VERSION` de arriba y la
prosa de abajo, y agrega una entrada al changelog.

> **Versión de contrato vigente: `1`**

El número vive en **un solo lugar** (el marcador HTML de la primera línea, formato
`CDK_CONTRACT_VERSION: <entero>`). No lo dupliques en otros archivos.

---

## Cómo se usa la versión

- El `cdk` generado **debe estampar** su versión de contrato en el frontmatter de su `SKILL.md`:

  ```yaml
  ---
  name: cdk
  description: <triggers ricos…>
  cdk_contract_version: 1
  ---
  ```

- En el **pre-flight** (Fase 0.5 de `ozali`), el agente compara la versión estampada en el `cdk`
  instalado contra esta versión vigente **N**:

  | Estado del `cdk` instalado | Acción |
  |---|---|
  | No existe | Generar `cdk` por el flujo normal (GATE Fase 5 → Fase 6), estampando `cdk_contract_version: N`. |
  | Existe **sin** `cdk_contract_version`, o con un valor **< N** | **Desactualizado → migración automática** (sin GATE): aplica los deltas del changelog, estampa `N` y reporta los cambios. Si el delta exige **regeneración estructural** de subagentes, eso sí pasa por el GATE de la Fase 5. |
  | Existe con `cdk_contract_version == N` | Al día → no regenerar; solo informarlo. |

> Un `cdk` **sin** el campo `cdk_contract_version` es un `cdk` **legado** (generado por una versión
> anterior de `ozali`). Trátalo como versión `0`: siempre desactualizado.

---

## Regla de migración (todas las versiones)

Al migrar un `cdk` legado o desactualizado, **siempre**:

1. **Elimina toda referencia a la nomenclatura heredada** (`copsis-commit`, `copsis-doctor` — nombres
   de versiones anteriores del ecosistema, predecesoras de `ozali`) y **reemplázala por la de
   `ozali`**:
   - `copsis-commit` → **`ozali-commit`** (la skill de commit vigente que `ozali init`/`ozali update`
     instalan en `.claude/skills/ozali-commit/`).
   - Refs a plantillas o a la skill **`copsis-doctor`** → sus equivalentes de `ozali` (esta skill y
     sus `references/`). No debe quedar ninguna mención a `copsis-*` en el `cdk` migrado.
2. **Migra el histórico legado de docs**: si existe `.copsis/docs/cdk/` (la ruta que usaba
   `copsis-doctor`), **mueve** su contenido a `.ozali/docs/cdk/` — fusionando **por hito** y **sin
   sobrescribir** lo que ya exista en el destino — y **elimina** la carpeta `.copsis/` una vez vacía.
   Si `.copsis/` contiene otras subrutas legadas (p. ej. `.copsis/metrics/`), reubícalas bajo
   `.ozali/` de forma equivalente antes de borrar `.copsis/`.
3. **Preserva** el histórico por hito ya en `.ozali/docs/cdk/` y los planes congelados
   (`02-plan-aprobado.md`): la migración del contrato **nunca** los borra ni reescribe.
4. **Estampa** `cdk_contract_version: N` en el frontmatter del `cdk` migrado.
5. **Reporta** al usuario, en texto, qué cambió (referencias migradas, docs reubicados de `.copsis/`
   a `.ozali/`, secciones actualizadas, versión nueva).

---

## Changelog del contrato

### v1 — contrato base
Un `cdk` conforme a la v1 debe:

- Estampar `cdk_contract_version: 1` en su frontmatter.
- En el **cierre de hito**, invocar la skill **`ozali-commit`** (nunca `copsis-commit`) para
  generar el commit summary convencional (feature→`feat`, bugfix→`fix`, hotfix→`hotfix`,
  refactor→`refactor`; scope = módulo del hito).
- Operar **recall-first** (reusar memoria de Engram antes de releer/re-analizar) según
  [`engram-convention.md`](engram-convention.md) §7.
- Espejar a Engram los artefactos clave del hito y escribir la telemetría de tokens
  (`.ozali/metrics/token-metrics.json`, que lee `ozali doctor`).
- Respetar la calibración de Strict TDD (Fase 3.5) y el 🛑 GATE del plan.
