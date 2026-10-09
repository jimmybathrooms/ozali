# Blueprint de UI web — catálogo de componentes + revisor de UI (contrato v10)

Aplica **solo a proyectos web** (frontend con UI): Angular, React, Vue, Svelte, Next, Nuxt, Vite,
Solid, etc. En backend **no se genera nada de esto**: ni el catálogo ni el rol `project-ui-reviewer`.

> `ozali` no tiene catálogo ni revisor propios: **genera la estructura** en el repo destino.
> Todo lo de abajo describe lo que `ozali` escribe en `.ai/context/` y `.claude/agents/` del repo
> que calibra. Nada se asume del repo: los directorios, el tema y el sistema de i18n se **leen**.

---

## 1. ¿Es un proyecto web?

Reutiliza la detección frontend de [`knowledge-blueprint.md`](knowledge-blueprint.md) §1, con una
condición extra: debe haber **UI renderizada** (plantillas/JSX/SFC), no solo una librería de utilidades.

| Señal | Web |
|---|---|
| `angular.json`, `@angular/core` | sí |
| `react`/`react-dom`, `next`, `vue`, `nuxt`, `svelte`, `solid-js`, `vite` con alguno de los anteriores | sí |
| `vite` solo, sin framework de UI ni HTML propio | no (pregunta) |
| backend (`pom.xml`, `go.mod`, `express`/`nestjs`/`fastify` sin UI…) | no |

Monorepo mixto: pregunta qué paquetes son web. Sin señales claras → **no generes** el rol.

---

## 2. Catálogo de componentes — `.ai/context/ui-components.md`

Documento de contexto que responde "¿qué componente existente reutilizo antes de crear uno?".

### 2.1 Qué recorrer
Detecta los **directorios de componentes compartidos** por convención del stack y confírmalos con
el usuario (no los supongas): p. ej. `src/app/shared|core|ui`, `src/components`, `packages/ui/src`.
Excluye componentes de una sola página/feature salvo que el usuario pida incluirlos.

### 2.2 Qué extraer por componente (leído del código, nunca de memoria)
| Campo | Cómo se obtiene |
|---|---|
| Nombre y archivo | ruta real del componente |
| Selector / tag de uso | `selector` (Angular), nombre exportado (React/Vue/Svelte) |
| Módulo / barril que lo exporta | `NgModule`, `index.ts`, registro global |
| Entradas y salidas | `@Input`/`@Output`, `props`/`emits`, props tipadas |
| **Nº de usos** | **conteo ejecutado** (`grep -rc` / `rg -c` sobre plantillas) citando el comando |
| Estado | `en uso` / `legado` (reemplazado por otro) / `sin uso` (0 usos) |

Reglas de evidencia (heredan P-004/P-005): cada afirmación cita `archivo:línea`; "no se usa" o
"ningún" solo con **conteo ejecutado**; sin conteo, forma acotada ("no encontré usos con `<cmd>`").

### 2.3 Colores y tema (sección propia)
Documenta **cómo se define el color en este repo**: variables CSS (`--*`), clases del tema,
Angular Material theme, tokens de Tailwind, etc., y dónde viven. Si el tema **cambia por cliente o
entorno**, dilo: el catálogo remite a esa fuente, **no fija un color primario**.

### 2.4 Estructura del documento
```markdown
# Catálogo de UI
> Generado por ozali (<commit>) — lo escrito bajo "> **Equipo:**" no se sobrescribe.

## Colores y temas
<dónde se define el color, cómo se aplica, qué cambia por cliente>

## Componentes compartidos
| Componente | Selector | Módulo | Entradas / salidas | Usos | Estado |
|---|---|---|---|---|---|

## Internacionalización
<librería detectada, dónde viven las claves, cómo se usa en plantillas>
```

### 2.5 Activación y actualización
- **Pregunta** al usuario si generarlo cuando el repo es web y no existe (como `business/`,
  Fase 2.5). Flag manual: `/ozali --ui` (equivalente a `--business`) para generar o **actualizar**.
- **Actualizar** = re-recorrer y reportar **componentes nuevos, eliminados y con usos distintos**;
  aplicar solo el delta. **Preserva** todo bloque `> **Equipo:**` y toda sección que no sea tabla
  generada. Nunca borra contenido escrito a mano.
- Si el usuario no lo quiere: se anota en `01-analisis.md` y en `03-mejoras.md` (relevancia Media).

---

## 3. Rol `project-ui-reviewer` (condicional, solo web)

| Campo | Valor |
|---|---|
| Archivo generado | `.claude/agents/project-ui-reviewer.md` |
| Categoría / nivel | **D — Validación** / **medium** |
| Cuándo se genera | solo si el repo es **web** (§1). En backend los roles siguen siendo 8. |
| Cuándo actúa | tras `executioners ⇄ tester`, solo si el hito toca archivos de UI |
| Herramientas | Read, Grep, Glob, Bash acotado (solo lectura). **No edita código.** |

### 3.1 Qué revisa (solo lo **nuevo o modificado** del hito)
1. **Colores fijos:** valores `#hex`, `rgb()`/`hsl()` literales en estilos y plantillas nuevos.
   Deben usar el mecanismo del tema documentado en el catálogo (§2.3: clases del tema, `--*`…).
2. **Duplicados:** componentes nuevos cuyo propósito ya cubre uno del catálogo (§2.2). Propone
   reutilizar y cita el componente existente con su selector y ruta.
3. **Textos sin i18n:** cadenas visibles literales en plantillas nuevas cuando el repo usa una
   librería de traducción (la que figure en el catálogo §"Internacionalización"). Si el repo no
   usa i18n, **omite** esta regla.

### 3.2 Salida
Reporte con una fila por hallazgo: `archivo:línea` · regla · severidad (`bloquea` / `advierte`) ·
sugerencia. Los hex y textos sin i18n **advierten**; un duplicado claro **bloquea** hasta que
`executioners` justifique. Lo entrega al `project-orchestrator`; lo resumido va a la bitácora (`05`).

### 3.3 Sin catálogo
Si no existe `.ai/context/ui-components.md`, el revisor aplica solo las reglas 1 y 3 con lo que
detecte en el código (tema y librería de i18n), avisa que falta el catálogo y sugiere `/ozali --ui`.

### 3.4 Nunca
- Nunca revisa ni edita backend. Nunca inventa el color "correcto": remite al tema documentado.
- Nunca asume rutas ni nombres de un proyecto concreto: todo sale del catálogo y del repo.
