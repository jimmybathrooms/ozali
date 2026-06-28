# Perfiles de permiso de `cdk` (modo normal y `--auto`)

Plantillas y mecanismos de permisos para `cdk`, en **dos perfiles**, para **Claude Code** y
**opencode**.

> [!IMPORTANT]
> Una **skill no puede** otorgarse permisos ni cambiar el modo en caliente: el harness lee la
> configuración de los **archivos de settings** y de los **flags de lanzamiento**. Por eso
> esto es **configuración de entorno**, no algo que el `SKILL.md` ejecute. `cdk` solo
> **verifica/recuerda** que esté activa al iniciar.
>
> El **GATE es comportamiento de la skill**, no un prompt de permisos: liberar permisos y
> parar en el plan **no se contradicen**.

## Perfiles

| Capacidad | **Modo normal** (sin `--auto`) | **Modo `--auto`** |
| :-- | :-- | :-- |
| Lectura dentro del proyecto | ✅ sin prompt | ✅ sin prompt |
| Lectura de rutas **fuera** del proyecto | ❓ pregunta | ✅ sin prompt |
| Líneas de comando (Bash/PowerShell) | ✅ sin prompt | ✅ sin prompt |
| Scripts de Python | ✅ sin prompt | ✅ sin prompt |
| Fetch de sitios externos (lectura) | ✅ sin prompt | ✅ sin prompt |
| **Ediciones/escrituras de código** | ❓ **pregunta** | ✅ auto-aplica |
| Comandos destructivos (`rm -rf`, `git push`) | ❓ pregunta | ⚠ circuit breakers / `ask` |
| 🛑 GATE del plan | siempre para | siempre para |

> En **modo normal** `cdk` puede analizar y ejecutar libremente, pero **confirma los cambios de
> código**. En **`--auto`** además auto-aplica los cambios y el **único alto es el GATE**.

---

## 1. Claude Code

### 1.0 Modo normal (base) — lectura + comandos + Python + fetch
Perfil para el flujo **sin `--auto`**: libera análisis y ejecución, pero **las ediciones de
código siguen pidiendo confirmación**. Archivo `.claude/settings.json` (compartible) o
`.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash",
      "PowerShell",
      "WebFetch",
      "WebSearch"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push *)",
      "PowerShell(Remove-Item *)"
    ]
  }
}
```

- **Lectura dentro del proyecto** ya es libre (ver §1.1), por eso no hace falta `Read` en el
  `allow`; se mantiene **`ask` por defecto** para rutas fuera del proyecto (no se abre
  `additionalDirectories` en este perfil).
- **Líneas de comando** y **Python** quedan cubiertos por `Bash`/`PowerShell` (p. ej.
  `python script.py`, `python3 -m ...`, `mvn`, `node`).
- **Fetch externo de lectura** vía `WebFetch` (cualquier dominio) + `WebSearch`.
- **Ediciones/escrituras** (`Edit`/`Write`) **NO** están en `allow` → siguen preguntando.
- `deny` deja como red de seguridad los comandos destructivos más comunes (gana sobre `allow`).

> Variante **más acotada** (en vez de `Bash`/`PowerShell` completos): lista solo los comandos
> que usa el análisis, p. ej. `"Bash(python *)"`, `"Bash(python3 *)"`, `"Bash(node *)"`,
> `"Bash(mvn *)"`, `"Bash(git status*)"`, `"Bash(node .claude/skills/cdk/verify-structure.mjs*)"`.

### 1.1 Qué ya NO pide permiso (no necesitas hacer nada)
- **Lecturas dentro del working dir** y herramientas read-only: `Read`, `Grep`, `Glob`.
- **Comandos Bash read-only**: `ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`,
  `wc`, `which`, `diff`, `stat`, `du`, `cd` y formas read-only de `git`.

→ La fricción real del análisis son **rutas FUERA del working dir** (otro repo, `~`, etc.).

### 1.2 Opción A — Scoped (recomendada por seguridad)
Lecturas libres en el análisis + ediciones automáticas en la ejecución, sin abrir todo.
Archivo `.claude/settings.local.json` (o `.claude/settings.json` para compartir):

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Read",
      "Grep",
      "Glob",
      "Bash(node .claude/skills/cdk/verify-structure.mjs*)"
    ],
    "additionalDirectories": [
      "../",
      "//c/Users/<usuario>/ruta/a/otros/repos"
    ]
  }
}
```

- `additionalDirectories` habilita **leer/editar rutas fuera del proyecto** sin prompt (úsalo
  para las rutas no contempladas que el análisis pueda necesitar).
- `defaultMode: "acceptEdits"` auto-acepta ediciones y `mkdir/touch/mv/cp` en el working dir y
  en `additionalDirectories` (cubre la ejecución post-GATE).
- Mantienes control sobre comandos Bash de escritura (siguen preguntando salvo los `allow`).

### 1.3 Opción B — Bypass total (lo que pediste: solo parar en el plan)
Forma **fiable**: lanzar la sesión con el flag (NO depende de settings):

```bash
claude --dangerously-skip-permissions
```

- Salta **todos** los prompts; el único alto será el GATE de `cdk`.
- `defaultMode: "bypassPermissions"` en settings **puede no surtir efecto** (bug conocido); por
  eso se prefiere el flag.
- **Circuit breakers que SIEMPRE preguntan** aunque el bypass esté activo: `rm -rf /`,
  `rm -rf ~` y cualquier regla `ask` explícita.
- Escrituras a directorios protegidos (`.git`, `.claude`, `.vscode`, `.idea`, `.husky`, …)
  pueden seguir avisando; excepciones: `.claude/commands`, `.claude/agents`, `.claude/skills`.
- ⚠ Úsalo solo en entornos aislados/confiables (contenedor, VM o repo controlado).

### 1.4 Opción C — PreToolUse hook (avanzado)
Orden de evaluación: **PreToolUse hook → deny → ask → allow → modo**. Un hook puede
**auto-aprobar** llamadas (no puede saltarse `deny`/`ask`). Patrón típico: `allow` de `Bash` +
un hook que **rechace** solo los comandos peligrosos. Ver docs de hooks de Claude Code.

> Precedencia de settings: managed > flags CLI > `.claude/settings.local.json` >
> `.claude/settings.json` > `~/.claude/settings.json`. Un `deny` en cualquier nivel gana.

---

## 2. opencode

Config en `opencode.json` (raíz del proyecto) o `~/.config/opencode/opencode.json`. Valores:
`"allow"` | `"ask"` | `"deny"`. **Gana la última regla que coincide** → pon el catch-all `*`
primero y luego las excepciones.

### 2.0 Modo normal (base) — lectura + comandos + Python + fetch
Perfil para el flujo **sin `--auto`**: libera análisis y ejecución, **confirma ediciones**.
`opencode.json` en la raíz del proyecto:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": "allow",
    "grep": "allow",
    "glob": "allow",
    "webfetch": "allow",
    "external_directory": "ask",
    "edit": "ask",
    "bash": {
      "*": "allow",
      "rm -rf *": "ask",
      "git push *": "ask"
    }
  }
}
```

- `bash: "*": "allow"` cubre **líneas de comando y Python** (`python ...`, `mvn`, `node`).
- `webfetch: "allow"` → **fetch externo de lectura**.
- `external_directory: "ask"` mantiene la confirmación para **rutas fuera del proyecto**
  (en `--auto` pasa a `"allow"`, ver §2.1/§2.2).
- `edit: "ask"` → los **cambios de código siguen confirmándose**.

### 2.1 Opción A — Scoped (recomendada)
La clave para "rutas fuera del scope" es **`external_directory`** (por defecto `"ask"`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": "allow",
    "grep": "allow",
    "glob": "allow",
    "external_directory": "allow",
    "edit": "allow",
    "bash": {
      "*": "allow",
      "rm -rf *": "ask",
      "git push *": "ask"
    }
  }
}
```

### 2.2 Opción B — Bypass total
```json
{ "$schema": "https://opencode.ai/config.json", "permission": "allow" }
```
(equivale a `{ "*": "allow" }`). Nota: los archivos `.env` están **denegados por defecto**.

### 2.3 Opción C — Acotado solo al agente `cdk`
Deja el resto en `"ask"` y abre el bypass únicamente cuando corre `cdk`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": { "*": "ask" },
  "agent": {
    "cdk": {
      "permission": {
        "read": "allow",
        "grep": "allow",
        "glob": "allow",
        "external_directory": "allow",
        "edit": "allow",
        "bash": { "*": "allow", "rm -rf *": "deny", "git push *": "ask" }
      }
    }
  }
}
```

Las reglas del agente **se fusionan** con las globales y **tienen prioridad**.

---

## 3. Resumen rápido

| Necesidad | Claude Code | opencode |
| :-- | :-- | :-- |
| **Base modo normal** (lectura proyecto + comandos + Python + fetch, edita con confirmación) | `allow: [Bash, PowerShell, WebFetch, WebSearch]` (§1.0) | `read/grep/glob/webfetch/bash: allow`, `edit: ask` (§2.0) |
| Leer rutas fuera del scope en análisis | `permissions.additionalDirectories` | `external_directory: "allow"` |
| Auto-aceptar ediciones (post-GATE) | `defaultMode: "acceptEdits"` o Shift+Tab | `edit: "allow"` |
| Bypass total (solo parar en el plan) | `claude --dangerously-skip-permissions` | `"permission": "allow"` |
| Acotar el bypass a un solo flujo | `allow` por patrón + hook | `agent.cdk.permission` |
| Siempre pregunta (no bypasseable) | `rm -rf /`, `rm -rf ~`, reglas `ask` | `.env` (deny por defecto) |

> El **GATE del plan no se configura aquí**: lo impone el `SKILL.md` de `cdk`. Esta config solo
> elimina los **prompts de permiso** alrededor de él.
