# Plantillas de documentación

Hay **dos** conjuntos de documentación, con propósito y ruta distintos:

| Conjunto | Quién lo genera | Cuándo | Ruta |
|----------|-----------------|--------|------|
| **Corrida de ozali** | `ozali` | cada corrida de diagnóstico | `.ai/ozali/logs/ozali.log_{{yy-mm-dd}}/` |
| **Hito de cdk** | `cdk` (`project-documenter`) | cada solicitud/hito del usuario | `.ozali/docs/cdk/<hito>/` |

Ambos comparten el mismo **encabezado de identidad**.

---

## A) Documentación de corrida (ozali)

Cada corrida de `ozali` produce **3 documentos** en:

```
.ai/ozali/logs/ozali.log_{{yy-mm-dd}}/
  01-analisis.md
  02-plan.md
  03-mejoras.md
```

- `{{yy-mm-dd}}` = fecha local de la corrida (ej. `26-06-10`).
- Si ya existe una carpeta del mismo día, agrega sufijo: `ozali.log_26-06-10-2/`.
- La **fecha** va en el nombre de la carpeta; la **fecha + hora** va dentro de cada documento.

---

## Encabezado obligatorio (todos los documentos)

Va al inicio de cada `.md`. Toma los datos de la **Fase 0** de `ozali` (identidad/git/sesión).

```
---
ozali.log: {{yy-mm-dd}}
documento: 01-analisis | 02-plan | 03-mejoras
Autor: <git user.name> <<git user.email>>
Sesión: <correo de sesión si está disponible>
Rama: <branch actual>
Creado: <yyyy-mm-dd HH:MM:SS> (local)
---
```

---

## 01-analisis.md — Análisis e hitos de importancia

```markdown
# Análisis — <título corto de la solicitud>

## Contexto
<qué se pidió y por qué>

## Fuente de verdad usada
- Variante: AI.md/.ai | IA.md/.ia
- Discrepancias detectadas vs. estructura real:
  - <lista>

## Hitos de importancia
1. <hito> — <por qué importa> — Riesgo: Alto/Medio/Bajo
2. ...

## Superficie de impacto
- Archivos/módulos afectados: <lista>
- Dependencias: <lista>
```

---

## 02-plan.md — Plan ejecutado

```markdown
# Plan ejecutado — <título corto>

## Decisión
<enfoque elegido y alternativas descartadas>

## Tareas (con estado final)
- [x] <tarea 1>
- [x] <tarea 2>
- [ ] <pendiente, si aplica>

## Cambios realizados
- <archivo>: <qué cambió>

## Validación
- Pruebas ejecutadas: <comando / resultado>
- Criterios de aceptación: cumplidos/parciales
```

---

## 03-mejoras.md — Mejoras posibles (explicativo, breve)

```markdown
# Mejoras posibles — <título corto>

> Solo propuestas explicativas, sin profundizar. Cada una con su grado de relevancia.

## A la skill (ozali/cdk)
- **[Alta]** <mejora> — <por qué>
- **[Media]** <mejora> — <por qué>

## Al proyecto
- **[Alta]** <mejora> — <por qué>
- **[Baja]** <mejora> — <por qué>
```

Grados de relevancia: **Alta** (impacto/urgencia clara), **Media** (conviene pronto),
**Baja** (nice-to-have).

---

## B) Documentación por hito (cdk)

La genera `cdk` (subagente `project-documenter`) **una vez por cada solicitud/hito** del
usuario, en:

```
.ozali/docs/cdk/<hito>/
  01-prompt-entrada.md      ← al inicio del hito
  02-plan-aprobado.md       ← se congela al aprobar el GATE (inmutable)
  03-resumen-tecnico.md     ← al cierre
  04-resumen-usuario.md     ← al cierre
  05-bitacora-ejecucion.md  ← append-only, DURANTE el ciclo
  06-uso-tokens.md          ← al cierre
```

- `<hito>` = slug corto y descriptivo de la solicitud (ej. `alta-componente-cobranza`,
  `fix-calculo-prima-poliza`). Si ya existe, agrega sufijo `-2`, `-3`, …
- Cada documento usa el **mismo encabezado de identidad** de arriba (con `hito:` en lugar de
  `ozali.log:`).

### 01-prompt-entrada.md — Prompt de entrada

```markdown
# Prompt de entrada — <hito>

> Captura textual de la solicitud del usuario, para evaluar el progreso de las solicitudes.

## Prompt (textual)
<pega aquí, sin editar, el prompt/solicitud exacta del usuario>

## Contexto de la sesión
- Fecha/Hora de la solicitud: <yyyy-mm-dd HH:MM:SS>
- Hito asignado: <slug>
- Modo de ejecución: normal | --auto
- Solicitudes previas relacionadas: <links a otros hitos, si aplica>
```

### 02-plan-aprobado.md — Plan aprobado (snapshot congelado en el GATE)

> Se escribe **al aprobarse el GATE, antes de tocar código**, y es **inmutable**: deja
> constancia de qué se acordó y quién lo aprobó. Cualquier desvío posterior se registra en
> `05-bitacora-ejecucion.md`, nunca editando este documento. Es el mismo Plan de Acción que
> vio el usuario, ya con su decisión.

```markdown
# Plan aprobado — <hito>

**Tipo:** feature | bugfix | hotfix | refactor      **Tamaño:** S | M | L
**Workflow:** .ai/workflows/<archivo>.md
**Modo:** normal | --auto
**Aprobado por:** <usuario> — <yyyy-mm-dd HH:MM:SS>

## Solicitud del usuario
<qué pidió, en sus palabras>

## Alcance aprobado
<lo que SÍ se hará>

## Hallazgos del análisis
- Reutilización detectada: <clases/archivos existentes que se aprovechan>
- Riesgos: ⚠ <riesgo> → <mitigación> / 🔴 <bloqueante resuelto y cómo>

## Cambios aprobados (archivo por archivo)
| Acción | Archivo / Clase | Capa | Detalle |
| :-- | :-- | :-- | :-- |
| crear | <X> | <capa> | <detalle> |
| modificar | <Y> | <capa> | <detalle> |

## Tareas
- [ ] <tarea 1>
- [ ] <tarea 2>

## Plan de pruebas
- Caso feliz: <...>
- Casos negativos: <...>

## Criterios de aceptación (definition of done)
- <p. ej. mvn test verde + criterios del owner>

## Fuera de alcance (explícito)
- <lo que NO se hará en este hito>
```

### 03-resumen-tecnico.md — Resumen técnico

```markdown
# Resumen técnico — <hito>

## Decisiones de implementación
<enfoque, patrones, por qué>

## Archivos tocados
- <archivo>: <qué cambió>

## Impacto y riesgos
- Módulos afectados: <lista>
- Riesgo en módulos sensibles (core/guard/services/poliza/siniestros/cobranza/models/...): <sí/no, detalle>

## Validación
- Pruebas: <comando / resultado>
- walkthrough.md: <ruta / evidencia>
```

### 04-resumen-usuario.md — Resumen para el usuario

```markdown
# Resumen para usuario — <hito>

> Lenguaje claro, sin jerga técnica.

## ¿Qué se hizo y para qué sirve?
<explicación sencilla en 2-3 frases>

## ¿Cómo se usa? (casos de uso)
1. **<caso de uso 1>** — <pasos sencillos explicados>
2. **<caso de uso 2>** — <pasos sencillos explicados>

## Qué cambia para ti
<beneficio concreto / qué notará el usuario>
```

### 05-bitacora-ejecucion.md — Bitácora de ejecución (append-only)

> Registro **cronológico y append-only** de lo que ocurre DESPUÉS de aprobar el plan y
> DURANTE el ciclo de ejecución: dudas, decisiones, actualizaciones y desvíos respecto al
> `02-plan-aprobado.md` (que permanece inmutable), preguntas al usuario y sus respuestas.
> **No se reescribe**: solo se agregan entradas, en orden cronológico. Aquí vive toda la
> diferencia entre lo planeado y lo realmente ejecutado.

```markdown
# Bitácora de ejecución — <hito>

**Modo de ejecución:** normal | --auto
**Inicio del ciclo:** <yyyy-mm-dd HH:MM:SS>

## Entradas

### <yyyy-mm-dd HH:MM:SS> — [duda | decisión | actualización | desvío | pregunta]
- **Qué surgió:** <descripción concreta>
- **Contexto:** <archivo / tarea / iteración donde apareció>
- **Resolución:** <qué se decidió y por qué; si fue pregunta al usuario, pega su respuesta textual>
- **Impacto en el plan:** ninguno | ajuste dentro de alcance | requirió ampliar alcance (se detuvo y preguntó)

### <yyyy-mm-dd HH:MM:SS> — [tipo]
- ...

## Cierre del ciclo
- **Fin:** <yyyy-mm-dd HH:MM:SS>
- **Iteraciones executioner⇄tester:** <n>
- **Desvíos relevantes vs. plan aprobado:** <resumen / "ninguno">
```

### 06-uso-tokens.md — Uso de tokens (al cierre)

> Se captura **al terminar el plan**. Las métricas se rellenan en caso de que el proveedor sea
> **Claude/Anthropic** (fuente: comando `/cost` de Claude Code). Con cualquier otro
> proveedor verifica si puedes obtener la información y si no puedes, deja la estructura con el **nombre del proveedor** y las métricas en `N/A`
> (data presente, sin inventar cifras).

```markdown
# Uso de tokens — <hito>

**Proveedor:** Claude (Anthropic) | <otro proveedor>
**Modelo:** <p. ej. claude-opus-4-8 / N/A>
**Fuente de la medición:** /cost (Claude Code) | N/A
**Capturado:** <yyyy-mm-dd HH:MM:SS>

## Métricas de la sesión
| Métrica | Valor |
| :-- | :-- |
| Tokens de entrada (input)   | <n / N/A> |
| Tokens de salida (output)   | <n / N/A> |
| Tokens de caché (lectura)   | <n / N/A> |
| Tokens de caché (escritura) | <n / N/A> |
| Total de tokens             | <n / N/A> |
| Total de tiempo de sesión   | <n / N/A> |
| Costo estimado              | <$ / N/A> |

## Notas
- <observaciones sobre el consumo del hito; deja vacío o "N/A" si no puedes encontrar información del proveedor>
```

> **Regla del proveedor:** si el proveedor **no** cuenta con estos datos, **no** intentes
> derivar ni inventar cifras de otro sistema: solo registra el nombre del proveedor y deja
> el resto en `N/A`. El objetivo es **mantener la estructura presente** para no perder la
> trazabilidad del hito.
