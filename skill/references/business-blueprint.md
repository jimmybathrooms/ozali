# Blueprint de reglas de negocio (`.ai/business/`)

Se usa en la **Fase 2.5** de `ozali` (ver [`../SKILL.md`](../SKILL.md)). Define cómo se extrae y
se mantiene la carpeta `business/` dentro de la carpeta dotted (`.ai/` o `.ia/`): **qué hace el
sistema desde el punto de vista del negocio**, no cómo está construido. La arquitectura vive en
`context/`; aquí vive el *dominio*: entidades, estados, validaciones, políticas de acceso,
vocabulario y flujos.

> Estructura derivada del POC `poc-business-rules` (Opción B, hecha a mano sobre
> `quattro-catalogos-api`, commit `bfed9ff`) y del reconocimiento de 5 proyectos
> (3 backend Spring Boot, 2 frontend Angular).

---

## 1. Principio rector: estructura sí, semántica no

> **Regla anti-inferencia (dura):** el extractor **documenta lo que el código hace** y **cita dónde**.
> **Nunca** infiere *por qué* lo hace ni afirma que sea la intención del negocio. Lo que el
> código insinúa pero no prueba se marca `<!-- PROVISIONAL: confirmar con negocio -->` y se
> formula como **pregunta** para negocio.

**Por qué:** en el POC, de 5 afirmaciones de negocio hechas de memoria, **3 resultaron falsas** al
contrastarlas con el código. Una regla inventada en `business/` es peor que un hueco: los agentes
de `cdk` la tratan como verdad y la hacen cumplir.

Consecuencias prácticas:
- Un **bug** documentado sigue siendo el comportamiento actual: se anota como bug (`> ⚠️ Deuda
  real:`), **no** se corrige en la doc ni se describe como "debería".
- Un valor mágico (`perfilID = 1`, `opcion = 101`) se cita tal cual y se pregunta qué significa.
- Nombres de variables o comentarios **no** son evidencia de intención; son pistas para la
  pregunta PROVISIONAL.

---

## 2. Cuándo corre (Fase 2.5)

| Situación | Modo | Qué hace |
|---|---|---|
| Falta `business/` en la corrida normal de `ozali` | **Preguntar** | Ofrece extraerla (costo estimado + nº de PROVISIONAL esperables). Si el usuario dice que no, sigue sin ella y lo registra en `01-analisis.md`. |
| `ozali --business` y **no** existe `business/` | **Crear** | Corre solo la extracción (sin regenerar `cdk`), con su propio 🛑 GATE. |
| `ozali --business` y **sí** existe `business/` | **Actualizar** | Revalida contra el código actual (ver §8). |

`--business` se reconoce en cualquier posición de la invocación (`/ozali --business`,
`ozali --business revisa pólizas`). Texto adicional acota el alcance (un módulo o flujo).

---

## 3. Estructura canónica

```
.ai/business/            (o .ia/business/)
  README.md             → qué es la carpeta, reglas de procedencia, cómo se mantiene
  domain-model.md       → entidades, estados (enums/catálogos), relaciones, lo que NO decide
  rules.md              → reglas codificadas en servicios: condicionales, defaults, cálculos
  validation-map.md     → validaciones por entidad/campo, capa, origen exacto y respuesta
  policies.md           → multi-tenancy, identidad del actuante, permisos, auditoría, datos sensibles
  glossary.md           → vocabulario del dominio tal como lo usa el repo (+ falsos amigos)
  workflows/
    <flujo>.md          → un flujo de negocio punta a punta (solo los que el código evidencia)
```

- `workflows/` de `business/` **no** es `.ai/workflows/` (procesos de desarrollo: feature,
  bugfix…). Aquí son flujos del **dominio** (ciclo de vida de un Lead, emisión de póliza).
- Documenta en **español**; conserva los identificadores originales entre backticks.
- Agrega la fila "Reglas de Negocio" en la tabla de Contexto Global de `AI.md`
  (ver [`knowledge-blueprint.md`](knowledge-blueprint.md) §4).

---

## 4. Procedencia: toda afirmación lleva una de tres marcas

| Marca | Significa | Forma |
|---|---|---|
| **Evidencia de código** | El código lo hace; verificable | cita `Archivo.java:42` o `archivo.ts:10-25` en la misma frase o tabla |
| **Aporte de negocio** | Lo dijo PO/negocio; no se infiere del código | bloque `> **Negocio:** …` — **no** se borra al refactorizar |
| **Provisional** | El código lo insinúa, nadie confirmó la intención | `<!-- PROVISIONAL: confirmar con negocio -->` + `> ` pregunta concreta |

Una afirmación **sin** marca no entra. El extractor solo produce las marcas 1 y 3; la marca 2
solo la escribe una persona (o el agente transcribiendo textualmente lo que el usuario dijo en la
sesión, citándolo).

---

## 5. Dónde buscar (fuentes de extracción → archivo destino)

### Backend (Spring Boot / Java; análogo en otros stacks)

| Fuente en el código | Qué extraer | Destino |
|---|---|---|
| Enums de estado/tipo (`*Status`, `*Tipo`, `*Estatus`) | valores, uso real (¿se referencia o está muerto?) | `domain-model.md` |
| Entidades JPA y sus relaciones | entidades del dominio, cadenas (`Ramo → SubRamo → …`), borrado lógico | `domain-model.md` |
| Forms/DTOs con Bean Validation (`@NotNull`, `@Size`, `@Pattern`…) | campo, restricción, mensaje | `validation-map.md` §capa declarativa |
| `throw new *ValidationException` en services | condición y mensaje | `validation-map.md` §capa de negocio + `rules.md` |
| Condicionales en services (`switch` por aseguradora, tolerancias, defaults) | la regla y sus ramas | `rules.md` |
| Cálculos (primas, IVA, prorrateos, fechas) | fórmula tal cual, con constantes | `rules.md` |
| Exception handlers (`@ControllerAdvice`) | qué error → qué HTTP y cuerpo | `validation-map.md` §cómo se disparan |
| Filtros/interceptores de seguridad, headers de identidad, `socioID`/tenant | quién puede qué, aislamiento | `policies.md` |
| Auditoría (`@CreatedBy`, `Auditable`, bitácoras) | qué se registra y cuándo | `policies.md` |
| Tests con nombres descriptivos | reglas que el equipo ya fijó como verdad | cita cruzada en `rules.md` |

### Frontend (Angular / React / Vue)

| Fuente en el código | Qué extraer | Destino |
|---|---|---|
| Validadores de formulario (`Validators.pattern`, custom validators) | campo, patrón, mensaje al usuario | `validation-map.md` |
| Constantes de patrones (`PATRON_CORREO`, RFC, CURP, CP) | regex tal cual + dónde se usa | `validation-map.md` |
| Guards de ruta (`CanActivate`, `PendingChangesGuard`) | condición de acceso | `policies.md` |
| Interceptores (tokens, refresh JWE/JWS, tenant) | contrato de sesión/identidad | `policies.md` |
| Enums/constantes de estado y roles por rango | valores y significado visible en UI | `domain-model.md` |
| Reglas de visualización (`*ngIf` por rol/estado, botones deshabilitados) | qué se muestra a quién y cuándo | `policies.md` / `rules.md` |
| Servicios con lógica condicional (matrices por aseguradora, IDs hardcodeados) | la regla y el valor mágico | `rules.md` (+ PROVISIONAL si el ID no tiene catálogo) |
| Parámetros de tenant (`*Parametros[n]`) | qué cambia por cliente | `rules.md` §configurable |

> **Front y back se contradicen a veces** (el front valida algo que el back no, o al revés). Eso
> **se documenta**, no se resuelve: va en `validation-map.md` §"Lo que NO se valida" o como
> PROVISIONAL.

---

## 6. Esqueleto por archivo

Cada archivo abre con 2-4 líneas de alcance y termina, cuando aplica, con una sección de
**lo que NO**: en el POC fueron las secciones más útiles para los agentes (evitan que asuman
validaciones o decisiones que el sistema no hace).

- **`README.md`** — Por qué existe · Tabla de contenido (archivo → qué contiene) · Cómo se
  mantiene (§4 de este blueprint, copiado) · Reglas duras para quien edite · Pie con fecha,
  rama y commit base de la extracción.
- **`domain-model.md`** — 1. Cómo se representa el estado (flags, enums, catálogos en BD) ·
  2. Enums del dominio (uno por `###`, marcar los **declarados pero no usados**) ·
  3. Entidades principales · 4. Catálogos · 5. Auditoría · N. **Lo que este servicio NO decide**.
- **`rules.md`** — Una regla por `##` numerada: **Regla:** (una frase) · evidencia citada ·
  **Consecuencia:** · deuda/bug si existe · PROVISIONAL si aplica.
- **`validation-map.md`** — 1. Cómo se disparan y qué devuelven (tabla capa → handler → HTTP) ·
  2. Catálogo de validaciones declarativas (tabla por entidad: campo · regla · mensaje · origen) ·
  3. Validaciones de negocio (imperativas) · 4. **Lo que NO se valida en ningún lado**.
- **`policies.md`** — Contrato de identidad · Aislamiento entre tenants · Modelo de permisos ·
  Auditoría · Datos sensibles (sin valores reales, ver seguridad) · **Resumen para agentes de IA**
  (5-10 viñetas de "nunca/siempre").
- **`glossary.md`** — Secciones por área (actores, producto, contrato, comercial…) · término →
  definición en este repo → identificador en código · **Falsos amigos — no confundir**.
- **`workflows/<flujo>.md`** — Las piezas · estados · endpoints/pantallas paso a paso · lo que el
  sistema NO valida · diagrama mermaid del flujo **real** · "Al modificar este flujo" (qué revisar).

---

## 7. Alcance y tamaño (no documentar todo)

Un repo grande (p. ej. 98 entidades, 95 servicios) no se vuelca entero. Prioriza en este orden y
**para** al llegar a ~300 líneas por archivo:

1. Lo que **escribe** (altas, cambios de estado, bajas) antes que lo que solo consulta.
2. Estados y transiciones (enums + servicios que los cambian).
3. Validaciones con impacto al usuario (mensajes, HTTP 4xx).
4. Identidad, tenant y permisos.
5. Flujos que cruzan varias entidades → `workflows/` (máximo 3 en la primera extracción).

Lo que quede fuera se lista en `README.md` §"Pendiente de documentar" — nunca se omite en
silencio. Si el usuario acotó el alcance (texto tras `--business`), respétalo y dilo en el README.

**Seguridad:** nunca copies valores reales de secretos, credenciales, tokens ni PII (tarjetas,
teléfonos, correos completos) aunque aparezcan en el código o en fixtures; describe el tipo de
dato y la regla, no el dato.

---

## 8. Modo actualizar (`--business` con carpeta existente)

1. Lee el pie del `README.md` (commit base) y calcula el delta:
   `git diff --stat <commit-base>..HEAD` sobre las fuentes de §5.
2. **Revalida cada cita** `archivo:línea` de la carpeta:
   - el archivo ya no existe o la línea no contiene lo citado → corrige la cita si lo encuentras
     movido; si la regla desapareció, márcala `> ⚠️ Ya no se encuentra en el código (desde <sha>)`
     y **pregunta** antes de borrarla;
   - la regla cambió de comportamiento → actualiza el texto y agrega PROVISIONAL si la nueva
     intención no está confirmada.
3. Extrae **solo** lo nuevo del delta (mismas fuentes y prioridades).
4. **Preserva intactos** los bloques `> **Negocio:**`. Si el código ya contradice uno, **no** lo
   edites: agrega debajo un PROVISIONAL señalando la contradicción.
5. Un PROVISIONAL que el usuario confirma en la sesión se convierte en `> **Negocio:**` citando
   quién lo confirmó y cuándo.
6. Actualiza el pie del `README.md` (fecha, rama, commit base nuevo).

---

## 9. Validación y GATE

Antes del 🛑 GATE (en la corrida normal, dentro del GATE de la Fase 5; con `--business`, un GATE
propio) presenta:

- Archivos generados/actualizados con su nº de líneas.
- **Conteo de reglas** (secciones de `rules.md`), **validaciones** (filas de `validation-map.md`) y
  **PROVISIONAL** por archivo — el total de PROVISIONAL es la lista de trabajo para negocio.
- Muestra de 3 citas verificadas al azar (archivo:línea → fragmento real).
- En modo actualizar: citas corregidas, reglas desaparecidas, reglas nuevas.
- Lo que quedó fuera por alcance (§7).

Tras la aprobación, espeja un resumen a Engram:
`mem_save(topic_key: "cdk/_project/business-rules", …)` con el commit base, el conteo y la lista
de PROVISIONAL abiertos (ver [`engram-convention.md`](engram-convention.md)). No espejes el
contenido completo: la fuente de verdad es la carpeta.
