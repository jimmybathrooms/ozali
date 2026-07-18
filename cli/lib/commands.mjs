// commands.mjs — implementación de init / doctor / update / sync.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  c, ok, warn, err, info, step,
  SKILL_SRC, COMMIT_SKILL_SRC, SKILL_GENERATOR_SRC, TEMPLATES_SRC, exists, ensureDir, copyDir, readJSON, writeJSON,
  ensureGitignore, tryExec, spawnCmd, which, engramAssetName, pickEngramAsset,
  projectName, pkgVersion, DEFAULT_KNOWLEDGE, HOME, openURL, gitInfo,
  toPortablePath, fromPortablePath,
} from "./util.mjs";
import { detectAll, detectSourceOfTruth, detectWorkspace, detectReferences } from "./detect.mjs";
import { ask, confirm, select } from "./prompt.mjs";

const CONFIG_PATH = (cwd) => path.join(cwd, ".ozali", "config.json");
const TEAM_CLOUD_PATH = (cwd) => path.join(cwd, ".ozali", "cloud.json");
const ENGRAM_CONFIG_PATH = (cwd) => path.join(cwd, ".engram", "config.json");
const CLOUD_TOKEN_ENV = "ENGRAM_CLOUD_TOKEN";
const CLOUD_AUTOSYNC_ENV = "ENGRAM_CLOUD_AUTOSYNC";
const CLOUD_SERVER_ENV = "ENGRAM_CLOUD_SERVER";

function skillTarget(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".claude") : path.join(cwd, ".claude");
  return path.join(base, "skills", "ozali");
}

function commitSkillTarget(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".claude") : path.join(cwd, ".claude");
  return path.join(base, "skills", "ozali-commit");
}

function skillGeneratorTarget(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".claude") : path.join(cwd, ".claude");
  return path.join(base, "skills", "skill-generator");
}

// --- opencode paths (skills.sh spec: .opencode/skills/ project, ~/.config/opencode/skills/ global) ---
// Nota: ozali (bootstrap) no se instala localmente en opencode; el global es suficiente.
// Solo las skills de ejecución (ozali-commit, skill-generator) van local.
function commitSkillTargetOpencode(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".config", "opencode") : path.join(cwd, ".opencode");
  return path.join(base, "skills", "ozali-commit");
}

function skillGeneratorTargetOpencode(cwd, scope) {
  const base = scope === "global" ? path.join(process.env.HOME || "", ".config", "opencode") : path.join(cwd, ".opencode");
  return path.join(base, "skills", "skill-generator");
}

function readTeamCloud(cwd) {
  return readJSON(TEAM_CLOUD_PATH(cwd));
}

function writeTeamCloud(cwd, cloud) {
  writeJSON(TEAM_CLOUD_PATH(cwd), {
    server: cloud.server,
    project: cloud.project,
    enrolled: !!cloud.enabled,
    auth_required: cloud.authRequired !== false,
    token_env: cloud.tokenEnv || CLOUD_TOKEN_ENV,
    autosync_env: cloud.autosyncEnv || CLOUD_AUTOSYNC_ENV,
    dashboard: cloudDashboardURL(cloud.server),
    updated_at: new Date().toISOString(),
  });
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function firstLine(text, fallback = "") {
  if (!text) return fallback;
  const line = String(text).split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line || fallback;
}

function printIndented(text) {
  if (!text) return;
  for (const line of String(text).split(/\r?\n/)) console.log(`  ${c.dim(line)}`);
}

function cloudDashboardURL(server) {
  if (!server) return null;
  return server.replace(/\/+$/, "") + "/dashboard";
}

function hasCloudToken() {
  return !!firstNonEmpty(process.env[CLOUD_TOKEN_ENV]);
}

function extractReasonCode(text) {
  if (!text) return null;
  const match = firstLine(text).match(/(?:reason(?:_code)?|reasonCode)\s*[:=]\s*([a-z_]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function syncCloudProject(cwd, project) {
  return tryExec("engram", ["sync", "--cloud", "--project", project], { cwd });
}

function cloudStatusSnapshot(cwd, project) {
  return {
    syncStatus: tryExec("engram", ["sync", "--cloud", "--status", "--project", project], { cwd }),
    upgradeStatus: tryExec("engram", ["cloud", "upgrade", "status", "--project", project], { cwd }),
    conflictsStats: tryExec("engram", ["conflicts", "stats", "--project", project], { cwd }),
  };
}

// ============================================================ init ===========

/**
 * Normaliza un config de ozali antes de persistirlo:
 * - Convierte knowledgeRepo a path portable (relativo o ~) si existe.
 */
function normalizeConfig(cfg, cwd) {
  if (cfg && cfg.knowledgeRepo) {
    cfg.knowledgeRepo = toPortablePath(cfg.knowledgeRepo, cwd);
  }
  return cfg;
}

/**
 * Inicializa (o reconfigura) únicamente el repo de conocimiento y el config mínimo.
 * Reutilizable por `init --knowledge-only`, `doctor --fix`, etc.
 */
async function initKnowledgeRepo(cwd, opts, extraConfig = {}, explicitRepo = null) {
  const knowledgeRepoRaw = explicitRepo || opts.knowledgeRepo || await ask("Ruta del repo de conocimiento (histórico aislado)", DEFAULT_KNOWLEDGE);
  const knowledgeRepo = fromPortablePath(knowledgeRepoRaw, cwd);

  ensureDir(knowledgeRepo);
  if (!exists(path.join(knowledgeRepo, ".git"))) {
    if (await confirm(`¿Inicializo git en el repo de conocimiento (${knowledgeRepo})?`, true)) {
      tryExec("git", ["init", "-q"], { cwd: knowledgeRepo });
      ensureDir(path.join(knowledgeRepo, "projects"));
      ensureDir(path.join(knowledgeRepo, "engram"));
      ok("Repo de conocimiento inicializado.");
    }
  } else info("Repo de conocimiento ya existe.");

  const existing = readJSON(CONFIG_PATH(cwd)) || {};
  const config = {
    version: pkgVersion(),
    knowledgeRepo: toPortablePath(knowledgeRepo, cwd),
    project: projectName(cwd),
    createdAt: existing.createdAt || new Date().toISOString(),
    ...extraConfig,
  };
  writeJSON(CONFIG_PATH(cwd), config);
  ok(`Config local escrita en ${c.bold(".ozali/config.json")} (repo de conocimiento configurado).`);
  return config;
}

export async function init(cwd, opts) {
  step("ozali init — bootstrap del proyecto");

  // Track rápido: solo repo de conocimiento, sin agents/skills/Engram
  if (opts.knowledgeOnly) {
    step("ozali init --knowledge-only");
    await initKnowledgeRepo(cwd, opts);
    info(`Siguientes pasos: corre ${c.bold("ozali init")} (sin --knowledge-only) para completar skills, agentes y Engram.`);
    return 0;
  }

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
  const knowledgeRepoRaw = opts.knowledgeRepo || await ask("Ruta del repo de conocimiento (histórico aislado)", DEFAULT_KNOWLEDGE);
  const knowledgeRepo = fromPortablePath(knowledgeRepoRaw, cwd);

  // Engram
  let memoryMode = "docs";
  if (opts.noEngram) {
    info("--no-engram: arranco en modo " + c.bold("docs") + " (sin usar Engram).");
  } else if (env.engram.available) {
    memoryMode = "hybrid";
    ok(`Engram disponible (${env.engram.bin}). Modo de memoria: ${c.bold("hybrid")} (docs + Engram).`);
    // Verificar si hay versión nueva con cooldown de seguridad
    const versionCheck = checkEngramVersion();
    if (versionCheck && versionCheck.canUpgrade) {
      warn(`Hay una nueva versión de Engram: ${c.bold(versionCheck.latest)} (tienes ${versionCheck.current}).`);
      if (await confirm("¿Actualizar Engram ahora?", false)) {
        info("Actualizando Engram…");
        if (process.platform === "darwin" && which("brew")) {
          spawnCmd("brew", ["upgrade", "gentleman-programming/tap/engram"]);
        } else if (which("go")) {
          spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
        } else {
          warn("No se puede auto-actualizar sin Homebrew (macOS) o Go. Descarga manual:");
          info("  " + c.cyan(versionCheck.url));
        }
      }
    } else if (versionCheck && versionCheck.cooldown) {
      info(`Engram ${c.bold(versionCheck.latest)} está disponible pero aún en cooldown de seguridad (24h). Se activará el ${new Date(new Date(versionCheck.publishedAt).getTime() + 24*60*60*1000).toLocaleDateString()}.`);
    }
  } else {
    warn("Engram no está instalado.");
    // --dry-run no instala; --yes usa el default (sí); interactivo pregunta.
    if (opts.dryRun) info("(dry-run) Aquí instalaría y configuraría Engram.");
    const installNow = opts.dryRun ? false
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

  // Obsidian (opt-in) — ofrecer instalación si no detectado
  if (!env.obsidian.installed) {
    warn("Obsidian no detectado. Es el visualizador recomendado para el vault de conocimiento.");
    if (!opts.dryRun) {
      const installObsidian = opts.yes ? false : await confirm("¿Abrir la página de descarga de Obsidian?", false);
      if (installObsidian) {
        const url = process.platform === "darwin" ? "https://obsidian.md/download"
          : process.platform === "win32" ? "https://obsidian.md/download"
          : "https://obsidian.md/download";
        openURL(url);
        info("Descarga e instala Obsidian, luego corre " + c.bold("ozali sync --obsidian") + " para generar el vault.");
      }
    }
  } else {
    ok(`Obsidian detectado (${c.dim(env.obsidian.path)}).`);
  }

  // Engram Cloud (opt-in) — réplica de equipo además del git-sync. Solo si Engram quedó disponible.
  let cloud = { enabled: false };
  if (memoryMode === "hybrid" && !opts.dryRun) {
    const teamCloud = readTeamCloud(cwd);
    if (teamCloud && teamCloud.enrolled) {
      // Fase 1: dev nuevo en un repo que ya tiene .ozali/cloud.json del equipo
      cloud = await connectTeamCloud(cwd, teamCloud, opts);
    } else {
      cloud = await maybeEnableEngramCloud(cwd, projectName(cwd), opts);
    }
  }

  if (opts.dryRun) { warn("--dry-run: no escribo nada. Plan mostrado arriba."); return 0; }

  // --- acciones ---
  step("Aplicando");
  // 1) copiar skill ozali (bootstrap) + ozali-commit (commit convencional) + skill-generator
  const target = skillTarget(cwd, scope);
  ensureDir(path.dirname(target));
  copyDir(SKILL_SRC, target);
  ok(`Skill instalada en ${c.bold(path.relative(cwd, target) || target)}.`);
  const commitTarget = commitSkillTarget(cwd, scope);
  copyDir(COMMIT_SKILL_SRC, commitTarget);
  ok(`Skill ${c.bold("ozali-commit")} instalada en ${c.bold(path.relative(cwd, commitTarget) || commitTarget)}.`);
  const generatorTarget = skillGeneratorTarget(cwd, scope);
  copyDir(SKILL_GENERATOR_SRC, generatorTarget);
  ok(`Skill ${c.bold("skill-generator")} instalada en ${c.bold(path.relative(cwd, generatorTarget) || generatorTarget)}.`);

  // 1b) Instalar skills de ejecución en opencode si el agente lo requiere
  // Nota: ozali (bootstrap) no se instala localmente en opencode; el global es suficiente.
  if (agent === "opencode" || agent === "both") {
    const ocCommit = commitSkillTargetOpencode(cwd, scope);
    ensureDir(path.dirname(ocCommit));
    copyDir(COMMIT_SKILL_SRC, ocCommit);
    ok(`Skill ${c.bold("ozali-commit")} instalada en opencode: ${c.bold(path.relative(cwd, ocCommit) || ocCommit)}.`);
    const ocGen = skillGeneratorTargetOpencode(cwd, scope);
    copyDir(SKILL_GENERATOR_SRC, ocGen);
    ok(`Skill ${c.bold("skill-generator")} instalada en opencode: ${c.bold(path.relative(cwd, ocGen) || ocGen)}.`);
  }

  // 1.5) Migrar skills heredadas (copsis-* → ozali-*)
  if (!opts.dryRun) {
    await migrateLegacySkills(cwd, opts, agent, scope);
  }

  // 2) perfiles base de permisos (idempotentes, merge mínimo) por agente
  if (agent === "claude-code" || agent === "both") {
    ensureClaudeCodeProfile(cwd, scope);
    // Claude Code ignora los permisos de un .claude/settings.json de proyecto hasta confiar en él.
    if (scope === "project" && !opts.noTrust) await ensureClaudeWorkspaceTrust(cwd, opts);
  }
  if (agent === "opencode" || agent === "both") {
    ensureOpencodeProfile(cwd);
  }

  // 2.5) ozali-jarvis: orquestador always-on (memoria Engram + puente a cdk).
  if (!opts.noJarvis) {
    const proj = projectName(cwd);
    // Fija el proyecto para escrituras deterministas de memoria (se deriva igual por cada miembro).
    writeJSON(ENGRAM_CONFIG_PATH(cwd), { project_name: proj });
    ok(`Proyecto de memoria fijado en ${c.bold(".engram/config.json")} (${proj}).`);
    if (agent === "claude-code" || agent === "both") ensureJarvisClaudeCode(cwd);
    if (agent === "opencode" || agent === "both") ensureJarvisOpencode(cwd);
  }

  // 3) gitignore del histórico aislado
  if (env.git.isRepo) {
    const { added } = ensureGitignore(cwd, [".ozali/*", "!.ozali/cloud.json", ".engram/"]);
    if (added.length) ok(`.gitignore actualizado: ${added.join(", ")} (histórico aislado del repo principal).`);
    else info(".gitignore ya aislaba el histórico.");
  }

  // 4-5) repo de conocimiento + config local (reutiliza helper)
  const config = await initKnowledgeRepo(cwd, opts, { agent, scope, memoryMode, cloud }, knowledgeRepoRaw);

  // 6) Obsidian vault (init) — si Obsidian está instalado, inicializar el vault base
  if (env.obsidian.installed && !opts.dryRun) {
    const kRepo = fromPortablePath(config.knowledgeRepo, cwd);
    await initObsidianVault(kRepo, opts);
  }

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
 * Consulta la API de releases de Engram y compara con la versión instalada.
 * Si hay una versión estable más reciente cuyo release tenga >24h de antigüedad,
 * advierte al usuario y ofrece upgrade. Si la versión nueva tiene <24h, ignora
 * (cooldown de seguridad contra supply-chain attacks).
 * Devuelve { current, latest, url, canUpgrade } o null si no hay info.
 */
function checkEngramVersion() {
  const currentRaw = tryExec("engram", ["version"]);
  if (!currentRaw) return null;
  const current = currentRaw.trim().replace(/^engram\s+/, "");
  const raw = fetchText(ENGRAM_RELEASES_LIST);
  if (!raw) return null;
  let releases;
  try { releases = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(releases)) return null;
  const now = Date.now();
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const m = /^v(\d+\.\d+\.\d+)$/.exec(r.tag_name || "");
    if (!m) continue;
    const latest = m[1];
    if (compareSemver(latest, current) <= 0) break; // no hay nada más nuevo
    const published = r.published_at ? new Date(r.published_at).getTime() : 0;
    if (!published || now - published < COOLDOWN_MS) {
      // Versión muy reciente — mostrar como disponible pero con cooldown activo
      return { current, latest, url: r.html_url, canUpgrade: false, cooldown: true, publishedAt: r.published_at };
    }
    // Versión estable con cooldown cumplido
    const asset = pickEngramAsset([r], process.platform, process.arch);
    return { current, latest, url: asset ? asset.url : r.html_url, canUpgrade: true, cooldown: false, publishedAt: r.published_at };
  }
  return { current, latest: current, canUpgrade: false };
}

/** Comparación semver simple: devuelve >0 si a>b, <0 si a<b, 0 si iguales. */
function compareSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Instala Engram con la mejor ruta disponible para el SO actual.
 * Linux: binario precompilado (auto-descarga, sin toolchain) con brew/go como alternativas.
 * macOS: Homebrew → Go → binario precompilado como fallback.
 * Windows: Go install (recomendado) o binario manual.
 * Devuelve true si el binario quedó disponible en PATH.
 */
function installEngram() {
  const plat = process.platform;

  if (plat === "linux") {
    // En Linux Homebrew es poco común: el binario precompilado es la vía universal sin toolchain.
    if (installEngramFromTarball()) return true;
    if (which("brew")) {
      info("Instalando: " + c.bold("brew install gentleman-programming/tap/engram"));
      spawnCmd("brew", ["install", "gentleman-programming/tap/engram"]);
    } else if (which("go")) {
      info("Compilando con Go: " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
      spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
    } else {
      warn("No pude instalar Engram automáticamente. Sigue las instrucciones de abajo.");
      return false;
    }
  } else if (plat === "darwin") {
    if (which("brew")) {
      info("Instalando: " + c.bold("brew install gentleman-programming/tap/engram"));
      spawnCmd("brew", ["install", "gentleman-programming/tap/engram"]);
    } else if (which("go")) {
      info("Homebrew no encontrado — instalando con Go:");
      info("  " + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
      spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
    } else if (installEngramFromTarball()) {
      return true;
    } else {
      warn("No se encontró Homebrew ni Go y falló la descarga del binario. Opciones:");
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

// Lista de releases (NO /releases/latest: ese endpoint puede devolver un tag especial
// sin binarios, p. ej. `pi-v*`). Recorremos la lista y elegimos el release estable.
const ENGRAM_RELEASES_LIST = "https://api.github.com/repos/Gentleman-Programming/engram/releases?per_page=30";

/** GET de texto con curl (o wget). Devuelve el body o null si no hay red/herramienta. */
function fetchText(url) {
  if (which("curl")) return tryExec("curl", ["-fsSL", url]);
  if (which("wget")) return tryExec("wget", ["-qO-", url]);
  return null;
}

/**
 * Resuelve { version, url } del binario precompilado de Engram para este SO/arch,
 * consultando la lista de releases y quedándose con el release estable más reciente
 * que contenga el asset. Devuelve null si no hay red/herramienta o no hay binario.
 */
function resolveEngramAsset(platform, arch) {
  const raw = fetchText(ENGRAM_RELEASES_LIST);
  if (!raw) return null;
  let releases;
  try { releases = JSON.parse(raw); } catch { return null; }
  return pickEngramAsset(releases, platform, arch);
}

/** Descarga url → dest con curl (o wget como fallback). Devuelve true si tuvo éxito. */
function download(url, dest) {
  if (which("curl")) return spawnCmd("curl", ["-fL", "--retry", "2", "-o", dest, url]) === 0;
  if (which("wget")) return spawnCmd("wget", ["-O", dest, url]) === 0;
  warn("No se encontró curl ni wget para descargar el binario de Engram.");
  return false;
}

/** Busca recursivamente un ejecutable llamado "engram" dentro de dir (1 nivel basta). */
function findEngramBinary(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === "engram") return full;
    if (e.isDirectory()) {
      const nested = findEngramBinary(full);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Instala Engram bajando el binario precompilado del release más reciente (linux/macOS).
 * Lo coloca en ~/.local/bin (sin sudo) y lo antepone al PATH del proceso para que los
 * `engram setup <agente>` posteriores lo encuentren en esta misma corrida.
 * Node-14-safe: usa curl/wget + tar vía execFileSync (sin fetch global). Devuelve true si quedó listo.
 */
function installEngramFromTarball() {
  const plat = process.platform;
  if (plat !== "linux" && plat !== "darwin") return false;

  // Falla rápido si la arquitectura no tiene binario publicado (versión irrelevante para esta validación).
  if (!engramAssetName(plat, process.arch, "0")) {
    warn(`Arquitectura no soportada para el binario precompilado (${process.arch}).`);
    return false;
  }

  const resolved = resolveEngramAsset(plat, process.arch);
  if (!resolved) {
    warn("No pude resolver un binario precompilado de Engram para tu SO/arch (¿sin red, sin curl/wget, o release sin assets?).");
    return false;
  }
  const { version, url } = resolved;
  const asset = engramAssetName(plat, process.arch, version);
  info(`Descargando binario precompilado de Engram ${c.bold("v" + version)} (${process.arch})…`);

  let tmpDir;
  try { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-engram-")); }
  catch { warn("No pude crear un directorio temporal para la descarga."); return false; }

  const tarball = path.join(tmpDir, asset);
  if (!download(url, tarball)) { warn("Falló la descarga del binario de Engram."); return false; }

  if (spawnCmd("tar", ["-xzf", tarball, "-C", tmpDir]) !== 0) {
    warn("Falló la extracción del tarball de Engram (¿tar disponible?).");
    return false;
  }

  const binSrc = findEngramBinary(tmpDir);
  if (!binSrc) { warn("No encontré el binario engram dentro del tarball."); return false; }

  const destDir = path.join(HOME, ".local", "bin");
  const dest = path.join(destDir, "engram");
  try {
    ensureDir(destDir);
    fs.copyFileSync(binSrc, dest);
    fs.chmodSync(dest, 0o755);
  } catch (e) {
    warn(`No pude instalar el binario en ${destDir} (${e.message}).`);
    return false;
  }

  // Disponible en esta corrida para los `engram setup` que vienen después.
  const onPath = (process.env.PATH || "").split(path.delimiter).includes(destDir);
  if (!onPath) process.env.PATH = destDir + path.delimiter + (process.env.PATH || "");

  ok(`Engram instalado en ${c.bold(dest)}.`);
  if (!onPath) {
    warn(`${c.bold(destDir)} no estaba en tu PATH. Para usar ${c.bold("engram")} fuera del agente, añádelo a tu shell:`);
    console.log(`    ${c.dim('export PATH="$HOME/.local/bin:$PATH"')}`);
  }
  return true;
}

/**
 * Fase 1: Onboarding de equipo. Un dev nuevo hace `ozali init` en un repo que ya tiene
 * .ozali/cloud.json (commiteable). Detecta la cloud del equipo y ofrece conectarse en 1 paso.
 */
async function connectTeamCloud(cwd, cloudMeta, opts) {
  const project = cloudMeta.project || projectName(cwd);
  ok(`Engram Cloud del equipo detectado (servidor: ${c.bold(cloudMeta.server || "por defecto")})`);
  info(`  → Proyecto: "${project}"`);
  const connect = await confirm("¿Conectarte a la memoria del equipo?", true);
  if (!connect) {
    info("Cloud del equipo omitido. Puedes conectarte después con " + c.bold("ozali cloud config") + ".");
    return { enabled: false, server: cloudMeta.server };
  }
  const token = await ask("Token de autenticación (ENGRAM_CLOUD_TOKEN)");
  if (!token) {
    warn("Sin token no se puede conectar (modo autenticado obligatorio). Continúo con git-sync.");
    return { enabled: false, server: cloudMeta.server };
  }
  const server = cloudMeta.server || "http://127.0.0.1:18080";
  info(`Configurando Engram Cloud → ${server}`);
  spawnCmd("engram", ["cloud", "config", "--server", server]);
  process.env[CLOUD_TOKEN_ENV] = token;
  info(`Enrolando el proyecto "${project}"…`);
  if (spawnCmd("engram", ["cloud", "enroll", project]) !== 0) {
    warn("No se pudo enrolar. Verifica el token y el servidor. Continúo con git-sync.");
    return { enabled: false, server };
  }
  writeTeamCloud(cwd, { enabled: true, server, project, authRequired: true });
  configureCloudAutosync(cwd, opts);
  persistCloudToken(token, opts);
  ok("Conectado a Engram Cloud del equipo.");
  // Recibir la memoria del equipo (pull desde cloud)
  info("Recibiendo memoria del equipo…");
  const pullOut = tryExec("engram", ["sync", "--cloud", "--import", "--project", project], { cwd });
  if (pullOut !== null) {
    ok("Memoria del equipo recibida.");
    if (pullOut.trim()) printIndented(pullOut);
    // Importar chunks locales
    if (spawnCmd("engram", ["sync", "--import"], { cwd }) === 0) ok("Memorias importadas a Engram local.");
  } else {
    warn("No se pudo recibir la memoria del equipo. Corre " + c.bold("ozali sync --cloud --import") + " más tarde.");
  }
  return { enabled: true, server, token };
}

/**
 * Engram Cloud opt-in: réplica de equipo en tiempo real, adicional al git-sync.
 * Modo autenticado obligatorio: siempre pide token. Configura autosync en el agente.
 * Devuelve { enabled, server, token }.
 */
async function maybeEnableEngramCloud(cwd, project, opts) {
  if (opts.yes) return { enabled: false };
  const enable = await confirm("¿Habilitar Engram Cloud para el equipo? (réplica opt-in, requiere un servidor)", false);
  if (!enable) {
    info("Cloud omitido. El histórico de equipo viaja por git-sync (" + c.bold("ozali sync") + ").");
    return { enabled: false };
  }
  const server = await ask("URL del servidor de Engram Cloud", "http://127.0.0.1:18080");
  const token = await ask("Token de autenticación (ENGRAM_CLOUD_TOKEN)");
  if (!token) {
    warn("Sin token no se puede configurar Engram Cloud (modo autenticado obligatorio). Continúo con git-sync.");
    return { enabled: false, server };
  }
  info(`Configurando Engram Cloud → ${server}`);
  spawnCmd("engram", ["cloud", "config", "--server", server]);
  process.env[CLOUD_TOKEN_ENV] = token;
  info(`Enrolando el proyecto "${project}"…`);
  if (spawnCmd("engram", ["cloud", "enroll", project]) === 0) {
    writeTeamCloud(cwd, { enabled: true, server, project, authRequired: true });
    configureCloudAutosync(cwd, opts);
    persistCloudToken(token, opts);
    ok("Engram Cloud habilitado. Replica con " + c.bold("ozali sync --cloud") + ".");
    const dash = cloudDashboardURL(server);
    if (dash) {
      info(`Dashboard: ${c.cyan(dash)}`);
      if (await confirm("¿Abrir el dashboard en el navegador?", false)) openURL(dash);
    }
    return { enabled: true, server, token };
  }
  warn("No se pudo enrolar el proyecto en Engram Cloud. Continúo solo con git-sync.");
  return { enabled: false, server };
}

/**
 * Configura ENGRAM_CLOUD_AUTOSYNC=1 (y ENGRAM_CLOUD_TOKEN) en el bloque env del MCP
 * de Engram del agente, para que la réplica sea automática e invisible.
 */
function configureCloudAutosync(cwd, opts) {
  const agent = opts.agent || "claude-code";
  const token = process.env[CLOUD_TOKEN_ENV] || "";
  // Claude Code: .claude/settings.json → mcpServers.engram.env
  if (agent === "claude-code" || agent === "both") {
    const p = path.join(cwd, ".claude", "settings.json");
    const cfg = readJSON(p, {});
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.engram = cfg.mcpServers.engram || {};
    cfg.mcpServers.engram.env = cfg.mcpServers.engram.env || {};
    cfg.mcpServers.engram.env[CLOUD_AUTOSYNC_ENV] = "1";
    if (token) cfg.mcpServers.engram.env[CLOUD_TOKEN_ENV] = token;
    writeJSON(p, cfg);
    ok(`Autosync de Engram Cloud configurado en ${c.bold(".claude/settings.json")} (mcpServers.engram.env).`);
  }
  // opencode: opencode.json → mcp.engram.env
  if (agent === "opencode" || agent === "both") {
    const p = path.join(cwd, "opencode.json");
    const cfg = readJSON(p, {});
    cfg.mcp = cfg.mcp || {};
    cfg.mcp.engram = cfg.mcp.engram || {};
    if (cfg.mcp.engram.env === undefined || typeof cfg.mcp.engram.env !== "object") {
      cfg.mcp.engram.env = {};
    } else {
      cfg.mcp.engram.env = { ...cfg.mcp.engram.env };
    }
    cfg.mcp.engram.env[CLOUD_AUTOSYNC_ENV] = "1";
    if (token) cfg.mcp.engram.env[CLOUD_TOKEN_ENV] = token;
    writeJSON(p, cfg);
    ok(`Autosync de Engram Cloud configurado en ${c.bold("opencode.json")} (mcp.engram.env).`);
  }
}

/**
 * Persiste el token de Engram Cloud para sesiones futuras.
 * 1) ~/.engram/cloud_token (default de Engram)
 * 2) Avisa al usuario que añada la env var a su shell rc si quiere uso fuera del agente.
 */
function persistCloudToken(token, opts) {
  const tokenPath = path.join(HOME, ".engram", "cloud_token");
  try {
    ensureDir(path.dirname(tokenPath));
    fs.writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
    ok(`Token guardado en ${c.bold("~/.engram/cloud_token")} (permisos 600).`);
  } catch {
    warn("No pude escribir ~/.engram/cloud_token. Guarda el token manualmente.");
  }
  const shell = process.env.SHELL || "";
  const rc = shell.includes("zsh") ? "~/.zshrc" : shell.includes("bash") ? "~/.bashrc" : null;
  if (rc) {
    info(`Para usar Engram Cloud fuera del agente, añade a ${c.bold(rc)}:`);
    console.log(`    ${c.dim(`export ${CLOUD_TOKEN_ENV}=<tu-token>`)}`);
  }
}

function printEngramManualInstructions(agent) {
  const plat = process.platform;
  info("Para activar memoria buscable/acumulativa (modo " + c.bold("hybrid") + "):");
  if (plat === "linux") {
    info("  1. Binario precompilado " + c.dim("(recomendado)") + ": baja " + c.bold("engram_<ver>_linux_<amd64|arm64>.tar.gz") + " de");
    info("     " + c.cyan("https://github.com/Gentleman-Programming/engram/releases"));
    info("     " + c.bold("tar -xzf engram_*_linux_*.tar.gz && mv engram ~/.local/bin/ && chmod +x ~/.local/bin/engram"));
    info("     " + c.dim('(asegúrate que ~/.local/bin esté en tu PATH: export PATH="$HOME/.local/bin:$PATH")'));
    info("     " + c.dim("o, con Go 1.24+: ") + c.bold("go install github.com/Gentleman-Programming/engram/cmd/engram@latest"));
  } else if (plat === "darwin") {
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

// ----------------------------------------------------------------- ozali-jarvis
const JARVIS_BEGIN = "<!-- ozali-jarvis:start -->";
const JARVIS_END = "<!-- ozali-jarvis:end -->";

/** Cuerpo del bloque jarvis para CLAUDE.md / AGENTS.md (sin el frontmatter del template). */
function jarvisPersonaBody(tpl = "ozali-jarvis.md") {
  const raw = fs.readFileSync(path.join(TEMPLATES_SRC, tpl), "utf8");
  // Quita el frontmatter YAML (--- ... ---) y deja el cuerpo markdown.
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim();
}

/** Inserta/actualiza un bloque marcado en un archivo markdown (idempotente). */
function upsertMarkedBlock(file, body, begin = JARVIS_BEGIN, end = JARVIS_END) {
  const block = `${begin}\n${body}\n${end}`;
  let txt = exists(file) ? fs.readFileSync(file, "utf8") : "";
  const re = new RegExp(`${begin}[\\s\\S]*?${end}`);
  let changed;
  if (re.test(txt)) {
    const next = txt.replace(re, block);
    changed = next !== txt; txt = next;
  } else {
    txt = (txt.trim() ? txt.replace(/\s*$/, "") + "\n\n" : "") + block + "\n";
    changed = true;
  }
  fs.writeFileSync(file, txt);
  return changed;
}

function ensureJarvisClaudeCode(cwd) {
  // 1) persona en CLAUDE.md (always-on)
  const claudeMd = path.join(cwd, "CLAUDE.md");
  const ch = upsertMarkedBlock(claudeMd, jarvisPersonaBody());
  ok(`ozali-jarvis ${ch ? "escrito" : "ya presente"} en ${c.bold("CLAUDE.md")} (orquestador por defecto).`);
  // 2) subagente
  const agentFile = path.join(cwd, ".claude", "agents", "ozali-jarvis.md");
  ensureDir(path.dirname(agentFile));
  fs.copyFileSync(path.join(TEMPLATES_SRC, "ozali-jarvis.md"), agentFile);
  ok(`Subagente ${c.bold(".claude/agents/ozali-jarvis.md")} instalado.`);
  // 3) hooks de recordatorio (idempotentes)
  ensureJarvisHooks(cwd);
}

function ensureJarvisHooks(cwd) {
  const p = path.join(cwd, ".claude", "settings.json");
  const cfg = readJSON(p, {});
  cfg.hooks = cfg.hooks || {};
  const reminder = (msg) => ({ hooks: [{ type: "command", command: `echo '[ozali-jarvis] ${msg}'` }] });
  const want = {
    SessionStart: reminder("recall-first: confirma proyecto (mem_current_project) y recupera contexto de Engram (mem_context) antes de actuar."),
    PreCompact: reminder("antes de compactar: persiste el state recuperable en Engram (engram-convention §4)."),
    SessionEnd: reminder("cierre: registra lo trabajado en Engram (scope project, español) y haz mem_session_summary."),
  };
  let added = 0;
  for (const [evt, val] of Object.entries(want)) {
    const arr = cfg.hooks[evt] || (cfg.hooks[evt] = []);
    // idempotencia: no duplicar el recordatorio ozali-jarvis para ese evento
    const has = JSON.stringify(arr).includes("[ozali-jarvis]");
    if (!has) { arr.push(val); added++; }
  }
  writeJSON(p, cfg);
  if (added) ok(`Hooks de recordatorio de ozali-jarvis añadidos a ${c.bold(".claude/settings.json")} (${added}).`);
  else info("Hooks de ozali-jarvis ya presentes en Claude Code.");
}

function ensureJarvisOpencode(cwd) {
  // 1) persona en AGENTS.md
  const agentsMd = path.join(cwd, "AGENTS.md");
  const ch = upsertMarkedBlock(agentsMd, jarvisPersonaBody());
  ok(`ozali-jarvis ${ch ? "escrito" : "ya presente"} en ${c.bold("AGENTS.md")} (orquestador por defecto).`);
  // 2) agente en opencode.json
  const p = path.join(cwd, "opencode.json");
  const cfg = readJSON(p, {});
  cfg.$schema = cfg.$schema || "https://opencode.ai/config.json";
  cfg.agent = cfg.agent || {};
  if (!cfg.agent["ozali-jarvis"]) {
    cfg.agent["ozali-jarvis"] = {
      mode: "primary",
      description: "Orquestador del proyecto: memoria Engram + puente a la skill cdk.",
      prompt: "{file:./AGENTS.md}",
    };
    writeJSON(p, cfg);
    ok(`Agente ${c.bold("ozali-jarvis")} (primary) añadido a ${c.bold("opencode.json")}.`);
  } else {
    info("Agente ozali-jarvis ya presente en opencode.json.");
  }
  // 3) plugin de recordatorio
  const plugin = path.join(cwd, ".opencode", "plugins", "ozali-jarvis.js");
  if (!exists(plugin)) {
    ensureDir(path.dirname(plugin));
    fs.copyFileSync(path.join(TEMPLATES_SRC, "ozali-jarvis-plugin.js"), plugin);
    ok(`Plugin ${c.bold(".opencode/plugins/ozali-jarvis.js")} instalado.`);
  } else {
    info("Plugin de ozali-jarvis ya presente en opencode.");
  }
}

// Marca el proyecto como confiable en Claude Code (~/.claude.json). Sin esto, Claude Code
// ignora los permisos de un .claude/settings.json de proyecto ("workspace not trusted").
async function ensureClaudeWorkspaceTrust(cwd, opts) {
  const p = path.join(HOME, ".claude.json");
  if (!exists(p)) {
    info("Claude Code aún no tiene ~/.claude.json; al abrirlo aquí, acepta el diálogo de confianza.");
    return;
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { warn("No pude leer ~/.claude.json; acepta el diálogo de confianza de Claude Code manualmente."); return; }
  cfg.projects = cfg.projects || {};
  cfg.projects[cwd] = cfg.projects[cwd] || {};
  if (cfg.projects[cwd].hasTrustDialogAccepted === true) {
    info("Claude Code ya confía en este workspace.");
    return;
  }
  const doTrust = opts.yes ? true
    : await confirm("¿Marcar este proyecto como confiable en Claude Code? (necesario para que apliquen los permisos)", true);
  if (!doTrust) {
    info("Workspace no marcado como confiable: Claude Code ignorará los permisos hasta que aceptes su diálogo.");
    return;
  }
  cfg.projects[cwd].hasTrustDialogAccepted = true;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2)); // formato que usa Claude Code (indent 2, sin newline final)
  ok("Workspace marcado como confiable en Claude Code (los permisos de .claude/settings.json ya aplican).");
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

// ========================================================= workspace =========
// Configuración multi-repo: escanea repos hijos de una carpeta raíz, remedia los
// que no tienen ozali init, guía la calibración (que hace el agente), y escribe
// 3 capas de config: manifiesto + .code-workspace + orquestador de workspace.
const WS_JARVIS_BEGIN = "<!-- ozali-workspace-jarvis:start -->";
const WS_JARVIS_END = "<!-- ozali-workspace-jarvis:end -->";
const WS_MANIFEST = (root) => path.join(root, "ozali-workspace.json");

const STATUS_LABEL = {
  "ready": () => c.green("✔ listo"),
  "needs-calibration": () => c.yellow("⚠ sin calibrar (falta cdk)"),
  "missing-init": () => c.red("✖ sin init"),
};

export async function workspace(cwd, opts = {}) {
  step("ozali workspace — configuración multi-repo");
  const depth = opts.depth ? (parseInt(opts.depth, 10) || 1) : 1;

  // Fase A — escaneo (read-only)
  let ws = detectWorkspace(cwd, { depth });
  if (ws.members.length === 0) {
    warn("No encontré repositorios git como hijos de esta carpeta.");
    info("Corre " + c.bold("ozali workspace") + " desde la carpeta que agrupa tus repos (o usa " + c.bold("--depth 2") + ").");
    return 1;
  }
  step("Repos detectados");
  printMembers(ws.members);

  // Modos batch (Track 1): operan sobre los miembros del workspace ya existente y salen.
  if (opts.wsDoctor) return await workspaceDoctor(ws.members, opts);
  if (opts.wsUpdate) return await workspaceUpdate(ws.members, opts);

  // Fase B — remediación de los que no tienen ozali init
  const missing = ws.members.filter((m) => m.status === "missing-init");
  if (missing.length && opts.dryRun) {
    info(`(dry-run) Aquí correría ${c.bold("ozali init")} en: ${c.bold(missing.map((m) => m.dir).join(", "))}.`);
  } else if (missing.length) {
    step("Repos sin ozali init");
    const base = inheritedConfig(ws.members);
    const shared = {
      agent: opts.agent || (base && base.agent),
      scope: opts.scope || (base && base.scope),
      knowledgeRepo: fromPortablePath(opts.knowledgeRepo || (base && base.knowledgeRepo), root),
    };
    for (const m of missing) {
      const go = opts.yes ? true : await confirm(`¿Correr ${c.bold("ozali init")} en ${c.bold(m.dir)}?`, true);
      if (!go) { info(`Saltado: ${m.dir}.`); continue; }
      await init(m.path, { ...opts, ...shared });
    }
    ws = detectWorkspace(cwd, { depth }); // re-escanea tras remediar
  }

  // Guía de calibración (el CLI NO puede calibrar; lo hace el agente)
  const needCal = ws.members.filter((m) => m.status === "needs-calibration");
  if (needCal.length) {
    step("Calibración pendiente (la hace tu agente, no el CLI)");
    warn(`${needCal.length} repo(s) tienen ozali init pero aún no generan su skill ${c.bold("cdk")}.`);
    for (const m of needCal) {
      console.log(`  • ${c.bold(m.dir)} → abre el repo en tu agente y corre la skill ${c.bold("ozali")} (${c.dim('"diagnostica el proyecto"')}).`);
    }
  }

  // Fase C — referencias entre repos (auto-detección + confirmación)
  const references = await confirmReferences(detectReferences(ws.members), opts);

  if (opts.dryRun) { warn("--dry-run: no escribo nada. Plan mostrado arriba."); return 0; }

  // Fase D — escritura de la configuración del workspace
  step("Escribiendo configuración del workspace");
  const manifest = writeWorkspaceManifest(cwd, ws.members, references, opts);
  writeCodeWorkspace(cwd, ws.members);

  const agent = manifest.agent;
  if (agent === "claude-code" || agent === "both") {
    ensureWorkspaceJarvisClaudeCode(cwd);
    ensureWorkspaceOzaliSkill(cwd); // Track 2: skill ozali en la raíz → calibrar miembros desde el workspace
    if (!opts.noTrust) await ensureClaudeWorkspaceTrust(cwd, opts);
  }
  if (agent === "opencode" || agent === "both") ensureWorkspaceJarvisOpencode(cwd);

  if (gitInfo(cwd).isRepo) {
    const { added } = ensureGitignore(cwd, [".claude/", ".engram/", ".ozali/"]);
    if (added.length) ok(`.gitignore de la raíz actualizado: ${added.join(", ")}.`);
  }

  // Siguientes pasos
  step("Siguientes pasos");
  const wsFile = `${path.basename(cwd)}.code-workspace`;
  console.log(`  1. Abre el workspace en tu editor: ${c.bold(wsFile)} ${c.dim("(VSCode/Antigravity → Open Workspace).")}`);
  if (needCal.length) {
    console.log(`  2. Calibra los pendientes (${c.bold(needCal.map((m) => m.dir).join(", "))}) ${c.dim("sin salir del workspace:")}`);
    console.log(`     ${c.dim("abre el agente en la raíz y pide a")} ${c.bold("ozali-workspace-jarvis")} ${c.dim('que "calibre los repos pendientes"')}`);
    console.log(`     ${c.dim("(usa la skill")} ${c.bold("ozali")} ${c.dim("en modo target, repo por repo con su GATE).")}`);
  }
  console.log(`  ${c.dim("• Salud de todos los repos:")}     ${c.bold("ozali workspace --doctor")}`);
  console.log(`  ${c.dim("• Actualizar todos los repos:")}   ${c.bold("ozali workspace --update")}`);
  console.log(`  ${c.dim("Re-corre")} ${c.bold("ozali workspace")} ${c.dim("cuando agregues repos o cambien las referencias (es idempotente).")}`);
  return 0;
}

/** Track 1 — health-check de todos los miembros (doctor por repo) + resumen consolidado. */
async function workspaceDoctor(members, opts = {}) {
  const results = [];
  for (const m of members) {
    console.log("");
    console.log(c.bold(c.magenta(`── ${m.dir} ──`)));
    if (m.status === "missing-init") {
      warn(`Sin ozali init → córrelo (o re-corre ${c.bold("ozali workspace")}).`);
      results.push({ dir: m.dir, ok: false, note: "sin init" });
      continue;
    }
    const code = await doctor(m.path, opts);
    results.push({ dir: m.dir, ok: code === 0, note: code === 0 ? "todo en orden" : "puntos a atender" });
  }
  step("Resumen del workspace");
  const pad = Math.max(4, ...members.map((m) => m.dir.length));
  for (const r of results) {
    console.log(`  ${r.ok ? c.green("✔") : c.yellow("✖")} ${r.dir.padEnd(pad)}  ${c.dim(r.note)}`);
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

/** Track 1 — update de todos los miembros ozali (skills/permisos/jarvis) + resumen. */
async function workspaceUpdate(members, opts) {
  const results = [];
  let failed = 0;
  for (const m of members) {
    console.log("");
    console.log(c.bold(c.magenta(`── ${m.dir} ──`)));
    if (m.status === "missing-init") {
      warn("Sin ozali init → nada que actualizar (córrelo primero).");
      results.push({ dir: m.dir, mark: c.yellow("—"), note: "sin init (saltado)" });
      continue;
    }
    const code = await update(m.path, opts);
    if (code !== 0) failed++;
    results.push({ dir: m.dir, mark: code === 0 ? c.green("✔") : c.yellow("✖"), note: code === 0 ? "actualizado" : "revisar" });
  }
  step("Resumen del workspace");
  const pad = Math.max(4, ...members.map((m) => m.dir.length));
  for (const r of results) console.log(`  ${r.mark} ${r.dir.padEnd(pad)}  ${c.dim(r.note)}`);
  info(`La skill ${c.bold("cdk")} la regenera el agente. Re-corre ${c.bold("ozali workspace")} para refrescar estados.`);
  return failed > 0 ? 1 : 0;
}

/** Track 2 — instala la skill `ozali` en la raíz para calibrar miembros desde el workspace. */
function ensureWorkspaceOzaliSkill(root) {
  copyDir(SKILL_SRC, path.join(root, ".claude", "skills", "ozali"));
  ok(`Skill ${c.bold("ozali")} instalada en la raíz (${c.bold(".claude/skills/ozali")}) para calibrar miembros desde el workspace.`);
}

/** Primer .ozali/config.json entre los miembros ya inicializados (para heredar defaults). */
function inheritedConfig(members) {
  for (const m of members) {
    const cfg = readJSON(path.join(m.path, ".ozali", "config.json"));
    if (cfg) return cfg;
  }
  return null;
}

function printMembers(members) {
  const pad = Math.max(4, ...members.map((m) => m.dir.length));
  for (const m of members) {
    const label = (STATUS_LABEL[m.status] || (() => m.status))();
    const sot = m.sot.found ? c.dim(`sot:${m.sot.variant}`) : c.dim("sot:—");
    const eng = m.engramProject ? c.dim(` engram:${m.engramProject}`) : "";
    console.log(`  ${c.bold(m.dir.padEnd(pad))}  ${label}  ${sot}${eng}`);
  }
}

async function confirmReferences(detected, opts) {
  if (detected.length === 0) { info("No detecté referencias automáticas entre los repos."); return []; }
  step("Referencias detectadas entre repos");
  for (const e of detected) console.log(`  • ${c.bold(e.fromDir)} → ${c.bold(e.toDir)} ${c.dim("(" + e.kind + ")")}`);
  if (opts.yes) return detected;
  if (await confirm(`¿Registrar las ${detected.length} referencias detectadas?`, true)) return detected;
  const kept = [];
  for (const e of detected) {
    if (await confirm(`  ¿Registrar ${e.fromDir} → ${e.toDir} (${e.kind})?`, true)) kept.push(e);
  }
  return kept;
}

function writeWorkspaceManifest(root, members, references, opts) {
  const existing = readJSON(WS_MANIFEST(root)) || {};
  const base = inheritedConfig(members) || {};
  const agent = opts.agent || existing.agent || base.agent || "claude-code";
  const manifest = {
    version: pkgVersion(),
    root,
    agent,
    knowledgeRepo: toPortablePath(
      opts.knowledgeRepo || existing.knowledgeRepo || base.knowledgeRepo || DEFAULT_KNOWLEDGE,
      root
    ),
    cloud: base.cloud || existing.cloud || { enabled: false },
    members: members.map((m) => ({ path: m.dir, project: m.project, status: m.status, sot: m.sot.found ? m.sot.variant : null })),
    references: references.map((e) => ({ from: e.fromDir, to: e.toDir, kind: e.kind })),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJSON(WS_MANIFEST(root), manifest);
  ok(`Manifiesto escrito en ${c.bold("ozali-workspace.json")} (${members.length} repos, ${references.length} referencias).`);
  return manifest;
}

function writeCodeWorkspace(root, members) {
  const file = path.join(root, `${path.basename(root)}.code-workspace`);
  const existing = readJSON(file) || {};
  const folders = Array.isArray(existing.folders) ? existing.folders.slice() : [];
  const have = new Set(folders.map((f) => f && f.path));
  for (const m of members) if (!have.has(m.dir)) folders.push({ path: m.dir });
  const cfg = {
    folders,
    settings: existing.settings || {},
    extensions: existing.extensions || { recommendations: ["anthropic.claude-code"] },
  };
  writeJSON(file, cfg);
  ok(`Workspace de editor escrito en ${c.bold(path.basename(file))} (${folders.length} carpetas, multi-root).`);
}

function ensureWorkspaceJarvisClaudeCode(root) {
  const claudeMd = path.join(root, "CLAUDE.md");
  const ch = upsertMarkedBlock(claudeMd, jarvisPersonaBody("ozali-workspace-jarvis.md"), WS_JARVIS_BEGIN, WS_JARVIS_END);
  ok(`ozali-workspace-jarvis ${ch ? "escrito" : "ya presente"} en ${c.bold("CLAUDE.md")} de la raíz.`);
  const agentFile = path.join(root, ".claude", "agents", "ozali-workspace-jarvis.md");
  ensureDir(path.dirname(agentFile));
  fs.copyFileSync(path.join(TEMPLATES_SRC, "ozali-workspace-jarvis.md"), agentFile);
  ok(`Subagente ${c.bold(".claude/agents/ozali-workspace-jarvis.md")} instalado.`);
}

function ensureWorkspaceJarvisOpencode(root) {
  const agentsMd = path.join(root, "AGENTS.md");
  const ch = upsertMarkedBlock(agentsMd, jarvisPersonaBody("ozali-workspace-jarvis.md"), WS_JARVIS_BEGIN, WS_JARVIS_END);
  ok(`ozali-workspace-jarvis ${ch ? "escrito" : "ya presente"} en ${c.bold("AGENTS.md")} de la raíz.`);
  const p = path.join(root, "opencode.json");
  const cfg = readJSON(p, {});
  cfg.$schema = cfg.$schema || "https://opencode.ai/config.json";
  cfg.agent = cfg.agent || {};
  if (!cfg.agent["ozali-workspace-jarvis"]) {
    cfg.agent["ozali-workspace-jarvis"] = {
      mode: "primary",
      description: "Orquestador multi-repo: coordina repos hermanos según ozali-workspace.json.",
      prompt: "{file:./AGENTS.md}",
    };
    writeJSON(p, cfg);
    ok(`Agente ${c.bold("ozali-workspace-jarvis")} (primary) añadido a ${c.bold("opencode.json")}.`);
  } else {
    info("Agente ozali-workspace-jarvis ya presente en opencode.json.");
  }
}

// =========================================================== doctor ==========
export async function doctor(cwd, opts = {}) {
  step("ozali doctor — health-check (read-only)");
  const env = detectAll(cwd);
  const cfg = readJSON(CONFIG_PATH(cwd));
  const rows = [];
  const add = (label, good, detail) => rows.push({ label, good, detail });

  add("Repo git", env.git.isRepo, env.git.isRepo ? (env.git.commit ? `${env.git.branch}@${env.git.commit}` : "repo sin commits") : "no es repo git");
  add("Node ≥ 16", env.node.ok, env.node.version);
  add("Fuente de verdad", env.sot.found, env.sot.found ? `${env.sot.doc} + ${env.sot.dir}/` : "ausente (corre la skill 'ozali')");
  add("Skill ozali instalada", env.skill.installed, env.skill.installed ? env.skill.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init)");
  add("Skill skill-generator", env.skillGenerator.installed, env.skillGenerator.installed ? env.skillGenerator.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init)");
  // Skill cdk (la genera el agente): versión de contrato vs. la vigente del paquete.
  const cdkInfo = detectCdk(cwd);
  const cdkN = cdkCanonicalVersion();
  if (!cdkInfo.installed) {
    add("Skill cdk", true, "no generada aún (corre la skill 'ozali' en tu agente)");
  } else if (cdkInfo.version != null && cdkInfo.version >= cdkN && !cdkInfo.hasCopsis) {
    add("Skill cdk", true, `contrato v${cdkInfo.version} (al día)`);
  } else {
    const reason = cdkInfo.hasCopsis ? "contiene copsis-commit → migra con la skill 'ozali'"
      : cdkInfo.version == null ? "sin versión de contrato (legado) → migra con la skill 'ozali'"
      : `contrato v${cdkInfo.version} < v${cdkN} → migra con la skill 'ozali'`;
    add("Skill cdk", false, reason);
  }
  add("Engram", env.engram.available, env.engram.available ? env.engram.bin : "no instalado → modo docs");
  if (env.engram.available) {
    const online = tryExec("engram", ["doctor"], { cwd }) !== null;
    add("Engram en línea", online, online ? "engram doctor OK" : "engram doctor no responde");
  }
  const jarvis = detectJarvis(cwd);
  // jarvis es opt-in (--no-jarvis): informativo, no cuenta como fallo.
  add("ozali-jarvis", true, jarvis.present ? `configurado (${jarvis.where.join(", ")})` : "no configurado (--no-jarvis)");
  const cloudMeta = readTeamCloud(cwd);
  const cloudOn = !!(cfg && cfg.cloud && cfg.cloud.enabled) || !!(cloudMeta && cloudMeta.enrolled);
  // Cloud es opt-in: "off" es un estado válido (no cuenta como fallo).
  const cloudDetail = cloudOn
    ? [`enrolado → ${firstNonEmpty(cloudMeta && cloudMeta.server, cfg && cfg.cloud && cfg.cloud.server) || "server por defecto"}`,
       hasCloudToken() ? c.green("token ✓") : c.yellow("sin token"),
       cloudMeta && cloudMeta.dashboard ? c.cyan(cloudMeta.dashboard) : ""].filter(Boolean).join(" · ")
    : "off (opt-in, git-sync activo)";
  add("Engram Cloud", true, cloudDetail);
  const kRepoPortable = cfg && cfg.knowledgeRepo;
  const kRepoResolved = kRepoPortable ? fromPortablePath(kRepoPortable, cwd) : null;
  add("Repo de conocimiento", !!(kRepoResolved && exists(kRepoResolved)), kRepoResolved || "sin configurar (ozali init)");

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

  // --fix: auto-remediar problemas detectables
  if (opts.fix && bad > 0) {
    step("Modo --fix: remediando problemas detectados");

    // Fix 1: Repo de conocimiento
    const kRepoRow = rows.find((r) => r.label === "Repo de conocimiento");
    if (kRepoRow && !kRepoRow.good) {
      await initKnowledgeRepo(cwd, opts);
      kRepoRow.good = true;
      kRepoRow.detail = fromPortablePath(readJSON(CONFIG_PATH(cwd)).knowledgeRepo, cwd);
    }

    // Fix 2: Strict TDD
    const tddRow = rows.find((r) => r.label === "Strict TDD calibrado");
    if (tddRow && !tddRow.good && env.testing.runners.length > 0) {
      const calibrate = opts.yes ? true : await confirm(`Detecté runner(s) ${env.testing.runners.join(", ")}. ¿Calibrar strict_tdd: true?`, true);
      if (calibrate) {
        const sot = env.sot.found ? env.sot : detectSourceOfTruth(cwd);
        if (!sot.found) {
          warn("No hay fuente de verdad (.ai/ o .ia/). No puedo calibrar TDD sin ella.");
        } else {
          const f = path.join(cwd, sot.dir, "context", "tech-stack.md");
          ensureDir(path.dirname(f));
          let txt = exists(f) ? fs.readFileSync(f, "utf8") : "# Tech Stack\n\n";
          if (!/Testing\s*&\s*TDD/i.test(txt)) {
            txt += "\n\n## Testing & TDD\n\n";
          }
          if (/Strict\s*TDD[:*\s]+(true|false)/i.test(txt)) {
            txt = txt.replace(/Strict\s*TDD[:*\s]+(true|false)/i, "Strict TDD: true");
          } else {
            txt += "\nStrict TDD: true\n";
          }
          fs.writeFileSync(f, txt);
          ok(`Strict TDD calibrado a ${c.bold("true")} en ${path.relative(cwd, f)}.`);
          tddRow.good = true;
          tddRow.detail = "strict_tdd: true";
        }
      }
    }

    const badAfterFix = rows.filter((r) => !r.good).length;
    console.log("");
    if (badAfterFix === 0) ok("Todos los problemas detectados fueron remediados.");
    else warn(`${badAfterFix} punto(s) aún sin remediar.`);
    return badAfterFix === 0 ? 0 : 1;
  }

  // Auto-upgrade: si Engram acaba de instalarse y el config aún dice "docs", subir a hybrid.
  if (cfg && cfg.memoryMode === "docs" && env.engram.available) {
    cfg.memoryMode = "hybrid";
    writeJSON(CONFIG_PATH(cwd), normalizeConfig(cfg, cwd));
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

  // Estado detallado de Engram Cloud (si está habilitado).
  if (cloudOn && env.engram.available) {
    const project = (cfg && cfg.project) || projectName(cwd);
    const snap = cloudStatusSnapshot(cwd, project);
    const hasData = snap.syncStatus || snap.upgradeStatus || snap.conflictsStats;
    if (hasData) {
      step("Estado de Engram Cloud");
      if (snap.syncStatus) {
        info("Sync:");
        printIndented(snap.syncStatus);
        // Warnings específicos por reason_code
        const reason = extractReasonCode(snap.syncStatus);
        if (reason === "blocked_unenrolled") warn("El proyecto no está enrolado en el servidor cloud. Corre " + c.bold("ozali init") + " para re-enrolarlo.");
        if (reason === "transport_failed") warn("No se pudo conectar al servidor cloud (transport_failed). Verifica la URL y tu conexión.");
      }
      if (snap.upgradeStatus) {
        info("Upgrade:");
        printIndented(snap.upgradeStatus);
        // Fase 3.2: sugerir upgrade si el estado no es bootstrap_verified
        const upgradeReason = extractReasonCode(snap.upgradeStatus);
        if (upgradeReason && upgradeReason !== "bootstrap_verified") {
          warn(`El proyecto requiere upgrade de cloud (estado: ${upgradeReason}). Corre ${c.bold("ozali cloud upgrade")}.`);
        }
      }
      if (snap.conflictsStats) {
        info("Conflictos:");
        printIndented(snap.conflictsStats);
        // Fase 4.2: advertir conflictos pendientes
        const pendingMatch = snap.conflictsStats.match(/pending\s*[:=]\s*(\d+)/i);
        const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;
        if (pending > 0) warn(`${pending} conflicto(s) de memoria sin juzgar. Usa ${c.bold("ozali audit --conflicts")}.`);
      }
    }
    if (cloudMeta && cloudMeta.dashboard) info(`Dashboard: ${c.cyan(cloudMeta.dashboard)}`);
  }

  // Tendencia de uso de tokens (la escribe cdk en cada hito; informativo).
  const metrics = readJSON(path.join(cwd, ".ozali", "metrics", "token-metrics.json"));
  if (metrics && Array.isArray(metrics.hits) && metrics.hits.length) {
    step("Tendencia de tokens (últimos hitos)");
    for (const h of metrics.hits.slice(-3)) {
      const saved = h.savedByRecall ? ` ${c.green("(ahorro recall: " + h.savedByRecall + ")")}` : "";
      console.log(`  ${c.dim(h.hito || "?")}: total ${h.total ?? "N/A"}${saved}`);
    }
  }

  return bad === 0 ? 0 : 1;
}

/** Detecta si ozali-jarvis está configurado en el proyecto y dónde. */
function detectJarvis(cwd) {
  const where = [];
  const hasBlock = (f) => exists(f) && fs.readFileSync(f, "utf8").includes(JARVIS_BEGIN);
  if (hasBlock(path.join(cwd, "CLAUDE.md"))) where.push("CLAUDE.md");
  if (hasBlock(path.join(cwd, "AGENTS.md"))) where.push("AGENTS.md");
  if (exists(path.join(cwd, ".claude", "agents", "ozali-jarvis.md"))) where.push("subagente");
  const oc = readJSON(path.join(cwd, "opencode.json"));
  if (oc && oc.agent && oc.agent["ozali-jarvis"]) where.push("opencode");
  return { present: where.length > 0, where };
}

function readStrictTdd(cwd, sot) {
  const f = path.join(cwd, sot.dir, "context", "tech-stack.md");
  if (!exists(f)) return { found: false };
  const txt = fs.readFileSync(f, "utf8");
  const m = txt.match(/Strict\s*TDD[:*\s]+(true|false)/i);
  return m ? { found: true, value: m[1].toLowerCase() } : { found: false };
}

// =========================================================== update ==========
// Lleva una instalación existente al paquete actual: refresca la skill ozali (con sus
// references), los perfiles de permisos y **crea/refresca ozali-jarvis** (clave para repos
// inicializados antes de 0.4.0). La skill `cdk` la regenera el AGENTE (no el CLI): se detecta
// y se guía la regeneración.
export async function update(cwd, opts = {}) {
  step("ozali update — actualizar la instalación al paquete actual");
  const env = detectAll(cwd);
  const cfgPath = CONFIG_PATH(cwd);
  const cfg = readJSON(cfgPath);
  if (!env.skill.installed && !cfg) {
    warn("No hay instalación de ozali en esta ruta. Corre " + c.bold("ozali init") + " primero.");
    return 1;
  }

  // 1) Skill ozali (incluye las references: la base desde la que el agente regenera cdk)
  //    + ozali-commit (commit convencional) + skill-generator como skills hermanas.
  if (env.skill.installed) {
    for (const p of env.skill.paths) {
      copyDir(SKILL_SRC, p);
      ok(`Skill ozali actualizada: ${path.relative(cwd, p) || p} → v${pkgVersion()}`);
      const commitDir = path.join(path.dirname(p), "ozali-commit");
      const freshCommit = !exists(commitDir);
      copyDir(COMMIT_SKILL_SRC, commitDir);
      ok(`Skill ozali-commit ${freshCommit ? "instalada" : "actualizada"}: ${path.relative(cwd, commitDir) || commitDir}`);
      const generatorDir = path.join(path.dirname(p), "skill-generator");
      const freshGenerator = !exists(generatorDir);
      copyDir(SKILL_GENERATOR_SRC, generatorDir);
      ok(`Skill skill-generator ${freshGenerator ? "instalada" : "actualizada"}: ${path.relative(cwd, generatorDir) || generatorDir}`);
    }
  } else {
    warn("Skill ozali no instalada en esta ruta (corre " + c.bold("ozali init") + " para instalarla).");
  }

  // Agente/scope: del config; si falta, infiere del entorno.
  const agent = (cfg && cfg.agent) || (env.agents.opencode.present && !env.agents.claudeCode.present ? "opencode"
    : env.agents.claudeCode.present && env.agents.opencode.present ? "both" : "claude-code");
  const scope = (cfg && cfg.scope) || "project";

  // 1b) Actualizar skills de ejecución en opencode si el agente lo requiere
  // Nota: ozali (bootstrap) no se instala localmente en opencode; el global es suficiente.
  if (agent === "opencode" || agent === "both") {
    const ocCommit = commitSkillTargetOpencode(cwd, scope);
    ensureDir(path.dirname(ocCommit));
    const freshOcCommit = !exists(ocCommit);
    copyDir(COMMIT_SKILL_SRC, ocCommit);
    ok(`Skill ozali-commit ${freshOcCommit ? "instalada" : "actualizada"} en opencode: ${path.relative(cwd, ocCommit) || ocCommit}`);
    const ocGen = skillGeneratorTargetOpencode(cwd, scope);
    const freshOcGen = !exists(ocGen);
    copyDir(SKILL_GENERATOR_SRC, ocGen);
    ok(`Skill skill-generator ${freshOcGen ? "instalada" : "actualizada"} en opencode: ${path.relative(cwd, ocGen) || ocGen}`);
  }

  // 1.5) Migrar skills heredadas locales (copsis-* → ozali-*)
  await migrateLegacySkills(cwd, opts, agent, scope);

  // 2) Perfiles base de permisos (idempotente: recoge defaults nuevos del paquete)
  if (agent === "claude-code" || agent === "both") ensureClaudeCodeProfile(cwd, scope);
  if (agent === "opencode" || agent === "both") ensureOpencodeProfile(cwd);

  // 3) ozali-jarvis: crea el orquestador en repos previos a 0.4.0 y refresca el resto.
  if (!opts.noJarvis) {
    const proj = projectName(cwd);
    const engPath = ENGRAM_CONFIG_PATH(cwd);
    if (!exists(engPath)) { writeJSON(engPath, { project_name: proj }); ok(`Proyecto de memoria fijado en ${c.bold(".engram/config.json")} (${proj}).`); }
    if (agent === "claude-code" || agent === "both") ensureJarvisClaudeCode(cwd);
    if (agent === "opencode" || agent === "both") ensureJarvisOpencode(cwd);
  }

  // 4) Skill cdk: la genera/migra el AGENTE (Fase 0.5/6); el CLI solo detecta versión y guía.
  const cdk = detectCdk(cwd);
  const cdkN = cdkCanonicalVersion();
  if (cdk.installed) {
    step("Skill cdk (generada por el agente)");
    const upToDate = cdk.version != null && cdk.version >= cdkN && !cdk.hasCopsis;
    if (upToDate) {
      ok(`cdk al día (contrato v${cdk.version}).`);
    } else {
      const reason = cdk.version == null ? "sin versión de contrato (cdk legado)"
        : cdk.version < cdkN ? `contrato v${cdk.version} < v${cdkN} (desactualizado)`
        : "contiene referencias a copsis-commit";
      warn(`cdk desactualizada: ${reason}.`);
      if (cdk.hasCopsis) warn("Detectadas referencias a " + c.bold("copsis-commit") + " (heredadas de versiones anteriores).");
      info("El CLI no regenera cdk. Actualízala manualmente desde tu agente:");
      info("  1. Abre tu agente en este proyecto.");
      info("  2. Corre la skill " + c.bold("ozali") + " (escribe " + c.bold('"ozali"') + "): el pre-flight migra cdk al contrato " + c.bold("v" + cdkN) + ", elimina copsis-commit y cablea ozali-commit.");
      info("Tus docs por hito (" + c.bold(".ozali/docs/cdk/") + ") y el plan congelado se conservan.");
    }
  } else {
    info("cdk aún no generada en este repo. Corre la skill " + c.bold("ozali") + " en tu agente para crearla.");
  }

  // 4.5) Engram version check (cooldown 24h)
  if (env.engram.available) {
    const versionCheck = checkEngramVersion();
    if (versionCheck && versionCheck.canUpgrade) {
      warn(`Hay una nueva versión de Engram: ${c.bold(versionCheck.latest)} (tienes ${versionCheck.current}).`);
      if (await confirm("¿Actualizar Engram ahora?", false)) {
        info("Actualizando Engram…");
        if (process.platform === "darwin" && which("brew")) {
          spawnCmd("brew", ["upgrade", "gentleman-programming/tap/engram"]);
        } else if (which("go")) {
          spawnCmd("go", ["install", "github.com/Gentleman-Programming/engram/cmd/engram@latest"]);
        } else {
          warn("No se puede auto-actualizar sin Homebrew (macOS) o Go. Descarga manual:");
          info("  " + c.cyan(versionCheck.url));
        }
      }
    } else if (versionCheck && versionCheck.cooldown) {
      info(`Engram ${c.bold(versionCheck.latest)} está disponible pero aún en cooldown de seguridad (24h). Se activará el ${new Date(new Date(versionCheck.publishedAt).getTime() + 24*60*60*1000).toLocaleDateString()}.`);
    }
  }

  // 4.6) Obsidian check
  if (!env.obsidian.installed) {
    warn("Obsidian no detectado. Es el visualizador recomendado para el vault de conocimiento.");
    const installObsidian = opts.yes ? false : await confirm("¿Abrir la página de descarga de Obsidian?", false);
    if (installObsidian) {
      openURL("https://obsidian.md/download");
      info("Descarga e instala Obsidian, luego corre " + c.bold("ozali sync --obsidian") + " para generar el vault.");
    }
  }

  // 5) versión del config
  if (cfg) { cfg.version = pkgVersion(); cfg.updatedAt = new Date().toISOString(); writeJSON(cfgPath, normalizeConfig(cfg, cwd)); }
  ok(`Instalación al día con ozali v${pkgVersion()}.`);
  return 0;
}

/**
 * Migra skills heredadas de versiones anteriores (copsis-* → ozali-*).
 * - copsis-commit/ → ozali-commit/ (reemplaza contenido con la skill vigente)
 * - copsis-doctor/ → eliminada (reemplazada por CLI `ozali doctor` + skill `ozali`)
 * Si ozali-commit o skill-generator no están en local pero hay heredadas locales,
 * los instala en el proyecto.
 */
async function migrateLegacySkills(cwd, opts = {}, agent = "claude-code", scope = "project") {
  const { detectLegacySkills } = await import("./detect.mjs");
  const legacy = detectLegacySkills(cwd);
  if (legacy.length === 0) return;

  step("Migrando skills heredadas");
  for (const item of legacy) {
    if (item.name === "copsis-commit") {
      const target = path.join(cwd, ".claude", "skills", "ozali-commit");
      // Si ya existe ozali-commit, solo eliminamos la heredada
      if (exists(target)) {
        info(`Skill ${c.bold("ozali-commit")} ya existe; eliminando heredada ${c.bold(item.name)}.`);
      } else {
        info(`Migrando ${c.bold(item.name)} → ${c.bold("ozali-commit")}.`);
        copyDir(COMMIT_SKILL_SRC, target);
        ok(`Skill ${c.bold("ozali-commit")} instalada en ${c.bold(path.relative(cwd, target) || target)}.`);
      }
      // También en opencode si aplica
      if (agent === "opencode" || agent === "both") {
        const ocTarget = commitSkillTargetOpencode(cwd, scope);
        if (!exists(ocTarget)) {
          copyDir(COMMIT_SKILL_SRC, ocTarget);
          ok(`Skill ${c.bold("ozali-commit")} instalada en opencode: ${c.bold(path.relative(cwd, ocTarget) || ocTarget)}.`);
        }
      }
      // Eliminar heredada
      try {
        fs.rmSync(item.path, { recursive: true, force: true });
        ok(`Heredada ${c.bold(item.name)} eliminada.`);
      } catch (e) {
        warn(`No pude eliminar ${item.path}: ${e.message}`);
      }
    } else if (item.name === "copsis-doctor") {
      info(`Eliminando heredada ${c.bold(item.name)} (reemplazada por CLI ${c.bold("ozali doctor")} + skill ${c.bold("ozali")}).`);
      try {
        fs.rmSync(item.path, { recursive: true, force: true });
        ok(`Heredada ${c.bold(item.name)} eliminada.`);
      } catch (e) {
        warn(`No pude eliminar ${item.path}: ${e.message}`);
      }
    }
  }

  // Si hay heredadas locales, asegurar que skill-generator también esté local
  const localGenerator = path.join(cwd, ".claude", "skills", "skill-generator");
  if (!exists(localGenerator)) {
    info(`Instalando skill ${c.bold("skill-generator")} localmente (detectadas heredadas en el proyecto).`);
    copyDir(SKILL_GENERATOR_SRC, localGenerator);
    ok(`Skill ${c.bold("skill-generator")} instalada en ${c.bold(path.relative(cwd, localGenerator) || localGenerator)}.`);
  }
  // También en opencode si aplica
  if (agent === "opencode" || agent === "both") {
    const ocGen = skillGeneratorTargetOpencode(cwd, scope);
    if (!exists(ocGen)) {
      copyDir(SKILL_GENERATOR_SRC, ocGen);
      ok(`Skill ${c.bold("skill-generator")} instalada en opencode: ${c.bold(path.relative(cwd, ocGen) || ocGen)}.`);
    }
  }
}

/**
 * ¿Existe la skill cdk (generada por el agente)? Devuelve además la versión de contrato
 * estampada en su frontmatter (`cdk_contract_version`) y si aún referencia `copsis-commit`.
 * version === null ⇒ cdk legado (sin marcador de versión).
 */
function detectCdk(cwd) {
  const paths = [
    path.join(cwd, ".claude", "skills", "cdk", "SKILL.md"),
    path.join(HOME, ".claude", "skills", "cdk", "SKILL.md"),
  ].filter(exists);
  if (paths.length === 0) return { installed: false, paths: [], version: null, hasCopsis: false };
  let version = null;
  let hasCopsis = false;
  for (const f of paths) {
    const txt = fs.readFileSync(f, "utf8");
    if (version === null) {
      const m = txt.match(/cdk_contract_version:\s*(\d+)/i);
      if (m) version = parseInt(m[1], 10);
    }
    if (/copsis-commit/i.test(txt)) hasCopsis = true;
  }
  return { installed: true, paths, version, hasCopsis };
}

/** Versión de contrato vigente de cdk (fuente única: skill/references/cdk-contract.md del paquete). */
function cdkCanonicalVersion() {
  try {
    const txt = fs.readFileSync(path.join(SKILL_SRC, "references", "cdk-contract.md"), "utf8");
    const m = txt.match(/CDK_CONTRACT_VERSION:\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  } catch {
    return 1;
  }
}

// =========================================================== install-engram ===
export async function installEngramCmd(cwd, opts) {
  step("ozali install-engram — instalar o reparar Engram bajo demanda");
  const env = detectAll(cwd);
  const cfg = readJSON(CONFIG_PATH(cwd));
  let needsInstall = !env.engram.available;

  if (env.engram.available) {
    const online = tryExec("engram", ["doctor"], { cwd }) !== null;
    if (online && !opts.force) {
      ok(`Engram ya está instalado y responde (${env.engram.bin}).`);
      info("Usa --force si quieres forzar una reinstalación.");
    } else if (online && opts.force) {
      warn("Forzando reinstalación de Engram (--force)…");
      needsInstall = true;
    } else {
      warn("Engram está en PATH pero no responde (engram doctor falló). Reinstalando…");
      needsInstall = true;
    }
  }

  if (needsInstall) {
    if (opts.dryRun) {
      info("(dry-run) Aquí instalaría Engram.");
      return 0;
    }
    const installed = installEngram();
    if (!installed) {
      warn("No se pudo instalar Engram automáticamente.");
      printEngramManualInstructions(cfg?.agent || "both");
      return 1;
    }
  }

  // Configurar agente MCP
  let agent = opts.agent || (cfg && cfg.agent);
  if (!agent && !opts.yes) {
    agent = await select("¿Para qué agente configuro Engram?", [
      { value: "claude-code", label: "Claude Code" },
      { value: "opencode", label: "opencode" },
      { value: "both", label: "Ambos" },
    ], 2);
  } else if (!agent) {
    agent = "both";
  }

  if (agent === "claude-code" || agent === "both") {
    info("Registrando MCP en Claude Code…");
    spawnCmd("engram", ["setup", "claude-code"]);
  }
  if (agent === "opencode" || agent === "both") {
    info("Registrando MCP en opencode…");
    spawnCmd("engram", ["setup", "opencode"]);
  }

  // Actualizar config de ozali si existe
  if (cfg) {
    let wrote = false;
    if (cfg.memoryMode === "docs") {
      cfg.memoryMode = "hybrid";
      wrote = true;
      ok("Modo de memoria actualizado a " + c.bold("hybrid") + " en .ozali/config.json.");
    }
    if (!cfg.agent) {
      cfg.agent = agent;
      wrote = true;
    }
    if (wrote) writeJSON(CONFIG_PATH(cwd), normalizeConfig(cfg, cwd));
  } else {
    warn("No hay configuración de ozali en esta ruta (corre " + c.bold("ozali init") + " para completar el setup).");
    info("Engram quedó instalado; solo falta el config de ozali para integrarlo al flujo.");
  }

  ok("Engram listo. Reinicia tu agente para que cargue el servidor MCP de Engram.");
  return 0;
}

// ============================================================= sync ===========
export async function sync(cwd, opts) {
  step(`ozali sync${opts.import ? " --import" : ""}${opts.cloud ? " --cloud" : ""} — histórico ↔ repo de conocimiento`);
  const cfg = readJSON(CONFIG_PATH(cwd));
  if (!cfg || !cfg.knowledgeRepo) { warn("Sin repo de conocimiento configurado. Corre " + c.bold("ozali init") + "."); return 1; }
  const kRepo = fromPortablePath(cfg.knowledgeRepo, cwd);
  if (!exists(kRepo)) { err(`El repo de conocimiento no existe: ${kRepo}`); return 1; }
  const project = cfg.project || projectName(cwd);
  const projDir = path.join(kRepo, "projects", project);
  const docsLocal = path.join(cwd, ".ozali", "docs");
  const engramLocal = path.join(cwd, ".engram");

  // Engram Cloud (opt-in): réplica bidireccional adicional al git-sync.
  if (opts.cloud) {
    const cloudMeta = readTeamCloud(cwd);
    const cloudEnabled = (cfg.cloud && cfg.cloud.enabled) || (cloudMeta && cloudMeta.enrolled);
    if (cloudEnabled && tryExec("engram", ["--version"])) {
      if (!hasCloudToken() && cloudMeta && cloudMeta.auth_required !== false) {
        warn(`El servidor cloud puede requerir autenticación. Define ${c.bold(CLOUD_TOKEN_ENV)} si falla el sync.`);
      }
      const cloudServer = firstNonEmpty(cloudMeta && cloudMeta.server, cfg.cloud && cfg.cloud.server);
      if (cloudServer && process.env[CLOUD_SERVER_ENV] === undefined) process.env[CLOUD_SERVER_ENV] = cloudServer;

      if (opts.import) {
        // --- onboarding inverso: pull desde cloud ---
        info(`Recibiendo memoria del equipo desde Engram Cloud (proyecto "${project}")…`);
        const pullOut = tryExec("engram", ["sync", "--cloud", "--import", "--project", project], { cwd });
        if (pullOut !== null) {
          ok("Pull desde Engram Cloud completado.");
          if (pullOut.trim()) printIndented(pullOut);
          // Importar los chunks locales que llegaron vía cloud
          if (spawnCmd("engram", ["sync", "--import"], { cwd }) === 0) ok("Memorias cloud importadas a Engram local.");
          else warn("engram sync --import no terminó correctamente tras el pull cloud.");
          // Verificación
          const verify = tryExec("engram", ["cloud", "status", "--project", project], { cwd });
          if (verify) { info("Estado de cloud:"); printIndented(verify); }
        } else {
          const reason = extractReasonCode(pullOut);
          warn(`engram sync --cloud --import no terminó correctamente${reason ? ` (motivo: ${reason})` : ""}.`);
          if (reason === "blocked_unenrolled") info("El proyecto no está enrolado en el servidor. Corre " + c.bold("ozali init") + " para enrolarlo.");
        }
      } else {
        // --- push a cloud (default) ---
        info(`Replicando con Engram Cloud (proyecto "${project}")…`);
        const out = syncCloudProject(cwd, project);
        if (out !== null) {
          ok("Réplica con Engram Cloud completada.");
          if (out.trim()) printIndented(out);
        } else {
          const reason = extractReasonCode(out);
          warn(`engram sync --cloud no terminó correctamente${reason ? ` (motivo: ${reason})` : ""}. Revisa el output de arriba.`);
          if (reason === "blocked_unenrolled") info("El proyecto no está enrolado en el servidor. Corre " + c.bold("ozali init") + " para enrolarlo.");
          if (reason === "transport_failed") info("No se pudo conectar al servidor cloud. Verifica la URL y tu conexión.");
        }
      }
    } else if (!cloudEnabled) {
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

  // 2.5) Obsidian vault export
  const vaultPath = path.join(kRepo, "obsidian");
  if (opts.obsidian) {
    await exportObsidianVault(kRepo, project, vaultPath);
  } else if (exists(vaultPath) && !opts.yes) {
    if (await confirm("¿Exportar memoria a Obsidian vault?", true)) {
      await exportObsidianVault(kRepo, project, vaultPath);
    }
  }

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

/**
 * Inicializa la estructura base del vault de Obsidian en el repo de conocimiento.
 * Copia templates desde `templates/obsidian-vault/` si el vault aún no existe.
 * No requiere Engram (a diferencia de exportObsidianVault).
 */
async function initObsidianVault(kRepo, opts = {}) {
  const vaultPath = path.join(kRepo, "obsidian");
  if (exists(vaultPath)) {
    info(`Vault de Obsidian ya existe en ${path.relative(kRepo, vaultPath)}.`);
    return;
  }
  ensureDir(vaultPath);
  const templateDir = path.join(TEMPLATES_SRC, "obsidian-vault");
  if (exists(templateDir)) {
    copyDir(templateDir, vaultPath);
    ok(`Vault de Obsidian inicializado en ${c.bold(path.relative(kRepo, vaultPath) || "obsidian")}.`);
    info(`Para abrirlo: abre Obsidian → "Open folder as vault" → seleccioná "${vaultPath}".`);
    if (opts.yes) {
      info(`Usá ${c.bold("ozali sync --obsidian")} para regenerar los MOCs cuando tengas proyectos.`);
    } else {
      const openNow = opts.yes ? false : await confirm("¿Abrir el vault en Obsidian ahora?", false);
      if (openNow) {
        openURL("obsidian://open?path=" + encodeURIComponent(vaultPath));
        info("Si Obsidian no se abrió automáticamente, abrilo manualmente y seleccioná el vault.");
      }
    }
  } else {
    warn("Templates de Obsidian no encontrados en el paquete. Vault no inicializado.");
  }
}

/**
 * Exporta la memoria de Engram a un vault de Obsidian compatible.
 * 1) Copia templates base si no existen.
 * 2) Genera MOCs dinámicos (proyectos) desde knowledgeRepo/projects/.
 * 3) Ejecuta `engram obsidian-export`.
 */
async function exportObsidianVault(kRepo, project, vaultPath) {
  if (!tryExec("engram", ["--version"])) {
    warn("Engram no está disponible. No se puede exportar a Obsidian.");
    return;
  }
  ensureDir(vaultPath);
  // 1) Templates base
  const templateDir = path.join(TEMPLATES_SRC, "obsidian-vault");
  if (exists(templateDir)) {
    for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
      const src = path.join(templateDir, entry.name);
      const dst = path.join(vaultPath, entry.name);
      if (entry.isDirectory()) {
        if (!exists(dst)) copyDir(src, dst);
      } else if (!exists(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }
  // 2) MOC dinámico — Proyectos
  const projectsDir = path.join(kRepo, "projects");
  const projectsMoc = path.join(vaultPath, "MOCs", "Proyectos.md");
  if (exists(projectsDir)) {
    const projects = [];
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) projects.push(entry.name);
    }
    const list = projects.map((p) => `- [[${p}]] — proyecto activo`).join("\n");
    const body = fs.readFileSync(projectsMoc, "utf8");
    const updated = body.replace(
      /<!-- PROJECTS_START -->[\s\S]*?<!-- PROJECTS_END -->/,
      `<!-- PROJECTS_START -->\n${list || "- Sin proyectos activos todavía."}\n<!-- PROJECTS_END -->`
    );
    fs.writeFileSync(projectsMoc, updated);
  }
  // 3) Export Engram
  info("Exportando memoria a Obsidian vault…");
  const out = tryExec("engram", ["obsidian-export", "--vault", vaultPath, "--project", project, "--graph-config", "preserve"]);
  if (out !== null) {
    ok("Obsidian vault actualizado.");
  } else {
    warn("engram obsidian-export falló. Revisa que el vault esté cerrado en Obsidian.");
  }
}

// ============================================================ audit ===========
// Navega/audita la memoria de Engram: del proyecto actual o general (todos los
// proyectos). Sin contexto de proyecto en la ruta → general. Sin Engram → audita
// el histórico local de documentos.
export async function audit(cwd, opts) {
  step("ozali audit — auditoría de memoria (Engram)");
  const env = detectAll(cwd);
  const cfg = readJSON(CONFIG_PATH(cwd));
  const engramCfg = readJSON(ENGRAM_CONFIG_PATH(cwd));
  const project = (engramCfg && engramCfg.project_name) || (cfg && cfg.project) || projectName(cwd);
  const hasProjectContext = env.git.isRepo || !!cfg || !!engramCfg;

  // Resolver alcance: --general fuerza general; sin contexto → general; en repo se propone elegir.
  let scope = (opts.general || !hasProjectContext) ? "general" : "project";
  if (!hasProjectContext) info("Sin contexto de proyecto en esta ruta → auditoría " + c.bold("general") + ".");
  else if (scope === "project" && !opts.general && !opts.yes) {
    scope = await select("¿Qué auditoría quieres?", [
      { value: "project", label: `Proyecto (${c.bold(project)})` },
      { value: "general", label: "General (todos los proyectos en Engram)" },
    ], 0);
  }

  // Sin Engram → auditar el histórico local de documentos.
  if (!env.engram.available) {
    warn("Engram no está instalado → auditoría desde documentos locales.");
    return auditFromDocs(cwd, project);
  }

  // Fase 4.1: --dashboard abre el dashboard de Engram Cloud
  if (opts.dashboard) {
    const cloudMeta = readTeamCloud(cwd);
    const dash = (cloudMeta && cloudMeta.dashboard) || (cloudMeta && cloudMeta.server ? cloudDashboardURL(cloudMeta.server) : null);
    if (!dash) { warn("No hay Engram Cloud configurado. Corre " + c.bold("ozali init") + " primero."); return 1; }
    info(`Abriendo dashboard: ${c.cyan(dash)}`);
    openURL(dash);
    return 0;
  }

  // Fase 4.1: --conflicts lista/stats conflictos de memoria
  if (opts.conflicts) {
    const projArg = scope === "project" ? ["--project", project] : [];
    if (opts.stats) {
      step(`Estadísticas de conflictos${scope === "project" ? ` — ${project}` : ""}`);
      const out = tryExec("engram", ["conflicts", "stats", ...projArg], { cwd });
      if (out) printIndented(out);
      else warn("No se pudieron obtener estadísticas de conflictos.");
    } else {
      const statusFlag = opts.judged ? ["--status", "judged"] : [];
      step(`Conflictos${opts.judged ? " juzgados" : " pendientes"}${scope === "project" ? ` — ${project}` : ""}`);
      const out = tryExec("engram", ["conflicts", "list", ...statusFlag, ...projArg], { cwd });
      if (out) printIndented(out);
      else warn("No se pudieron listar conflictos.");
    }
    return 0;
  }

  // Navegador interactivo.
  if (opts.tui) {
    info("Abriendo el navegador interactivo de Engram (engram tui)…");
    return spawnCmd("engram", ["tui"], { cwd });
  }

  if (scope === "general") {
    step("Proyectos en Engram");
    spawnCmd("engram", ["projects", "list"], { cwd });
    step("Estadísticas (global)");
    spawnCmd("engram", ["stats"], { cwd });
    step("Contexto reciente");
    spawnCmd("engram", ["context"], { cwd });
  } else {
    step(`Contexto reciente — ${project}`);
    spawnCmd("engram", ["context", project], { cwd });
    step("Estadísticas (global)");
    spawnCmd("engram", ["stats"], { cwd });
  }
  if (opts.search) {
    step(`Búsqueda: "${opts.search}"`);
    spawnCmd("engram", ["search", opts.search], { cwd });
  }
  info("Navegación interactiva: " + c.bold("ozali audit --tui") + "  ·  búsqueda: " + c.bold('ozali audit --search "<texto>"'));
  return 0;
}

function auditFromDocs(cwd, project) {
  const docsDir = path.join(cwd, ".ozali", "docs", "cdk");
  if (exists(docsDir)) {
    step(`Hitos documentados localmente — ${project}`);
    const hitos = fs.readdirSync(docsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (hitos.length) for (const e of hitos) console.log("  • " + e.name);
    else info("Aún no hay hitos en .ozali/docs/cdk/.");
  } else {
    info("No hay histórico local en .ozali/docs/cdk/ todavía.");
  }
  const metrics = readJSON(path.join(cwd, ".ozali", "metrics", "token-metrics.json"));
  if (metrics && Array.isArray(metrics.hits) && metrics.hits.length) {
    step("Uso de tokens (últimos hitos)");
    for (const h of metrics.hits.slice(-5)) console.log(`  ${c.dim(h.hito || "?")}: total ${h.total ?? "N/A"}`);
  }
  info("Instala Engram para auditoría buscable/acumulativa (" + c.bold("ozali doctor") + ").");
  return 0;
}

// ============================================================= cloud ===========
export async function cloud(cwd, opts) {
  const sub = opts._[1] || "status";
  const cfg = readJSON(CONFIG_PATH(cwd));
  const cloudMeta = readTeamCloud(cwd);
  const project = (cfg && cfg.project) || projectName(cwd);
  const cloudServer = firstNonEmpty(cloudMeta && cloudMeta.server, cfg && cfg.cloud && cfg.cloud.server);

  switch (sub) {
    case "status": {
      step(`ozali cloud status — proyecto "${project}"`);
      if (!tryExec("engram", ["--version"])) { warn("Engram no responde."); return 1; }
      if (cloudServer && process.env[CLOUD_SERVER_ENV] === undefined) process.env[CLOUD_SERVER_ENV] = cloudServer;
      const status = tryExec("engram", ["cloud", "status", "--project", project], { cwd });
      if (status) { info("Estado:"); printIndented(status); }
      else { warn("No se pudo obtener el estado de cloud."); }
      const upgrade = tryExec("engram", ["cloud", "upgrade", "status", "--project", project], { cwd });
      if (upgrade) { info("Upgrade:"); printIndented(upgrade); }
      return 0;
    }

    case "upgrade": {
      step(`ozali cloud upgrade — proyecto "${project}"`);
      if (!tryExec("engram", ["--version"])) { warn("Engram no responde."); return 1; }
      if (cloudServer && process.env[CLOUD_SERVER_ENV] === undefined) process.env[CLOUD_SERVER_ENV] = cloudServer;
      // 1) doctor (checkpoint)
      info("Paso 1/3: Verificando estado actual…");
      const status = tryExec("engram", ["cloud", "status", "--project", project], { cwd });
      if (status) printIndented(status);
      // 2) repair --dry-run
      info("Paso 2/3: Simulando repair (dry-run)…");
      const dryRun = tryExec("engram", ["cloud", "upgrade", "repair", "--dry-run", "--project", project], { cwd });
      if (dryRun) printIndented(dryRun);
      const doApply = await confirm("¿Aplicar el repair ahora?", true);
      if (!doApply) { info("Upgrade cancelado. Puedes aplicarlo después con " + c.bold("ozali cloud repair") + "."); return 0; }
      // 3) repair --apply + bootstrap
      info("Paso 3/3: Aplicando repair…");
      const repairOut = tryExec("engram", ["cloud", "upgrade", "repair", "--apply", "--project", project], { cwd });
      if (repairOut !== null) { ok("Repair aplicado."); if (repairOut.trim()) printIndented(repairOut); }
      else { warn("Repair falló. Revisa el output de arriba."); return 1; }
      const boot = tryExec("engram", ["cloud", "upgrade", "bootstrap", "--project", project], { cwd });
      if (boot !== null) { ok("Bootstrap completado."); if (boot.trim()) printIndented(boot); }
      else warn("Bootstrap falló. Corre " + c.bold("ozali cloud status") + " para ver el estado.");
      return 0;
    }

    case "repair": {
      step(`ozali cloud repair — proyecto "${project}"`);
      if (!tryExec("engram", ["--version"])) { warn("Engram no responde."); return 1; }
      if (cloudServer && process.env[CLOUD_SERVER_ENV] === undefined) process.env[CLOUD_SERVER_ENV] = cloudServer;
      const out = tryExec("engram", ["cloud", "upgrade", "repair", "--apply", "--project", project], { cwd });
      if (out !== null) { ok("Repair aplicado."); if (out.trim()) printIndented(out); return 0; }
      warn("Repair falló. Revisa el output de arriba.");
      return 1;
    }

    case "dashboard": {
      const dash = cloudMeta && cloudMeta.dashboard ? cloudMeta.dashboard : (cloudServer ? cloudDashboardURL(cloudServer) : null);
      if (!dash) { warn("No hay servidor cloud configurado. Corre " + c.bold("ozali init") + " primero."); return 1; }
      info(`Abriendo dashboard: ${c.cyan(dash)}`);
      openURL(dash);
      return 0;
    }

    case "config": {
      step("ozali cloud config");
      if (cloudMeta && cloudMeta.enrolled) {
        info(`Servidor: ${c.bold(cloudMeta.server || "no definido")}`);
        info(`Proyecto: ${c.bold(cloudMeta.project || project)}`);
        info(`Token: ${hasCloudToken() ? c.green("✓ configurado") : c.yellow("✗ no configurado")}`);
        info(`Dashboard: ${cloudMeta.dashboard ? c.cyan(cloudMeta.dashboard) : "no disponible"}`);
        info(`Autosync: ${c.bold(CLOUD_AUTOSYNC_ENV)}=${process.env[CLOUD_AUTOSYNC_ENV] || "no definido"}`);
        const reconfig = await confirm("¿Reconfigurar el servidor?", false);
        if (!reconfig) return 0;
      }
      const server = await ask("URL del servidor de Engram Cloud", cloudMeta && cloudMeta.server || "http://127.0.0.1:18080");
      const token = await ask("Token de autenticación");
      if (!token) { warn("Sin token no se puede configurar (modo autenticado obligatorio)."); return 1; }
      spawnCmd("engram", ["cloud", "config", "--server", server]);
      process.env[CLOUD_TOKEN_ENV] = token;
      if (spawnCmd("engram", ["cloud", "enroll", project]) === 0) {
        writeTeamCloud(cwd, { enabled: true, server, project, authRequired: true });
        configureCloudAutosync(cwd, opts);
        persistCloudToken(token, opts);
        ok("Engram Cloud reconfigurado.");
        return 0;
      }
      warn("No se pudo enrolar el proyecto. Verifica el servidor y el token.");
      return 1;
    }

    default:
      err(`Subcomando desconocido "${sub}". Usa: status | upgrade | repair | dashboard | config`);
      return 1;
  }
}

// ===================================================== session-state =========
// Helpers para micro-checkpoints en disco (.ozali/.session-state.json).
// Usados por CDK (skill cdk) para guardar/reanudar estado de hito interrumpido.

const SESSION_STATE_PATH = (cwd) => path.join(cwd, ".ozali", ".session-state.json");

/** Escribe el estado de sesión de un hito en disco (sobrescribe). */
export function writeSessionState(cwd, state) {
  const p = SESSION_STATE_PATH(cwd);
  const payload = {
    ...state,
    last_updated: new Date().toISOString(),
  };
  ensureDir(path.dirname(p));
  writeJSON(p, payload);
}

/** Lee el estado de sesión de disco. Devuelve null si no existe. */
export function readSessionState(cwd) {
  return readJSON(SESSION_STATE_PATH(cwd));
}

/** Borra el estado de sesión de disco (hito completado). */
export function clearSessionState(cwd) {
  const p = SESSION_STATE_PATH(cwd);
  if (exists(p)) {
    try { fs.unlinkSync(p); } catch { /* noop */ }
  }
}
