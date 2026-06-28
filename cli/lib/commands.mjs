// commands.mjs — implementación de init / doctor / update / sync.
import fs from "node:fs";
import path from "node:path";
import {
  c, ok, warn, err, info, step,
  SKILL_SRC, exists, ensureDir, copyDir, readJSON, writeJSON,
  ensureGitignore, tryExec, projectName, pkgVersion, DEFAULT_KNOWLEDGE,
} from "./util.mjs";
import { detectAll } from "./detect.mjs";
import { ask, confirm, select } from "./prompt.mjs";

const CONFIG_PATH = (cwd) => path.join(cwd, ".ozali", "config.json");

function skillTarget(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".claude") : path.join(cwd, ".claude");
  return path.join(base, "skills", "ozali");
}

// ============================================================ init ===========
export async function init(cwd, opts) {
  step("ozali init — bootstrap del proyecto");
  const env = detectAll(cwd);

  if (!env.node.ok) warn(`Node ${env.node.version} detectado; ozali y el harness piden ≥16. Continúo, pero actualiza si ves errores.`);
  if (!env.git.isRepo) warn("No estás en un repo git: la trazabilidad por commit y el sync quedarán limitados.");

  // Fuente de verdad
  if (env.sot.found) ok(`Fuente de verdad detectada: ${c.bold(env.sot.doc)} + ${c.bold(env.sot.dir + "/")} (variante ${env.sot.variant}).`);
  else info(`Sin fuente de verdad aún (se generará al correr la skill 'ozali' en tu agente).`);

  // Agente
  const agentDefault = env.agents.opencode.present && !env.agents.claudeCode.present ? "opencode"
    : env.agents.claudeCode.present && env.agents.opencode.present ? "both" : "claude-code";
  const agent = opts.agent || await select("¿Para qué agente configuro ozali?", [
    { value: "claude-code", label: "Claude Code" },
    { value: "opencode", label: "opencode" },
    { value: "both", label: "Ambos (Claude Code + opencode)" },
  ], { "claude-code": 0, opencode: 1, both: 2 }[agentDefault]);

  // Scope
  const scope = opts.scope || await select("¿Dónde instalo la skill?", [
    { value: "project", label: `Proyecto (${c.dim(".claude/skills/ozali")})` },
    { value: "global", label: `Global (${c.dim("~/.claude/skills/ozali")})` },
  ], 0);

  // Repo de conocimiento (histórico aislado)
  const knowledgeRepo = opts.knowledgeRepo || await ask("Ruta del repo de conocimiento (histórico aislado)", DEFAULT_KNOWLEDGE);

  // Engram
  let memoryMode = "hybrid";
  if (env.engram.available) {
    ok(`Engram disponible (${env.engram.bin}). Modo de memoria: ${c.bold("hybrid")} (docs + Engram).`);
  } else {
    memoryMode = "docs";
    warn("Engram no está instalado. Arrancamos en modo " + c.bold("docs") + " (solo documentos legibles).");
    info("Para activar memoria buscable/acumulativa instala Engram: " + c.cyan("https://github.com/Gentleman-Programming/engram"));
    info("Tras instalarlo, vuelve a correr " + c.bold("ozali doctor") + " — el modo subirá a hybrid automáticamente.");
  }

  if (opts.dryRun) { warn("--dry-run: no escribo nada. Plan mostrado arriba."); return 0; }

  // --- acciones ---
  step("Aplicando");
  // 1) copiar skill
  const target = skillTarget(cwd, scope);
  ensureDir(path.dirname(target));
  copyDir(SKILL_SRC, target);
  ok(`Skill instalada en ${c.bold(path.relative(cwd, target) || target)}.`);

  // 2) opencode: perfil base de permisos (idempotente, merge mínimo)
  if (agent === "opencode" || agent === "both") {
    ensureOpencodeProfile(cwd);
  }

  // 3) gitignore del histórico aislado
  if (env.git.isRepo) {
    const { added } = ensureGitignore(cwd, [".ozali/", ".engram/"]);
    if (added.length) ok(`.gitignore actualizado: ${added.join(", ")} (histórico aislado del repo principal).`);
    else info(".gitignore ya aislaba el histórico.");
  }

  // 4) repo de conocimiento
  ensureDir(knowledgeRepo);
  if (!exists(path.join(knowledgeRepo, ".git"))) {
    if (await confirm(`¿Inicializo git en el repo de conocimiento (${knowledgeRepo})?`, true)) {
      tryExec("git", ["init", "-q"], { cwd: knowledgeRepo });
      ensureDir(path.join(knowledgeRepo, "projects"));
      ensureDir(path.join(knowledgeRepo, "engram"));
      ok("Repo de conocimiento inicializado.");
    }
  } else info("Repo de conocimiento ya existe.");

  // 5) config local (gitignored)
  const config = {
    version: pkgVersion(), agent, scope, knowledgeRepo, memoryMode,
    project: projectName(cwd), createdAt: new Date().toISOString(),
  };
  writeJSON(CONFIG_PATH(cwd), config);
  ok(`Config local escrita en ${c.bold(".ozali/config.json")} (gitignored).`);

  // --- siguientes pasos ---
  step("Siguientes pasos");
  console.log(`  1. Abre tu agente en este proyecto.`);
  console.log(`  2. Escribe ${c.bold('"diagnostica el proyecto"')} o ${c.bold('"ozali"')} para arrancar el bootstrap (calibración + generación de la skill ${c.bold("cdk")}).`);
  console.log(`  3. Tras trabajar, corre ${c.bold("ozali sync")} para llevar el histórico al repo de conocimiento.`);
  console.log(`  ${c.dim("Salud en cualquier momento:")} ${c.bold("ozali doctor")}`);
  return 0;
}

function ensureOpencodeProfile(cwd) {
  const p = path.join(cwd, "opencode.json");
  const base = readJSON(p, {});
  base["$schema"] = base["$schema"] || "https://opencode.ai/config.json";
  base.permission = base.permission || {};
  const perm = base.permission;
  // Perfil base modo normal: lectura+comandos+fetch libres, ediciones confirman.
  for (const [k, v] of Object.entries({ read: "allow", grep: "allow", glob: "allow", webfetch: "allow", external_directory: "ask", edit: "ask" })) {
    if (perm[k] === undefined) perm[k] = v;
  }
  if (perm.bash === undefined) perm.bash = { "*": "allow", "rm -rf *": "ask", "git push *": "ask" };
  writeJSON(p, base);
  ok(`Perfil base de permisos de opencode en ${c.bold("opencode.json")} (lectura+comandos libres, ediciones confirman).`);
}

// =========================================================== doctor ==========
export function doctor(cwd) {
  step("ozali doctor — health-check (read-only)");
  const env = detectAll(cwd);
  const cfg = readJSON(CONFIG_PATH(cwd));
  const rows = [];
  const add = (label, good, detail) => rows.push({ label, good, detail });

  add("Repo git", env.git.isRepo, env.git.isRepo ? (env.git.commit ? `${env.git.branch}@${env.git.commit}` : "repo sin commits") : "no es repo git");
  add("Node ≥ 16", env.node.ok, env.node.version);
  add("Fuente de verdad", env.sot.found, env.sot.found ? `${env.sot.doc} + ${env.sot.dir}/` : "ausente (corre la skill 'ozali')");
  add("Skill ozali instalada", env.skill.installed, env.skill.installed ? env.skill.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init)");
  add("Engram", env.engram.available, env.engram.available ? env.engram.bin : "no instalado → modo docs");
  add("Repo de conocimiento", !!(cfg && cfg.knowledgeRepo && exists(cfg.knowledgeRepo)), cfg ? cfg.knowledgeRepo : "sin configurar (ozali init)");

  // Strict TDD (de la fuente de verdad)
  const tdd = readStrictTdd(cwd, env.sot);
  add("Strict TDD calibrado", tdd.found, tdd.found ? `strict_tdd: ${tdd.value}` : "sin calibrar (Fase 3.5 del bootstrap)");

  // Testing signals
  add("Runner de pruebas", env.testing.runners.length > 0, env.testing.runners.join(", ") || "ninguno detectado");

  const pad = Math.max(...rows.map((r) => r.label.length));
  console.log("");
  for (const r of rows) {
    const mark = r.good ? c.green("✔") : c.yellow("✖");
    console.log(`  ${mark} ${r.label.padEnd(pad)}  ${c.dim(r.detail)}`);
  }
  const bad = rows.filter((r) => !r.good).length;
  console.log("");
  if (bad === 0) ok("Todo en orden. ozali está listo para trabajar.");
  else warn(`${bad} punto(s) a atender. Revisa los ✖ de arriba.`);
  return bad === 0 ? 0 : 1;
}

function readStrictTdd(cwd, sot) {
  const f = path.join(cwd, sot.dir, "context", "tech-stack.md");
  if (!exists(f)) return { found: false };
  const txt = fs.readFileSync(f, "utf8");
  const m = txt.match(/Strict\s*TDD[:*\s]+(true|false)/i);
  return m ? { found: true, value: m[1].toLowerCase() } : { found: false };
}

// =========================================================== update ==========
export function update(cwd) {
  step("ozali update — actualizar skill instalada");
  const env = detectAll(cwd);
  if (!env.skill.installed) { warn("No hay skill ozali instalada. Corre " + c.bold("ozali init") + " primero."); return 1; }
  for (const p of env.skill.paths) {
    copyDir(SKILL_SRC, p);
    ok(`Actualizada: ${path.relative(cwd, p) || p} → v${pkgVersion()}`);
  }
  const cfgPath = CONFIG_PATH(cwd);
  const cfg = readJSON(cfgPath);
  if (cfg) { cfg.version = pkgVersion(); cfg.updatedAt = new Date().toISOString(); writeJSON(cfgPath, cfg); }
  return 0;
}

// ============================================================= sync ===========
export function sync(cwd, opts) {
  step(`ozali sync${opts.import ? " --import" : ""} — histórico ↔ repo de conocimiento`);
  const cfg = readJSON(CONFIG_PATH(cwd));
  if (!cfg || !cfg.knowledgeRepo) { warn("Sin repo de conocimiento configurado. Corre " + c.bold("ozali init") + "."); return 1; }
  const kRepo = cfg.knowledgeRepo;
  if (!exists(kRepo)) { err(`El repo de conocimiento no existe: ${kRepo}`); return 1; }
  const project = cfg.project || projectName(cwd);
  const projDir = path.join(kRepo, "projects", project);
  const docsLocal = path.join(cwd, ".ozali", "docs");
  const engramLocal = path.join(cwd, ".engram");

  if (opts.import) {
    // Repo de conocimiento → local
    const srcDocs = path.join(projDir, "docs");
    if (exists(srcDocs)) { copyDir(srcDocs, docsLocal); ok("Docs importados a .ozali/docs/."); }
    if (cfg.memoryMode === "hybrid" && tryExec("engram", ["--version"])) {
      info("Ejecutando engram sync --import…");
      tryExec("engram", ["sync", "--import"], { cwd });
    }
    info("Import completo. Revisa .ozali/docs/.");
    return 0;
  }

  // Local → repo de conocimiento
  // 1) Engram export (si hybrid + disponible)
  if (cfg.memoryMode === "hybrid" && tryExec("engram", ["--version"])) {
    info("Exportando memorias con engram sync…");
    tryExec("engram", ["sync"], { cwd });
    if (exists(engramLocal)) { copyDir(engramLocal, path.join(kRepo, "engram", project)); ok("Export de Engram copiado al repo de conocimiento."); }
  } else if (cfg.memoryMode === "hybrid") {
    warn("Modo hybrid pero Engram no responde; sincronizo solo docs.");
  }
  // 2) Docs
  if (exists(docsLocal)) { copyDir(docsLocal, path.join(projDir, "docs")); ok(`Docs copiados a projects/${project}/docs/.`); }
  else info("No hay .ozali/docs/ que sincronizar todavía.");

  // 3) commit (push solo si hay remoto)
  if (exists(path.join(kRepo, ".git"))) {
    tryExec("git", ["add", "-A"], { cwd: kRepo });
    const msg = `sync(${project}): histórico ${new Date().toISOString().slice(0, 19)}`;
    tryExec("git", ["commit", "-m", msg], { cwd: kRepo });
    ok("Commit en el repo de conocimiento.");
    const remote = tryExec("git", ["remote", "get-url", "origin"], { cwd: kRepo });
    if (remote) {
      if (opts.push) { tryExec("git", ["push"], { cwd: kRepo }); ok("Push realizado."); }
      else info("Hay remoto configurado. Usa " + c.bold("ozali sync --push") + " para publicar al equipo.");
    } else {
      info("Sin remoto en el repo de conocimiento. Añade uno (git remote add origin …) para compartir con el equipo.");
    }
  }
  return 0;
}
