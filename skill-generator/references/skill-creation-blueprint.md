# Blueprint de creación de skills (Agent Skills Specification)

Fuente de verdad para la skill `skill-generator`. Define cuándo, cómo y con qué
estándares se materializa una skill reutilizable en el ecosistema de agentes de IA.

Basado en:
- [Agent Skills Specification](https://agentskills.io)
- [skills.sh / vercel-labs/skills](https://github.com/vercel-labs/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills)

---

## 1. Estructura canónica de una skill

```
skill-name/
  SKILL.md              ← obligatorio. Frontmatter YAML + cuerpo markdown.
  references/           ← opcional. Blueprints, templates, convenciones.
    some-blueprint.md
```

### SKILL.md — frontmatter obligatorio

```yaml
---
name: skill-name               ← kebab-case, único en el repo/equipo
description: Qué hace y cuándo usarla. Incluye triggers ricos (verbos + sustantivos)
                               que el usuario naturalmente diría para activarla.
---
```

Campos opcionales (agent-specific):
- `metadata.internal: true` — oculta de descubrimiento normal (skills.sh).
- `cdk_contract_version: N` — si la skill es parte del ecosistema ozali/cdk.

### Cuerpo del SKILL.md

Secciones recomendadas (en orden):

1. **Introducción / Misión** (1-2 párrafos): qué resuelve, para qué agentes está pensada.
2. **When to Use** (triggers): escenarios y palabras clave que la activan. Sé explícito:
   "Úsala cuando el usuario quiera 'crear X', 'generar Y', 'auditar Z', 'migrar W'."
3. **Steps** (pasos secuenciales): numerados, accionables, con herramientas sugeridas.
4. **References** (enlaces): a `references/*.md` o a docs del proyecto.
5. **Examples** (2-3 ejemplos): prompts reales que la skill debería capturar.
6. **Integration notes** (opcional): cómo se integra con otras skills (ej.: `cdk`, `ozali-commit`).

---

## 2. Criterios de evaluación — ¿merece convertirse en skill?

Una tarea/flujo debe cumplir **TODOS** estos criterios para ser aprobada:

| # | Criterio | Umbral | Anti-ejemplo (rechazo) |
|---|---|---|---|
| 1 | **Repetitividad** | ≥ 3 usos documentados o previsibles en el próximo trimestre | "Nunca volveré a hacer esto" |
| 2 | **Contexto estable** | Entradas/salidas predecibles; no depende de APIs experimentales | "El formato cambia cada sprint" |
| 3 | **Valor medible** | Ahorra >5 min de explicación o >3 pasos manuales por uso | "Solo es un atajo de 10 segundos" |
| 4 | **Seguridad** | No manipula secretos, credenciales, contraseñas ni archivos sensibles | "Lee ~/.env y lo muestra al usuario" |
| 5 | **Scope acotado** | Hace una cosa bien; no intenta ser un orquestador universal | "Esta skill hace de todo" |

### Señales de que NO es una skill (rechazo rápido)

- Es una pregunta puntual ("¿cómo funciona X?") → responder directamente, no skill.
- Depende del estado emocional/contextual del usuario ("ayúdame a decidir si...") → no procedimental.
- Requiere acceso a datos personales o credenciales del usuario → **rechazo por seguridad**.

---

## 3. Diseño de skills multi-agente

El ecosistema skills.sh soporta **70+ agentes**. Diseña para el mínimo común denominador:

### Agent paths estándar (skills.sh CLI)

| Agente | Path proyecto | Path global |
|---|---|---|
| Claude Code | `.claude/skills/{name}/` | `~/.claude/skills/{name}/` |
| OpenCode | `.agents/skills/{name}/` | `~/.config/opencode/skills/{name}/` |
| Cursor | `.agents/skills/{name}/` | `~/.cursor/skills/{name}/` |
| Codex | `.agents/skills/{name}/` | `~/.codex/skills/{name}/` |
| Cline | `.agents/skills/{name}/` | `~/.agents/skills/{name}/` |

### Compatibilidad de features

| Feature | Claude Code | OpenCode | Cursor | Codex |
|---|---|---|---|---|
| `SKILL.md` básico | ✔ | ✔ | ✔ | ✔ |
| `allowed-tools` (frontmatter) | ✔ | ✔ | ✔ | ✔ |
| Hooks (SessionStart, etc.) | ✔ | ✘ | ✘ | ✘ |
| `context: fork` | ✔ | ✘ | ✘ | ✘ |

**Regla:** usa solo features universales (SKILL.md + allowed-tools) a menos que la skill sea
exclusiva para Claude Code y se documente explícitamente.

---

## 4. Security First — Reglas de seguridad para skills

> **Primera ley:** una skill nunca expone, lee, transmite ni procesa secretos, contraseñas,
> tokens, credenciales, claves privadas, números de tarjetas, números telefónicos, correos
> electrónicos completos ni rutas a archivos que los contengan.

### Prohibiciones absolutas

1. **No exponer credenciales en texto plano.** Si la skill necesita referirse a una
   variable de entorno, usa el nombre de la variable, nunca su valor.
   - ✅ `Asegúrate que DATABASE_URL esté definida.`
   - ✘ `La contraseña es mySecret123.`

2. **No ejecutar comandos que lean archivos de credenciales.**
   - ✘ `cat ~/.env`, `cat ~/.aws/credentials`, `cat ~/.ssh/id_rsa`
   - ✘ `grep -r "password" .`, `grep -r "token" .`
   - Si el usuario pide explícitamente ver credenciales: **recházalo amablemente.**

3. **No ofuscar como excusa.** Si un comando expone una credencial, no lo ejecutes
   diciendo "ya la ofuscaré después". **La salida del tool expone la credencial ANTES**
   de que puedas redactarla.

4. **URLs con credenciales:** siempre ofusca completamente. Solo mostrar los 3
   primeros caracteres del usuario (si los hay), el resto como `***`; la contraseña
   siempre como `***`:
   - ✅ `scheme://use***:***@host` (usuario "user" → `use***`)
   - ✅ `scheme://adm***:***@host` (usuario "admin" → `adm***`)
   - ✅ `scheme://***:***@host` (usuario < 3 chars o desconocido → `***`)

5. **Archivos de configuración sensibles:** no leer ni editar `.env`, `.secret`, `.key`,
   `config.toml` con secciones de credenciales, a menos que sea para agregar una variable
   **sin valor** (placeholder).

6. **No exponer PII (datos personales):** nunca mostrar, leer, transmitir ni procesar
   números de tarjetas de crédito/débito, números telefónicos completos ni direcciones de
   correo electrónico completas. Si la skill necesita referirse a ellos, usa placeholders:
   - ✅ `El número de tarjeta termina en ****1234.` (solo últimos 4 si es estrictamente necesario)
   - ✅ `Contacto: jua***@ejemplo.com` (solo 3 primeros chars del usuario, el resto como `***`)
   - ✅ `Teléfono: +52 *** *** ****` (solo prefijo de país si aplica, el resto como `***`)
   - ✘ `La tarjeta es 4532123456789012.`
   - ✘ `El email es juan.perez@empresa.com.`
   - ✘ `El teléfono es +52 55 1234 5678.`

### Respuesta estándar ante solicitudes de credenciales o PII

```
No puedo mostrar ni procesar contraseñas, tokens, credenciales, números de tarjetas,
teléfonos ni correos electrónicos por razones de seguridad y privacidad.
Si necesitás verificar una configuración, te sugiero revisarla localmente en tu entorno.
```

### Checklist de seguridad pre-materialización

Antes de escribir el SKILL.md final, verifica:
- [ ] ¿Algún paso sugiere leer un archivo que podría contener secretos o PII?
- [ ] ¿Algún ejemplo de prompt podría inducir al usuario a pedir credenciales, tarjetas, teléfonos o emails?
- [ ] ¿La skill menciona rutas sensibles (`.env`, `~/.config/`, `~/.ssh/`)?
- [ ] ¿Hay instrucciones de "ofusca esto" como justificación para ejecutar un comando riesgoso?
- [ ] ¿Algún paso podría exponer números de tarjetas, teléfonos completos o correos completos?

Si alguna casilla falla → **rediseñar la skill** antes de materializarla.

---

## 5. Triggers y auto-invocación

La descripción de una skill es su **interfaz de descubrimiento**. Un agente invoca una skill
cuando el prompt del usuario coincide semánticamente con la descripción.

### Cómo escribir descriptions que sean descubribles

- **Verbos al inicio:** "Crea", "Genera", "Corrige", "Refactoriza", "Audita", "Migra",
  "Valida", "Despliega", "Documenta".
- **Sustantivos del dominio:** "componente React", "endpoint REST", "esquema Prisma",
  "commit convencional", "workflow de CI", "plan de refactor".
- **Sinónimos:** si el equipo dice "feature" y "funcionalidad", incluye ambos.
- **Anti-patrones:** evita descripciones genéricas como "Ayuda con el proyecto" o
  "Hace cosas útiles".

### Ejemplo de description rica

```yaml
---
name: component-generator
description: Genera componentes React con TypeScript siguiendo el design system del proyecto. Crea hooks, stories y tests asociados. Úsala cuando el usuario quiera "crear un componente", "nuevo botón/modal/tabla", "generar UI", "scaffold de componente" o "hacer un story para X".
---
```

---

## 6. Reutilización y evolución

### Versionado de skills

Las skills no usan semver tradicional. El versionado es implícito:
- **V1:** skill básica, sin references/
- **V2:** agrega references/ con blueprints
- **V3:** agrega integración con otras skills (hooks, callbacks)

Documenta los cambios mayores en un `CHANGELOG.md` dentro de `references/` si la skill es
compartida con el equipo.

### Migración de skills legadas

Si una skill usa nomenclatura heredada (nombres de herramientas obsoletas, paths viejos):
1. Renómbrala con un nombre canónico nuevo.
2. Deja la skill vieja con un aviso de deprecación en su SKILL.md.
3. Migra usuarios activos notificándolos en el próximo hito de `cdk`.

---

## 7. Preguntas frecuentes

**¿Puede una skill invocar otra skill?**
Sí, pero documenta la dependencia explícitamente. Ej.: "Esta skill invoca `ozali-commit`
en su cierre para generar el commit summary. Asegurate que `ozali-commit` esté instalada."

**¿Dónde publicar una skill para el equipo?**
- Opción A: repo privado del equipo + `npx skills add owner/repo`.
- Opción B: skills.sh pública (si la skill es genérica y no expone datos internos).

**¿Qué pasa si el agente no soporta skills?**
La skill sigue siendo útil como **documentación procedimental**. El usuario puede copiar el
SKILL.md y seguir los pasos manualmente.
