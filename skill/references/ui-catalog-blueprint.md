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
el usuario (no los supongas): p. ej. `src/app/shared|core|ui|common|lib|tools|utils|widgets`,
`src/components`, `packages/ui/src`.
Excluye componentes de una sola página/feature salvo que el usuario pida incluirlos.

**Cómo decidir qué es compartido** (cuando el nombre no basta, mide): un directorio es candidato si
sus componentes **se usan desde ≥3 carpetas de feature distintas** (conteo ejecutado de su selector
fuera de él) o si la arquitectura del repo (`architecture.md`) lo declara reutilizable. Los
directorios de dominio/feature (los que agrupan pantallas de un módulo de negocio) se excluyen y se
**listan como excluidos con su motivo**. Si un directorio mezcla compartidos puros con piezas casi
de página, inclúyelo entero y marca las piezas de página como tales; no filtres dentro en silencio.
Los conteos de inventario excluyen specs. Si hay dos carpetas hermanas con el mismo propósito
(p. ej. `pipe/` y `pipes/`), cataloga ambas y avisa del duplicado.

- **Modo no interactivo** (subagente, CI, `--yes`): no preguntes; usa los directorios detectados,
  **lista cuáles usaste** al inicio del catálogo y entra a la lista de supuestos del GATE.
- Además de componentes, recorre **directivas y pipes** (o sus equivalentes: composables,
  hooks de UI, helpers de plantilla) y el **módulo/paquete de la librería base de UI** del repo
  (p. ej. Angular Material, MUI, Vuetify): qué exporta y qué patrón de modales usa.
- **Familias** (un componente padre que despacha a hijos, p. ej. `chart` → `chart-bar/line/…`):
  una fila por hijo, marcada `interno`, y el padre como punto de entrada.

### 2.2 Qué extraer por componente (leído del código, nunca de memoria)
| Campo | Cómo se obtiene |
|---|---|
| Nombre y archivo | ruta real del componente |
| Selector / tag de uso | `selector` (Angular), nombre exportado (React/Vue/Svelte) |
| Módulo / barril que lo exporta | `NgModule`, `index.ts`, registro global |
| Entradas y salidas | `@Input`/`@Output`, `props`/`emits`, props tipadas. Con >15 entradas: agrupa por prefijo/propósito, cita el rango de líneas y **avisa** que no conviene seguir ampliándolo |
| Contrato por código | si no tiene entradas y se configura tras abrirlo (`componentInstance.x = …`, `data` del diálogo): documenta ese contrato |
| **Nº de usos** | **dos conteos ejecutados**, ver "Definición de uso" |
| Estado | ver "Estados" |
| No confundir con | solo si aplica, ver abajo |

**Definición de uso** (escríbela, tal cual, al inicio del catálogo para que sea auditable):
- **Por plantilla:** apariciones del tag/componente en plantillas (archivos de plantilla y plantillas
  inline), **excluyendo specs y la carpeta del propio componente**. Reporta apariciones y archivos
  distintos, y cita el comando (`rg -c` / `grep -rc`; prefiere comandos portables entre BSD y GNU).
  **El patrón debe aceptar etiquetas multilínea** (atributos en la línea siguiente): usa
  `<tag([ >/]|$)` y no `<tag[ >]`, que subcuenta. Declara el patrón exacto en el documento.
- **Por código:** aperturas programáticas (`dialog.open(Clase`, `createComponent`, `router`/rutas
  que lo cargan, `@ViewChild`/refs, selector dinámico). Sin este conteo, un modal usado cientos de
  veces saldría con "0 usos".
- Lo que **no** se midió se declara en el documento (p. ej. "selector dinámico no medido").

**Estados:**
| Estado | Condición |
|---|---|
| `en uso` | ≥1 uso por plantilla o por código |
| `por código` | 0 por plantilla y ≥1 por código (modales, rutas) |
| `interno` | 0 usos directos y lo referencia otro componente del catálogo (familia) |
| `legado` | existe un reemplazo evidente **medido** (cita ambos conteos) |
| `sin uso` | 0 por plantilla **y** 0 por código **y** no es `interno`; añade "confirmar antes de borrar" |

**No confundir con:** si un componente con `sin uso` (o poco uso) tiene un nombre que sugiere una
función de página (pie, cabecera, navegación, aviso…), **busca qué mecanismo cubre esa función de
verdad** (otro componente con un tipo/modo, contenido administrable, layout) y cítalo con
`archivo:línea`. Si no lo encuentras, dilo: "no encontré el mecanismo con `<cmd>`".

Reglas de evidencia (heredan P-004/P-005): cada afirmación cita `archivo:línea`; "no se usa" o
"ningún" solo con **conteo ejecutado**; sin conteo, forma acotada ("no encontré usos con `<cmd>`").

### 2.3 Colores y tema (sección propia)
Documenta **cómo se define el color en este repo**: variables CSS (`--*`), clases del tema,
Angular Material theme, tokens de Tailwind, etc., y dónde viven. Si el tema **cambia por cliente o
entorno**, dilo: el catálogo remite a esa fuente, **no fija un color primario**. Incluye:
- **Rol de color → clase/token** (tabla): primario, éxito, peligro/cancelar, neutros, etc., con la
  clase o variable **leída del tema**, no inventada. Si un rol no existe en el repo, no lo agregues.
- **Regla:** ante un color del diseño ausente del tema y de la paleta, no lo añadas por tu cuenta:
  consulta al equipo, porque un color nuevo afecta a todos los temas/clientes. Cita dónde se da de
  alta un color/tema nuevo.
- **Tipografía:** fuentes cargadas (y dónde), la por defecto, y si el tema puede cambiarla.
- **Deuda medida** (opcional): literales de color fijos vs. uso de tokens, con el comando.

### 2.4 Estructura del documento
```markdown
# Catálogo de UI
> Generado por ozali (<commit>) — lo escrito bajo "> **Equipo:**" no se sobrescribe.
<alcance: directorios usados y si los confirmó el usuario o se detectaron>

## Reglas del proyecto
<reglas leídas de coding-standards/architecture que afectan a la UI: reutilizar antes de crear,
 no copiar colores del diseño, librería base para controles, i18n, módulos vs. standalone…>

## Del diseño al componente
| Si en el diseño ves… | Usa | Módulo / import |
|---|---|---|
<un lookup por patrón de UI frecuente; cada fila apunta a un componente del catálogo. Incluye las
 funciones de página que NO tienen componente homónimo (p. ej. el pie) con el mecanismo real>

## Esqueleto típico de una página
<la plantilla más repetida del repo (cita archivo:línea y cuántas plantillas la siguen): contenedor
 → barra → avisos → migas → contenido; helper responsive y breakpoints globales. Documenta las
 **trampas medidas**: combinación de clases/contenedores cuyo uso incorrecto causa desbordes o
 scroll, con el conteo de la forma correcta vs. la incorrecta (rg sobre plantillas).
 **Regla de desborde (obligatoria):** para cada clase de layout del esqueleto que defina margen,
 padding o ancho propio (`margin`, `padding`, `width`, `min-width` en su regla CSS), calcula si
 combinarla con una clase de **ancho completo** del grid (`100%`, `col-12`, `w-100`, `flex: 1 0 100%`)
 desborda (ancho 100% + margen/padding horizontal > 100%). Si desborda, documenta "usar `<clase
 correcta>`, **nunca** `<clase de ancho completo> <clase de layout>`" con la regla CSS citada
 (`archivo:línea`) y el conteo de plantillas con la forma correcta y con la incorrecta (0 si nadie
 comete el error hoy: la advertencia se documenta igual, es preventiva)>

## Colores y temas
<§2.3>

## Componentes compartidos
> Definición de "uso": <§2.2>
<agrupa por propósito (estructura/navegación, tarjetas, datos, avisos y modales, procesos y
 gráficas, otros) cuando haya >15 componentes; si no, una sola tabla>
| Componente | Selector | Módulo | Entradas / salidas | Usos (plantilla / código) | Estado | No confundir con |
|---|---|---|---|---|---|---|

## Directivas, pipes y herramientas
<tabla aparte; la herramienta estándar (p. ej. la tabla/grid) marcada como tal>

## Librería base de UI
<qué exporta el módulo/paquete base, patrón de modales y de mensajes breves>

## Internacionalización
<librería detectada, dónde viven las claves, cómo se usa en plantillas, cobertura medida>

## Mantenimiento
<al crear o quitar un componente, actualizar la tabla correspondiente en el mismo commit>

## Apéndice — comandos de conteo
<los comandos exactos ejecutados, desde la raíz del repo>
```
Las secciones **Colores y temas** e **Internacionalización** conservan su nombre: el revisor de UI
(§3) las referencia.

### 2.5 Activación y actualización
- **Pregunta** al usuario si generarlo cuando el repo es web y no existe (como `business/`,
  Fase 2.5). Flag manual: `/ozali --ui` (equivalente a `--business`) para generar o **actualizar**.
- **Actualizar** = re-recorrer y reportar **componentes nuevos, eliminados y con usos distintos**;
  aplicar solo el delta. **Preserva** todo bloque `> **Equipo:**` y toda sección que no sea tabla
  generada. Nunca borra contenido escrito a mano.
- **Migración opcional** (catálogo escrito antes del blueprint vigente): tras aplicar el delta,
  compara con §2.4 y **lista las secciones/columnas faltantes** (definición de uso, Estado, No
  confundir con, conteo por código, esqueleto, lookup, directivas/pipes, librería base, i18n,
  apéndice). Ofrece agregarlas **como secciones nuevas** (GATE); nunca reescribe ni reordena lo
  manual, y las filas existentes solo ganan columnas, no pierden texto.
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
