# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

## P-001 · `.ozali/docs/` debe versionarse en el repo principal

**Relevancia:** Alta · **Detectado:** 2026-09-15, calibrando el repo `landing` · **Estado:** abierto

### Decisión del equipo

La documentación por hito que genera `cdk` (`.ozali/docs/cdk/<hito>/`, los 6 `.md`) **sí se sube
al repo principal**. Deja de ser exclusiva del repo de conocimiento aislado: vive junto al código
que documenta, se revisa en el PR y viaja con el clon.

El repo de conocimiento sigue existiendo para la memoria de Engram y para el agregado entre repos;
lo que cambia es que el repo principal ya no la esconde.

### Qué está mal hoy

El **CLI ya es correcto** — `GITIGNORE_ENTRIES` (`cli/lib/commands.mjs:24`) es
`[".ozali/backups/", ".ozali/.session-state.json", ".engram/"]`: no ignora `.ozali/docs/`. El
mensaje de `ozali update` incluso lo dice en voz alta (*".ozali/ (config del equipo y docs por
hito) ahora se commitea"*).

El problema es que **la documentación de la skill contradice al CLI**, y el agente le hace caso a
la documentación:

| Archivo | Línea | Dice |
|---|---|---|
| `skill/SKILL.md` | ~497 | "**Ruta base:** `.ozali/docs/cdk/` — **gitignored en el repo principal**…" |
| `skill/references/engram-convention.md` | ~299 | "Commit + push del repo de conocimiento (no del repo principal, que los tiene gitignored)." |

Resultado observado en `landing`: el agente, siguiendo su propio `SKILL.md`, agregó
`.ozali/docs/` al `.gitignore` del repo — deshaciendo lo que el CLI había dejado bien. Un repo
inicializado por CLI queda correcto; uno **calibrado por el agente** queda mal.

### Qué hay que cambiar

1. **`skill/SKILL.md`** → en *"Documentación por hito de `cdk`"*, reemplazar
   "gitignored en el repo principal" por que **se versiona en el repo principal** y además se
   sincroniza al repo de conocimiento.
2. **`skill/references/engram-convention.md`** → corregir el paso 3 de `ozali sync`: los docs ya
   no están gitignored en el repo principal.
3. **`cli/lib/util.mjs`** → agregar `.ozali/docs/` (y `.ozali/docs/cdk/`) a `GITIGNORE_OBSOLETE`,
   para que `pruneGitignore` las **retire** en repos donde una corrida previa del agente ya las
   metió. Sin esto, `ensureGitignore` solo agrega y un repo contaminado se queda así para siempre
   — es el mismo motivo por el que existe `GITIGNORE_OBSOLETE` para `.ozali/*`.
4. **`cli/test/smoke.test.mjs`** → extender el test
   *".gitignore ignora solo el ruido local; .ozali/ es commiteable"* con un caso que parta de un
   `.gitignore` que **sí** tenga `.ozali/docs/` y verifique que `init`/`update` lo retiran.
5. Revisar si `.ozali/metrics/` corre la misma suerte (telemetría de tokens). Hoy el CLI tampoco
   lo ignora; decidir si se versiona o si entra a `GITIGNORE_ENTRIES` de forma explícita.

### Cómo se verifica

```bash
# en un repo limpio
ozali init
grep -n "\.ozali/docs" .gitignore   # → sin coincidencias

# en un repo ya contaminado por el agente
printf '\n.ozali/docs/\n' >> .gitignore
ozali update
grep -n "\.ozali/docs" .gitignore   # → sin coincidencias (pruneGitignore la retiró)
```

### Referencias

- Corrida que lo detectó: `landing` → `.ai/ozali/logs/ozali.log_26-09-15/`
- Memoria Engram (proyecto `ozali`): pendiente `P-001`
