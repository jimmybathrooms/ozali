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

## Releases

Crear un tag `vX.Y.Z` que coincida con `package.json` dispara el workflow de publicación a npm
con **provenance** (sigstore). Requiere el secret `NPM_TOKEN`.
