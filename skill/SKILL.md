---
name: ozali
description: Diagnostica, calibra y planifica la skill `cdk` de un proyecto. Úsala cuando quieras "preparar cdk", "calibrar el proyecto", "generar la estructura de agentes", "arrancar ozali desde cero" o invocar "ozali".
model: high
---

# Skill: ozali

`ozali` es la skill **base/bootstrap**. Su único trabajo es llevar al usuario por una
experiencia interactiva que termina **generando y configurando la skill `cdk`** del proyecto,
usando como fuente de verdad la documentación global del repo (`AI.md` + `.ai/`, o su variante
`IA.md` + `.ia/`) y la **calibración real de testing** del proyecto.

`ozali` **diagnostica, calibra y planifica**. `cdk` **ejecuta** (genera código respetando reglas).
No mezcles responsabilidades: `ozali` nunca escribe código de negocio del proyecto; solo
produce documentación, la calibración, el plan y los artefactos de la skill `cdk`.

> **Regla de oro:** nada se ejecuta sin aprobación del usuario en los puntos marcados como
> 🛑 **GATE**. Si el usuario no aprueba, detente y pregunta.

> **Memoria de equipo (Engram):** `ozali` y `cdk` operan en modo **híbrido** — conservan los
> documentos legibles por humanos **y** espejan los artefactos clave a Engram para búsqueda y
> acumulación de conocimiento. El histórico de documentación se mantiene **aislado del repo
> principal** (repo de conocimiento aparte). Reglas en
> [`references/engram-convention.md`](references/engram-convention.md) y
> [team-history](../docs/team-history.md).

---

## Modo workspace — calibrar un repo miembro (target)

Normalmente `ozali` opera sobre el **repo actual** (cwd). Pero cuando te invocan desde la **raíz de un
workspace** (existe `ozali-workspace.json`) para calibrar un **repo miembro**, operas sobre un
**target de subcarpeta** en vez del cwd. En ese caso:

- **Todas las rutas son relativas al `<target>`**, no a la raíz: la fuente de verdad
  (`<target>/AI.md` + `<target>/.ai/`, o su variante `IA.md` + `.ia/`), la skill que generas
  (`<target>/.claude/skills/cdk/`), el histórico (`<target>/.ozali/docs/`) y
  `<target>/.engram/config.json`.
- **Identidad git del miembro:** usa `git -C <target> …` (no la raíz).
- **Engram:** guarda con el `project_name` de `<target>/.engram/config.json` (equivale al
  `members[].project` del manifiesto). **No mezcles** memoria entre repos.
- **Un target por corrida**, secuencial, con su **propio 🛑 GATE**. No calibres varios a la vez sin
  aprobación.
- Al terminar, sugiere **re-correr `ozali workspace`** en la raíz para refrescar el estado del miembro
  en el manifiesto (`needs-calibration` → `ready`).

Si te invocan sin target (uso normal en un solo repo), ignora esta sección y sigue con el cwd.

---

## Flujo general (7 fases)

```
Fase 0    Identidad y registro          → quién corre ozali (git/sesión)
Fase 0.5  Pre-flight de cdk             → ¿existe cdk? ¿versión de contrato vigente? migrar si toca
Fase 1    Detección fuente de verdad    → ¿existe AI.md/.ai o IA.md/.ia?
Fase 2    Generación conocimiento       → si falta, evaluar el proyecto y generar AI.md + .ai/
Fase 3    Validación + ajustes          → ¿coincide con la estructura real? ajustes mínimos
Fase 3.5  Calibración testing + TDD     → detectar runner/capas/cobertura y resolver Strict TDD
Fase 4    Diseño de agentes (cdk)       → 8 roles + esquema de responsabilidades
Fase 5    🛑 GATE: plan de cdk          → presentar plan, esperar aprobación
Fase 6    Generar cdk                   → skill cdk + subagentes reales + wiring TDD/Engram
```

Al final de **cada corrida** se escriben los **3 documentos** de registro (ver
[Documentación de corrida](#documentación-de-corrida)).

---

## Fase 0 — Reanudación de hito + Identidad

Antes de nada, verifica si hay un **hito pendiente** de `cdk` que necesite reanudarse.

### 0.0 Handshake Engram (detección temprana)

1. Intenta `mem_current_project`. Si la herramienta **no existe** o devuelve error
   (las tools `mem_*` no están cargadas), muestra al usuario:
   > ⚠️ Engram MCP no está activo. Las tools `mem_*` no están disponibles.  
   > Para activar memoria persistente, abre `/plugin` en Claude Code, instala `engram@engram`
   > (Enable / "instalar para mí") y reinicia Claude Code.  
   > Hasta entonces, todo funciona en modo `docs` (sin memoria acumulativa).
   - Registra en la bitácora: *"Engram no disponible — modo docs."*
   - **No bloquees** el flujo; continúa con el fallback a docs.
2. Si responde pero el proyecto no coincide con `.engram/config.json`, corrige
   `.engram/config.json` o usa el nombre que devuelva Engram.

### 0.1 Reanudación (checkpoint de estado)

1. **Buscar estado en Engram:** `mem_search(query: "cdk/{hito}/state", project: "{project}")`.
   Si hay resultado, recuperar con `mem_get_observation(id)`.
2. **Guard de rama:** al recuperar el `state` de Engram, comparar el campo `rama` (si existe)
   contra la rama actual de git (`git rev-parse --abbrev-ref HEAD`):
   - Si **diffieren** → **ignorar** el estado (tratar como hito nuevo). Registrar:
     *"State de rama `{state.rama}` ignorado — estamos en `{rama_actual}`."*
   - Si **coinciden** o el state no tiene campo `rama` (legado) → continuar con la evaluación.
3. **Buscar estado en disco:** leer `.ozali/.session-state.json` si existe (fallback cuando
   Engram no está disponible o como respaldo).
4. **Decidir:**
   - Si **no hay estado** o la fase es `completed` → nuevo hito, continuar normalmente.
   - Si hay un hito **pendiente** (fase ≠ `completed`):
     - Preguntar al usuario: *"Tenés un hito pendiente en fase **[X]**. ¿Reanudar desde ahí?"*
     - Si **sí**: saltar las fases ya completadas y arrancar desde la fase pendiente.
       Registrar en la bitácora: *"Reanudación desde fase [X] tras interrupción."*
     - Si **no**: tratar como hito nuevo (sobrescribir estado al final del análisis).

> La reanudación aplica tanto a `ozali` (bootstrap/calibración) como al hito de `cdk` que se
> generará en Fase 6. El formato del estado sigue [`references/engram-convention.md`](references/engram-convention.md) §4.

### 0.2 Identidad y registro

Identifica **quién** está corriendo `ozali` para el encabezado del registro.

1. Intenta obtener identidad de la sesión activa (correo/cuenta).
2. Complementa con la cuenta de git del repo:
   - `git config user.name`
   - `git config user.email`
   - rama actual: `git rev-parse --abbrev-ref HEAD`
   - **commit actual** (para trazabilidad del histórico aislado): `git rev-parse --short HEAD`
3. Construye el bloque de identidad que se usará en todos los documentos:

```
Autor: <user.name> <<user.email>>
Sesión: <correo de sesión si está disponible>
Rama: <branch>
Commit: <short SHA>
Generado por: ozali
Fecha/Hora: <yyyy-mm-dd HH:MM:SS> (zona local)
```

Guarda estos valores; se reutilizan en Fase 6 y en la documentación.

---

## Fase 0.5 — Pre-flight de `cdk` (versión de contrato + migración)

> Esta fase resuelve el caso de **un repo que ya tiene `cdk` instalada**: en vez de omitirla,
> `ozali` decide si está **al día**, **desactualizada** o **ausente**, y actúa en consecuencia.
> La **versión de contrato vigente** y las reglas de migración están en
> [`references/cdk-contract.md`](references/cdk-contract.md) — es la **fuente de verdad única**.

1. **Lee la versión de contrato vigente `N`** del marcador `CDK_CONTRACT_VERSION` en
   [`references/cdk-contract.md`](references/cdk-contract.md).
2. **Busca el `cdk` instalado**: `.claude/skills/cdk/SKILL.md` (proyecto), luego
   `~/.claude/skills/cdk/SKILL.md` (global). Si existe, lee `cdk_contract_version` de su frontmatter.
3. **Decide y registra** la decisión (se usa en las Fases 5 y 6):

   | Estado del `cdk` instalado | Decisión |
   |---|---|
   | **No existe** | `GENERAR` — flujo normal: continúa el bootstrap hasta el GATE (Fase 5) y genera `cdk` en la Fase 6, estampando `cdk_contract_version: N`. |
   | **Existe sin `cdk_contract_version`** (cdk legado) o con valor **`< N`** | `MIGRAR` — **migración automática** (sin GATE), ver abajo. |
   | **Existe con `cdk_contract_version == N`** | `AL_DÍA` — no regenerar. Infórmalo y continúa el bootstrap solo para refrescar la calibración/documentación si el usuario lo pide. |

4. **Migración automática (`MIGRAR`)** — aplica los deltas del changelog de
   [`references/cdk-contract.md`](references/cdk-contract.md) sobre el `cdk` instalado, **sin** pasar
   por el GATE, porque preserva el `cdk` del usuario y solo actualiza el contrato:
   - **Elimina toda referencia a la nomenclatura heredada** (`copsis-commit`, `copsis-doctor`) y
     reemplázala por la de `ozali`: `copsis-commit` → **`ozali-commit`** (instalada en
     `.claude/skills/ozali-commit/`); refs a plantillas o a la skill `copsis-doctor` → sus
     equivalentes de `ozali`. No debe quedar ninguna mención a `copsis-*`.
   - **Migra el histórico legado**: si existe `.copsis/docs/cdk/` (la ruta de `copsis-doctor`),
     **mueve** su contenido a `.ozali/docs/cdk/` (fusiona **por hito**, **sin sobrescribir** lo ya
     existente) y **borra** la carpeta `.copsis/` una vez vacía.
   - Aplica el resto de deltas del changelog (recall-first, telemetría, etc. según la versión).
   - **Estampa** `cdk_contract_version: N` en el frontmatter del `cdk`.
   - **Preserva** intactos los docs ya en `.ozali/docs/cdk/` (histórico por hito) y los planes
     congelados (`02-plan-aprobado.md`).
   - **Reporta** al usuario, en texto, qué cambió (referencias migradas, docs reubicados de `.copsis/`
     a `.ozali/`, secciones actualizadas, versión nueva).
   - **Excepción → GATE:** si un delta exige **regeneración estructural** (reescribir subagentes,
     cambiar el harness, rehacer el wiring de TDD), eso **no** es migración automática: preséntalo en
     el plan del GATE (Fase 5) y regénéralo en la Fase 6.

> Sin `cdk` previo, esta fase no hace nada salvo registrar `GENERAR`. La calibración (Fase 3.5) y el
> resto del flujo continúan igual.

### Configuración local (`.ozali/config.local.json`)

`ozali` soporta un archivo de configuración local que **sobrescribe** `.ozali/config.json`
sin modificar el config del repo (igual que `.claude/settings.local.json` sobrescribe
`.claude/settings.json`).

- **Ruta:** `.ozali/config.local.json`
- **Merge:** shallow merge; las claves de primer nivel en `.local` ganan sobre el base.
- **Uso típico:** ajustar `agents.models` (modelos de agentes) o `knowledgeRepo` para tu
  entorno local sin tocar el config compartido del equipo.
- **Advertencia:** los cambios en `agents.models` **no surten efecto** en los subagentes ya
  generados hasta que se **regenera o actualiza `cdk`** (correr `ozali update` o invocar
  `ozali` de nuevo). `ozali doctor` detecta esta condición y te avisa.

---

## Fase 1 — Detección de la fuente de verdad

Busca en la raíz del repositorio, aceptando **ambas nomenclaturas**:

| Concepto        | Variante A | Variante B |
|-----------------|------------|------------|
| Documento guía  | `IA.md`    | `AI.md`    |
| Carpeta dotted  | `.ia/`     | `.ai/`     |

- Si encuentras **cualquiera** de las dos variantes → **ruta FOUND** (ve a Fase 3).
- Si **no** encuentras ninguna → **ruta GENERATE** (ve a Fase 2).

Registra cuál variante usa el proyecto. Esa será la nomenclatura canónica de aquí en adelante;
**no la cambies** si el proyecto ya tiene una.

Inspecciona el contenido encontrado y trátalo como **fuente de verdad** provisional. Estructura
esperada dentro de la carpeta dotted:

```
.ai/ (o .ia/)
  agents/      → identidades existentes (frontend, designer, reviewer, tester, ...)
  context/     → architecture.md, coding-standards.md, tech-stack.md
  knowledge/   → learning-notes.md, README.md
  workflows/   → feature.md, bugfix.md, hotfix.md, refactor.md
```

---

## Fase 2 — Generación de la base de conocimiento (evaluando el proyecto)

Solo si la Fase 1 no encontró nada. **No se descarga nada de fuentes externas:** la fuente
de verdad se construye **evaluando el proyecto real**. La estructura canónica, las reglas
de generación y las diferencias frontend/backend están en
[`references/knowledge-blueprint.md`](references/knowledge-blueprint.md).

Pasos:
1. **Detecta frontend o backend** (señales del blueprint §1; si hay ambigüedad, pregunta).
2. **Inspecciona el proyecto real** (blueprint §2): estructura, stack y versiones leídas de los
   manifiestos, comandos de build/test, patrones de arquitectura, convenciones observadas,
   configuración por entorno y estado real de pruebas.
3. **Genera la carpeta dotted** (`.ai/` por defecto) con la estructura canónica del blueprint §3.
4. **Genera el documento guía** (`AI.md`) como "Project Brain" según el blueprint §4.
5. **Regla anti-invención:** todo lo que no se pueda derivar del código real se marca como
   `<!-- PROVISIONAL: confirmar con el usuario -->` o se pregunta. Nunca inventes reglas de
   negocio, módulos, comandos ni versiones.
6. **Nomenclatura del repo real:** nada de nombres genéricos de plantilla.

Lo generado es **provisional**: continúa a Fase 3 y valídalo igual que una fuente encontrada.

---

## Fase 3 — Validación contra la estructura real + ajustes mínimos

La fuente de verdad es **provisional** hasta validarla contra el código real.

1. Lee la estructura real del proyecto (p. ej. `src/app/...`, módulos, servicios).
2. Compara contra lo que afirma la fuente de verdad (`context/architecture.md`, `tech-stack.md`).
3. Marca **discrepancias** (carpetas/módulos que existen y no están documentados, o viceversa).
4. Aplica **solo ajustes mínimos** necesarios para una primera iteración coherente.
5. Todo cambio mayor se anota como **propuesta** para el documento 3 (mejoras), no se aplica.

Resultado: una fuente de verdad **validada** y el inventario de hitos/discrepancias que alimenta
el documento 1 (análisis).

---

## Fase 3.5 — Calibración de testing + Strict TDD

> Esta fase es lo que hace que `cdk` sepa **si puede exigir test-first**. Sin ella, el TDD es un
> deseo; con ella, es un contrato calibrado contra lo que el proyecto realmente soporta. Catálogo
> completo de detección en [`references/calibration-blueprint.md`](references/calibration-blueprint.md).

1. **Detecta las capacidades de testing reales** (blueprint §1): runner(s) de tests, capas
   disponibles (unit / integración / e2e), comando(s) exactos, linter, type-checker, formatter,
   y **cobertura/estado real** (conteo de archivos de prueba, no supuestos).
2. **Resuelve `strict_tdd`** con esta tabla de decisión (blueprint §2):

   | Señal encontrada | `strict_tdd` |
   |---|---|
   | Marcador/config explícito del proyecto (`.ai/context/tech-stack.md`, CI, convención de equipo) | usa ese valor |
   | Sin marcador, pero **existe runner de tests** | **`true`** (default: test-first) |
   | **No hay runner de tests** | `false` + explica que no está disponible y qué falta |

3. **Persiste la calibración** como artefacto `testing-capabilities`:
   - en la fuente de verdad: sección **"Testing & TDD"** dentro de `.ai/context/tech-stack.md`
     (tabla de capacidades + `strict_tdd` + comandos verdes);
   - en **Engram** (cuando esté disponible): `cdk/_project/testing-capabilities`
     (ver [`references/engram-convention.md`](references/engram-convention.md)).

4. **Si falta información** para fijar el umbral de "verde" (qué comando corre las pruebas, qué
   cuenta como pasar), **pregunta al usuario** lo mínimo. No inventes comandos ni umbrales.

El resultado de esta fase entra al plan del GATE (Fase 5) como la sección **"Calibración de
pruebas"** y condiciona el ciclo `executioners ⇄ tester` de `cdk` (Fase 6).

---

## Fase 4 — Diseño de agentes y subagentes para `cdk`

A partir del conocimiento consolidado, diseña la estructura de agentes de `cdk`. El catálogo
canónico de los **8 roles**, su esquema de responsabilidades, entradas/salidas, **clasificación
cognitiva y modelo asignado** está en [`references/agents-blueprint.md`](references/agents-blueprint.md):

| # | Rol | Categoría | Nivel modelo | Justificación |
|---|-----|-----------|--------------|---------------|
| 1 | **project-owner** | A — Análisis Profundo | **high** | Visión, reglas, módulos sensibles |
| 2 | **project-manager** | E — Lectura/Propuesta | **medium** | Backlog, workflows, dependencias |
| 3 | **project-analyzer** | A — Análisis Profundo | **high** | Impacto, riesgos bloqueantes, hitos |
| 4 | **project-orchestrator** | B — Orquestación | **medium** | Enrutamiento, recall-first, modo auto |
| 5 | **executioners** | C — Escritura Código | **high** | Implementación, estándares, arquitectura |
| 6 | **project-proposer** | E — Lectura/Propuesta | **medium** | Alternativas, trade-offs, relevancia |
| 7 | **project-documenter** | C — Escritura Docs | **medium** (híbrido) | Sonnet sencilla; Opus técnica |
| 8 | **tester** | D — Validación | **medium** (híbrido) | Haiku ejecución; Sonnet diagnóstico |

> **Resolución de modelo:** el nivel (`low`, `medium`, `high`) se resuelve a modelo real
> consultando `.ozali/config.json` → `agents.models.{claude|opencode}.{low|medium|high}`.
> El orquestador debe hacer este lookup al invocar cada subagente.

Si la fuente de verdad **no** aporta suficiente para definir una identidad (responsabilidad,
herramientas permitidas, límites), **pregunta al usuario** lo mínimo necesario. No inventes
reglas de negocio.

---

## Fase 5 — 🛑 GATE: presentar el plan de `cdk`

> [!IMPORTANT]
> **Es IMPERATIVO presentar el plan de trabajo como mensaje visible y completo al usuario
> ANTES de pedir cualquier aprobación.** El plan debe ir en el cuerpo del mensaje final
> (markdown completo: tablas, estructura de archivos, subagentes), nunca solo resumido
> dentro de una pregunta o herramienta de confirmación. Si el plan no se presentó de forma
> visible, el GATE **no es válido**: preséntalo primero y vuelve a pedir aprobación.

Presenta al usuario un plan claro y conciso que incluya:

- Nombre canónico de la fuente de verdad detectada y variante (`AI.md/.ai` vs `IA.md/.ia`).
- Resumen de discrepancias y ajustes mínimos aplicados en Fase 3.
- **Calibración de pruebas** (Fase 3.5): capacidades detectadas + `strict_tdd: true|false` + comandos verdes.
- Los 8 subagentes a crear (ruta, responsabilidad de una línea, herramientas).
- Estructura de archivos que generará `cdk`.
- La ruta de documentación, nomenclatura de logs y **destino del histórico** (repo de conocimiento aislado).

**Detente y espera aprobación explícita.** No generes `cdk` hasta recibir el "ok".

---

## Fase 5.5 — ¿Generar también `skill-generator`?

Tras la aprobación del GATE de `cdk`, evalúa si el proyecto necesita una skill de
fabricación de skills. Si el equipo:
- Tiene ≥ 3 flujos de trabajo repetitivos que `cdk` ha detectado.
- Quiere empoderar a devs para crear sus propias skills sin pasar por `cdk`.
- Trabaja en un workspace multi-repo donde cada repo podría necesitar skills específicas.

En esos casos, **sugiere al usuario** generar `skill-generator` como skill hermana de `cdk`.
Si aprueba, aplícale el mismo flujo de Fase 6 (adaptado a la skill `skill-generator` del
paquete `ozali`).

> `skill-generator` y `cdk` son **skills hermanas**, no anidadas: `cdk` ejecuta código de
> negocio; `skill-generator` fabrica skills. Cuando `cdk` detecta un patrón repetitivo dentro
> de un hito, puede sugerir: "¿Querés que `skill-generator` extraiga esto a una skill
> reutilizable?"

---

## Fase 6 — Generar la skill `cdk`

Solo tras la aprobación de la Fase 5. Genera:

1. `.claude/skills/cdk/SKILL.md` — orquestador de `cdk`. Debe:
   - declarar en el frontmatter una **description con triggers ricos** (verbos y sustantivos
     que el usuario usaría: "crea", "genera", "corrige", "refactoriza", método, clase,
     endpoint, componente…) para mejorar la auto-invocación de la skill;
    - **estampar en el frontmatter** `cdk_contract_version: N`, con `N` = la versión de contrato
      vigente de [`references/cdk-contract.md`](references/cdk-contract.md). Esto permite que el
      pre-flight (Fase 0.5) y `ozali doctor`/`ozali update` sepan si el `cdk` está al día;
    - **estampar en el frontmatter** `model: medium` (el orquestador `cdk` opera en nivel medio);
    - **resolver modelo de subagentes:** el orquestador debe, al invocar cada subagente, leer
      su `model:` del frontmatter y resolverlo a modelo real vía `.ozali/config.json` →
      `agents.models.{claude|opencode}.{low|medium|high}`;
   - declarar que ayuda a **generar código** (nuevo componente, fix de bug, análisis de impacto)
     respetando la fuente de verdad y los estándares del proyecto;
    - orquestar los 8 subagentes según la fase del trabajo;
    - **gate de aplicabilidad previo (CDK-first)**: inmediatamente después de capturar el
      prompt del usuario, **antes de revisar archivos o ejecutar cualquier harness**, verificar
      si la solicitud aplica para ser procesada por CDK (tareas de desarrollo de software:
      nuevo componente, fix de bug, refactor, endpoint, método, clase, validación, análisis de
      impacto, etc.).
      - Si **aplica**: hacer **énfasis explícito** al usuario (`"Esta solicitud aplica para CDK.
        Procederé con el flujo de desarrollo disciplinado."`) y continuar con el flujo normal.
      - Si **NO aplica** (pregunta conceptual, configuración de entorno, tarea administrativa,
        documentación fuera del alcance de CDK, o cualquier tarea que no implique cambio de
        código de negocio): **informar amablemente** al usuario que la solicitud no entra por
        el flujo CDK, explicar por qué, y **sugerir alternativas** (otra skill, comando manual,
        o cómo reformular la petición para que aplique). **Ser permisivo:** preguntar al usuario
        si desea continuar con CDK de todos modos, usar otra vía, o reformular. Si el usuario
        decide continuar con CDK a pesar de no aplicar estrictamente, registrar la excepción
        en la bitácora (`05`) y proseguir con el flujo normal. Si decide otra vía, registrar
        la decisión y detener el flujo.
    - exigir que el análisis arranque con el **harness de verificación de estructura**
     (punto 3 abajo) antes de planear nada;
   - **respetar la calibración de Strict TDD** (Fase 3.5): si `strict_tdd: true`, el ciclo
     `executioners ⇄ tester` es **test-first** (RED → GREEN → REFACTOR): se escribe la prueba que
     falla, luego el mínimo código que la pasa, luego refactor con pruebas en verde; el GATE
     muestra el **plan de pruebas** como sección obligatoria. Si `strict_tdd: false`, exige al
     menos pruebas de regresión y lo deja explícito en la bitácora;
   - definir el **formato del Plan de Acción** que ve el usuario en el GATE: tabla de
     cambios archivo por archivo, **plan de pruebas**, riesgos con mitigación y sección
     explícita de **"Fuera de alcance"**;
   - **congelar el plan al aprobarse el GATE**: `02-plan-aprobado.md` se escribe en ese
     momento (antes de tocar código) y es inmutable;
   - soportar el **modo autónomo `--auto`** (ver [Modo autónomo (`--auto`)](#modo-autónomo---auto)):
     `cdk` recorre el hito de punta a punta —análisis (incluida la lectura de rutas no
     contempladas), ejecución— **sin prompts**, con el **único alto en el 🛑 GATE**; debe
     incluir una sección breve de **permisos** con los **dos perfiles** —base del modo normal
     (lectura + comandos + Python + fetch, confirmando ediciones) y bypass de `--auto`— que
     apunte a [`references/permissions-bypass.md`](references/permissions-bypass.md) (config de
     Claude Code y opencode) y **verificar/recordar** esa configuración al iniciar;
   - incluir una sección de **Gotchas verificados** (hallazgos reales del repo) y una de
     **Troubleshooting** (síntoma → causa/fix);
   - **por cada solicitud/hito del usuario**, generar la documentación por hito en
     `.ozali/docs/cdk/<hito>/` (ver [Documentación por hito de `cdk`](#documentación-por-hito-de-cdk)),
     que son **6 documentos**: incluye la **bitácora de ejecución** (`05`) que se escribe DURANTE
     el ciclo y el **uso de tokens** (`06`) que se escribe al cierre;
    - **espejar a Engram** los artefactos clave del hito (análisis, plan aprobado, bitácora,
      resumen técnico, `state`) con naming determinista, según
      [`references/engram-convention.md`](references/engram-convention.md), y al **iniciar** un
      hito hacer `mem_search` del proyecto/hito para recuperar contexto previo;
    - **checkpoints obligatorios entre fases** (v4 del contrato): el `cdk` generado debe guardar
      un checkpoint tras cada transición de fase del hito (`analysis_done` → `plan_approved` →
      `execution_done` → `testing_done` → `completed`), usando `mem_update` del artefacto
      `cdk/{hito}/state` y el disco `.ozali/.session-state.json`. Esto permite **reanudación**
      si el agente se interrumpe. Ver [`references/engram-convention.md`](references/engram-convention.md) §4 y §4.5;
    - **micro-checkpoints intra-fase**: durante la ejecución, si el hito modifica **>5 archivos**,
      los `executioners` deben guardar micro-checkpoint en disco (`.ozali/.session-state.json`)
      cada **3-5 archivos procesados**, registrando `archivos_procesados`, `last_updated` y `rama`;
     - **reanudación automática**: al iniciar un hito, buscar `cdk/{hito}/state` en Engram y
       `.ozali/.session-state.json` en disco. Al recuperar el `state` de Engram, aplicar el
       **guard de rama**: comparar `rama` contra la rama actual (`git rev-parse --abbrev-ref HEAD`).
       Si diffieren → **ignorar** el estado (tratar como hito nuevo). Si hay un hito pendiente
       (fase ≠ `completed`) y la rama coincide, preguntar al usuario si desea reanudar desde
       la fase encontrada;
    - en el **cierre del hito**, invocar la skill **`ozali-commit`** (instalada por el CLI en
      `.claude/skills/ozali-commit/`; **nunca** `copsis-commit`, nombre heredado de versiones
      anteriores) para generar el commit summary (feature→`feat`, bugfix→`fix`, hotfix→`hotfix`,
      refactor→`refactor`; scope = módulo del hito). El GATE del mensaje es independiente del GATE
      del plan.
    - **integrar `skill-generator`**: cuando `cdk` detecta un patrón repetitivo dentro de un hito
      (≥ 3 ocurrencias o pasos manuales predecibles), debe **sugerir al usuario** extraerlo a una
      skill reutilizable invocando `skill-generator`. No generar la skill por sí mismo; delegar.
    - **Seguridad (Security First)**: incluir en el SKILL.md de `cdk` y en los system prompts de
      los subagentes las restricciones de seguridad de
      [`skill-creation-blueprint.md`](../../skill-generator/references/skill-creation-blueprint.md) §4:
      nunca exponer credenciales, contraseñas, tokens ni rutas a archivos sensibles; rechazar
      amablemente solicitudes de lectura de `.env`, `~/.aws/credentials`, `~/.ssh/id_rsa`, etc.
 2. `.claude/agents/<rol>.md` — un subagente real por cada uno de los 8 roles, con su system
    prompt y herramientas, según [`references/agents-blueprint.md`](references/agents-blueprint.md).
    Cada subagente debe:
    - Incluir `model: {low|medium|high}` en su frontmatter, según la clasificación de Fase 4.
    - Respetar las **restricciones de seguridad** arriba mencionadas.
    - Ser resuelto a modelo real por el orquestador consultando `.ozali/config.json`.
 3. `.claude/skills/cdk/verify-structure.mjs` — **harness del analista**: script Node sin
    dependencias (Node 16+) adaptado a la estructura real del proyecto. Verifica paquetes/capas
    esperados, localiza clases clave, reporta discrepancias doc↔código y, con `--grep <palabra>`,
    lista archivos existentes relacionados (**reutilización antes de crear**). Genéralo a partir
    del esqueleto parametrizado de [`references/harness-template.md`](references/harness-template.md)
    con valores de la fuente de verdad validada en Fase 3 — nunca de supuestos — y **ejecútalo
    para validarlo** antes de cerrar la fase (template §4).
 4. Cualquier otra referencia/plantilla que `cdk` necesite.

> La fuente de verdad sigue siendo **únicamente** `AI.md` + `.ai/` — `cdk` la referencia,
> **no la duplica** dentro de la skill. No copies `context/` ni `workflows/` a
> `.claude/skills/cdk/`.

Tras generar, escribe los 3 documentos de la corrida y resume al usuario qué quedó creado y
cómo invocar `cdk`.

---

## Documentación por hito de `cdk`

Esto lo produce la skill **`cdk`** (no `ozali`), una vez por **cada solicitud/hito** del usuario.
Es responsabilidad del subagente `project-documenter`. `ozali` debe **cablear este comportamiento**
dentro del `SKILL.md` de `cdk` que genera en la Fase 6.

- **Ruta base:** `.ozali/docs/cdk/` — **gitignored en el repo principal** y sincronizada al repo
  de conocimiento aislado (ver [team-history](../docs/team-history.md)).
- **Carpeta por hito:** `<hito>/` — slug corto y descriptivo (ej. `alta-componente-cobranza`).
  Si ya existe, agrega sufijo `-2`, `-3`, …
- **Contenido (6 `.md`):**
  1. `01-prompt-entrada.md` — el **prompt de entrada** del usuario, **textual**, con timestamp.
     *Se escribe al inicio del hito.*
  2. `02-plan-aprobado.md` — el **plan aprobado**. *Se congela AL APROBAR el GATE, antes de tocar
     código; es inmutable.*
  3. `03-resumen-tecnico.md` — **resumen técnico** (archivos tocados, decisiones, impacto). *Al cierre.*
  4. `04-resumen-usuario.md` — **resumen para el usuario**, entendible y con **casos de uso
     sencillos explicados** (sin jerga técnica). *Al cierre.*
  5. `05-bitacora-ejecucion.md` — **bitácora viva del ciclo** (append-only): dudas, decisiones,
     actualizaciones y desvíos DURANTE la ejecución. Mantiene íntegro el `02-plan-aprobado.md`.
  6. `06-uso-tokens.md` — **uso de tokens**, al cerrar el hito. Métricas solo si el proveedor es
     **Claude/Anthropic**; con otro proveedor deja estructura + nombre del proveedor (`N/A`).

Las plantillas completas están en [`references/doc-templates.md`](references/doc-templates.md).
Cada documento lleva el mismo encabezado de identidad (autor desde git/sesión + commit + fecha/hora).

---

## Memoria híbrida (Engram)

`ozali` cablea en el `SKILL.md` de `cdk` un contrato de **memoria híbrida**: cada artefacto clave
vive como **documento legible** (los 6 por hito) **y** como **espejo en Engram** (buscable,
recuperable, acumulativo). Así la herramienta **aprende de lo que el equipo va haciendo**. Contrato
completo (naming, llamadas inline, degradación) en
[`references/engram-convention.md`](references/engram-convention.md).

> **Orquestador por defecto (`ozali-jarvis`):** `ozali init` crea el agente **ozali-jarvis**
> (persona en CLAUDE.md/AGENTS.md + subagente + hooks) que opera **memoria-aware en toda sesión, sin
> necesidad de `/cdk`**: recupera contexto de Engram al iniciar, registra el trabajo del equipo
> conforme avanza, y **delega la ejecución disciplinada en `cdk`**. `cdk` y jarvis comparten el mismo
> contrato de memoria (esta convención).

**Mínimos que `cdk` debe cablear** (resumen; el detalle y los `mem_*` exactos están en la convención):

- **Al iniciar un hito** → handshake "Engram en línea" (`mem_current_project` + `mem_context`) +
  `mem_save_prompt` (captura el prompt real una vez) + `mem_search` de `cdk/{hito}/state`,
  `cdk/_project/testing-capabilities`, `cdk/_project/token-metrics` y `cdk/{hito}/*` →
  `mem_get_observation` **selectivo** de lo relevante. Al recuperar `state`, aplicar el **guard de
  rama** (`state.rama` vs rama actual); si coinciden y hay pendientes, **reanuda**; si diffieren,
  **ignorar** (tratar como hito nuevo). Con `testing-capabilities` resuelve el modo TDD.
- **Recall-first (ahorro de tokens/contexto)** → antes de releer/re-analizar, reusar el
  `analisis`/`resumen-tecnico` previo si su `ultimo_commit` sigue vigente (guard de staleness); si el
  código cambió, re-analizar solo el delta. Recuperación selectiva y restauración tras compactación
  desde `state`+`bitacora`. Ver convención §7.
- **Telemetría** → espejar `uso-tokens` a `cdk/{hito}/uso-tokens`, agregar en
  `cdk/_project/token-metrics` y escribir `.ozali/metrics/token-metrics.json` (lo lee `ozali doctor`).
- **Al aprobar el GATE** → `mem_save` de `cdk/{hito}/plan-aprobado` **una sola vez** (inmutable).
- **Durante el ciclo** → `mem_update` (upsert) de `cdk/{hito}/bitacora` y `cdk/{hito}/state` tras
  cada transición de fase (el archivo `05` sigue siendo append-only como fuente de verdad).
- **Al cerrar** → `mem_save` de `cdk/{hito}/resumen-tecnico` + `mem_session_summary` (solo el agente
  top-level, nunca un subagente).
- **Naming determinista:** `cdk/{hito}/{tipo}` (o `cdk/_project/{tipo}`), `type: architecture`,
  `capture_prompt: false` para artefactos automáticos.

**Reglas duras:** persistir **antes** del texto final del subagente; en `hybrid` el doc es la
fuente de verdad y Engram el índice (lectura Engram-primero, docs-fallback); **la ausencia de
Engram nunca bloquea** un hito — `cdk` degrada a modo `docs` y anota el espejo pendiente. El
**histórico se sincroniza al repo de conocimiento aislado** con `ozali sync` (no al repo principal).

---

## Permisos del modo normal (sin `--auto`)

Aun **sin** `--auto`, `cdk` opera con un **perfil base de permisos** orientado al análisis y la
validación, para no interrumpirte por operaciones de diagnóstico:

- **Lectura dentro del proyecto** (`Read`/`Grep`/`Glob` y Bash read-only).
- **Ejecución de líneas de comando** (Bash/PowerShell) y **scripts de Python**.
- **Fetch de sitios externos para lectura** (`WebFetch`/`WebSearch`).

Lo que el modo normal **sí** sigue confirmando: **ediciones/escrituras de archivos** y los
comandos destructivos (`rm -rf`, `git push`). El **🛑 GATE del plan** se mantiene igual.

> Plantillas listas para copiar en [`references/permissions-bypass.md`](references/permissions-bypass.md)
> (Claude Code §1 y opencode §2).

---

## Modo autónomo (`--auto`)

`ozali` debe cablear en el `SKILL.md` de `cdk` un **modo autónomo** que recorre el hito **de punta
a punta sin prompts**. La **regla del único alto** lo resume:

> 🎯 **En modo `--auto` el único punto donde `cdk` se detiene a esperar al humano es el
> 🛑 GATE del plan.** Todo lo demás —análisis, lectura de rutas no contempladas, ejecución— corre
> sin interrupciones.

- **Invocación:** el usuario antepone el flag, p. ej. `cdk --auto agrega validación de RFC en
  cotización`. `cdk` reconoce `--auto` en cualquier posición; el inicio es la forma canónica.
- **El GATE (único alto):** el plan se presenta y se espera aprobación, **siempre**.
- **Después del GATE:** ejecuta de punta a punta dentro del alcance aprobado. Si surge algo
  **fuera** del plan, se **detiene y pregunta** (y lo registra en la bitácora `05`).
- **Permisos: una skill NO puede auto-otorgarse permisos.** El bypass se configura a nivel de
  **entorno** (settings/flags). `cdk`, al detectar `--auto`, **verifica/recuerda** la config de
  [`references/permissions-bypass.md`](references/permissions-bypass.md).
- **Registro:** que el hito corrió en `--auto` (y con qué bypass) se anota en `05-bitacora-ejecucion.md`.

---

## Documentación de corrida

Cada corrida de `ozali` produce **3 documentos `.md`** en una carpeta por corrida. Plantillas en
[`references/doc-templates.md`](references/doc-templates.md).

- **Ruta base:** `.ai/ozali/logs/` (la corrida del bootstrap puede vivir junto al cerebro; el
  histórico **por hito** de `cdk` es el que se aísla al repo de conocimiento).
- **Carpeta de corrida:** `ozali.log_{{yy-mm-dd}}/` (sufijo `-2`, `-3`, … si ya existe del día).
- **Contenido:**
  1. `01-analisis.md` — análisis del proyecto e **hitos de importancia**.
  2. `02-plan.md` — el **plan ejecutado**.
  3. `03-mejoras.md` — **mejoras posibles** a la skill y al proyecto, cada una con su **grado de
     relevancia** (Alta/Media/Baja).

**Encabezado obligatorio** al inicio de cada documento, con la identidad de Fase 0 y la hora:

```
---
ozali.log: 26-06-27
documento: 01-analisis
Autor: <user.name> <<user.email>>
Sesión: <correo de sesión>
Rama: <branch>
Commit: <short SHA>
Creado: 2026-06-27 14:32:07 (local)
---
```
