# Convención de memoria híbrida (docs + Engram)

Contrato de persistencia que `ozali` cablea dentro del `SKILL.md` de `cdk` (Fase 6). Define
**qué se guarda, dónde, cuándo y con qué nombre** para que la herramienta **aprenda de lo que el
equipo va haciendo** sin sobrecargar el repo principal.

> **Principio híbrido:** cada artefacto clave vive en **dos** lugares — un **documento legible**
> (para humanos, auditable, versionable en el repo de conocimiento) **y** un **espejo en Engram**
> (buscable, recuperable tras compactación, base de la memoria acumulativa del equipo).

---

## 1. Modo de persistencia y degradación

`cdk` resuelve el modo **al iniciar cada hito**:

| Modo | Lee de | Escribe en | Cuándo |
|---|---|---|---|
| **`hybrid`** (default) | Engram primero, docs como fallback | docs **y** Engram | Engram disponible |
| **`docs`** | docs | docs | Engram **no** instalado/alcanzable |
| **`none`** | contexto del prompt | nada | el usuario lo pide explícito (efímero) |

**Detección de Engram:** el MCP de Engram expone `mem_*`. Si las herramientas no están disponibles
(o `mem_context` falla), `cdk` **degrada a `docs`** sin romper: escribe los 6 documentos por hito
igual y anota en la bitácora que el espejo Engram quedó pendiente. `ozali init` (CLI) **verifica/
guía la instalación de Engram**; mientras no esté, todo funciona en modo `docs`.

> Regla: la **ausencia de Engram nunca bloquea** un hito. Solo se pierde la capa buscable, que se
> rellena al sincronizar cuando Engram esté disponible.

**Nombre de proyecto:** usa el que Engram autodetecta del remoto git (normalizado a minúsculas).
Sin remoto, el nombre de carpeta. Mantén UN nombre por proyecto (evita drift `my-app` vs `My-App`).

---

## 1.5. Memoria de equipo (scope + idioma)

La memoria de Engram es **compartida**: lo que un dev guarda en `scope: project` lo recuperan los
agentes de sus compañeros tras `ozali sync` / `ozali sync --import`. Dos convenciones son
**obligatorias** para que esa memoria compartida sirva como herramienta de equipo.

### Scope: `project` vs `personal`

| Guarda como `scope: project` | Guarda como `scope: personal` |
|---|---|
| Decisiones de arquitectura y trade-offs | Notas y aprendizajes personales |
| Bugfixes que afectan a otros | Atajos de editor / dotfiles |
| Convenciones, naming, *gotchas* del repo | Preferencias de estilo o workflow |
| Contratos de API, quirks de despliegue | Enlaces para releer luego |
| Contexto de onboarding | TODOs y recordatorios personales |

> Regla rápida: **si el agente de un compañero debería encontrarlo, es `scope: project`.** Todos los
> artefactos automáticos de `cdk` (§2) van en `scope: project`.

> ⚠️ **El sync exporta AMBOS scopes.** Hoy `scope` filtra búsqueda, **no** transporte: al sincronizar
> un proyecto se comparten también sus observaciones `personal`. Si necesitas notas verdaderamente
> privadas, guárdalas bajo **otro nombre de proyecto** (p. ej. `tu-nombre-notas`) que no sincronices,
> o no las pongas en Engram.

### Idioma de la memoria compartida: **español**

FTS5 (el buscador de Engram) **no es multilingüe**: una búsqueda en un idioma no matchea memorias
guardadas en otro. Por eso este equipo fija una **lingua franca** para `scope: project`:

- **`scope: project` → siempre en español.** Títulos, `topic_key` semánticos y contenido.
- **`scope: personal` → cualquier idioma** (nadie más busca tu scope personal).

> 🔑 **Regla de consistencia:** como elegimos español, **tanto al guardar como al buscar**
> `scope: project` se usa español. Una `mem_search` en inglés sobre memoria guardada en español
> **no devuelve nada** — la búsqueda se fragmenta y la memoria de equipo deja de funcionar.

---

## 2. Naming determinista

Todos los artefactos de `cdk` en Engram siguen:

```
title:           cdk/{hito}/{artifact-type}
topic_key:       cdk/{hito}/{artifact-type}
type:            architecture
project:         {nombre del proyecto detectado}
scope:           project
capture_prompt:  false        # artefactos automáticos: NO capturan el prompt del usuario
```

Para artefactos a nivel de proyecto (no de hito): `cdk/_project/{artifact-type}`.

> `capture_prompt: false` es **explícito y obligatorio** para artefactos automáticos cuando el
> esquema lo soporta (Engram v1.15.3+ lo pone `true` por defecto en saves humanos). Si un esquema
> viejo no expone el campo, **omítelo** en lugar de fallar. El **prompt del usuario** se captura
> aparte, una sola vez, con `mem_save_prompt` al inicio del hito (artefacto `01`).

### Mapa doc ↔ Engram

| Doc por hito (archivo) | artifact-type (Engram) | Momento | Operación |
|---|---|---|---|
| `01-prompt-entrada.md` | — (usa `mem_save_prompt`) | inicio del hito | `mem_save_prompt` |
| (análisis del analyzer) | `analisis` | tras el análisis | `mem_save` |
| `02-plan-aprobado.md` | `plan-aprobado` | al aprobar el GATE | `mem_save` **una vez** (inmutable) |
| `05-bitacora-ejecucion.md` | `bitacora` | checkpoints del ciclo | `mem_update` (upsert) |
| `03-resumen-tecnico.md` | `resumen-tecnico` | al cierre | `mem_save` |
| (estado del orchestrator) | `state` | tras cada transición de fase | `mem_update` (upsert) |
| calibración (Fase 3.5 de ozali) | `_project/testing-capabilities` | en el bootstrap | `mem_save` |

> `04-resumen-usuario.md` y `06-uso-tokens.md` se quedan como **docs legibles** (no necesitan
> espejo buscable); opcional mirror si el equipo lo quiere.

---

## 3. Llamadas inline (lo que cdk debe ejecutar)

### Al INICIAR un hito (contrato de arranque — así aprende del equipo)

```
# 1) Capturar el prompt real, una vez:
mem_save_prompt(prompt: "{prompt textual del usuario}", project: "{project}")

# 2) Traer contexto previo (búsquedas primero, luego recuperar full):
mem_search(query: "cdk/{hito}/state", project: "{project}")            → ¿hito en curso? (reanudar)
mem_search(query: "cdk/_project/testing-capabilities", project: "{project}")  → strict_tdd + comando verde
mem_search(query: "cdk/{hito}", project: "{project}")                 → artefactos relacionados
mem_context(project: "{project}")                                      → historia reciente de sesión

# 3) Recuperar contenido completo de lo relevante (search devuelve preview truncado):
mem_get_observation(id: {state_id})                  → restaurar fase + tareas done/pending
mem_get_observation(id: {testing_capabilities_id})   → resolver modo TDD
```

Si `state` existe con tareas pendientes → **reanuda** desde la primera pendiente (no rehagas lo
hecho). Si `testing-capabilities` da `strict_tdd: true` → ciclo **test-first** (RED→GREEN→REFACTOR).

### Al CONGELAR el plan (GATE aprobado)

```
mem_save(
  title: "cdk/{hito}/plan-aprobado", topic_key: "cdk/{hito}/plan-aprobado",
  type: "architecture", project: "{project}", capture_prompt: false,
  content: "{markdown completo del plan aprobado}"
)
```
Inmutable: **no** se vuelve a guardar este topic_key. Los desvíos van a `bitacora`.

### DURANTE el ciclo (bitácora + estado, append-only en archivo, upsert en Engram)

```
# bitácora: el archivo 05 es append-only (fuente de verdad); el espejo se upserta con el full actual
mem_update(id: {bitacora_id}, content: "{contenido completo y actualizado de la bitácora}")
#   (si aún no existe: mem_save con topic_key cdk/{hito}/bitacora)

# estado recuperable: upsert tras CADA transición de fase
mem_update(id: {state_id}, content: "{ver §4}")
#   (si aún no existe: mem_save con topic_key cdk/{hito}/state)
```

### Al CERRAR el hito

```
mem_save(title: "cdk/{hito}/resumen-tecnico", topic_key: "cdk/{hito}/resumen-tecnico",
         type: "architecture", project: "{project}", capture_prompt: false,
         content: "{resumen técnico}")
# y un cierre de sesión (solo el agente top-level, NUNCA un subagente):
mem_session_summary(project: "{project}", content: "{qué se logró en el hito}")
```

---

## 4. Artefacto `state` (recuperable tras compactación)

Lo mantiene el `project-orchestrator`. Permite que un hito sobreviva a una compactación de
contexto o a cerrar/abrir la sesión.

```
title:     cdk/{hito}/state
topic_key: cdk/{hito}/state
type:      architecture
project:   {project}
scope:     project
capture_prompt: false
content: |
  hito: {hito}
  fase: {analysis_done | plan_approved | execution_done | testing_done | completed}
  strict_tdd: {true|false}
  modo: {normal | --auto}
  tareas:
    completadas: [t1, t2]
    pendientes: [t3, t4]
  archivos_procesados: [path/relativo/1, path/relativo/2]
  ultimo_commit: {short SHA}
  last_updated: {ISO-8601}
```

**Fases obligatorias (checkpoints entre fases):**

| Fase | Significado | Acción del orchestrator |
|---|---|---|
| `analysis_done` | Análisis completado, listo para plan | `mem_save` de `analisis` + `mem_update` de `state` con `fase: analysis_done` |
| `plan_approved` | Plan aprobado en el 🛑 GATE | `mem_save` de `plan-aprobado` (inmutable) + `mem_update` de `state` con `fase: plan_approved` |
| `execution_done` | Ejecución de código completada | `mem_update` de `state` con `fase: execution_done`, lista final de archivos procesados |
| `testing_done` | Testing validado | `mem_update` de `state` con `fase: testing_done`, resultado de pruebas |
| `completed` | Hito cerrado, documentación lista | `mem_save` de `resumen-tecnico` + `mem_session_summary`, **borrar `state`** (hito limpio) |

**Recuperación (2 pasos):** `mem_search("cdk/{hito}/state")` → `mem_get_observation(id)` → parsear
YAML → restaurar. Si no hay `state`, es un hito nuevo. Si la fase es `completed`, ignorar (hito
ya cerrado).

---

## 4.5. Micro-checkpoints en disco (`.ozali/.session-state.json`)

Complemento local al `state` de Engram. Cuando Engram no está disponible o como respaldo
tolerante a fallos de red.

**Quién lo escribe:** los `executioners` (durante fase de ejecución) y el `project-orchestrator`
(al cambiar de fase).

**Cuándo:**
- Al completar una fase (transición de `analysis_done` → `plan_approved`, etc.).
- **Durante ejecución:** si el hito modificará **>5 archivos**, guardar micro-checkpoint cada
  **3-5 archivos procesados**.

**Formato:**

```json
{
  "hito": "alta-componente-cobranza",
  "fase": "execution_done",
  "strict_tdd": true,
  "modo": "normal",
  "tareas": {
    "completadas": ["t1", "t2"],
    "pendientes": ["t3"]
  },
  "archivos_procesados": [
    "src/app/cotizacion/cotizacion.module.ts",
    "src/app/cotizacion/cotizacion.service.ts"
  ],
  "ultimo_commit": "a1b2c3d",
  "last_updated": "2026-07-17T19:45:00Z"
}
```

**Reglas:**
- El archivo es **sobrescrito** (no append-only) — siempre refleja el estado actual.
- Al reanudar, `cdk` lee este archivo **además** del `state` de Engram. Si ambos existen,
  usa el más reciente (`last_updated`).
- Al cerrar el hito (`completed`), el orchestrator **borra** `.session-state.json`.
- Si no hay Engram (modo `docs`), este archivo es la **única fuente de reanudación**.

---

## 5. Reglas duras

- **Persistir ANTES de responder:** cuando un subagente guarda en Engram o escribe docs, la llamada
  va **antes** de su texto final. La última salida del subagente debe ser **texto**, nunca un
  tool-call (si no, el orquestador solo recibe `"Observation saved"` y se pierde el análisis).
- **Subagentes NO llaman `mem_session_summary`** — reservado para el agente top-level.
- **Modo `hybrid`: ambas escrituras deben tener éxito.** Si Engram falla a media operación, el doc
  ya quedó (fuente de verdad) y se anota el espejo pendiente en la bitácora; no se aborta el hito.
- **Lectura `hybrid`: Engram primero, docs como fallback.** Si `mem_search` no devuelve, lee el
  archivo correspondiente en `.ozali/docs/cdk/{hito}/`.
- **Nunca inventes el prompt:** si no hay contexto de prompt, `mem_save` no fabrica texto.

---

## 6. Sincronización al repo de conocimiento (`ozali sync`)

Engram guarda en su **store local**; el histórico (docs + export Engram) se aísla en el repo de
conocimiento de equipo (ver [team-history](../../docs/team-history.md)). El CLI lo orquesta:

```
ozali sync            # export del proyecto → repo de conocimiento, commit + push
ozali sync --import   # pull del repo de conocimiento → import a Engram local (onboarding)
```

Internamente (Fase C lo implementa):
1. `engram sync` exporta las memorias del proyecto a `.engram/` (chunks + manifest).
2. Copia `.engram/` y `.ozali/docs/cdk/` a `ozali-knowledge/{engram,projects/<project>/...}`.
3. Commit + push del repo de conocimiento (no del repo principal, que los tiene gitignored).
4. `--import` hace lo inverso: clona/pull del repo de conocimiento y `engram sync --import`.

> Trazabilidad: cada doc lleva `ultimo_commit`/`Commit:` del repo principal en su encabezado, así
> el histórico aislado siempre apunta al código exacto que documenta.

---

## 7. Rendimiento: recall-first + telemetría de tokens

El objetivo de esta sección es **gastar menos tokens y contexto** reutilizando lo que el equipo ya
guardó en Engram, en vez de recomputarlo. Aplica tanto al uso **ambiental** (orquestador
`ozali-jarvis`, sin `/cdk`) como por **hito** (`cdk`).

### 7.1 Handshake "Engram en línea"
Al iniciar sesión/hito: `mem_current_project` (confirma que coincide con `.engram/config.json`) +
`mem_context`. Si responde → **modo recall-first activo**. Si no responde → degrada a `docs` (§1);
la ausencia de Engram nunca bloquea.

### 7.2 Recall-first con guard de staleness
**Antes** de releer archivos o re-analizar, `mem_search` del `analisis` / `plan-aprobado` /
`resumen-tecnico` del área. Cada artefacto lleva `ultimo_commit` (§6):

- Si el **SHA actual coincide** (o los archivos del área no cambiaron) → **reusar** el resumen
  conciso vía `mem_get_observation`, **sin releer el código**. Ahorra tokens de entrada.
- Si **cambió** → re-analizar **solo el delta** (los archivos tocados desde `ultimo_commit`), no todo.

> El harness `verify-structure.mjs` (estructural, barato) puede seguir corriendo; lo que se evita es
> **releer archivos grandes** que ya tienen un resumen vigente en memoria.

### 7.3 Recuperación selectiva
`mem_search` devuelve **previews truncados**. Haz `mem_get_observation` **solo** de los pocos
artefactos que realmente necesitas. **Nunca** vuelques toda la memoria al contexto.

### 7.4 Restauración tras compactación
Tras una compactación (o reabrir sesión), reconstruye desde `state` (§4) + `bitacora` —ambos
concisos— en vez de re-derivar todo el contexto releyendo conversación y archivos.

### 7.5 Guardar conciso para recall barato
Guarda resúmenes **estructurados y deduplicados** (no volcados crudos). Mientras más conciso el
artefacto, menos cuesta recuperarlo después.

### 7.6 Telemetría de tokens (medir → mejorar)
- Espeja el uso de tokens del hito a `cdk/{hito}/uso-tokens` y mantén un agregado por proyecto en
  `cdk/_project/token-metrics`.
- También escribe un resumen **local** en `.ozali/metrics/token-metrics.json` (últimos N hitos:
  `{ hito, input, output, total, savedByRecall, at }`) para que `ozali doctor` muestre la tendencia
  sin consultar el MCP.
- **Al iniciar**, recupera `cdk/_project/token-metrics`: si hitos similares fueron pesados, sé más
  agresivo con recall-first (resume antes, evita relecturas grandes).

> `savedByRecall` = estimación de relectura evitada por reusar memoria (ver plantilla `06-uso-tokens`).

---

## 8. Cloud: réplica de equipo en tiempo real

Engram Cloud es una **capa opt-in** que replica la memoria del equipo a un servidor central,
**adicional al git-sync**. Con autosync activo, la réplica es **automática e invisible**: los devs
no necesitan correr `ozali sync` manualmente para compartir memoria.

### 8.1 Modelo: cloud-first, git-sync como backup

```
dev A guarda memoria → autosync → cloud → dev B (autosync recibe)
                                ↕
                    git-sync (backup/secondary)
```

- **Cloud-first**: la réplica es en tiempo real (autosync). El repo de conocimiento sigue siendo
  el backup offline (ver [team-history](../../docs/team-history.md)).
- **Sin cloud**: todo funciona igual, solo que el sync es manual (`ozali sync` + `--push`/`--import`).

### 8.2 Cómo se comparten las memorias vía cloud

1. Un dev guarda una observación con `mem_save` (scope: project, español — ver §1.5).
2. El autosync la replica al servidor cloud automáticamente.
3. El autosync del otro dev la recibe y la importa a su store local.
4. Ambos devs pueden buscarla con `mem_search`.

> **Scope + idioma siguen siendo obligatorios** (§1.5): `scope: project` siempre en español,
> `scope: personal` cualquier idioma. Cloud no cambia esta regla — solo acelera el transporte.

### 8.3 Archivos de configuración

| Archivo | Commiteable | Contiene | Propósito |
|---|---|---|---|
| `.ozali/cloud.json` | **Sí** (no lleva secretos) | server, project, enrolled, dashboard URL | Que un dev nuevo detecte la cloud del equipo al hacer `ozali init` |
| `~/.engram/cloud_token` | No (local) | El token de auth | Persistencia del token entre sesiones |
| `.claude/settings.json` (env) | Sí | `ENGRAM_CLOUD_AUTOSYNC=1`, `ENGRAM_CLOUD_TOKEN` | Autosync en el MCP del agente |

> El token **nunca** se commitea. `.ozali/cloud.json` solo tiene metadatos sin secretos.

### 8.4 Comandos cloud del CLI

| Comando | Qué hace |
|---|---|
| `ozali init` → detecta `.ozali/cloud.json` | Onboarding: conecta al dev nuevo en 1 paso (Fase 1) |
| `ozali sync --cloud` | Push manual a cloud (además del git-sync) |
| `ozali sync --cloud --import` | Pull desde cloud (onboarding inverso) |
| `ozali cloud status` | Estado de enrollment + último sync + upgrade pipeline |
| `ozali cloud upgrade` | Flujo completo: doctor → repair --apply → bootstrap |
| `ozali cloud repair` | `engram cloud upgrade repair --apply` |
| `ozali cloud dashboard` | Abre el dashboard web en el navegador |
| `ozali cloud config` | Re-configura servidor/token |
| `ozali audit --conflicts` | Lista conflictos de memoria pendientes |
| `ozali audit --conflicts --stats` | Estadísticas de conflictos |

### 8.5 Conflictos: qué son y cómo resolverlos

Cuando dos devs guardan memorias que el sistema detecta como **potencialmente conflictivas**
(misma `topic_key`, contenido divergente), Engram Cloud las marca como conflictos pendientes.

- `ozali doctor` avisa si hay conflictos pendientes (`pending > 0`).
- `ozali audit --conflicts` los lista.
- El agente los resuelve con `mem_judge` (ver protocolo de conflict surfacing en las
  instrucciones del MCP de Engram): `related`, `compatible`, `scoped`, `conflicts_with`,
  `supersedes`, `not_conflict`.
- `ozali audit --conflicts --judged` muestra los ya resueltos.

### 8.6 Troubleshooting cloud

| `reason_code` | Significado | Acción |
|---|---|---|
| `blocked_unenrolled` | El proyecto no está enrolado en el servidor | `ozali init` o `ozali cloud config` |
| `transport_failed` | No se pudo conectar al servidor | Verifica URL, red, firewall |
| `bootstrap_verified` (upgrade) | Todo OK, no necesita upgrade | — |
| otro (upgrade) | El proyecto requiere upgrade de esquema | `ozali cloud upgrade` |

> `ozali doctor` parsea estos códigos y muestra warnings específicos.
