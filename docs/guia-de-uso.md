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
| `ozali install-engram` | Instala (o reinstala) Engram y registra su MCP cuando saltaste la instalación en `init`. |
| `ozali workspace` | Configura varios repos de una carpeta para trabajar en conjunto (lo corres en la carpeta raíz). |
| `ozali doctor` | Revisa que todo esté bien. Es solo lectura, no cambia nada. |
| `ozali update` | Actualiza skill ozali + ozali-jarvis + permisos (y guía cómo regenerar cdk). |
| `ozali sync` | Sube el histórico/memoria al repo de equipo. |
| `ozali audit` | Navega/audita la memoria de Engram (qué se ha hecho). |

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

## ozali-jarvis: el orquestador (no necesitas /cdk)

`init` crea **ozali-jarvis**, el "cerebro" por defecto de tu proyecto. A partir de ahí, **en cada
sesión y sin escribir `/cdk`**, tu agente:

- **recuerda** lo que el equipo trabajó antes (recupera contexto de Engram al iniciar),
- **registra** lo que van haciendo (decisiones, acciones, aprendizajes) para que quede acumulado,
- y cuando toca **escribir código con disciplina**, delega en la skill `cdk` (plan, aprobación, TDD).

Sigues pudiendo invocar `/cdk` cuando quieras; jarvis simplemente lo usa como referencia y mantiene
todo en contexto. ¿No lo quieres? `init --no-jarvis`.

### Menos tokens, más contexto
Con Engram en línea, jarvis y `cdk` trabajan **recall-first**: antes de releer archivos o re-analizar,
reutilizan el análisis/resumen que ya está en memoria (si el código no cambió). Eso gasta **menos
tokens** y mantiene el contexto enfocado. Puedes ver la tendencia de consumo con `ozali doctor`.

## Engram: la memoria del equipo (opcional)

Durante `init`, ozali **instala Engram por ti**: en modo interactivo te pregunta (basta con aceptar),
y en modo automático (`--yes`) lo instala solo. Lo baja con brew (macOS/Linux) o `go` (Windows), y si
no puede, te deja las instrucciones. Con Engram, tu agente **recuerda** decisiones, bugs resueltos y
convenciones — y los recupera en futuras sesiones.

¿No quieres Engram ahora? Pasa `--no-engram` y ozali arranca en modo `docs` (la memoria se queda en
documentos legibles). Cuando quieras activarlo, corre `ozali install-engram` — lo instala, configura
el MCP en tu agente y sube el modo a `hybrid` de una vez.

Dos detalles si lo usas en equipo:

- **Idioma:** guarda la memoria compartida **en español** (y búscala en español). El buscador no
  mezcla idiomas: si guardas en español y buscas en inglés, no encuentra nada.
- **Privado vs. compartido:** lo que marques como `scope: project` lo ve todo el equipo. Para notas
  personales usa `scope: personal` (aunque hoy el sync comparte ambos — para algo realmente privado,
  no lo pongas en el proyecto de equipo).

Más detalle técnico en [engram-convention.md](../skill/references/engram-convention.md).

---

## Auditar lo que se ha hecho (`ozali audit`)

¿Quieres ver qué ha registrado el equipo? `ozali audit`:

- **Dentro de un repo:** te propone auditar **ese proyecto** o **todos** (general).
- **Fuera de un repo** (una ruta cualquiera): va directo a la auditoría **general**.

Atajos: `ozali audit --tui` abre un navegador interactivo de la memoria; `ozali audit --search "rfc"`
busca un término; `ozali audit --general` fuerza el alcance general. Si no tienes Engram, audita el
histórico local de `.ozali/docs/`.

---

## Trabajar con varios repos a la vez (`ozali workspace`)

¿Tienes una carpeta que agrupa **varios repositorios que se hablan entre sí** (una API, su front, una
librería compartida) y quieres que tu agente trabaje con todos juntos? Corre **una vez** en esa
carpeta raíz:

```bash
ozali workspace             # escanea los repos hijos, prepara los que falten y arma la config conjunta
ozali workspace --dry-run   # solo te muestra el inventario y el plan, sin escribir nada
ozali workspace --yes       # sin preguntas: acepta los defaults y las referencias detectadas
ozali workspace --depth 2   # busca repos hasta 2 niveles (si están en subcarpetas de grupo)
```

Qué hace, en orden:

1. **Revisa** cada repo y te dice cómo está: `✔ listo`, `⚠ sin calibrar` (le falta correr la skill
   `ozali`) o `✖ sin init` (nunca se preparó).
2. **Prepara** los que están `✖ sin init` corriendo `ozali init` por ti, y te **guía** para calibrar
   los que están `⚠ sin calibrar` (abrir ese repo y escribir *"diagnostica el proyecto"* — eso lo
   hace tu agente, no el comando).
3. **Detecta las referencias** entre repos (dependencias npm cruzadas, submódulos, `docker-compose`) y
   te pide confirmarlas.
4. **Escribe la configuración** para trabajar en conjunto:
   - `ozali-workspace.json` — el mapa de repos, su estado y sus referencias (esto **sí** se commitea).
   - `<carpeta>.code-workspace` — ábrelo en VSCode/Antigravity y verás todos los repos juntos.
   - **ozali-workspace-jarvis** en el `CLAUDE.md`/`AGENTS.md` de la raíz: un orquestador que coordina
     los repos según ese mapa y delega el trabajo de código en el `cdk` de cada uno.

**Sin ir a cada proyecto:** desde la carpeta raíz puedes operar todos los repos de una vez:

```bash
ozali workspace --doctor    # revisa la salud de todos los repos y saca un resumen
ozali workspace --update    # actualiza skills, permisos y jarvis de todos los repos
```

Y para **calibrar** (generar `cdk`) los que estén `⚠ sin calibrar`, ya **no** abres cada proyecto:
abre tu agente en la carpeta raíz y pídele *"calibra los repos pendientes"* — el orquestador los
recorre **uno por uno** (cada uno con su aprobación) sin que cambies de proyecto.

Es **idempotente**: vuelve a correrlo cuando agregues un repo o cambien las referencias — no duplica
nada. Cada repo conserva su autonomía (su propio jarvis, su `cdk` y su memoria); el workspace solo
los **coordina**. Detalle completo en [workspaces.md](workspaces.md).

## Preguntas frecuentes

**¿Tengo que usar Engram?**
No. Es opcional. Sin él, ozali funciona en modo `docs`.

**¿ozali toca mi código sin permiso?**
No. Siempre hay un plan y un GATE de aprobación antes de ejecutar.

**Escribí `ozali` y la terminal dice "command not found".**
Lo corriste con `dlx`/`npx`, que es temporal. Instálalo global: `pnpm add -g ozali`.

**¿Esto ensucia mi repositorio?**
No. El histórico y la memoria se aíslan (`.ozali/`, `.engram/` van al `.gitignore`).

**Tengo varios repos que dependen entre sí. ¿Los conecto?**
Sí: abre la carpeta que los agrupa y corre `ozali workspace`. Prepara los que falten y arma una
config para que tu agente trabaje con todos juntos. Ver [arriba](#trabajar-con-varios-repos-a-la-vez-ozali-workspace).

**Veo "this workspace has not been trusted" y mis permisos no aplican.**
Es el aviso de seguridad de Claude Code: ignora los permisos del proyecto hasta confiar en él.
Deja que `init` lo marque como confiable, o abre Claude Code en la carpeta y acepta el diálogo una
vez. Tras eso, el aviso desaparece y los permisos surten efecto.

**Actualicé ozali pero no veo ozali-jarvis (o cdk quedó viejo).**
Corre `ozali update` en el repo: refresca la skill ozali, los permisos y **crea/actualiza
ozali-jarvis**. La skill `cdk` la regenera tu agente: tras `ozali update`, abre el agente y vuelve a
correr la skill `ozali` para regenerar `cdk` con lo nuevo (tus docs por hito y el plan se conservan).

**¿Funciona en Windows?**
Sí. Los permisos base incluyen variantes PowerShell, y Engram se instala con `go install` o un
binario descargable.
