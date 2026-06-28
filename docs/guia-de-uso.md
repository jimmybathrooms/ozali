# Guía de uso — ozali

← [README](../README.md) · ¿buscas el modelo mental? → [intended-usage.md](intended-usage.md)

Guía rápida y sin tecnicismos para empezar a usar **ozali** en cualquier proyecto. Si nunca lo
has usado, lee esto de principio a fin: son 5 minutos.

---

## ¿Qué es ozali, en simple?

ozali le enseña a tu asistente de IA (Claude Code u opencode) **cómo trabajar en tu proyecto**:
entiende tu código, propone un plan, pide tu aprobación antes de ejecutar, y **recuerda** lo que
el equipo hizo antes. Tú sigues mandando; ozali pone el método y el orden.

Piensa en tres piezas:

| Pieza | Para qué sirve |
|---|---|
| **El comando `ozali`** | Lo corres en la terminal. Instala y mantiene todo. |
| **La skill `ozali`** | Vive dentro de tu agente. Diagnostica el proyecto y prepara el trabajo. |
| **Engram** *(opcional)* | La "memoria" del equipo: lo aprendido se guarda y se comparte. |

---

## Paso a paso (primera vez)

### 1. Instala ozali

```bash
pnpm add -g ozali      # recomendado
# o:  npm install -g ozali
```

> Puedes probarlo sin instalar con `pnpm dlx ozali init`, pero entonces el comando `ozali` **no
> queda disponible** después. Para usar `doctor`, `sync`, etc. en el día a día, instálalo con `-g`.

### 2. Entra a tu proyecto y arranca

```bash
cd mi-proyecto
ozali init
```

El asistente te hará unas preguntas (qué agente usas, dónde guardar la memoria, si instalar
Engram). Puedes aceptar los valores por defecto si dudas. Al terminar, deja listo:

- la skill instalada en tu agente,
- los permisos base para que el agente **no te pregunte por cada comando** (ver más abajo),
- el aislamiento del histórico (no ensucia tu repo).

### 3. Abre tu agente y diagnostica

Abre Claude Code (u opencode) en el proyecto y escribe:

```
diagnostica el proyecto
```

ozali revisará tu código, preparará la documentación base y te mostrará un **plan**. Nada se
ejecuta hasta que tú apruebes (eso es el 🛑 **GATE**).

### 4. Trabaja normal

Pídele cosas a tu agente como siempre: *"crea el endpoint de login"*, *"corrige este bug"*, etc.
ozali se encarga de hacerlo con orden y de ir guardando el registro.

### 5. Guarda y comparte (si trabajas en equipo)

```bash
ozali sync
```

Lleva el histórico y la memoria al repo de conocimiento del equipo. Tus compañeros lo traen con
`ozali sync --import`.

---

## Los comandos (chuleta)

| Comando | Qué hace |
|---|---|
| `ozali init` | Prepara el proyecto (lo corres una vez por repo). |
| `ozali doctor` | Revisa que todo esté bien. Es solo lectura, no cambia nada. |
| `ozali update` | Actualiza la skill a la última versión. |
| `ozali sync` | Sube el histórico/memoria al repo de equipo. |
| `ozali sync --import` | Baja lo que el equipo ya guardó. |

¿Algo no funciona? Corre **`ozali doctor`** primero: te dice qué falta y cómo arreglarlo.

---

## Sobre los permisos (menos interrupciones)

Por defecto, los agentes piden confirmación **antes de cada comando**. Eso cansa. Durante `init`,
ozali crea un archivo `.claude/settings.json` con una lista de permisos razonable: deja correr
libremente cosas seguras (instalar dependencias, correr tests, leer archivos, `git status`…) y
**bloquea las peligrosas** (`rm -rf`, `git push`).

Es **un punto de partida, no una jaula**: puedes editar ese archivo y añadir lo que tu proyecto
necesite. Si vuelves a correr `ozali init`, tus reglas **se conservan** (no se borran ni se
duplican).

> **Confianza del workspace (Claude Code):** por seguridad, Claude Code **ignora** los permisos de
> un proyecto hasta que confías en él (verás un aviso *"this workspace has not been trusted"*).
> `init` te ofrece marcarlo como confiable automáticamente; si prefieres hacerlo tú, abre Claude
> Code en la carpeta y acepta el diálogo de confianza una vez. Con `--no-trust` ozali no lo toca.

Ejemplo — permitir Docker además de lo de fábrica:

```json
{
  "permissions": {
    "allow": ["Bash(docker *)"],
    "deny": []
  }
}
```

---

## Engram: la memoria del equipo (opcional)

Durante `init`, ozali **instala Engram por ti**: en modo interactivo te pregunta (basta con aceptar),
y en modo automático (`--yes`) lo instala solo. Lo baja con brew (macOS/Linux) o `go` (Windows), y si
no puede, te deja las instrucciones. Con Engram, tu agente **recuerda** decisiones, bugs resueltos y
convenciones — y los recupera en futuras sesiones.

¿No quieres Engram ahora? Pasa `--no-engram` y ozali arranca en modo `docs` (la memoria se queda en
documentos legibles). Cuando quieras activarlo, instálalo y corre `ozali doctor`: el modo sube a
`hybrid` solo.

Dos detalles si lo usas en equipo:

- **Idioma:** guarda la memoria compartida **en español** (y búscala en español). El buscador no
  mezcla idiomas: si guardas en español y buscas en inglés, no encuentra nada.
- **Privado vs. compartido:** lo que marques como `scope: project` lo ve todo el equipo. Para notas
  personales usa `scope: personal` (aunque hoy el sync comparte ambos — para algo realmente privado,
  no lo pongas en el proyecto de equipo).

Más detalle técnico en [engram-convention.md](../skill/references/engram-convention.md).

---

## Preguntas frecuentes

**¿Tengo que usar Engram?**
No. Es opcional. Sin él, ozali funciona en modo `docs`.

**¿ozali toca mi código sin permiso?**
No. Siempre hay un plan y un GATE de aprobación antes de ejecutar.

**Escribí `ozali` y la terminal dice "command not found".**
Lo corriste con `dlx`/`npx`, que es temporal. Instálalo global: `pnpm add -g ozali`.

**¿Esto ensucia mi repositorio?**
No. El histórico y la memoria se aíslan (`.ozali/`, `.engram/` van al `.gitignore`).

**Veo "this workspace has not been trusted" y mis permisos no aplican.**
Es el aviso de seguridad de Claude Code: ignora los permisos del proyecto hasta confiar en él.
Deja que `init` lo marque como confiable, o abre Claude Code en la carpeta y acepta el diálogo una
vez. Tras eso, el aviso desaparece y los permisos surten efecto.

**¿Funciona en Windows?**
Sí. Los permisos base incluyen variantes PowerShell, y Engram se instala con `go install` o un
binario descargable.
