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

## La descarga del binario de Engram

Cuando `ozali init` / `ozali install-engram` no encuentra Homebrew ni Go (o corre en Linux),
descarga el binario precompilado de Engram desde los releases de GitHub. Esa descarga es
**código que después ejecutas**, así que se trata con las mismas reglas que el resto del
instalador:

| Control | Qué hace |
|---|---|
| **Origen fijo** | Solo se acepta una URL `https://github.com/Gentleman-Programming/engram/releases/download/…`. Cualquier otro host (incluidos `github.com.otracosa.tld` o `https://github.com@otro/`) se descarta aunque venga en la respuesta de la API. |
| **HTTPS sin degradar** | `curl --proto '=https' --proto-redir '=https'` / `wget --https-only`: un redirect a `http://` aborta en vez de exponer la descarga a un MITM. |
| **SHA-256 verificado** | Se baja el `checksums.txt` del **mismo release** y se compara contra el hash del archivo (`node:crypto`, sin dependencias). **Fail-closed**: si no hay manifiesto, no aparece el asset o el hash no coincide, se aborta y **no se instala nada**. |
| **Solo releases estables** | Se ignoran `draft`, `prerelease` y tags no-semver (`pi-v*`). Nunca se instala un RC por accidente. |
| **Extracción acotada** | `tar --no-same-owner --no-same-permissions` en un directorio temporal propio (`0700`), y se comprueba que el binario extraído no salga de ese directorio (path traversal / symlink). |
| **Sin residuos** | El temporal se borra siempre, haya fallado o no. |

Si la verificación falla, el CLI te dice qué hash esperaba y cuál obtuvo, y te deja las rutas
alternativas (`brew install …` o `go install …`), que traen su propia verificación
(checksum en la fórmula de Homebrew, `GOSUMDB` en Go).

En **Linux esta es la ruta por defecto** (Homebrew es poco común ahí, así que el binario
precompilado se intenta primero), en **macOS** solo se usa si no hay ni `brew` ni `go`, y en
**Windows** no se usa: va por `go install`, que verifica el módulo contra `GOSUMDB`.

### Consulta de releases: caché y autenticación

La lista de releases se consulta a la API pública de GitHub, que limita a **60 peticiones/hora
por IP** sin autenticar. Un equipo detrás de la misma salida a internet corriendo `ozali doctor`
o `init` en varios repos agota ese cupo y se queda sin poder resolver el binario (403).

- **Caché de 6h** en `~/.ozali/cache/engram-releases.json` (solo los campos que usamos, ~45 KB).
  `doctor`, `init` e `install-engram` comparten el caché, así que la API se toca una vez cada 6h.
- **Autenticación opcional**: si tienes `gh` autenticado se usa `gh api`; si no, se toma
  `GITHUB_TOKEN`/`GH_TOKEN` del entorno (5000 req/h). El token viaja en un archivo de
  configuración `0600` que se pasa con `curl -K`, **nunca como argumento** — argv es visible
  para cualquier proceso de la máquina (`ps aux`).
- **Si la API falla** se reutiliza el caché vencido avisando de su antigüedad. Es seguro: la
  descarga que salga de ahí se valida igual por origen y por SHA-256.

## Disciplina interna

- El harness `verify-structure.mjs` que genera `cdk` es también **cero deps, Node 16+**.
- El CLI no escribe fuera del proyecto destino sin confirmación, salvo el repo de conocimiento
  que el usuario configura explícitamente en `ozali init`.
