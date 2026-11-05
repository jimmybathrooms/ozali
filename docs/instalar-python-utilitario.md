# Instalar la skill `python-utilitario` en otro equipo (sin ozali)

Guía temporal mientras se libera ozali con el comando `install-skill python-utilitario`.
La skill es solo una carpeta: instalarla es copiarla al directorio de skills del agente.

## Qué es

Fabrica utilitarios Python autocontenidos: una carpeta con `<nombre>.py`, **un solo**
`run_<nombre>.sh` (crea su `venv/`, instala dependencias y ejecuta), `requirements.txt`,
`README.md` y `.gitignore`. Con log por corrida, `--dry-run` y códigos de salida estándar
(`0` ok · `1` fallidos · `2` credencial vencida · `130` cancelado). No instala nada en la PC.

Contenido de la carpeta de la skill:

```
python-utilitario/
├── SKILL.md
├── references/{convenciones.md, migracion.md}
└── plantillas/{TEMPLATE.py, run_TEMPLATE.sh, requirements.txt, README.md, gitignore}
```

## Requisitos

- Claude Code (o opencode) instalado.
- `python3` disponible en el PATH (el utilitario crea su propio venv con él).

## Opción A — Copiar la carpeta (recomendada si no hay acceso al repo)

Desde el equipo que ya la tiene, comprime la carpeta:

```bash
cd ~/.claude/skills
zip -r python-utilitario.zip python-utilitario -x "*.DS_Store"
```

Pasa el `.zip` al otro equipo (AirDrop, Drive, scp…) y ahí:

```bash
mkdir -p ~/.claude/skills
unzip python-utilitario.zip -d ~/.claude/skills
```

## Opción B — Desde el repo de ozali (si tienes acceso a GitHub)

```bash
git clone --depth 1 https://github.com/jimmybathrooms/ozali.git /tmp/ozali-src
mkdir -p ~/.claude/skills
cp -R /tmp/ozali-src/skill-python-utilitario ~/.claude/skills/python-utilitario
rm -rf /tmp/ozali-src
```

> La carpeta del repo se llama `skill-python-utilitario`; en el destino **debe llamarse
> `python-utilitario`** (el nombre de la carpeta es el nombre de la skill).

Para **opencode**, el destino es `~/.config/opencode/skills/python-utilitario`.

Para instalarla **solo en un proyecto** (no global), usa `<repo>/.claude/skills/python-utilitario`.

## Verificar

```bash
ls ~/.claude/skills/python-utilitario/SKILL.md
head -3 ~/.claude/skills/python-utilitario/SKILL.md   # debe mostrar "name: python-utilitario"
```

Reinicia Claude Code y pídele, por ejemplo:

> "Hazme un utilitario que lea un xlsx y lo mande a una API, que corra en su venv."

Debe activarse la skill `python-utilitario` y generar la carpeta completa.

## Cuando ozali se libere

Ya no hará falta copiar nada a mano:

```bash
npx ozali install-skill python-utilitario     # o: ozali install-skill --python
```

Opciones: `--scope project|global` (global por defecto) y `--agent claude-code|opencode|both`.
