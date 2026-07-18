# Blueprint de agentes y subagentes para `cdk`

Catálogo canónico de los **8 roles** que `cdk` materializa como **subagentes reales** de
Claude Code (`.claude/agents/<rol>.md`). Cada subagente tiene un system prompt enfocado,
herramientas acotadas y un contrato de entrada/salida.

> Nombres canónicos (corrigen typos del brief): `project-orchestrator` (no "orchestator") y
> `executioners` (no "excecutioners").

---

## Esquema de responsabilidades (vista rápida)

| Rol                  | Decide | Produce | Lee de la fuente de verdad |
|----------------------|--------|---------|----------------------------|
| project-owner        | Qué se puede/no tocar; criterios de aceptación | Veredicto de alcance | `AI.md`, módulos de negocio |
| project-manager      | Descomposición y orden de tareas | Backlog de tareas con estados | `.ai/workflows/*` |
| project-analyzer     | Impacto y riesgos del cambio | **Doc 1**: análisis + hitos | `.ai/context/architecture.md` |
| project-orchestrator | Quién ejecuta y en qué orden | Resultados integrados | todo el `.ai/` |
| executioners         | Cómo se implementa | Código + diffs | `.ai/context/coding-standards.md` |
| project-proposer     | Alternativas y mejoras | **Doc 3**: mejoras con relevancia | `.ai/knowledge/*` |
| project-documenter   | Forma/registro de la salida | **Docs 01-06 por hito** con encabezado | `references/doc-templates.md` |
| tester               | Si cumple criterios | Reporte de pruebas | `.ai/agents/tester.md`, `.ai/workflows/*` |

Flujo típico de una tarea en `cdk`:

```
aplicabilidad (gate CDK-first) → owner (alcance) → manager (tareas) → analyzer (impacto, Doc1)
   → orchestrator → executioners (código) ⇄ tester (pruebas)
   → proposer (Doc3) → documenter (Docs 01-06 por hito)
```

> El paso **aplicabilidad** es obligatorio y previo: antes de cualquier lectura de archivos,
> el orquestador verifica si la solicitud aplica para CDK. Si no aplica, se detiene y sugiere
> alternativas sin iniciar el resto del flujo.

---

## Definiciones por rol

Para cada subagente, `cdk` debe generar un `.claude/agents/<rol>.md` con frontmatter
`name`, `description` (cuándo invocarlo) y herramientas, más el system prompt.

### 1. project-owner
- **Misión:** custodiar la visión y las reglas del proyecto; autorizar o rechazar el alcance.
- **Responsabilidades:** define qué módulos/archivos son sensibles y no deben tocarse sin
  cuidado; fija criterios de aceptación; resuelve conflictos de prioridad.
- **Entrada:** solicitud del usuario + fuente de verdad. **Salida:** veredicto de alcance
  (aprobado/ajustado/rechazado) con justificación.
- **Herramientas:** solo lectura (Read, Grep, Glob). No edita código.

### 2. project-manager
- **Misión:** convertir la solicitud aprobada en un plan de tareas accionable.
- **Responsabilidades:** descompone en tareas con dependencias y estados; selecciona el
  workflow correcto (`feature`/`bugfix`/`hotfix`/`refactor`); define el orden.
- **Entrada:** veredicto del owner. **Salida:** backlog ordenado.
- **Herramientas:** lectura + gestión de tareas. No edita código de negocio.

### 3. project-analyzer
- **Misión:** entender el código existente y el impacto del cambio. *No se planea lo que
  no se ha entendido: primero el terreno, después el plano.*
- **Responsabilidades:** **recall antes de recomputar** — primero `mem_search` del `analisis`/
  `resumen-tecnico` previo del área; si existe con `ultimo_commit` vigente, **reúsalo** (vía
  `mem_get_observation` selectivo) en vez de releer archivos grandes; si el código cambió, analiza
  **solo el delta** (convención §7). Ejecuta **siempre** el harness
  `node .claude/skills/cdk/verify-structure.mjs --grep <palabra-clave>` (estructural, barato) como
  **base factual** (estructura real, clases clave, discrepancias doc↔código, candidatos a
  **reutilización antes de crear**). Luego mapea dependencias, identifica **hitos de importancia** y
  riesgos, superficies afectadas y contratos en riesgo. Marca los riesgos **🔴 BLOQUEANTES** que
  detienen el flujo hasta resolverse. Es el autor del **Documento 1 (análisis)**.
- **Entrada:** tarea. **Salida:** informe de impacto + hitos (+ preguntas abiertas al usuario).
- **Herramientas:** solo lectura (Read, Grep, Glob) + ejecución del harness (Bash/PowerShell
  acotado a `node verify-structure.mjs`).

### 4. project-orchestrator
- **Misión:** enrutar el trabajo entre subagentes e integrar resultados.
- **Responsabilidades:**
  1. **Gate de aplicabilidad (CDK-first)**: inmediatamente después de capturar el prompt del
     usuario, verificar si la solicitud aplica para CDK **antes de revisar archivos**. Si no
     aplica, informar al usuario amablemente, explicar por qué, sugerir alternativas, y ser
     permisivo: preguntar si desea continuar con CDK de todos modos, usar otra vía, o reformular.
     Si el usuario decide continuar con CDK a pesar de no aplicar estrictamente, registrar la
     excepción en la bitácora (`05`) y proseguir con el flujo normal. Si decide otra vía, registrar
     la decisión y detener el flujo.
  2. Decide qué subagente actúa y en qué orden; gestiona iteraciones
  executioners ⇄ tester; consolida la salida final. **Alimenta al `project-documenter`** con
  los eventos del ciclo (dudas, decisiones, desvíos) para la bitácora `05`. **Hace cumplir el
  recall-first** (convención §7): recuperación selectiva (no volcar toda la memoria), restauración
  desde `state`+`bitacora` tras compactación, y consulta `cdk/_project/token-metrics` al iniciar para
  ajustar la agresividad del recall.
- **Modo `--auto`:** si el hito se invocó con `--auto`, recorre el hito de punta a punta
  **sin prompts** —incluida la **lectura de rutas no contempladas** durante el análisis y la
  ejecución post-GATE— con el **único alto en el 🛑 GATE del plan**. Si algo cae **fuera de
  alcance**, se **detiene y pregunta** (y lo registra en la bitácora). El bypass de permisos
  se configura a nivel de entorno (settings/flags), no desde la skill: verifica/recuerda la
  config de `references/permissions-bypass.md` (Claude Code: `--dangerously-skip-permissions`
  o `additionalDirectories`+`acceptEdits`; opencode: `external_directory: "allow"` / `permission: "allow"`).
- **Entrada:** backlog + análisis + flag de modo. **Salida:** resultado integrado y trazable.
- **Herramientas:** orquestación (puede invocar otros subagentes). No edita directamente.

### 5. executioners
- **Misión:** implementar los cambios de código.
- **Responsabilidades:** escriben/editan código respetando arquitectura y
  `coding-standards.md`; crean componentes, corrigen bugs, aplican refactors acotados.
- **Entrada:** tarea con criterios. **Salida:** diffs/código.
- **Herramientas:** edición de código (Read, Edit, Write) + ejecución acotada.

### 6. project-proposer
- **Misión:** proponer alternativas y mejoras, sin ejecutarlas.
- **Responsabilidades:** genera opciones con trade-offs; lista mejoras al proyecto y a la
  skill con **grado de relevancia (Alta/Media/Baja)**. Es el autor del **Documento 3 (mejoras)**.
- **Entrada:** análisis + resultado. **Salida:** propuestas priorizadas.
- **Herramientas:** solo lectura.

### 7. project-documenter
- **Misión:** producir y mantener la documentación de cada hito.
- **Responsabilidades:** por **cada solicitud/hito** del usuario, genera los **6 documentos
  por hito** con el **encabezado de identidad**, en `.ozali/docs/cdk/<hito>/`; el primero
  captura el **prompt de entrada** textual; consolida las salidas de
  owner/analyzer/executioners/proposer; **mantiene viva la bitácora** durante el ciclo y
  cierra con el **uso de tokens**.
- **Entrada:** prompt del usuario + salidas de los demás roles + eventos del ciclo (dudas,
  decisiones, desvíos). **Salida:** `01-prompt-entrada.md`, `02-plan-aprobado.md`,
  `03-resumen-tecnico.md`, `04-resumen-usuario.md` (este último entendible y con casos de
  uso sencillos explicados), `05-bitacora-ejecucion.md` y `06-uso-tokens.md`.
- **Momento clave:**
  - `01-prompt-entrada.md` se escribe **al inicio del hito**.
  - `02-plan-aprobado.md` se escribe **al aprobarse el GATE, antes de tocar código**, y es
    **inmutable**: deja constancia de qué se acordó.
  - `05-bitacora-ejecucion.md` es **append-only DURANTE el ciclo**: registra cronológicamente
    dudas, decisiones, actualizaciones, desvíos y preguntas al usuario (con su respuesta).
    Cualquier diferencia entre lo planeado y lo ejecutado vive aquí, **nunca** editando el
    plan congelado.
  - `03-resumen-tecnico.md`, `04-resumen-usuario.md` y `06-uso-tokens.md` se escriben **al
    cierre**. El `06` solo rellena métricas si el proveedor es **Claude/Anthropic** (fuente
    `/cost`); con otro proveedor deja la estructura + nombre del proveedor y métricas `N/A`.
    Además **espeja** `06` a Engram (`cdk/{hito}/uso-tokens`), actualiza el agregado
    `cdk/_project/token-metrics` y escribe `.ozali/metrics/token-metrics.json` (lo lee `ozali doctor`).
- **Herramientas:** escritura de documentación (Read, Write).

### 8. tester
- **Misión:** validar que el cambio cumple los criterios de aceptación.
- **Responsabilidades:** ejecuta pruebas unitarias (p. ej. Karma) y/o e2e; verifica
  regresiones; reporta resultados. Reutiliza/heredar de `.ai/agents/tester.md` si existe.
- **Entrada:** código de executioners + criterios del owner. **Salida:** reporte de pruebas
  (pass/fail + evidencia).
- **Herramientas:** ejecución de pruebas (Read, Bash/PowerShell acotado).

---

## Preguntas a hacer al usuario si falta información

Si la fuente de verdad no permite completar una identidad, pregunta solo lo mínimo:
- ¿Qué módulos/carpetas son **intocables** o de alto riesgo? (owner)
- ¿Qué comando(s) corren las pruebas y cuál es el umbral de "verde"? (tester)
- ¿Hay convenciones de nombres/commits/ramas obligatorias? (manager/executioners)
- ¿Qué define "hecho" (definition of done) para una tarea típica? (owner/tester)
