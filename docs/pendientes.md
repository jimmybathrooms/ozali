# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

### P-012 · Publish de v0.23.0 falla con `404 Not Found` en `PUT /ozali`

- **Qué está mal hoy:** el job *Publish (npm + provenance)* #38 (tag `v0.23.0`, commit `b5d2291`)
  firma la provenance en sigstore, pero `npm publish` termina con `E404 … 'ozali@0.23.0' is not in
  this registry`. Para un paquete ya existente (0.22.0 publicado) npm responde 404 cuando el token
  no puede escribir. Tests y CI en verde; el tag existe y coincide con `package.json`.
- **Descartado:** falta de permisos de la cuenta — `npm access list collaborators ozali` →
  `jimmybaths: read-write`. El OIDC/provenance funciona (`id-token: write`).
- **Hipótesis restantes (sobre el secret `NPM_TOKEN`):** token granular sin "Read and write" sobre
  `ozali`, vencido/revocado, valor pegado con espacios o salto de línea, o puesto en *Environment*
  secrets y no en *Repository* secrets (el cambio de token coincide con el commit `c51a4ee`).
- **Qué hay que cambiar:** revisar/regenerar el token y actualizar el secret; después *Re-run failed
  jobs* sobre `v0.23.0` (no recrear el tag). Alternativa estable: *Trusted Publishing* (OIDC) en la
  página del paquete en npm, sin token.
- **Cómo se verifica:** el job #38 pasa y `npm view ozali version` devuelve `0.23.0`.

Cerrados recientemente:

- **P-013** · Contrato cdk **v10** (`catalogo-ui-revisor-web`): rol condicional `project-ui-reviewer`
  (solo web), Fase 2.6 + `--ui` para el catálogo `ui-components.md`, preservación del contexto manual al
  regenerar `cdk`, `detectWebProject` y fila *Revisor de UI* en `doctor`; migración v9 → v10.
  Blueprint nuevo `ui-catalog-blueprint.md`. Release v0.24.0 (pendiente de publicar: ver P-012).
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
