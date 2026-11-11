# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

## P-014 · Catálogo de UI: cerrar los huecos que dejó la evaluación con un agente consumidor

**Qué está mal hoy.** La evaluación del generador (brief y comparativa se conservan fuera del repo: contienen nombres del caso de prueba) llevó el blueprint de v0.26.0 a una
salida que evita el error del footer y la trampa de scroll, pero un agente que usa **solo** el
catálogo aún falla 3 de 10 criterios del caso real. Ya aplicado en esta iteración: definición de uso
con patrón multilínea, estados `por código`/`interno`, "No confundir con", lookup diseño→componente,
esqueleto con regla de desborde, criterio de directorio compartido, modo no interactivo y migración
opcional en modo actualizar. Falta:

1. **Call-site real del sustituto:** cuando un componente `sin uso` tiene "No confundir con", citar
   un uso real (`archivo:línea`) del mecanismo que cubre la función, con su posición en el esqueleto
   (el pie va fuera del contenedor principal; hoy el catálogo no lo dice).
2. **Valores válidos de entradas tipadas** por enum/unión (p. ej. `type` de un aviso): listarlos.
3. **Origen de lo que el esqueleto usa** (estructura de página, etiqueta, helper responsive, loader):
   clase base o servicio.
4. **Librería base por nombre:** módulos exportados, no solo su cantidad.
5. **API de modales** abiertos por código (`componentInstance.*`, retorno) y el helper responsive
   dentro del esqueleto cuando el repo lo usa en la mayoría de plantillas.
6. **Criterio "≥3 carpetas de feature"** aplicado también a los directorios **excluidos**; decidir si
   un layout compartido (`menu`) entra.
7. **Migración en modo actualizar:** hoy solo está documentada en el blueprint (§2.5) y la Fase 2.6;
   falta probarla de punta a punta (el agente de la prueba la reportó como faltantes, no la ejecutó).

**Cómo se verifica.** Regenerar sobre una copia del caso de prueba sin catálogo y repetir el test del
agente consumidor (10 criterios); objetivo: 10/10 con solo el catálogo generado. Añadir a
`smoke.test.mjs` las reglas mecánicas nuevas. Cierre: borrar esta entrada.

---

_Histórico de cierres en `git log -- docs/pendientes.md`._

Cerrados recientemente:

- **P-012** · Publish de v0.23.0 fallaba con `404 Not Found` en `PUT /ozali`. Causa: el secret
  `NPM_TOKEN` no tenía permiso de escritura sobre el paquete (la cuenta sí era `read-write`; la
  provenance firmaba bien). Se generó un token granular nuevo y, tras *Re-run failed jobs* sobre
  `v0.23.0`, `npm view ozali version` devolvió 0.23.0. npmjs.com tardó en refrescar su caché.
- **P-013** · Contrato cdk **v10** (`catalogo-ui-revisor-web`): rol condicional `project-ui-reviewer`
  (solo web), Fase 2.6 + `--ui` para el catálogo `ui-components.md`, preservación del contexto manual al
  regenerar `cdk`, `detectWebProject` y fila *Revisor de UI* en `doctor`; migración v9 → v10.
  Blueprint nuevo `ui-catalog-blueprint.md`. Release v0.24.0.
- **P-008** · `ozali state read|clear|write --hito --fase`: expone los helpers de estado de sesión;
  `clear` solo puede borrar `.ozali/.session-state.json` y no acepta rutas. Salida sin banner para
  que cdk parsee el JSON. Release v0.22.0.
- **P-009** · `init`/`update` suman `Write`/`Edit(.ozali/docs/**)` y `Write(.ozali/.session-state.json)`
  (`Bash(ozali *)` y `Bash(engram *)` ya existían) e ignoran `.ozali/tmp/`; `doctor` gana *Permisos de
  cierre* (deny de `rm` sin `ozali` permitido) y *Desechables de hitos*. El deny de `rm` no se toca.
- **P-010** · `ozali clean --hito <slug>`: dry-run por defecto, `--yes` aplica; borra
  `.ozali/tmp/<hito>/` y el `manifest.json`, con `realpath`, allowlist (`.ozali/tmp/`, `src/test/`,
  más `clean.allow`), rechazo de rastreados por git y exit≠0 con rechazos.
- **P-011** · Contrato cdk **v8** (`cdk-contract.md`): cierre con Write, un comando por acción,
  `ozali state clear` + `ozali clean --yes`, convención `.ozali/tmp/<hito>/` + `manifest.json` para
  `tester`/`executioners`, fallback para CLI anterior y migración v7 → v8. Propagado a SKILL,
  engram-convention §4.5, agents-blueprint y doc-templates.
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
