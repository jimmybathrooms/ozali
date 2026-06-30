# Histórico aislado y memoria de equipo

← [README](../README.md)

Objetivo: que el **histórico de documentación y memoria crezca sin sobrecargar el repo principal**
del proyecto, y que el conocimiento sea **compartible por el equipo**.

## Tres capas, tres destinos

| Capa | Qué es | Dónde vive | Por qué |
|---|---|---|---|
| **Cerebro** (fuente de verdad) | `.ai/` + `AI.md` | **repo principal** (commiteado) | son las reglas; chico, crece lento, debe viajar con el código |
| **Histórico** (docs) | docs por hito (6) + por corrida (3) | **repo de conocimiento aparte** (gitignored en el principal) | esto es lo que crece sin límite |
| **Memoria** (Engram) | chunks/manifest buscables | store local de Engram + export al repo de conocimiento | Engram ya aísla por defecto; solo el export `.engram/` necesita casa |

## Modelo recomendado: un repo de conocimiento de equipo

Un único repo `ozali-knowledge` guarda el histórico de **todos** los proyectos (Engram y las
carpetas de docs ya son multi-proyecto por naming determinista):

```
ozali-knowledge/                 (repo GitHub aparte, compartido por el equipo)
  engram/                        ← export de Engram (multi-proyecto: chunks + manifest)
  projects/
    quattro-auto-api/
      runs/                      ← corridas de bootstrap de ozali (3 docs c/u)
      milestones/<hito>/         ← 6 docs por hito
    otro-proyecto/
      ...
```

El repo principal solo gana `.ai/` (cerebro) + las skills bajo `.claude/skills/`. Su `.gitignore`
excluye `.ozali/` y `.engram/`.

## Cómo lo cablea el CLI

- `ozali init` → detecta/clona el repo de conocimiento (default `~/.ozali/knowledge`), añade
  `.ozali/` y `.engram/` al `.gitignore` del repo principal, apunta el export de Engram ahí.
- `cdk` (durante el trabajo) → escribe docs en el repo de conocimiento, no en el working tree
  del repo principal.
- `ozali sync` → commit + push del repo de conocimiento; el equipo hace pull para compartir.

## Trazabilidad (enlace código ↔ histórico)

Cada documento lleva en su encabezado: autor, rama, **commit SHA del repo principal**, proyecto y
fecha/hora (Fase 0 de `ozali`). Así, desde un commit encuentras su histórico y cada entrada del
histórico apunta a un commit exacto.

## Opciones del enlace físico (rankeadas)

1. **Gitignore + clon aparte gestionado por el CLI (RECOMENDADO).** Modelo mental simple, sin
   dolor de submódulos. El histórico nunca pesa en el repo principal. El enlace es por SHA en el
   header (no forzado por git) — aceptable.
2. **Worktree de una rama huérfana** (`ozali-history`) en el mismo remoto, montada en `.ozali/`
   (gitignored en main). Un solo remoto; el histórico nunca ensucia los diffs de main. El
   object-DB crece pero el checkout queda liviano. Ideal si NO quieren un segundo repo.
3. **Submódulo git.** Acoplamiento estricto (pin por commit) pero con fricción (clone recursivo,
   detached HEAD). Solo si quieren pin forzado.
4. **Store externo no-git** (S3/Notion/drive). Desacopla del todo pero pierde auditoría git; más
   infra. No recomendado.

> Engram aporta además el `engram sync` / `engram sync --import` ya probado: lo retargeteamos al
> repo de conocimiento en lugar del repo principal.

El contrato concreto de qué se espeja a Engram, cuándo, y el algoritmo de `ozali sync` está en
[skill/references/engram-convention.md](../skill/references/engram-convention.md) (§3 y §6).

## Engram Cloud: réplica en tiempo real (opt-in)

Además del git-sync, ozali soporta **Engram Cloud** — un servidor central que replica la memoria
del equipo **en tiempo real** (autosync), sin necesidad de commit/push manual.

### Modelo: cloud-first, git-sync como backup

```
dev A guarda memoria → autosync → cloud → dev B (autosync recibe)
                                ↕
                    git-sync (backup/secondary, repos de conocimiento)
```

- **Cloud-first**: la réplica es automática e invisible. El repo de conocimiento sigue siendo
  el backup offline y el canal para docs (que no van a cloud).
- **Sin cloud**: todo funciona igual con git-sync manual (`ozali sync` + `--push`/`--import`).

### Onboarding de equipo (un dev nuevo en 1 paso)

Cuando un dev nuevo hace `ozali init` en un repo que ya tiene `.ozali/cloud.json` (commiteable,
sin secretos), el CLI detecta la cloud del equipo y ofrece conectarse automáticamente:

```
$ ozali init
✓ Engram Cloud del equipo detectado (servidor: https://engram.mi-empresa.com)
  → Proyecto: "ozali"
  → ¿Conectarte a la memoria del equipo? [sí/no]
  → token: ****
  → Recibiendo memoria del equipo…
  → autosync activo (invisible)
  → Listo.
```

### Despliegue del servidor

Ver [docs/deploy-cloud-vps.md](deploy-cloud-vps.md) (VPS genérico con docker-compose) y
[docs/deploy-cloud-gcloud.md](deploy-cloud-gcloud.md) (Google Cloud: Cloud Run o GCE VM).

### Comandos cloud

| Comando | Qué hace |
|---|---|
| `ozali sync --cloud` | Push manual a cloud |
| `ozali sync --cloud --import` | Pull desde cloud (onboarding inverso) |
| `ozali cloud status` | Estado + último sync + upgrade |
| `ozali cloud upgrade` | doctor → repair → bootstrap |
| `ozali cloud dashboard` | Abre el dashboard web |
| `ozali cloud config` | Re-configura servidor/token |

Detalle del contrato de memoria cloud (scope, idioma, conflictos, troubleshooting) en
[skill/references/engram-convention.md](../skill/references/engram-convention.md) §8.
