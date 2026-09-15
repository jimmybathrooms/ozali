# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

_Sin pendientes abiertos._

Cerrados recientemente:

- **P-001** · `.ozali/docs/` se versiona en el repo principal — la doc de la skill contradecía al
  CLI y el agente rompía el `.gitignore` al calibrar. Commit `7ff70fa`.
- **P-002** · `.ozali/metrics/` es caché local derivado y va gitignored — lo durable es el doc
  `06-uso-tokens.md` del hito más `cdk/_project/token-metrics` en Engram. Commit `b017305`.
- **P-003** · El suite de tests ya no escribe en el HOME real del desarrollador: `run()` inyecta
  un HOME temporal por cwd. La vía era `update`, que recorre `env.skill.paths` —incluida la
  instalación global— y le copiaba el working tree encima.
