# Blueprint de calibración de testing + Strict TDD

Se usa en la **Fase 3.5** de `ozali`. Su trabajo es averiguar **qué soporta realmente el
proyecto en materia de pruebas** y resolver si `cdk` puede exigir **test-first** (Strict TDD).
Nada se adivina: todo se deriva de manifiestos, configuración y conteo real de archivos.

> **Regla anti-invención:** no inventes comandos de prueba, umbrales de cobertura ni runners.
> Lo que no se pueda derivar del repo se **pregunta** al usuario o se marca `N/A`.

---

## 1. Qué detectar (capacidades de testing)

Inspecciona el repo y arma la **tabla de capacidades**:

| Aspecto | Dónde leerlo (señales) |
|---|---|
| **Runner(s)** de pruebas | `package.json` scripts (`test`, `test:e2e`), `jest`/`vitest`/`karma`/`mocha`/`playwright`/`cypress`; `pom.xml`/`build.gradle` (JUnit/surefire); `pyproject.toml`/`pytest.ini`/`tox.ini`; `go test`; `Cargo.toml` |
| **Capas disponibles** | unit (junto al código / `__tests__` / `src/test`), integración, e2e (carpetas `e2e/`, `cypress/`, `playwright/`) |
| **Comando(s) exactos** | scripts del manifiesto y wrappers (`npm test`, `pnpm test`, `mvnw test`, `pytest`, `go test ./...`) — copia el comando, no lo supongas |
| **Cobertura** | config de coverage (`jest --coverage`, `nyc`, `jacoco`, `coverage.py`); umbral si está declarado |
| **Linter / type-checker / formatter** | `eslint`, `biome`, `tsc --noEmit`, `ruff`/`mypy`, `golangci-lint`, `prettier`/`gofmt` |
| **Estado real** | **cuenta** archivos de prueba reales (`*.spec.ts`, `*.test.tsx`, `*Test.java`, `test_*.py`, `*_test.go`). Reporta el número; si es ~0, dilo |
| **CI** | `.github/workflows`, pipelines: ¿corre tests?, ¿bloquea el merge?, ¿hay gate de cobertura? |

La salida de esta sección es una tabla concreta, p. ej.:

```
| Capacidad      | Valor                          |
| -------------- | ------------------------------ |
| Runner unit    | vitest (`pnpm test`)           |
| Runner e2e     | playwright (`pnpm test:e2e`)   |
| Cobertura      | sí, umbral 80% (vitest)        |
| Type-check     | tsc --noEmit                   |
| Linter         | eslint + prettier              |
| Archivos test  | 142 *.spec.ts                  |
| CI corre tests | sí, bloquea merge              |
```

---

## 2. Resolver `strict_tdd`

Aplica en orden; gana la primera que coincide:

| Señal | `strict_tdd` | Nota |
|---|---|---|
| Marcador/config explícito del proyecto o convención de equipo (en `.ai/context/tech-stack.md`, CI, o el usuario lo afirma) | **usa ese valor** | la intención declarada manda |
| Sin marcador, pero **existe runner de tests usable** | **`true`** | default seguro: test-first |
| **No hay runner de tests** (o no corre) | **`false`** | explica que TDD estricto no está disponible y qué falta para habilitarlo |

> "Existe runner usable" = hay un comando de pruebas que **corre sin error de configuración**.
> Si hay runner declarado pero roto, trátalo como `false` y anótalo como riesgo/mejora.

Cuando falte el **umbral de verde** (qué comando corre y qué cuenta como pasar), **pregunta**:
- ¿Qué comando corre las pruebas y cuál es el umbral de "verde"?
- ¿La cobertura es un gate o solo informativa?
- ¿Hay módulos donde el test-first es obligatorio y otros donde no?

---

## 3. Dónde persistir la calibración (modo híbrido)

**a) Fuente de verdad (legible por humanos):** agrega/actualiza una sección **"Testing & TDD"**
en `.ai/context/tech-stack.md`:

```markdown
## Testing & TDD

**Strict TDD:** true   <!-- resuelto por ozali Fase 3.5 -->

| Capacidad | Valor |
| --------- | ----- |
| Runner unit | vitest (`pnpm test`) |
| ... | ... |

**Comando verde (definition of green):** `pnpm test` sin fallos + cobertura ≥ 80%.
**Ciclo:** RED → GREEN → REFACTOR (test-first) cuando Strict TDD = true.
```

**b) Engram (buscable / acumulable):** espeja como artefacto, ver
[`engram-convention.md`](engram-convention.md):

```
title:     cdk/_project/testing-capabilities
topic_key: cdk/_project/testing-capabilities
type:      architecture
project:   <nombre del proyecto>
capture_prompt: false
content:   <la tabla de capacidades + strict_tdd + comando verde>
```

---

## 4. Cómo lo consume `cdk`

- Si `strict_tdd: true`: el ciclo `executioners ⇄ tester` es **test-first** (RED→GREEN→REFACTOR);
  el GATE muestra el **plan de pruebas** como sección obligatoria y el `tester` no aprueba un hito
  sin pruebas nuevas/actualizadas en verde.
- Si `strict_tdd: false`: se exige al menos **pruebas de regresión** sobre lo tocado y se deja
  explícito en `05-bitacora-ejecucion.md` que el proyecto no soporta TDD estricto (con la mejora
  sugerida para habilitarlo en `03-mejoras.md`).
- El **comando verde** calibrado es el que usa el `tester` para decidir pass/fail.

---

## 5. Validación al cerrar la fase

Antes de pasar a Fase 4, confirma:
1. La tabla de capacidades refleja comandos **reales** (los corriste o los leíste del manifiesto).
2. `strict_tdd` quedó resuelto con justificación (no "por defecto" silencioso).
3. La sección "Testing & TDD" existe en `.ai/context/tech-stack.md`.
4. (Si hay Engram) el artefacto `testing-capabilities` quedó guardado.
