# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

## P-004 · El verificador de citas no comprueba el contenido, solo el rango

**Relevancia:** Alta · **Detectado:** 2026-09-22, comparando el POC A vs. B · **Estado:** abierto

### Qué está mal hoy

La Fase 2.5 verifica que `archivo:línea` exista y caiga dentro del archivo. Eso no detecta la
afirmación que cita una línea **real pero que dice otra cosa**. En el POC fue el único error
factual del extractor: se afirmó que el mensaje de un 409 se pierde al reenvolverse, citando el
`catch` correcto; el mensaje sí sobrevive porque `CopsisException` hace `super(errorMessage)`.

### Qué hay que cambiar

1. Extraer de cada afirmación los **identificadores** que nombra (clase, método, campo, constante,
   literal de mensaje) y exigir que al menos uno aparezca en el rango citado.
2. Cuando la afirmación hable de una **ausencia** ("no valida", "no se llama"), no basta la cita:
   exigir el comando de búsqueda que lo respalda (ver P-005).
3. Dejar el verificador como paso fijo del blueprint §9, antes del GATE, y reutilizable en el modo
   actualizar (P-007).

### Cómo se verifica

Sembrar en una carpeta `business/` de prueba una afirmación que cite una línea correcta con un
símbolo que no aparece en ella; el verificador debe marcarla.

---

## P-005 · El extractor generaliza: "ninguno", "siempre", "en ningún"

**Relevancia:** Alta · **Detectado:** 2026-09-22, comparando el POC A vs. B · **Estado:** abierto

### Qué está mal hoy

La base manual del POC afirmaba *"no hay `delete()` en ningún repositorio de catálogo"* citando un
solo servicio. Era falso **ya en su propio commit**: había tres borrados físicos. Es la forma de
error más cara, porque los agentes de `cdk` tratan la frase como invariante y "corrigen" código
sano para cumplirla.

### Qué hay que cambiar

1. En `business-blueprint.md` §1, regla dura: un cuantificador absoluto solo entra si viene de un
   **conteo ejecutado**, y la afirmación cita el comando y su resultado
   (p. ej. *"0 `@Pattern` en `src/main/java` (grep, 2026-09-21)"*).
2. Sin conteo, se degrada a la forma acotada: *"en los servicios revisados (X, Y, Z)…"*.
3. Que el verificador (P-004) marque los cuantificadores sin respaldo.

### Cómo se verifica

Correr `ozali --business` sobre un repo con una excepción conocida a una regla aparentemente
universal; la carpeta no debe afirmar la regla en absoluto sin el conteo.

---

## P-006 · Faltan fuentes de extracción: entidad, utilidades de patch y olores

**Relevancia:** Media · **Detectado:** 2026-09-22, comparando el POC A vs. B · **Estado:** abierto

### Qué está mal hoy

La base manual capturó cinco cosas que el extractor no miró, y el código ya existía:
`Values.getValue` como semántica de patch (un campo no se puede vaciar con `null`),
`updatable = false` en entidades (un paquete no cambia de ramo), un `setStatus(1)` fijo en el
guardado que **reactiva** un registro dado de baja al editarlo, un `save()` repetido dos veces
seguidas, y un cambio de contraseña forzado según el tipo de correo.

### Qué hay que cambiar

En la tabla de fuentes de `business-blueprint.md` §5 (backend), agregar:

1. **Anotaciones de la entidad** (`updatable`, `insertable`, `nullable`, `unique`, `@Convert`) →
   `domain-model.md`: son reglas de negocio expresadas en el mapeo.
2. **Utilidades de asignación** (`Values.getValue`, helpers de patch/merge) → `rules.md`: definen
   qué significa "campo ausente" en una edición.
3. **Olores de servicio con efecto de negocio**: `setStatus` fijo en un `save` que también edita
   (reactivación implícita), `save()` duplicado, llamadas a servicios externos antes de persistir.

### Cómo se verifica

Correr `ozali --business` sobre `quattro-catalogos-api` y comprobar que las cinco aparecen.

---

## P-007 · El modo actualizar no avisa de la caducidad

**Relevancia:** Media · **Detectado:** 2026-09-22, comparando el POC A vs. B · **Estado:** abierto

### Qué está mal hoy

La base manual del POC perdió **16 de 141 citas (11%) en un mes**: entre su commit y el actual
cambiaron 162 archivos de `src/main`. El blueprint ya describe la revalidación en §8, pero nada
la dispara ni la cuantifica, así que la carpeta envejece en silencio y los agentes de `cdk` siguen
leyéndola como verdad.

### Qué hay que cambiar

1. `ozali --business` en modo actualizar: reportar **% de citas vivas** y la lista de rotas, como
   primer paso y antes de extraer nada nuevo.
2. `ozali doctor`: una fila **`Reglas de negocio`** que compare el commit base del pie del
   `README.md` de `business/` contra `HEAD` y avise por encima de un umbral de deriva.
3. `cdk`: si el orquestador detecta citas rotas durante un hito, sugerir `ozali --business` al
   cierre (ya está en el contrato v7; falta que se dispare con el dato del verificador).

### Cómo se verifica

`ozali doctor` sobre `quattro-catalogos-api` con la base manual (`bfed9ff`) restaurada debe
reportar la deriva; con la extracción actual, no.

---

_Evidencia de P-004 a P-007: [`poc-reglas-negocio-a-vs-b.md`](poc-reglas-negocio-a-vs-b.md)._

Cerrados recientemente:

- **P-001** · `.ozali/docs/` se versiona en el repo principal — la doc de la skill contradecía al
  CLI y el agente rompía el `.gitignore` al calibrar. Commit `7ff70fa`.
- **P-002** · `.ozali/metrics/` es caché local derivado y va gitignored — lo durable es el doc
  `06-uso-tokens.md` del hito más `cdk/_project/token-metrics` en Engram. Commit `b017305`.
- **P-003** · El suite de tests ya no escribe en el HOME real del desarrollador: `run()` inyecta
  un HOME temporal por cwd. La vía era `update`, que recorre `env.skill.paths` —incluida la
  instalación global— y le copiaba el working tree encima.
