# Integración con Obsidian

← [README](README.md)

Ozali puede exportar la memoria de equipo (Engram) y el histórico de hitos a un **vault de Obsidian**: un espacio navegable con wikilinks, grafo de conocimiento y Mapas de Contenido (MOCs).

## ¿Qué es el vault?

Es una carpeta `obsidian/` dentro de tu **repo de conocimiento** (`ozali-knowledge/` o `~/.ozali/knowledge/`). Contiene:

- **README.md** — índice humano del vault
- **MOCs/** — Mapas de Contenido auto-generados (proyectos, decisiones, bugfixes, métricas)
- **Memoria/** — exportación de Engram (decisiones, bugfixes, resúmenes técnicos)
- **.obsidian/** — configuración compartida del equipo (plugins core, hotkeys)

## Requisitos

- [Obsidian](https://obsidian.md) instalado (opt-in; ozali lo detecta y ofrece descargar)
- Engram instalado (`engram obsidian-export` es el motor de exportación)

## Uso

### Generar / actualizar el vault

```bash
# Desde cualquier proyecto ozali
ozali sync --obsidian
```

Esto:
1. Exporta Engram al vault (`engram obsidian-export`)
2. Actualiza los MOCs dinámicos (lista de proyectos, etc.)
3. Commit en el repo de conocimiento

### Sin el flag `--obsidian`

```bash
ozali sync
```

Si el vault ya existe, ozali pregunta: *"¿Exportar memoria a Obsidian vault?"*. Responde `sí` para actualizar.

### Abrir el vault en Obsidian

1. Abre Obsidian
2. Selecciona **"Open folder as vault"**
3. Navega a tu `ozali-knowledge/obsidian/` (o `~/.ozali/knowledge/obsidian/`)

### Estructura recomendada del repo de conocimiento

```
ozali-knowledge/
  .git/
  engram/              ← export chunks de Engram
  projects/
    {proyecto}/
      docs/            ← docs por hito
  obsidian/            ← 🆕 VAULT DE OBSIDIAN
    .obsidian/
    README.md
    MOCs/
    Memoria/
```

## Configuración compartida

La carpeta `.obsidian/` del vault **sí se commitea** en el repo de conocimiento. Contiene:
- Plugins core habilitados (graph, backlinks, quick switcher)
- Config de lectura (readable line length)

**No se commitean** settings personales: temas, snippets, `workspace.json`, notas `Daily/`.

## Flujo de trabajo típico

1. Trabajas en un hito con `cdk` → ozali genera docs en `.ozali/docs/`
2. `ozali sync` → lleva docs + Engram al repo de conocimiento
3. `ozali sync --obsidian` → regenera el vault con la memoria actualizada
4. Abres Obsidian → exploras el grafo, wikilinks, decisiones del equipo

## Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| `engram obsidian-export` falla | Vault abierto en Obsidian (lock de archivos) | Cierra el vault en Obsidian y reintenta |
| MOCs vacíos | Sin proyectos en `knowledgeRepo/projects/` | Corre `ozali sync` primero para crear la estructura |
| No se detecta Obsidian | Instalado en path no estándar | Ignora la advertencia; abre el vault manualmente |

## Cerebro vs Vault

- **Cerebro** (`AI.md` + `.ai/`) vive en **cada repo** — es la fuente de verdad.
- **Vault** (`obsidian/`) vive en el **repo de conocimiento** — es la lectura humana acumulada.

No duplicamos el cerebro en el vault. Los MOCs usan **markdown links** para referenciar `AI.md` fuera del vault, y **wikilinks** para todo lo que está dentro (`Memoria/`, `MOCs/`).
