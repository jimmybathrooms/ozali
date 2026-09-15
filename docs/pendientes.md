# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

## P-002 · Decidir el destino de `.ozali/metrics/`

**Relevancia:** Media · **Detectado:** 2026-09-15, calibrando el repo `landing` · **Estado:** abierto

### La pregunta

`.ozali/metrics/token-metrics.json` es la telemetría de uso de tokens que `cdk` agrega al cerrar
cada hito y que lee `ozali doctor`. Hoy **nadie decidió si se versiona**, y eso produce repos
inconsistentes:

- El **CLI** no la ignora → en un repo inicializado por `ozali init`, la telemetría se commitea.
- En **`landing`**, ajustada a mano, sí quedó ignorada.

Ambos comportamientos son defendibles y por eso hay que elegir uno:

| Opción | A favor | En contra |
|---|---|---|
| **Versionarla** | La evolución del costo por hito es historia del equipo, y se revisa en el PR | Cambia en cada hito: ruido en los diffs, conflictos de merge casi garantizados en un JSON agregado |
| **Ignorarla** | Es ruido local que cambia siempre, como `.session-state.json` | Se pierde el histórico de costo salvo que `ozali sync` lo espeje al repo de conocimiento |

### Qué hay que cambiar, según la decisión

- **Si se ignora:** sumar `.ozali/metrics/` a `GITIGNORE_ENTRIES` (`cli/lib/commands.mjs:24`) y
  asegurar que `ozali sync` la espeje al repo de conocimiento para no perder el histórico.
- **Si se versiona:** sumarla a `GITIGNORE_OBSOLETE` (`cli/lib/util.mjs`) para retirarla de los
  repos donde ya se ignoró a mano, y documentar en `docs/team-history.md` que es parte de lo que
  viaja en el repo principal.

En cualquiera de los dos casos: un test en `cli/test/smoke.test.mjs` que fije el comportamiento,
como el que ya existe para `.ozali/docs/`.

### Referencias

- Corrida que lo detectó: `landing` → `.ai/ozali/logs/ozali.log_26-09-15/03-mejoras.md`
- Hermano cerrado: **P-001** (`.ozali/docs/` se versiona) — ver commit de esta entrada.
