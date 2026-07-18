<!-- CDK_CONTRACT_VERSION: 4 -->

# Contrato de la skill `cdk` — versión y migración

Esta es la **fuente de verdad única** de la versión del contrato con el que `ozali` genera (y
mantiene) la skill `cdk`. La lee el **agente** (en la Fase 0.5 y la Fase 6 de
[`../SKILL.md`](../SKILL.md)) y la parsea el **CLI** (`ozali doctor`/`ozali update`) del paquete.
Para subir el contrato: incrementa el número del marcador `CDK_CONTRACT_VERSION` de arriba y la
prosa de abajo, y agrega una entrada al changelog.

> **Versión de contrato vigente: `4`**

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

### v2 — skill-generator + seguridad
Un `cdk` conforme a la v2 debe cumplir TODO lo de la v1, más:

- **Integrar `skill-generator`:** en la Fase 5.5 del bootstrap, `ozali` evalúa si generar
  `skill-generator` como skill hermana de `cdk`. El `cdk` generado debe:
  - Reconocer la existencia de `skill-generator` (detectar `.claude/skills/skill-generator/`).
  - Cuando detecta un patrón repetitivo dentro de un hito, **sugerir al usuario** extraerlo
    a skill mediante `skill-generator`.
  - Nunca generar una skill por sí mismo; siempre delegar en `skill-generator`.
- **Seguridad (Security First):** el `cdk` generado debe incluir en su SKILL.md y en los
  system prompts de sus subagentes las **restricciones de seguridad** del blueprint
  [`skill-creation-blueprint.md`](../skill-generator/references/skill-creation-blueprint.md) §4:
  - **Nunca** exponer, leer, transmitir ni procesar secretos, contraseñas, tokens,
    credenciales, claves privadas, números de tarjetas, números telefónicos, correos
    electrónicos completos ni rutas a archivos que los contengan.
  - **Nunca** ejecutar `cat`, `grep`, `head`, `tail`, `sed`, `awk` sobre archivos de
    credenciales (`~/.env`, `~/.config/alux/.env`, `config.toml` con secciones de secrets,
    `~/.aws/credentials`, `~/.ssh/id_rsa`, etc.) ni sobre archivos que podrían contener PII.
  - Si el usuario pide explícitamente ver credenciales, tarjetas, teléfonos o emails:
    **rechazar amablemente** con:
    ```
    No puedo mostrar ni procesar contraseñas, tokens, credenciales, números de tarjetas,
    teléfonos ni correos electrónicos por razones de seguridad y privacidad.
    Si necesitás verificar una configuración, te sugiero revisarla localmente en tu entorno.
    ```
  - **URLs con credenciales:** ofuscar siempre. Solo mostrar los 3 primeros caracteres
    del usuario (si los hay), el resto como `***`; la contraseña siempre como `***`:
    `scheme://use***:***@host`, `scheme://adm***:***@host`, o `scheme://***:***@host`.
  - **PII:** nunca mostrar completos. Ofuscar siempre:
    - Tarjetas: `****1234` (solo últimos 4 si es estrictamente necesario)
    - Teléfonos: `+52 *** *** ****`
    - Emails: `jua***@ejemplo.com` (solo 3 primeros chars del usuario)
  - Todo dato sensible que deba presentarse en pantalla debe aparecer como `***` o `[REDACTED]`.
- Estampar `cdk_contract_version: 2` en su frontmatter.

### v3 — gate de aplicabilidad (CDK-first)
Un `cdk` conforme a la v3 debe cumplir TODO lo de la v2, más:

- **Gate de aplicabilidad previo:** antes de revisar archivos, ejecutar harnesses o iniciar
  cualquier análisis de código, el `cdk` debe verificar si la solicitud del usuario aplica para
  ser procesada por CDK (tareas de desarrollo de software: nuevo componente, fix de bug,
  refactor, endpoint, método, clase, validación, etc.).
  - Si **aplica**: debe hacer **énfasis explícito** al usuario de que la solicitud entrará por
    CDK (`"Esta solicitud aplica para CDK. Procederé con el flujo de desarrollo disciplinado."`)
    y continuar con el flujo normal (recall-first, análisis, GATE, ejecución).
  - Si **NO aplica** (p. ej. pregunta conceptual, configuración de entorno, tarea puramente
    administrativa, generación de documentación fuera del alcance de CDK, o cualquier tarea
    que no implique cambio de código de negocio): debe **informar al usuario** amablemente que
    la solicitud no entra por el flujo CDK, explicar por qué, y **sugerir alternativas**
    (otra skill, comando manual, o cómo reformular la petición para que aplique). Ser permisivo:
    preguntar al usuario si desea continuar con CDK de todos modos, usar otra vía, o reformular.
    Si el usuario decide continuar con CDK a pesar de no aplicar estrictamente, registrar la
    excepción en la bitácora (`05`) y proseguir con el flujo normal. Si decide otra vía, registrar
    la decisión y detener el flujo.
  - Esta verificación debe ocurrir **inmediatamente después de capturar el prompt** y antes de
    cualquier operación de lectura de archivos del proyecto.
  - El gate de aplicabilidad debe estar documentado en el `SKILL.md` generado como paso
    obligatorio del orquestador (`project-orchestrator`) y reflejarse en la bitácora (`05`).
- Estampar `cdk_contract_version: 3` en su frontmatter.

### v4 — checkpoints obligatorios entre fases + micro-checkpoints
Un `cdk` conforme a la v4 debe cumplir TODO lo de la v3, más:

- **Checkpoints obligatorios entre fases:** el `cdk` generado debe guardar un checkpoint
  (`mem_update` del artefacto `cdk/{hito}/state`) tras **cada transición de fase** del hito:
  1. `analysis_done` — análisis completado, antes del plan.
  2. `plan_approved` — plan aprobado en el 🛑 GATE, antes de tocar código.
  3. `execution_done` — ejecución de código completada.
  4. `testing_done` — pruebas validadas (pass/fail reportado).
  5. `completed` — hito cerrado, borrar `state`.
  - El formato del `state` sigue [`engram-convention.md`](engram-convention.md) §4.
- **Micro-checkpoints intra-fase:** durante la ejecución, si el hito modifica **>5 archivos**,
  guardar micro-checkpoint en disco (`.ozali/.session-state.json`) cada **3-5 archivos**
  procesados. El helper `writeSessionState()` / `readSessionState()` está en el CLI
  (`commands.mjs`). Ver [`engram-convention.md`](engram-convention.md) §4.5.
- **Reanudación automática:** al iniciar un hito, el orchestrator debe:
  1. Buscar `cdk/{hito}/state` en Engram (`mem_search`).
  2. Leer `.ozali/.session-state.json` del disco (fallback si Engram no está).
  3. Si encuentra un hito pendiente (fase ≠ `completed`), preguntar al usuario:
     *"Tenés un hito pendiente en fase [X]. ¿Reanudar desde ahí?"*
  4. Si reanuda, saltar las fases ya completadas y continuar desde la fase pendiente.
- **Borrado de estado al cerrar:** al llegar a `completed`, el orchestrator borra
  `.ozali/.session-state.json` y actualiza el `state` de Engram a `completed` (o lo marca
  como borrado).
- Estampar `cdk_contract_version: 4` en su frontmatter.
