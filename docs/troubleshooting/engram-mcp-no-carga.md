# Engram MCP no se levanta pese a estar el binario y el `.mcp.json`

← [README](../../README.md)

> **Solicitud de análisis para el equipo de ozali.** Caso real detectado durante el onboarding de
> un integrante. El objetivo es que `ozali init` / `ozali doctor` detecten y prevengan este
> escenario, no solo dejarlo documentado.

---

## Qué pasó

Un integrante del equipo (entorno **Ubuntu 24**, usuario `orlando-zamarron`) corrió `ozali init`
correctamente y tenía **las dos piezas base de Engram en su sitio**:

- **Binario** `engram` en PATH → `~/.local/bin/engram`, versión `1.19.0`.
- **Wiring MCP** presente e idéntico al de referencia, en
  `~/.claude/plugins/marketplaces/engram/plugin/claude-code/.mcp.json`:

  ```json
  { "mcpServers": { "engram": { "command": "engram", "args": ["mcp", "--tools=agent"] } } }
  ```

Aun así, el servidor **`engram` NO aparecía en `/mcp`** dentro de Claude Code, por lo que las tools
`mem_*` no cargaban en la sesión.

---

## Qué problemas causó

- Sin MCP levantado, **no hay memoria persistente**: no funcionan `mem_save`, `mem_search`,
  `mem_context`, ni el recall-first de `ozali-jarvis`.
- La sesión arranca "ciega" (sin contexto del equipo) y no se registran decisiones/aprendizajes →
  se pierde el acumulado buscable.
- **Diagnóstico confuso:** como el binario respondía (`which engram` ✓) y el `.mcp.json` existía,
  parecía que "todo estaba bien", cuando en realidad faltaba un paso.

---

## Causa raíz

**Añadir el marketplace ≠ tener el plugin activo.**

El archivo `.mcp.json` bajo `marketplaces/engram/...` es solo el **clon del marketplace**; Claude
Code **no levanta** ese servidor MCP hasta que el plugin `engram@engram` está **instalado y
HABILITADO a nivel usuario**. En este caso el plugin figuraba **deshabilitado** en `/plugin`.

> Recordatorio de arquitectura: Engram se carga como **plugin** de Claude Code (marketplace
> `Gentleman-Programming/engram`), no como MCP suelto en un `.mcp.json` del repo. Por eso las tools
> aparecen con el prefijo `mcp__plugin_engram_engram__*`. Requiere **dos piezas**: (1) binario
> `engram` en PATH, y (2) plugin instalado **y habilitado**.

---

## Cómo se resolvió

1. Abrir `/plugin` en Claude Code → el plugin **engram** aparecía **deshabilitado**.
2. Entrar en él → **"instalar para mí"** (habilitar a nivel usuario).
3. Con eso el MCP se levantó y `/mcp` mostró **engram → connected**.

Verificable con:

```bash
grep -i engram ~/.claude/plugins/installed_plugins.json   # debe listar "engram@engram" scope: user
```

Alternativa por comandos (si el plugin no estuviera ni añadido):

```
/plugin marketplace add Gentleman-Programming/engram
/plugin install engram@engram
# reiniciar Claude Code para relanzar los MCP
/mcp     # debe mostrar engram → connected
```

---

## Qué hace ozali ahora (desde v0.15.x)

Las propuestas originales ya están implementadas en el CLI:

1. **`ozali init` y `ozali doctor` verifican el estado real del plugin.**
   - `detect.mjs` lee `~/.claude/plugins/installed_plugins.json` y comprueba que
     `engram@engram` tenga al menos una entrada con `scope: user`.
   - Si el binario está en PATH pero el plugin no está habilitado, se muestra un **warning
     explícito** con los pasos exactos para habilitarlo.
2. **`ozali doctor` incluye el check en el checklist:**
   - `Engram MCP plugin` aparece junto a `Engram` y `Engram en línea`.
   - Si está deshabilitado, el checklist muestra ✖ y el mensaje de ayuda con el comando
     `/plugin install engram@engram`.
3. **Mensaje de PATH incluido.** Si tras habilitar el plugin el MCP sale `failed`, el CLI
   recuerda añadir `export PATH="$HOME/.local/bin:$PATH"` al shell.
4. **Post-instalación recordatoria.** Tras `ozali init` o `ozali install-engram`, si el plugin
   aún no está habilitado, se imprime la advertencia para que el usuario lo active antes de
   reiniciar Claude Code.

---

## Gotcha rápido (para copiar/pegar en onboarding)

> **Marketplace añadido ≠ plugin activo.** Si `which engram` responde y `.mcp.json` existe,
> pero `/mcp` no muestra Engram, lo más probable es que el plugin `engram@engram` esté
> deshabilitado. Corre en Claude Code:
>
> ```
> /plugin install engram@engram
> ```
>
> Verifica que esté **Enabled**, reinicia Claude Code y revisa `/mcp`.

---

_Detectado: 2026-07-20 · Entorno: Ubuntu 24 · engram 1.19.0 · plugin engram@engram 0.1.1_
_Resuelto en ozali: v0.15.x_
