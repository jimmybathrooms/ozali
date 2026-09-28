# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

_No hay pendientes abiertos. Histórico de cierres en `git log -- docs/pendientes.md`._

Cerrados recientemente:

- **P-004** · Verificador de citas por **contenido**, no solo rango: cada afirmación debe tener al
  menos un identificador en su rango citado; las ausencias exigen comando de búsqueda. Paso fijo
  del blueprint §9.1 antes del GATE. Commit pendiente de este hito.
- **P-005** · Cuantificadores absolutos ("ninguno", "siempre", "en ningún") solo con **conteo
  ejecutado** citado; sin conteo, forma acotada. Regla dura del blueprint §1 y §4; el verificador
  §9.1 los marca.
- **P-006** · Nuevas fuentes de extracción en el blueprint §5: anotaciones de entidad
  (`updatable`, `nullable`, `@Convert`), utilidades de asignación (`Values.getValue`, helpers de
  patch) y olores con efecto de negocio (`setStatus` fijo que reactiva, `save()` duplicado).
- **P-007** · Modo actualizar reporta **% de citas vivas** y lista de rotas como primer paso
  (blueprint §8); `ozali doctor` gana la fila **`Reglas de negocio`** que compara el commit base
  del pie del `README.md` de `business/` contra `HEAD` y avisa con deriva >20% (CLI).
- **P-001** · `.ozali/docs/` se versiona en el repo principal — la doc de la skill contradecía al
  CLI y el agente rompía el `.gitignore` al calibrar. Commit `7ff70fa`.
- **P-002** · `.ozali/metrics/` es caché local derivado y va gitignored — lo durable es el doc
  `06-uso-tokens.md` del hito más `cdk/_project/token-metrics` en Engram. Commit `b017305`.
- **P-003** · El suite de tests ya no escribe en el HOME real del desarrollador: `run()` inyecta
  un HOME temporal por cwd. La vía era `update`, que recorre `env.skill.paths` —incluida la
  instalación global— y le copiaba el working tree encima.
