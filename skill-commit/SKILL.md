---
name: ozali-commit
description: Genera un "commit summary" convencional (feat/fix/hotfix/refactor) con prefijo, scope y descripción a partir de los cambios EN STAGE y commitea tras tu aprobación. Úsala cuando el usuario quiera "commitea", "haz el commit", "genera el mensaje de commit", "cierra el hito con commit", o cuando otra skill (p. ej. cdk) cierre un hito. Sucesora de copsis-commit.
---

# Skill: ozali-commit

`ozali-commit` produce el **mensaje de commit** de un cambio siguiendo
[Conventional Commits](https://www.conventionalcommits.org/) y lo **commitea tras tu aprobación**.
Es la skill de commit vigente del ecosistema `ozali` (sucede a la antigua `copsis-commit`).

`cdk` la invoca en el **cierre de cada hito**, pero también puedes usarla suelta en cualquier repo.

> **Regla de oro:** nunca commitea sin tu aprobación explícita (🛑 **GATE de mensaje**). El GATE del
> mensaje es **independiente** del GATE del plan de `cdk`.

> **Cero dependencias:** usa `git` directo (ya habilitado en el perfil base de permisos de ozali:
> `Bash(git add *)`, `Bash(git commit *)`, `Bash(git status)`, `Bash(git diff *)`,
> `Bash(git log *)`). No requiere herramientas externas.

---

## Flujo

### 1. Inspecciona el stage
- `git status --short` — qué hay staged vs sin stage.
- `git diff --cached` — el contenido **EN STAGE** (la fuente de verdad del mensaje).
- Si **no hay nada en stage**: dilo y pregunta si quieres que haga `git add` de archivos concretos
  (o `git add -A`). **No** hagas `add -A` por tu cuenta sin confirmación.
- Lee el commit anterior con `git log -1 --pretty=%s` para mantener el estilo del repo.

### 2. Determina el tipo y el scope
A partir del diff EN STAGE, clasifica el cambio:

| Tipo | Cuándo |
|---|---|
| `feat` | nueva funcionalidad / capacidad |
| `fix` | corrección de bug |
| `hotfix` | corrección urgente en caliente |
| `refactor` | reestructura sin cambiar comportamiento |
| `docs` | solo documentación |
| `test` | solo pruebas |
| `chore` | mantenimiento (deps, config, build) |

- **Scope** = módulo/área tocada del repo (derívalo de las rutas en stage; ej. `cobranza`, `cli`,
  `auth`). Si abarca varias áreas, usa la más representativa o un scope general.
- Si la skill que invoca aporta tipo/scope (p. ej. `cdk` mapea feature→`feat`, bugfix→`fix`,
  hotfix→`hotfix`, refactor→`refactor`), **respétalos**.

### 3. Redacta el mensaje
Formato: `tipo(scope): descripción en imperativo, ≤ 72 chars`. Cuerpo opcional (qué/por qué, no el
cómo). No inventes cambios que no estén en el diff. Idioma: el del repo (mira `git log`).

```
feat(cobranza): agrega validación de RFC en alta de cotización

- valida formato y dígito verificador antes de persistir
- cubre el caso de RFC genérico (XAXX010101000)
```

### 4. 🛑 GATE de mensaje
Presenta el mensaje completo **como texto visible** y espera aprobación. Si el usuario pide ajustes,
itera. **No commitees** hasta el "ok".

### 5. Commitea
Tras la aprobación:
```bash
git commit -m "tipo(scope): descripción" [-m "cuerpo…"]
```
- Commitea **solo lo que está en stage** (no añadas archivos no aprobados).
- **No** hagas `git push` (es destructivo/saliente y está denegado por defecto): si el usuario lo
  quiere, recuérdaselo para que lo haga él.
- Reporta el hash corto resultante (`git rev-parse --short HEAD`).

---

## Notas
- Si el repo usa una convención propia (gitmoji, prefijos de ticket), detéctala desde `git log` y
  síguela.
- Si el cambio es demasiado grande/heterogéneo para un solo mensaje coherente, **sugiere** dividir
  en varios commits (pero no lo hagas sin aprobación).
