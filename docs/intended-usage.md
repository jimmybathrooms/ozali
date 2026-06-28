# Uso previsto (modelo mental)

← [README](../README.md)

Esta página explica **cómo se usa ozali**, no los flags. Si lees una sola página además del README, que sea esta.

## La idea en una frase

`ozali` toma un repo existente y le instala un **método de trabajo con IA**: calibra el proyecto,
genera una skill de ejecución (`cdk`) con TDD/SDD, y mantiene **memoria de equipo** con el
histórico aislado del repo principal.

## Las dos capas

| Capa | Quién la corre | Qué hace |
|---|---|---|
| **CLI `ozali`** | tú, en la terminal | instala/actualiza la skill, aísla el histórico, configura Engram (`init`/`doctor`/`update`/`sync`) |
| **Skill `ozali` → genera `cdk`** | tu agente (Claude Code/opencode) | diagnostica, calibra, y con tu aprobación (GATE) ejecuta el trabajo con 8 subagentes |

## Flujo típico (primera vez en un repo)

1. **`pnpm dlx ozali@<versión> init`** — el CLI detecta tu agente, instala la skill, aísla
   `.ozali/` y `.engram/` en el `.gitignore`, y configura el repo de conocimiento.
2. **Abre tu agente** y escribe `"diagnostica el proyecto"` (o `ozali`). La skill:
   - valida/genera la fuente de verdad `AI.md` + `.ai/`;
   - **calibra testing y resuelve Strict TDD** (Fase 3.5);
   - te presenta un **plan** (🛑 GATE) y, al aprobarlo, genera la skill `cdk` con sus 8 subagentes.
3. **Trabaja con `cdk`**: cada solicitud/hito produce 6 documentos legibles **y** se espeja a
   Engram (modo híbrido). El plan aprobado se congela; la bitácora es append-only.
4. **`ozali sync`** — lleva el histórico (docs + Engram) al repo de conocimiento de equipo.

## Día a día

- Pídele cosas a `cdk` en tu agente (`"crea el endpoint X"`, `"corrige el bug Y"`,
  `cdk --auto "refactor Z"`). El GATE del plan es el único punto donde siempre paras a aprobar.
- Si instalaste Engram, `cdk` **recuerda** lo que el equipo hizo antes y reanuda hitos a medias.
- Corre `ozali doctor` cuando quieras un chequeo de salud read-only.

## La regla de oro

El histórico **crece sin tocar el repo principal**. El cerebro (`.ai/`) viaja con el código; el
registro y la memoria viven aislados y se comparten con `ozali sync`. Así el equipo acumula
conocimiento sin inflar los repos de producto.
