// commands.mjs — implementación de init / doctor / update / sync.
import fs from "node:fs";
import path from "node:path";
import {
  c, ok, warn, err, info, step,
  SKILL_SRC, exists, ensureDir, copyDir, readJSON, writeJSON,
  ensureGitignore, tryExec, spawnCmd, which,
  projectName, pkgVersion, DEFAULT_KNOWLEDGE, HOME,
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
  let memoryMode = "docs";
  if (env.engram.available) {
    memoryMode = "hybrid";
    ok(`Engram disponible (${env.engram.bin}). Modo de memoria: ${c.bold("hybrid")} (docs + Engram).`);
  } else {
    warn("Engram no está instalado.");
    // Decisión de instalar: --no-engram/--dry-run nunca instalan; --yes usa el default (sí);
    // interactivo pregunta.
    if (opts.dryRun && !opts.noEngram) info("(dry-run) Aquí instalaría y configuraría Engram.");
    const installNow = (opts.noEngram || opts.dryRun) ? false
      : (opts.yes ? true : await confirm("¿Instalo y configuro Engram ahora?", true));
    if (installNow) {
      if (opts.yes) info("Modo no interactivo: instalando Engram automáticamente…");
      const installed = installEngram();
      if (installed) {
        if (agent === "claude-code" || agent === "both") {
          info("Registrando MCP en Claude Code…");
          spawnCmd("engram", ["setup", "claude-code"]);
        }
        if (agent === "opencode" || agent === "both") {
          info("Registrando MCP en opencode…");
          spawnCmd("engram", ["setup", "opencode"]);
        }
        memoryMode = "hybrid";
        ok("Engram listo. Modo de memoria: " + c.bold("hybrid") + ".");
        info("Reinicia tu agente para que cargue el servidor MCP de Engram.");
      } else {
        warn("Instalación no completada. Continúo en modo " + c.bold("docs") + ".");
        printEngramManualInstructions(agent);
      }
    } else {
      info("Modo " + c.bold("docs") + " activo. Cuando instales Engram, corre " + c.bold("ozali doctor") + " para activar hybrid.");
      printEngramManualInstructions(agent);
    }
  }

  // Engram Cloud (opt-in) — réplica de equipo además del git-sync. Solo si Engram quedó disponible.
  let cloud = { enabled: false };
  if (memoryMode === "hybrid" && !opts.dryRun) {
    cloud = await maybeEnableEngramCloud(projectName(cwd), opts);
  }

  if (opts.dryRun) { warn("--dry-run: no escribo nada. Plan mostrado arriba."); return 0; }

  // --- acciones ---
  step("Aplicando");
  // 1) copiar skill
  const target = skillTarget(cwd, scope);
  ensureDir(path.dirname(target));
  copyDir(SKILL_SRC, target);
  ok(`Skill instalada en ${c.bold(path.relative(cwd, target) || target)}.`);

  // 2) perfiles base de permisos (idempotentes, merge mínimo) por agente
  if (agent === "claude-code" || agent === "both") {
    ensureClaudeCodeProfile(cwd, scope);
  }
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
    version: pkgVersion(), agent, scope, knowledgeRepo, memoryMode, cloud,
    project: projectName(cwd), createdAt: new Date().toISOString(),
  };
  writeJSON(CONFIG_PATH(cwd), config);
  ok(`Config local escrita en ${c.bold(".ozali/config.json")} (gitignored).`);

  // --- siguientes pasos ---
  step("Siguientes pasos");
  // Detect if ozali is NOT permanently in PATH (i.e., run via pnpm dlx / npx without global install).
  if (!which("ozali")) {
    const v = pkgVersion();
    warn("ozali no está en tu PATH — fue ejecutado via dlx/npx sin instalación permanente.");
    info(`Instala globalmente para usar ${c.bold("ozali doctor")}, ${c.bold("ozali sync")}, etc.:`);
    console.log(`    ${c.bold(`pnpm add -g ozali@${v}`)}   ${c.dim("← recomendado")}`);
    console.log(`    ${c.dim("o")}  ${c.bold(`npm install -g ozali@${v}`)}`);
    console.log("");
  }
  console.log(`  1. Abre tu agente en este proyecto.`);
  console.log(`  2. Escribe ${c.bold('"diagnostica el proyecto"')} o ${c.bold('"ozali"')} para arrancar el bootstrap (calibración + generación de la skill ${c.bold("cdk")}).`);
  console.log(`  3. Tras trabajar, corre ${c.bold("ozali sync")} para llevar el histórico al repo de conocimiento.`);
  console.log(`  ${c.dim("Salud en cualquier momento:")} ${c.bold("ozali doctor")}`);
  return 0;
}

/**
 * Instala Engram con la mejor ruta disponible para el SO actual.
 * macOS/Linux: Homebrew (recomendado) o Go install como fallback.
 * Windows: Go install (recomendado) o binario manual.
 * Devuelve true si el binario quedó disponible en PATH.
 */
function installEngram() {
  const plat = process.platform;

  if (plat === "darwin" || plat === "linux") {
    if (which("brew")) {
      info("Instalando: " + c.bold("brew install gentleman-programming/tap/engram"));
      spawnCmd("brew", ["install", "gentleman-programming/tap/engram"]);
    } else if (which("go")) {
      info("Homebrew no encontrado — instalando con Go:");
      info("  " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
      spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
    } else {
      warn("No se encontró Homebrew ni Go. Opciones de instalación:");
      info("  a) Homebrew " + c.dim("(recomendado)") + ": " + c.cyan("https://brew.sh") + " → " + c.bold("brew install gentleman-programming/tap/engram"));
      info("  b) Binario precompilado: " + c.cyan("https://github.com/Gentleman-Programming/engram/releases"));
      return false;
    }
  } else if (plat === "win32") {
    if (which("go")) {
      info("Instalando: " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
      spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
    } else {
      warn("Go no encontrado. Opciones de instalación en Windows:");
      info("  a) Go 1.24+ " + c.dim("(recomendado)") + ": " + c.cyan("https://go.dev/dl/") + " → " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
      info("  b) Binario .zip: " + c.cyan("https://github.com/Gentleman-Programming/engram/releases"));
      return false;
    }
  } else {
    info("Guía de instalación completa: " + c.cyan("https://github.com/Gentleman-Programming/engram/blob/main/docs/INSTALLATION.md"));
    return false;
  }

  const bin = which("engram");
  if (bin) { ok("Engram instalado (" + bin + ")."); return true; }
  warn("El binario engram no aparece en PATH tras la instalación.");
  info("Puede que necesites reiniciar la terminal o ajustar tu PATH.");
  return false;
}

/**
 * Engram Cloud opt-in: réplica de equipo en tiempo real, adicional al git-sync.
 * Configura el servidor y enrola el proyecto. Devuelve { enabled, server }.
 */
async function maybeEnableEngramCloud(project, opts) {
  if (opts.yes) return { enabled: false };
  const enable = await confirm("¿Habilitar Engram Cloud para el equipo? (réplica opt-in, requiere un servidor)", false);
  if (!enable) {
    info("Cloud omitido. El histórico de equipo viaja por git-sync (" + c.bold("ozali sync") + ").");
    return { enabled: false };
  }
  const server = await ask("URL del servidor de Engram Cloud", "http://127.0.0.1:18080");
  info(`Configurando Engram Cloud → ${server}`);
  spawnCmd("engram", ["cloud", "config", "--server", server]);
  info(`Enrolando el proyecto "${project}"…`);
  if (spawnCmd("engram", ["cloud", "enroll", project]) === 0) {
    ok("Engram Cloud habilitado. Replica con " + c.bold("ozali sync --cloud") + ".");
    return { enabled: true, server };
  }
  warn("No se pudo enrolar el proyecto en Engram Cloud. Continúo solo con git-sync.");
  return { enabled: false, server };
}

function printEngramManualInstructions(agent) {
  const plat = process.platform;
  info("Para activar memoria buscable/acumulativa (modo " + c.bold("hybrid") + "):");
  if (plat === "darwin" || plat === "linux") {
    info("  1. " + c.bold("brew install gentleman-programming/tap/engram") + "  " + c.dim("(o binario: github.com/Gentleman-Programming/engram/releases)"));
  } else if (plat === "win32") {
    info("  1. " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest") + "  " + c.dim("(requiere Go 1.24+)"));
    info("     " + c.dim("o binario .zip: github.com/Gentleman-Programming/engram/releases"));
  } else {
    info("  1. " + c.cyan("https://github.com/Gentleman-Programming/engram/blob/main/docs/INSTALLATION.md"));
  }
  if (agent === "claude-code" || agent === "both") info("  2. " + c.bold("engram setup claude-code"));
  if (agent === "opencode" || agent === "both") info("  2. " + c.bold("engram setup opencode"));
  info("  3. Corre " + c.bold("ozali doctor") + " — el modo subirá a hybrid automáticamente.");
}

// Perfil base de permisos para Claude Code: lectura/comandos comunes libres,
// destructivos denegados. Es un TEMPLATE — el usuario puede añadir más entradas y
// re-correr init no las pisa (hace unión de listas).
const CLAUDE_PERMS = {
  allow: [
    "WebFetch", "WebSearch",
    "Bash(python *)", "Bash(python3 *)",
    "Bash(node *)", "Bash(npm *)", "Bash(npx *)", "Bash(pnpm *)", "Bash(yarn *)",
    "Bash(go *)", "Bash(mvn *)", "Bash(java *)",
    "Bash(git status)", "Bash(git diff *)", "Bash(git log *)", "Bash(git add *)", "Bash(git commit *)",
    "Bash(ozali *)", "Bash(engram *)",
    "PowerShell(python *)", "PowerShell(node *)", "PowerShell(npm *)", "PowerShell(npx *)",
    "PowerShell(mvn *)", "PowerShell(java *)",
  ],
  deny: [
    "Bash(rm -rf *)", "Bash(git push *)",
    "PowerShell(Remove-Item *)",
  ],
};

function mergeUnique(existing, additions) {
  const out = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(out);
  let added = 0;
  for (const item of additions) if (!seen.has(item)) { out.push(item); seen.add(item); added++; }
  return { out, added };
}

function ensureClaudeCodeProfile(cwd, scope) {
  const settingsPath = scope === "global"
    ? path.join(HOME, ".claude", "settings.json")
    : path.join(cwd, ".claude", "settings.json");
  const cfg = readJSON(settingsPath, {});
  cfg.permissions = cfg.permissions || {};
  const allowMerge = mergeUnique(cfg.permissions.allow, CLAUDE_PERMS.allow);
  const denyMerge = mergeUnique(cfg.permissions.deny, CLAUDE_PERMS.deny);
  cfg.permissions.allow = allowMerge.out;
  cfg.permissions.deny = denyMerge.out;
  writeJSON(settingsPath, cfg);
  const rel = path.relative(cwd, settingsPath) || settingsPath;
  if (allowMerge.added + denyMerge.added > 0) {
    ok(`Perfil base de permisos de Claude Code en ${c.bold(rel)} (${allowMerge.added} allow / ${denyMerge.added} deny añadidos; tus reglas se conservan).`);
  } else {
    info(`Permisos de Claude Code ya cubiertos en ${c.bold(rel)} (sin cambios).`);
  }
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
  const cloudOn = !!(cfg && cfg.cloud && cfg.cloud.enabled);
  // Cloud es opt-in: "off" es un estado válido (no cuenta como fallo).
  add("Engram Cloud", true, cloudOn ? `enrolado → ${cfg.cloud.server || "server por defecto"}` : "off (opt-in, git-sync activo)");
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

  // Auto-upgrade: si Engram acaba de instalarse y el config aún dice "docs", subir a hybrid.
  if (cfg && cfg.memoryMode === "docs" && env.engram.available) {
    cfg.memoryMode = "hybrid";
    writeJSON(CONFIG_PATH(cwd), cfg);
    ok("Engram detectado → modo de memoria actualizado a " + c.bold("hybrid") + " en .ozali/config.json.");
  }

  // Estado de sync de Engram (informativo).
  if (env.engram.available) {
    const status = tryExec("engram", ["sync", "--status"], { cwd });
    if (status) {
      step("Estado de sync (Engram)");
      for (const line of status.split(/\r?\n/)) console.log("  " + c.dim(line));
    }
  }

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

  // Engram Cloud (opt-in): réplica bidireccional adicional al git-sync.
  if (opts.cloud) {
    if (cfg.cloud && cfg.cloud.enabled && tryExec("engram", ["--version"])) {
      info(`Replicando con Engram Cloud (proyecto "${project}")…`);
      if (spawnCmd("engram", ["sync", "--cloud", "--project", project], { cwd }) === 0) ok("Réplica con Engram Cloud completada.");
      else warn("engram sync --cloud no terminó correctamente. Revisa el output de arriba.");
    } else if (!(cfg.cloud && cfg.cloud.enabled)) {
      warn("--cloud pedido, pero Engram Cloud no está habilitado. Corre " + c.bold("ozali init") + " para habilitarlo, o usa git-sync sin --cloud.");
    } else {
      warn("--cloud pedido, pero Engram no responde. Omito la réplica cloud.");
    }
  }

  if (opts.import) {
    // Repo de conocimiento → local
    // 0) Traer lo más reciente del equipo (si el knowledge repo tiene remoto).
    if (exists(path.join(kRepo, ".git")) && tryExec("git", ["remote", "get-url", "origin"], { cwd: kRepo })) {
      info("Actualizando el repo de conocimiento (git pull)…");
      if (spawnCmd("git", ["pull", "--ff-only"], { cwd: kRepo }) !== 0) {
        warn("git pull no pudo completarse; importo lo que haya localmente.");
      }
    }
    // 1) Docs
    const srcDocs = path.join(projDir, "docs");
    if (exists(srcDocs)) { copyDir(srcDocs, docsLocal); ok("Docs importados a .ozali/docs/."); }
    else info("Aún no hay docs en el repo de conocimiento para este proyecto.");
    // 2) Engram: copiar los chunks del repo de conocimiento → .engram/ ANTES de importar
    //    (engram sync --import lee de .engram/ en el cwd; sin esta copia, un dev nuevo
    //     no importaría nada).
    if (cfg.memoryMode === "hybrid" && tryExec("engram", ["--version"])) {
      const srcEngram = path.join(kRepo, "engram", project);
      if (exists(srcEngram)) {
        copyDir(srcEngram, engramLocal);
        info("Chunks de Engram copiados a .engram/. Importando…");
        if (spawnCmd("engram", ["sync", "--import"], { cwd }) === 0) ok("Memorias importadas a Engram local.");
        else warn("engram sync --import no terminó correctamente. Revisa el output de arriba.");
      } else {
        info("Aún no hay export de Engram en el repo de conocimiento para este proyecto.");
      }
    }
    info("Import completo. Revisa .ozali/docs/.");
    return 0;
  }

  // Local → repo de conocimiento
  // 1) Engram export (si hybrid + disponible)
  if (cfg.memoryMode === "hybrid" && tryExec("engram", ["--version"])) {
    info("Exportando memorias con engram sync…");
    if (spawnCmd("engram", ["sync"], { cwd }) === 0) {
      if (exists(engramLocal)) { copyDir(engramLocal, path.join(kRepo, "engram", project)); ok("Export de Engram copiado al repo de conocimiento."); }
      else info("engram sync no generó .engram/ (sin memorias nuevas).");
    } else {
      warn("engram sync falló; sincronizo solo docs. Revisa el output de arriba.");
    }
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
