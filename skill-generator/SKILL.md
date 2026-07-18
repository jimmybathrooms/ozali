---
name: skill-generator
description: Genera skills reutilizables para agentes de IA (Claude Code, opencode, Cursor, etc.) a partir de tareas repetitivas detectadas en el proyecto. Evalúa si un flujo de trabajo merece convertirse en skill, diseña su estructura según el Agent Skills Specification (skills.sh), y la materializa como SKILL.md + referencias. Úsala cuando el usuario quiera "crear una skill", "hacer un skill para...", "automatizar esto como skill", "generar una skill", "extraer esto a skill" o cuando detectes un patrón repetitivo que valga la pena encapsular.
model: medium
---

# Skill: skill-generator

`skill-generator` es la skill de **fabricación de skills**. Su trabajo es evaluar si una
tarea o flujo de trabajo del proyecto merece convertirse en una **skill reutilizable**, y
si es así, diseñarla y materializarla siguiendo los estándares del ecosistema de agent skills
(skills.sh, Claude Code, opencode, Codex, Cursor, etc.).

`skill-generator` **evalúa, diseña y construye**. No ejecuta código de negocio del proyecto;
solo produce el artefacto `SKILL.md` + sus referencias.

> **Regla de oro:** una skill solo se materializa si el usuario aprueba el diseño en el 🛑
> **GATE** de evaluación. Si no pasa los criterios de repetitividad, se rechaza amablemente.

> **Memoria de equipo (Engram):** skill-generator opera en modo **híbrido** — conserva el
> SKILL.md legible por humanos **y** espeja el artefacto a Engram para descubrimiento y
> reutilización. La skill generada vive junto al repo de conocimiento.

---

## Flujo de evaluación y generación (5 fases)

```
Fase 1  Evaluación de candidatura    → ¿merece convertirse en skill?
Fase 2  Diseño de la skill            → frontmatter, triggers, estructura, referencias
Fase 3  🛑 GATE: plan de skill        → presentar diseño, esperar aprobación
Fase 4  Materialización               → escribir SKILL.md + references/
Fase 5  Registro y difusión           → instalar en agentes + espejar a Engram
```

---

## Fase 1 — Evaluación de candidatura

Antes de generar nada, evalúa si el flujo de trabajo propuesto (o detectado) cumple los
criterios mínimos para convertirse en skill. Usa la tabla de decisión de
[`references/skill-creation-blueprint.md`](references/skill-creation-blueprint.md) §2.

### Criterios de evaluación (todos deben cumplirse)

| Criterio | Umbral | Cómo verificar |
|---|---|---|
| **Repetitividad** | ≥ 3 ocurrencias documentadas o previsibles | Contar instancias en el repo (commits, PRs, tareas similares) o justificación del usuario |
| **Contexto estable** | Las entradas/salidas no cambian drásticamente entre usos | Revisar si el flujo depende de variables inestables (APIs experimentales, diseños en borrador) |
| **Valor medible** | Ahorra >5 min de explicación o >3 pasos manuales por uso | Estimar con el usuario: "¿cuántas veces repites estos pasos?" |
| **Seguridad** | No manipula secretos, credenciales, contraseñas ni rutas a archivos sensibles | Revisar el blueprint §4 (Security First) |

### Resultado de la evaluación

- **✔ Aprobado** → continúa a Fase 2.
- **✖ Rechazado** → explica por qué no califica (qué criterio falla y qué haría falta).
  Guarda la evaluación en Engram (`skill-generator/rejected/{slug}`) para no reevaluar
  idénticamente en el futuro.

---

## Fase 2 — Diseño de la skill

Usa [`references/skill-creation-blueprint.md`](references/skill-creation-blueprint.md) §3 como
guía canónica. Diseña:

1. **Frontmatter YAML** (`name`, `description` rica con triggers, `cdk_contract_version` si aplica).
2. **Estructura del SKILL.md:**
   - Introducción y misión (1-2 párrafos).
   - Sección "When to Use" (triggers ricos: verbos + sustantivos que el usuario diría).
   - Sección "Steps" (pasos secuenciales, numerados, accionables).
   - Sección "References" (enlaces a `.md` en `references/` o docs del repo).
   - Sección "Examples" (2-3 ejemplos de prompts que activarían la skill).
3. **Referencias necesarias:** decide si la skill necesita un blueprint, template o convención
   adicional en `references/`.

### Reglas de diseño

- **Nombre canónico:** kebab-case, descriptivo, sin prefijos genéricos (`my-`, `test-`).
- **Description con triggers ricos:** incluir verbos ("crea", "genera", "corrige", "refactoriza",
  "audita", "migra") y sustantivos del dominio ("componente", "endpoint", "esquema", "commit",
  "workflow"). Esto mejora la **auto-invocación** del agente.
- **Agent-neutral:** la skill debe funcionar en Claude Code y opencode (y preferiblemente
  Cursor/Codex). Si necesita algo agent-specific, documentarlo explícitamente.

---

## Fase 3 — 🛑 GATE: presentar el plan de skill

> [!IMPORTANT]
> Es IMPERATIVO presentar el diseño completo como mensaje visible al usuario ANTES de pedir
> aprobación. Si el plan no se presentó de forma visible, el GATE **no es válido**.

Presenta:

- Nombre canónico y descripción final.
- Justificación de repetitividad (criterios de Fase 1).
- Estructura de archivos que se generará.
- Referencias adjuntas (si aplica).
- Compatibilidad de agentes (Claude Code / opencode / ambos).

**Detente y espera aprobación explícita.** No escribas nada hasta recibir el "ok".

---

## Fase 4 — Materialización

Tras la aprobación del GATE:

1. **Escribe el SKILL.md** en `.claude/skills/{name}/SKILL.md` (proyecto) o
   `~/.claude/skills/{name}/SKILL.md` (global), según el scope acordado.
2. **Escribe las referencias** en `.claude/skills/{name}/references/`.
3. **Asegura el frontmatter YAML válido**:
   ```yaml
   ---
   name: mi-skill
   description: Qué hace y cuándo usarla (triggers ricos)
   ---
   ```
4. **Asegura que no exponga secretos:** revisa final contra [`references/skill-creation-blueprint.md`](references/skill-creation-blueprint.md) §4.

---

## Fase 5 — Registro y difusión

1. **Instala la skill en el agente** (si el agente soporta skills.sh / symlink):
   - Claude Code: `.claude/skills/{name}/` ya es visible si Claude Code escanea esa ruta.
   - opencode: añadir a `opencode.json` → `skills` array si el agente requiere registro explícito.
2. **Espeja a Engram** (modo híbrido):
   - `mem_save` de `skill-generator/{name}/skill` con el contenido del SKILL.md.
   - `mem_save` de `skill-generator/{name}/blueprint` con la justificación de diseño.
3. **Sugiere al usuario:**
   - "Tu skill `{name}` está lista. Probá invocarla con: `{trigger de ejemplo}`."
   - "Si la usás >5 veces en el mes, considerá publicarla a skills.sh."

---

## Documentación de corrida

Cada corrida de skill-generator produce **3 documentos** en `.ai/ozali/logs/skill-generator/`:

1. `01-evaluacion.md` — evaluación de candidatura (criterios, veredicto).
2. `02-diseno.md` — diseño aprobado (frontmatter, estructura, referencias).
3. `03-skill-generada.md` — copia exacta del SKILL.md materializado.

---

## Integración con `cdk`

Cuando `cdk` detecta que un flujo de trabajo se está repitiendo dentro de un hito
(ej.: "siempre que toco X módulo, tengo que hacer Y pasos manuales"), debe:

1. **Sugerir al usuario:** "Este patrón se repite. ¿Querés que lo extraiga a una skill
   reutilizable con `skill-generator`?"
2. Si el usuario acepta, **delegar** la extracción a la skill `skill-generator` (no hacerlo
   dentro del hito de `cdk` — evitar mezclar responsabilidades).
3. La skill generada queda **disponible para futuros hitos** de `cdk` y para el equipo entero.

> **No generar skills dentro de `cdk`:** `cdk` ejecuta código de negocio; `skill-generator`
> fabrica skills. Son skills hermanas, no anidadas.
