// patch.mjs — mejoras de campo a la skill cdk: marcar, capturar y proponer (contrato v12, §3 de las notas).
// Las mejoras nacen en los repos de uso, pero los archivos de cdk los GENERA ozali. Un bloque marcado
//   <!-- ozali:local-patch id=<slug> autor=@x fecha=YYYY-MM-DD -->  …  <!-- /ozali:local-patch -->
// es una edición manual deliberada: la migración del contrato la conserva (nunca la borra en silencio) y
// `ozali patch capture` la convierte en una propuesta revisable. NADA entra a las plantillas sin revisión
// humana: `submit` abre un PR contra `develop` (nunca `main`) y es dry-run salvo `--yes`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  c, ok, warn, err, info, exists, ensureDir, readJSON, tryExec, spawnCmd, which, PKG_ROOT,
} from "./util.mjs";

const OPEN_RE = /^\s*<!--\s*ozali:local-patch\s+(.*?)\s*-->\s*$/;
const CLOSE_RE = /^\s*<!--\s*\/ozali:local-patch\s*-->\s*$/;
export const PATCH_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const PENDIENTE = "⚠️ COMPLETAR";

/** `k=v` y `k="v con espacios"` → objeto. */
export function parseMarkerAttrs(s) {
  const out = {};
  const re = /([a-zA-Z_][\w-]*)=(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

/**
 * Bloques local-patch de un texto (por líneas). Devuelve `{ blocks, errors }`; cada bloque trae su
 * `id`, atributos, y los índices (0-based) de la línea de apertura y de cierre. Anidados o sin cerrar
 * van a `errors` y no se tratan como bloques (ante la duda, no se toca).
 */
export function parseLocalPatches(text) {
  const lines = text.split("\n");
  const blocks = [];
  const errors = [];
  let cur = null;
  lines.forEach((ln, i) => {
    const o = OPEN_RE.exec(ln);
    if (o) {
      if (cur) { errors.push(`línea ${i + 1}: local-patch anidado dentro del de la línea ${cur.start + 1}`); return; }
      const attrs = parseMarkerAttrs(o[1]);
      cur = { id: attrs.id || null, attrs, start: i, end: -1 };
      return;
    }
    if (CLOSE_RE.test(ln)) {
      if (!cur) { errors.push(`línea ${i + 1}: cierre de local-patch sin apertura`); return; }
      cur.end = i;
      blocks.push(cur);
      cur = null;
    }
  });
  if (cur) errors.push(`línea ${cur.start + 1}: local-patch sin cerrar`);
  return { blocks, errors };
}

/** Archivos generados de cdk donde puede haber parches locales (relativos a la raíz). */
export function patchableFiles(root) {
  const out = [];
  const add = (rel) => { if (exists(path.join(root, rel))) out.push(rel); };
  add(".claude/skills/cdk/SKILL.md");
  add(".opencode/skills/cdk/SKILL.md");
  for (const dir of [".claude/agents", ".opencode/agents"]) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".md")).sort(); } catch { /* sin carpeta */ }
    for (const n of names) out.push(`${dir}/${n}`);
  }
  return out;
}

/** Todos los parches locales del repo: `[{ file, id, attrs, start, end, lines }]` + errores por archivo. */
export function scanLocalPatches(root) {
  const patches = [];
  const errors = [];
  for (const file of patchableFiles(root)) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), "utf8"); } catch { continue; }
    const { blocks, errors: errs } = parseLocalPatches(text);
    const lines = text.split("\n");
    for (const b of blocks) patches.push({ file, ...b, lines: lines.slice(b.start, b.end + 1) });
    for (const e of errs) errors.push(`${file}: ${e}`);
  }
  return { patches, errors };
}

/**
 * diff.patch de un parche: inserciones del bloque (marcadores incluidos) sobre el archivo SIN ningún
 * bloque local-patch (aproxima la plantilla oficial), con 3 líneas de contexto. Aplicable con `git apply`.
 */
export function buildInsertionDiff(file, text, id) {
  const lines = text.split("\n");
  const { blocks } = parseLocalPatches(text);
  const drop = new Set();
  for (const b of blocks) for (let i = b.start; i <= b.end; i++) drop.add(i);
  const base = lines.filter((_, i) => !drop.has(i));
  const mine = blocks.filter((b) => b.id === id);
  let out = "";
  let inserted = 0;
  for (const b of mine) {
    // posición en `base` = líneas que no son de ningún bloque y están antes de este
    let at = 0;
    for (let i = 0; i < b.start; i++) if (!drop.has(i)) at++;
    const ctxStart = Math.max(0, at - 3);
    const before = base.slice(ctxStart, at);
    const after = base.slice(at, at + 3);
    const body = lines.slice(b.start, b.end + 1);
    const oldCount = before.length + after.length;
    const oldStart = oldCount === 0 ? 0 : ctxStart + 1;
    const newStart = oldCount === 0 ? 1 : oldStart + inserted;
    out += `@@ -${oldStart},${oldCount} +${newStart},${oldCount + body.length} @@\n`;
    out += before.map((l) => " " + l + "\n").join("");
    out += body.map((l) => "+" + l + "\n").join("");
    out += after.map((l) => " " + l + "\n").join("");
    inserted += body.length;
  }
  return out ? `--- a/${file}\n+++ b/${file}\n${out}` : "";
}

/** Agrega `rechazada="motivo"` a las aperturas de un id (el bloque se queda local, con el motivo). */
export function markRejected(text, id, motivo) {
  const clean = String(motivo).replace(/["\r\n]+/g, " ").trim();
  return text.split("\n").map((ln) => {
    const o = OPEN_RE.exec(ln);
    if (!o) return ln;
    const attrs = parseMarkerAttrs(o[1]);
    if (attrs.id !== id) return ln;
    const rest = o[1].replace(/\s*rechazada=(?:"[^"]*"|\S+)/, "");
    return `<!-- ozali:local-patch ${rest} rechazada="${clean}" -->`;
  }).join("\n");
}

function cdkContractOf(root) {
  for (const f of [".claude/skills/cdk/SKILL.md", ".opencode/skills/cdk/SKILL.md"]) {
    try {
      const m = /cdk_contract_version:\s*(\d+)/.exec(fs.readFileSync(path.join(root, f), "utf8"));
      if (m) return m[1];
    } catch { /* siguiente */ }
  }
  return null;
}

/** PROPUESTA.md: motivación, hito de origen, evidencia e impacto en el contrato (lo que revisa la persona). */
export function buildProposalMd({ id, patches, hito, motivo, contrato, project }) {
  const files = [...new Set(patches.map((p) => p.file))];
  const autor = patches.map((p) => p.attrs.autor).find(Boolean) || PENDIENTE;
  const fecha = patches.map((p) => p.attrs.fecha).find(Boolean) || PENDIENTE;
  return `# Propuesta \`${id}\`

- **Autor:** ${autor}
- **Fecha del parche:** ${fecha}
- **Proyecto de origen:** ${project || PENDIENTE}
- **Hito de origen:** ${hito || PENDIENTE}
- **Contrato cdk del repo de origen:** ${contrato ? "v" + contrato : PENDIENTE}
- **Archivos afectados:** ${files.map((f) => "`" + f + "`").join(", ")}

## Motivación
${motivo || `${PENDIENTE}: qué problema real resolvió en el hito y por qué aplica más allá de este repo.`}

## Evidencia
- Tests / walkthrough del hito: ${PENDIENTE}
- Ranking de \`sette_bitacora_reporte\` (perfiles más usados o con más fallos), si hay: ${PENDIENTE}

## Impacto en el contrato
- [ ] Aplica a todos los proyectos (no solo a este)
- [ ] No rompe el contrato (si lo rompe: exige subir la versión \`cdk vN\`)
- [ ] Tiene tests de plantillas
- [ ] Degrada bien si falta la dependencia (p. ej. sette-mcp)

## Cambio
Ver \`diff.patch\` (inserciones sobre el archivo generado sin parches locales; los marcadores
\`ozali:local-patch\` desaparecen cuando la propuesta se integra a la plantilla oficial).
`;
}

/** `owner/repo` del paquete (package.json → repository.url). */
export function ozaliRepoSlug() {
  const pkg = readJSON(path.join(PKG_ROOT, "package.json"), {});
  const url = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository && pkg.repository.url) || "";
  const m = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
  return m ? m[1] : null;
}

function groupById(patches) {
  const byId = new Map();
  for (const p of patches) {
    if (!p.id) continue;
    if (!byId.has(p.id)) byId.set(p.id, []);
    byId.get(p.id).push(p);
  }
  return byId;
}

export function proposalsDir(root) { return path.join(root, ".ozali", "proposals"); }

/** Resumen para `ozali doctor`: cuántos parches locales hay (y cuántos rechazados). */
export function localPatchSummary(root) {
  const { patches, errors } = scanLocalPatches(root);
  const ids = new Set(patches.map((p) => p.id || "(sin id)"));
  return { total: patches.length, ids: [...ids], rejected: patches.filter((p) => p.attrs.rechazada).length, errors };
}

/** Raíz del repo (la skill cdk vive ahí aunque se invoque desde una subcarpeta); cwd si no hay git. */
export function patchRoot(cwd) {
  return tryExec("git", ["rev-parse", "--show-toplevel"], { cwd }) || cwd;
}

export async function patchCmd(cwd, opts = {}) {
  const root = patchRoot(cwd);
  const [, sub, ...extra] = opts._;
  if (sub === "list" && extra.length === 0) return patchList(root);
  if (sub === "capture" && extra.length <= 1) return patchCapture(root, extra[0] || opts.id, opts);
  if (sub === "reject" && extra.length <= 1) return patchReject(root, extra[0] || opts.id, opts);
  if (sub === "submit" && extra.length === 1) return patchSubmit(root, extra[0], opts);
  err("uso: ozali patch list | capture [<id>] [--hito <slug>] [--motivo <texto>] [--force] | reject <id> --motivo <texto> | submit <id> [--pr] [--repo owner/repo] [--base develop] [--yes]");
  return 1;
}

function patchList(root) {
  const { patches, errors } = scanLocalPatches(root);
  for (const e of errors) warn(e);
  if (!patches.length) { info("No hay parches locales (ozali:local-patch) en los archivos generados de cdk."); return errors.length ? 1 : 0; }
  for (const [id, ps] of groupById(patches)) {
    const a = ps[0].attrs;
    const estado = a.rechazada ? c.red(`rechazada: ${a.rechazada}`) : exists(path.join(proposalsDir(root), id)) ? c.green("capturada") : c.yellow("sin capturar");
    console.log(`${c.bold(id)}  ${c.dim(`autor=${a.autor || "?"} fecha=${a.fecha || "?"}`)}  [${estado}]`);
    for (const p of ps) console.log(`  ${p.file}:${p.start + 1}-${p.end + 1}`);
  }
  const sinId = patches.filter((p) => !p.id);
  for (const p of sinId) warn(`${p.file}:${p.start + 1}: local-patch sin id (no se puede capturar).`);
  return errors.length || sinId.length ? 1 : 0;
}

function patchCapture(root, onlyId, opts) {
  if (onlyId && !PATCH_ID_RE.test(onlyId)) { err(`patch capture: id inválido "${onlyId}" (a-z, 0-9 y guiones).`); return 1; }
  const { patches, errors } = scanLocalPatches(root);
  for (const e of errors) warn(e);
  const groups = groupById(patches);
  const ids = onlyId ? [onlyId] : [...groups.keys()];
  if (onlyId && !groups.has(onlyId)) { err(`patch capture: no hay un local-patch con id "${onlyId}". Usa ozali patch list.`); return 1; }
  if (!ids.length) { info("Nada que capturar: no hay parches locales."); return 0; }
  let code = 0;
  for (const id of ids) {
    if (!PATCH_ID_RE.test(id)) { warn(`id inválido "${id}": se omite.`); code = 1; continue; }
    const ps = groups.get(id);
    const rej = ps.map((p) => p.attrs.rechazada).find(Boolean);
    if (rej && !opts.force) { warn(`${id}: fue rechazada ("${rej}"); se queda local. Usa --force para capturarla de nuevo.`); continue; }
    const dir = path.join(proposalsDir(root), id);
    ensureDir(dir);
    let diff = "";
    for (const file of [...new Set(ps.map((p) => p.file))]) {
      diff += buildInsertionDiff(file, fs.readFileSync(path.join(root, file), "utf8"), id);
    }
    fs.writeFileSync(path.join(dir, "diff.patch"), diff);
    const mdPath = path.join(dir, "PROPUESTA.md");
    if (exists(mdPath) && !opts.force) {
      info(`${id}: diff.patch actualizado; PROPUESTA.md ya existe (se conserva, usa --force para regenerarla).`);
    } else {
      const project = (readJSON(path.join(root, ".ozali", "config.json"), {}) || {}).project;
      fs.writeFileSync(mdPath, buildProposalMd({ id, patches: ps, hito: opts.hito, motivo: opts.motivo, contrato: cdkContractOf(root), project }));
      ok(`${id}: propuesta en ${c.bold(path.relative(root, dir))}/ (diff.patch + PROPUESTA.md).`);
    }
    const pend = fs.readFileSync(mdPath, "utf8").includes(PENDIENTE);
    if (pend) info(`${id}: completa los campos "${PENDIENTE}" de PROPUESTA.md antes de ozali patch submit.`);
  }
  return code;
}

function patchReject(root, id, opts) {
  if (!id || !PATCH_ID_RE.test(id)) { err("patch reject: <id> requerido (a-z, 0-9 y guiones)."); return 1; }
  if (!opts.motivo || !String(opts.motivo).trim()) { err("patch reject: --motivo requerido (queda en el marcador)."); return 1; }
  const { patches } = scanLocalPatches(root);
  const files = [...new Set(patches.filter((p) => p.id === id).map((p) => p.file))];
  if (!files.length) { err(`patch reject: no hay un local-patch con id "${id}".`); return 1; }
  for (const f of files) {
    const p = path.join(root, f);
    fs.writeFileSync(p, markRejected(fs.readFileSync(p, "utf8"), id, opts.motivo));
  }
  ok(`${id}: marcada como rechazada en ${files.length} archivo(s); el bloque se queda local con el motivo.`);
  return 0;
}

const REVIEW_CHECKLIST = `
---
**Checklist del revisor**
- [ ] ¿Aplica a todos los proyectos o es local?
- [ ] ¿Rompe el contrato o exige subir la versión (\`cdk vN\`)?
- [ ] ¿Hay tests de plantillas?
- [ ] ¿Hay degradación si falta la dependencia (p. ej. sette-mcp)?
`;

/** Marcador que el workflow de triage busca para etiquetar el issue aunque quien lo abre no pueda poner etiquetas. */
export const PROPOSAL_MARKER = (id) => `<!-- ozali:proposal id=${id} -->`;
const BODY_MAX = 60000; // GitHub corta en 65 536 caracteres

/** Cuerpo del issue/PR: marcador + PROPUESTA.md + diff (cerco de 4 backticks por si el diff trae ```) + checklist. */
export function buildProposalBody(id, md, diff) {
  const head = `${PROPOSAL_MARKER(id)}\n${md}\n`;
  const tail = `${REVIEW_CHECKLIST}`;
  let d = diff;
  const room = BODY_MAX - head.length - tail.length - 200;
  if (d.length > room) d = d.slice(0, Math.max(0, room)) + "\n… (diff truncado; el completo está en .ozali/proposals/" + id + "/diff.patch)\n";
  return `${head}\n<details><summary>diff.patch</summary>\n\n\`\`\`\`diff\n${d}\`\`\`\`\n\n</details>\n${tail}`;
}

function patchSubmit(root, id, opts) {
  if (!PATCH_ID_RE.test(id)) { err(`patch submit: id inválido "${id}".`); return 1; }
  const dir = path.join(proposalsDir(root), id);
  const mdPath = path.join(dir, "PROPUESTA.md");
  if (!exists(path.join(dir, "diff.patch")) || !exists(mdPath)) { err(`patch submit: no hay propuesta capturada. Corre ${c.bold(`ozali patch capture ${id}`)} primero.`); return 1; }
  const md = fs.readFileSync(mdPath, "utf8");
  if (md.includes(PENDIENTE) && !opts.force) { err(`patch submit: PROPUESTA.md aún tiene campos "${PENDIENTE}". Complétalos (o usa --force).`); return 1; }
  const repo = opts.repo || ozaliRepoSlug();
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { err("patch submit: no pude resolver el repo de ozali (usa --repo owner/repo)."); return 1; }
  const asPR = Boolean(opts.pr);
  const base = opts.base || "develop";
  if (asPR && (base === "main" || base === "master")) { err("patch submit: las propuestas nunca van a main; la base es develop."); return 1; }
  const head = `proposal/${id}`;
  const title = `proposal(${id}): mejora de campo`;
  const body = buildProposalBody(id, md, fs.readFileSync(path.join(dir, "diff.patch"), "utf8"));

  console.log(`${c.bold("Propuesta:")} ${id}\n  modo:  ${asPR ? "pull request (con tu implementación)" : "issue (petición de mejora; el maintainer la acepta y la desarrolla)"}\n  repo:  ${repo}`);
  if (asPR) console.log(`  base:  ${base}\n  rama:  ${head}\n  ruta:  docs/proposals/${id}/ (PROPUESTA.md + diff.patch)`);
  console.log("  label: from-field (el workflow de triage también la pone)");
  if (!opts.yes) {
    console.log(`\n${c.dim("──── cuerpo que se publicaría ────")}\n${body}${c.dim("──── fin ────")}`);
    warn(`Esto se publica en ${repo}: incluye el nombre del proyecto, el hito y el contenido del parche. Si el repo es público, lo verá cualquiera. Revisa que no haya nada interno.`);
    info("dry-run: no se publicó nada. Repite con --yes para enviarlo (es una acción saliente).");
    return 0;
  }

  if (!which("gh")) { err("patch submit: requiere GitHub CLI (`gh`) autenticado."); return 1; }
  if (tryExec("gh", ["auth", "status"]) === null) { err("patch submit: `gh` no está autenticado (gh auth login)."); return 1; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-proposal-"));
  try {
    const bodyFile = path.join(tmp, "body.md");
    fs.writeFileSync(bodyFile, body);
    if (!asPR) {
      const args = ["issue", "create", "--repo", repo, "--title", title, "--body-file", bodyFile];
      let rc = spawnCmd("gh", [...args, "--label", "from-field"]);
      // Sin permiso de triage la etiqueta no se puede aplicar: se reintenta sin ella (el workflow la pone).
      if (rc !== 0) { warn("No se pudo aplicar la etiqueta from-field; reintento sin etiqueta (el workflow de triage la agrega)."); rc = spawnCmd("gh", args); }
      if (rc !== 0) { err("patch submit: no se pudo abrir el issue."); return 1; }
      ok(`Petición enviada a ${repo}. El maintainer la revisará (aceptada → milestone de release).`);
      return 0;
    }

    if (tryExec("gh", ["api", `repos/${repo}/branches/${base}`, "--jq", ".name"]) === null) {
      err(`patch submit: la rama base "${base}" no existe en ${repo} (o no hay acceso). Nunca se propone a main.`);
      return 1;
    }
    const clone = path.join(tmp, "repo");
    if (spawnCmd("gh", ["repo", "clone", repo, clone, "--", "--depth", "1", "--branch", base]) !== 0) { err("patch submit: no se pudo clonar el repo."); return 1; }
    const git = (...a) => spawnCmd("git", a, { cwd: clone });
    if (git("checkout", "-b", head) !== 0) return 1;
    const dest = path.join(clone, "docs", "proposals", id);
    ensureDir(dest);
    for (const f of ["PROPUESTA.md", "diff.patch"]) fs.copyFileSync(path.join(dir, f), path.join(dest, f));
    if (git("add", "docs/proposals") !== 0) return 1;
    if (git("commit", "-q", "-m", `proposal(${id}): mejora de campo para revisión`) !== 0) return 1;

    // ¿Escritura directa o fork? Un usuario externo no puede hacer push al repo de ozali.
    const canPush = tryExec("gh", ["api", `repos/${repo}`, "--jq", ".permissions.push"]) === "true";
    let prHead = head;
    let remote = "origin";
    if (!canPush) {
      const me = tryExec("gh", ["api", "user", "--jq", ".login"]);
      if (!me) { err("patch submit: no pude resolver tu usuario de GitHub para el fork."); return 1; }
      info("Sin permiso de escritura en el repo: uso un fork de tu cuenta.");
      if (spawnCmd("gh", ["repo", "fork", repo, "--remote", "--remote-name", "fork"], { cwd: clone }) !== 0) { err("patch submit: no se pudo crear/usar el fork."); return 1; }
      remote = "fork";
      prHead = `${me}:${head}`;
    }
    if (git("push", "-u", remote, head) !== 0) { err("patch submit: no se pudo hacer push de la rama."); return 1; }
    const prArgs = ["pr", "create", "--repo", repo, "--base", base, "--head", prHead, "--title", title, "--body-file", bodyFile];
    let rc = spawnCmd("gh", [...prArgs, "--label", "from-field"]);
    if (rc !== 0) { warn("No se pudo aplicar la etiqueta from-field; reintento sin etiqueta."); rc = spawnCmd("gh", prArgs); }
    if (rc !== 0) { err("patch submit: no se pudo abrir el PR."); return 1; }
    ok(`PR abierto contra ${repo}@${base}. Lo revisa el CODEOWNER.`);
    return 0;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
