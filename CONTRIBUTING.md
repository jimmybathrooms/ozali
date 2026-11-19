# Contribuir a ozali

Gracias por contribuir. ozali es deliberadamente **minimalista y seguro**: el CLI no tiene
dependencias ni lifecycle scripts. Mantengamos esa disciplina.

## Reglas no negociables

1. **Cero dependencias de runtime.** El CLI usa solo `node:*`. Nada de `dependencies` en
   `package.json`. (CI lo verifica.)
2. **Cero lifecycle scripts.** Nada de `preinstall`/`install`/`postinstall`/`prepare`. (CI lo verifica.)
3. **Node ≥ 16.** Evita APIs que no existan en 16 (p. ej. `readline/promises`); usa el patrón
   callback envuelto en Promise.
4. **El histórico se aísla.** El CLI nunca escribe el histórico/memoria dentro del repo
   principal del usuario sin gitignorearlo.

## Desarrollo

```bash
git clone <repo> && cd ozali
node cli/bin/ozali.mjs --help      # correr el CLI desde fuente
npm test                           # node --test cli/test/*.test.mjs
```

No hay `npm install` que hacer: no hay dependencias.

## Estructura

```
cli/bin/ozali.mjs     entrypoint (parseo + dispatch)
cli/lib/*.mjs         util, prompt, detect, commands
cli/test/*.test.mjs   pruebas (node:test)
skill/                la skill ozali (bootstrap) + references
docs/                 seguridad, histórico de equipo, uso previsto
```

## Pull requests

- Añade/actualiza pruebas en `cli/test/` para cambios de comportamiento del CLI.
- Si tocas la skill (`skill/`), verifica que los links a `references/` resuelven.
- Conventional commits (`feat:`, `fix:`, `docs:`…). Termina los commits con el trailer del repo.

## Mejoras de campo (propuestas desde repos que usan ozali)

Quien usa `cdk` y encuentra algo que mejorar no edita este repo: lo marca en su proyecto y lo propone.

**Usuario**
1. Marca la edición manual con `<!-- ozali:local-patch id=<slug> autor=@tu fecha=AAAA-MM-DD -->` … `<!-- /ozali:local-patch -->`.
2. `ozali patch capture <id> --hito <slug>` arma `.ozali/proposals/<id>/`; completa los campos "⚠️ COMPLETAR" de `PROPUESTA.md`.
3. `ozali patch submit <id>` (dry-run: muestra el cuerpo exacto) y luego `--yes` abre un **issue** en este repo.
   Con `--pr` abre un PR a `develop` con su implementación (hace fork si no tiene escritura).
   Revisa antes que no haya nada interno: el issue incluye proyecto, hito y contenido del parche.

**Maintainer**
1. El workflow `triage-from-field` etiqueta el issue `from-field` + `pendiente-revision`.
2. Triage con el checklist de la propuesta (¿aplica a todos?, ¿rompe contrato / sube `cdk vN`?, ¿hay tests de plantillas?, ¿degrada sin la dependencia?).
3. **Aceptar:** etiqueta `aceptada`, quita `pendiente-revision` y asigna un **milestone** (`vX.Y.Z`): ese milestone es el stack de liberación.
   **Rechazar:** etiqueta `rechazada` y comenta el motivo (el usuario lo guarda con `ozali patch reject <id> --motivo …`).
4. **Desarrollo:** ramas hacia `develop` con `Closes #N` (los PR de `--pr` se revisan; exigen CODEOWNER).
5. **Release:** con el milestone completo, `develop` → `main`, bump de versión y tag `vX.Y.Z` (ver Releases).
   La siguiente migración de `cdk` reemplaza el bloque `local-patch` por la versión oficial.

`develop` es la rama de integración (la CI corre en `main` y `develop`); `main` solo recibe releases.

## Releases

Crear un tag `vX.Y.Z` que coincida con `package.json` dispara el workflow de publicación a npm
con **provenance** (sigstore). Requiere el secret `NPM_TOKEN`.
