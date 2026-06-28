# Seguridad del instalador (npx / pnpm / supply-chain)

← [README](../README.md)

`ozali` se distribuye como un CLI **Node de cero dependencias y sin lifecycle scripts**
(`preinstall`/`install`/`postinstall`). Esa decisión es deliberada: **elimina de raíz** el vector
de ataque de cadena de suministro que abusaron incidentes recientes del registro npm.

## El problema: lifecycle scripts en `npm`/`npx`

`npx <pkg>` descarga el paquete **y todo su árbol de dependencias** a un caché temporal y ejecuta
su `bin`. Por defecto, npm/npx **ejecutan los lifecycle scripts** del paquete y de **cada
dependencia transitiva** durante la instalación — *antes* de que tú corras nada. Un `postinstall`
malicioso en una dependencia popular (o comprometida) corre código arbitrario en tu máquina:
roba tokens/variables de entorno y, en los gusanos recientes, se auto-propaga.

## Las tres palancas de mitigación

1. **Cero dependencias + cero scripts propios.** Si el paquete no tiene dependencias ni
   `postinstall`, el vector **no existe**, corras como corras. ← Es lo que hace `ozali`.
2. **`--ignore-scripts`.** npm/npx/pnpm lo soportan; se puede fijar global en `.npmrc`
   (`ignore-scripts=true`).
3. **pnpm v10+.** Deshabilita los lifecycle scripts de las dependencias **por defecto**; hay que
   aprobarlos explícitamente (`pnpm.onlyBuiltDependencies` o `pnpm approve-builds`). `pnpm dlx`
   (el equivalente de `npx`) hereda ese default seguro.

## Cómo instalar/ejecutar ozali de forma segura

| Método | Comando | Notas |
|---|---|---|
| **pnpm (recomendado)** | `pnpm dlx ozali@<versión> init` | pnpm 10 no corre postinstall de deps; pinea la versión |
| **npm con scripts off** | `npx --ignore-scripts ozali@<versión> init` | desactiva lifecycle scripts explícitamente |
| **git (máxima auditabilidad)** | `git clone <repo> && node ozali/cli/bin/ozali.mjs init` | sin registry, sin árbol de deps; el equipo lee el script antes de correrlo |

> **Siempre pinea la versión** (`@x.y.z`) en vez de `@latest`, y usa lockfile. Al publicar en npm
> se firmará con **provenance** (sigstore) para verificar origen.

## Por qué NO un `curl … | bash` como camino primario

El `curl … | bash` estilo de otros instaladores ejecuta un script remoto **a ciegas**. Lo dejamos
solo como espejo opcional, **pineado a un tag + checksum** verificable, nunca como ruta por defecto.

## Disciplina interna

- El harness `verify-structure.mjs` que genera `cdk` es también **cero deps, Node 16+**.
- El CLI no escribe fuera del proyecto destino sin confirmación, salvo el repo de conocimiento
  que el usuario configura explícitamente en `ozali init`.
