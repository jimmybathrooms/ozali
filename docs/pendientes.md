# Pendientes

Backlog corto de cosas detectadas en uso real que todavía no se aplicaron. Cada entrada dice
**qué está mal hoy**, **qué hay que cambiar** y **cómo se verifica**. Al cerrarse, se borra la
entrada (el histórico queda en el commit).

---

## P-003 · El suite de tests escribe en el HOME real del desarrollador

**Relevancia:** Media · **Detectado:** 2026-09-15, al implementar A2 · **Estado:** abierto

### Qué está mal hoy

`cli/test/smoke.test.mjs` crea proyectos temporales con `tmpProject()`, pero **no aísla `HOME`**.
Varias rutas del CLI resuelven contra `process.env.HOME` (las de `scope === "global"`, la skill
global en `~/.claude/skills/ozali/`, `~/.claude/plugins/…`), así que correr `npm test` **modifica
la instalación global del desarrollador**.

Comprobado: tras un `npm test`, `~/.claude/skills/ozali/SKILL.md` y sus `references/` quedan con
`mtime` de la corrida. El contenido coincidía con el del repo, así que no hubo daño visible — pero
eso es suerte, no aislamiento: si el árbol de trabajo tiene cambios a medio hacer, el suite los
empuja al entorno real del desarrollador.

### Qué hay que cambiar

1. En `tmpProject()` (o en un `beforeEach`), apuntar `HOME` a un directorio temporal por test y
   restaurarlo al terminar. Ojo: el CLI se ejecuta con `execFileSync`, así que alcanza con pasar
   `env: { ...process.env, HOME: tmpHome }` en `run()`.
2. `cli/lib/util.mjs` exporta `HOME` como constante evaluada **al importar el módulo**; para los
   tests unitarios (no los que van por `execFileSync`) hay que seguir pasando `home` explícito,
   como ya hace `detectEngramMcpServer({ home })`.
3. Revisar si algún test depende hoy, sin querer, del HOME real para pasar.

### Cómo se verifica

```bash
touch -t 202001010000 ~/.claude/skills/ozali/SKILL.md
npm test
ls -la ~/.claude/skills/ozali/SKILL.md   # el mtime NO debe haber cambiado
```

### Referencias

- Apareció al correr el suite de A2; el aviso del harness lo delató
  (`modified 2 files you've previously read: ~/.claude/skills/ozali/references/calibration-blueprint.md`).
