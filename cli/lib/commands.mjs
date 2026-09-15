// commands.mjs — implementación de init / doctor / update / sync.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  c, ok, warn, err, info, step,
  SKILL_SRC, COMMIT_SKILL_SRC, SKILL_GENERATOR_SRC, TEMPLATES_SRC, exists, ensureDir, copyDir, readJSON, writeJSON,
  ensureGitignore, pruneGitignore, GITIGNORE_OBSOLETE, gitTracks, migrateClaudeModelAliases,
  findAbstractModelFrontmatters, resolveModelForLevel, setFrontmatterModel,
  tryExec, spawnCmd, which, engramAssetName, pickEngramAsset,
  isTrustedEngramURL, checksumsURLFor, parseChecksums, slimReleases, readReleasesCache,
  projectName, pkgVersion, DEFAULT_KNOWLEDGE, HOME, openURL, gitInfo,
  toPortablePath, fromPortablePath, parseSemver, compareSemver,
} from "./util.mjs";
import { detectAll, detectSourceOfTruth, detectWorkspace, detectReferences, findWorkspaceRootUp, detectEngramMcpServer,
} from "./detect.mjs";
import { ask, confirm, select } from "./prompt.mjs";

const CONFIG_PATH = (cwd) => path.join(cwd, ".ozali", "config.json");
const CONFIG_LOCAL_PATH = (cwd) => path.join(cwd, ".ozali", "config.local.json");
const TEAM_CLOUD_PATH = (cwd) => path.join(cwd, ".ozali", "cloud.json");

// Lo único de ozali que NO va al repo es lo local y derivado: backups de skills (pesados), el
// state de sesión (cambia en cada corrida) y la telemetría de tokens — un caché que cdk reescribe
// en cada hito para que `doctor` muestre la tendencia sin consultar el MCP. La copia durable de
// esas métricas vive en Engram (`cdk/_project/token-metrics`) y en el doc `06-uso-tokens.md` del
// hito, que sí se commitea. El resto de .ozali/ —config.json, docs— es del equipo.
const GITIGNORE_ENTRIES = [
  ".ozali/backups/",
  ".ozali/.session-state.json",
  ".ozali/metrics/",
  ".engram/",
];

/** Lee config.json y mergea config.local.json encima (local gana, igual que .claude/settings.local.json). */
function readMergedConfig(cwd) {
  const base = readJSON(CONFIG_PATH(cwd)) || {};
  const local = readJSON(CONFIG_LOCAL_PATH(cwd)) || {};
  if (Object.keys(local).length === 0) return base;
  // shallow merge: las claves de primer nivel en local sobrescriben base
  return { ...base, ...local };
}
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
  // Contrato cdk v6: los modelos de Claude se guardan como alias (haiku/sonnet/opus).
  if (cfg && cfg.agents && cfg.agents.models && cfg.agents.models.claude) {
    const { models } = migrateClaudeModelAliases(cfg.agents.models.claude);
    cfg.agents.models.claude = models;
  }
  return cfg;
}

/** Resuelve el modo de memoria leyendo `mode` o el legacy `memoryMode`. */
function resolveMode(cfg) {
  if (!cfg) return "docs";
  return cfg.mode || cfg.memoryMode || "docs";
}

/** Devuelve defaults de rutas de ozali. */
function defaultPathsConfig() {
  return {
    docsPath: ".ozali/docs",
    metricsPath: ".ozali/metrics",
    sessionState: ".ozali/.session-state.json",
  };
}

/** Devuelve defaults de testing (se calibra en Fase 3.5 del bootstrap). */
function defaultTestingConfig(env = {}) {
  const runners = env.testing && env.testing.runners ? env.testing.runners : [];
  return {
    strict_tdd: runners.length > 0,
    runner: runners.length > 0 ? runners.join(", ") : null,
    greenCommand: null,
    singleTestCommand: null,
  };
}

/** Devuelve la sección agents con defaults por agente (vigente desde v0.15.0). */
function defaultAgentsConfig() {
  return {
    models: {
      // Alias, no IDs con versión: el contrato cdk v6 los estampa tal cual en el
      // frontmatter `model:` y no envejecen cuando sale la familia siguiente.
      claude: {
        low: "haiku",
        medium: "sonnet",
        high: "opus",
      },
      opencode: {
        low: "kimi-k3",
        medium: "deepseek-v4-pro",
        high: "mimo-v2.5",
      },
      mapping: {
        "project-analyzer": "high",
        "project-owner": "high",
        ozali: "high",
        executioners: "high",
        "project-orchestrator": "medium",
        "ozali-jarvis": "medium",
        cdk: "medium",
        "project-manager": "medium",
        "project-proposer": "medium",
        "skill-generator": "medium",
        tester: "medium",
        "project-documenter": "medium",
        "ozali-commit": "low",
      },
      hybridRules: {
        "project-documenter": {
          description:
            "Si la documentación es técnica (arquitectura, análisis de impacto, resumen técnico), usa high. Si es sencilla (prompt de entrada, resumen de usuario), usa medium.",
          highTriggers: ["03-resumen-tecnico.md", "05-bitacora-ejecucion.md"],
          mediumTriggers: ["01-prompt-entrada.md", "04-resumen-usuario.md", "06-uso-tokens.md"],
        },
        tester: {
          description:
            "Ejecutar tests y reportar pass/fail usa low. Si hay fallos, re-interpretar la causa raíz usa medium.",
          lowPhase: "ejecucion-de-tests",
          mediumPhase: "diagnostico-de-fallos",
        },
      },
    },
  };
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
    mode: (existing && (existing.mode || existing.memoryMode)) || "docs",
    frozen: existing.frozen !== undefined ? existing.frozen : false,
    ...defaultPathsConfig(),
    agents: (existing && existing.agents) ? existing.agents : defaultAgentsConfig(),
    testing: (existing && existing.testing) ? existing.testing : defaultTestingConfig(),
    ...extraConfig,
  };
  // Normalizar: si extraConfig trajo memoryMode (legacy), convertir a mode.
  if (config.memoryMode && !config.mode) {
    config.mode = config.memoryMode;
    delete config.memoryMode;
  }
  writeJSON(CONFIG_PATH(cwd), normalizeConfig(config, cwd));
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

  if (env.node.needsNode && !env.node.ok) warn(`Node ${env.node.version} detectado; ozali y el harness piden ≥16. Continúo, pero actualiza si ves errores.`);
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

  // Scope: si ya existe skill global, default global para evitar duplicados;
  // si no, default project (primer uso, prueba local).
  const hasGlobalSkill = exists(path.join(HOME, ".claude", "skills", "ozali", "SKILL.md"))
    || exists(path.join(HOME, ".config", "opencode", "skills", "ozali", "SKILL.md"));
  const scopeDefaultIndex = hasGlobalSkill ? 0 : 1;
  const scope = opts.scope || await select("¿Dónde instalo la skill?", [
    { value: "global", label: `Global (${c.dim("~/.claude/skills/ozali")})` },
    { value: "project", label: `Proyecto (${c.dim(".claude/skills/ozali")})` },
  ], scopeDefaultIndex);
  if (hasGlobalSkill && scope === "global") {
    info("Detecté la skill ozali globalmente; uso global para evitar duplicados en el panel de skills.");
  }

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
    // Verificar que el plugin MCP esté realmente habilitado (no solo el binario)
    if (agent === "claude-code" || agent === "both") {
      if (!env.engramPlugin.enabled) warnEngramPluginStatus(env.engramPlugin, "Claude Code");
      else if (!env.engramMcp.registered) warnEngramMcpServer(env.engramMcp);
    }
    if ((agent === "opencode" || agent === "both") && !env.engramOpencode.enabled) {
      warnEngramOpencodeStatus(env.engramOpencode);
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
        info("Importante: tras reiniciar, abre " + c.bold("/plugin") + " en Claude Code y habilita " + c.bold("engram@engram") + " (instalar para mí) si aún no lo está.");
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

  // 3) gitignore: .ozali/ se commitea (config del equipo); fuera solo el ruido local.
  if (env.git.isRepo) {
    const { removed } = pruneGitignore(cwd, GITIGNORE_OBSOLETE);
    const { added } = ensureGitignore(cwd, GITIGNORE_ENTRIES);
    if (removed.length) ok(`.gitignore: reglas obsoletas retiradas (${removed.join(", ")}) — .ozali/ ahora se commitea.`);
    if (added.length) ok(`.gitignore actualizado: ${added.join(", ")} (ruido local fuera del repo).`);
    else if (!removed.length) info(".gitignore ya estaba al día.");
  }

  // 4-5) repo de conocimiento + config local (reutiliza helper)
  const config = await initKnowledgeRepo(cwd, opts, { agent, scope, mode: memoryMode, cloud }, knowledgeRepoRaw);

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
  // Usa el mismo caché de 6h que la instalación: `doctor` corre a menudo y no debe
  // gastar el cupo de la API en cada invocación.
  const res = fetchEngramReleases({ quiet: true });
  if (!res) return null;
  const releases = res.releases;
  if (!Array.isArray(releases)) return null;
  const now = Date.now();
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const m = /^v(\d+\.\d+\.\d+)$/.exec(r.tag_name || "");
    if (!m) continue;
    const latest = m[1];
    const cmp = compareSemver(latest, current);
    if (!cmp.ahead) break; // no hay nada más nuevo
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
const ENGRAM_RELEASES_PATH = "repos/Gentleman-Programming/engram/releases?per_page=30";
const RELEASES_CACHE_FILE = path.join(HOME, ".ozali", "cache", "engram-releases.json");
const RELEASES_TTL_MS = 6 * 60 * 60 * 1000; // 6h: suficiente para no repegarle a la API en cada repo

/**
 * GET de texto con curl (o wget). Fuerza HTTPS también en los redirects: sin esto un
 * redirect a `http://` degradaría la conexión y abriría la puerta a un MITM.
 * Devuelve el body o null si no hay red/herramienta.
 */
function fetchText(url) {
  if (which("curl")) return tryExec("curl", ["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60", url]);
  if (which("wget")) return tryExec("wget", ["-qO-", "--https-only", "--max-redirect=5", "--timeout=60", url]);
  return null;
}

/** Token de GitHub del entorno, si el dev ya tiene uno exportado. "" si no hay. */
function githubToken() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
}

/**
 * GET a la API de GitHub devolviendo { body, status }. Estrategia, de mejor a peor:
 *   1. `gh api` — si el dev ya tiene el CLI autenticado, 5000 req/h y cero manejo de secretos.
 *   2. curl con `Authorization: Bearer` desde GITHUB_TOKEN/GH_TOKEN. El header va en un
 *      archivo de config 0600 (`curl -K`), NUNCA en argv: los argumentos son visibles
 *      para cualquier proceso de la máquina (`ps aux`).
 *   3. curl/wget anónimo — 60 req/h por IP; es el que se topa con el 403.
 * status es el código HTTP cuando se pudo leer, 0 si no hubo forma de saberlo.
 */
function fetchGitHubAPI(apiPath) {
  if (which("gh")) {
    const out = tryExec("gh", ["api", apiPath]);
    if (out) return { body: out, status: 200 };
  }

  const url = `https://api.github.com/${apiPath}`;
  const token = githubToken();

  if (token && which("curl")) {
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-gh-"));
      const cfg = path.join(dir, "curlrc");
      fs.writeFileSync(cfg, `header = "Authorization: Bearer ${token}"\n`, { mode: 0o600 });
      const body = tryExec("curl", ["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60", "-K", cfg, url]);
      if (body) return { body, status: 200 };
    } catch { /* cae al modo anónimo */ }
    finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } }
  }

  // Anónimo: separamos cuerpo y código HTTP para poder distinguir "sin red" de "rate limit".
  if (which("curl")) {
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-gh-"));
      const bodyFile = path.join(dir, "body");
      const code = tryExec("curl", ["-sS", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60", "-o", bodyFile, "-w", "%{http_code}", url]);
      const status = parseInt(code, 10) || 0;
      const body = status === 200 ? fs.readFileSync(bodyFile, "utf8") : null;
      return { body, status };
    } catch { return { body: null, status: 0 }; }
    finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } }
  }

  const body = fetchText(url);
  return { body, status: body ? 200 : 0 };
}

/** Lee el caché de releases del disco (o null). */
function loadReleasesCache() {
  return readReleasesCache(readJSON(RELEASES_CACHE_FILE, null), Date.now(), RELEASES_TTL_MS);
}

/** Guarda la lista de releases (proyectada) en el caché. Best-effort: nunca rompe el flujo. */
function saveReleasesCache(releases) {
  try {
    ensureDir(path.dirname(RELEASES_CACHE_FILE));
    writeJSON(RELEASES_CACHE_FILE, { fetchedAt: Date.now(), releases: slimReleases(releases) });
  } catch { /* ignore */ }
}

/**
 * Devuelve la lista de releases de Engram, con caché de 6h en ~/.ozali/cache.
 * Sin caché la API anónima (60 req/h por IP) se agota rápido cuando un equipo detrás de
 * una misma IP corre `ozali doctor`/`init` en varios repos. Si la API falla se usa el
 * caché vencido como red de seguridad (la descarga se verifica por checksum igual).
 * Devuelve { releases, source } o null.
 */
function fetchEngramReleases({ quiet = false } = {}) {
  const cached = loadReleasesCache();
  if (cached && cached.fresh) return { releases: cached.releases, source: "cache" };

  const { body, status } = fetchGitHubAPI(ENGRAM_RELEASES_PATH);
  let releases = null;
  if (body) {
    try { releases = JSON.parse(body); } catch { releases = null; }
  }
  if (Array.isArray(releases) && releases.length) {
    saveReleasesCache(releases);
    return { releases, source: "api" };
  }

  if (cached) {
    if (!quiet) {
      const hours = Math.round(cached.ageMs / 3600000);
      warn(`No pude consultar los releases de Engram (${status === 403 || status === 429 ? "límite de peticiones de GitHub" : "sin red"}); uso el caché local de hace ~${hours}h.`);
    }
    return { releases: cached.releases, source: "stale-cache" };
  }

  if (!quiet && (status === 403 || status === 429)) {
    warn("GitHub respondió 403/429: se agotó el límite de peticiones anónimas (60/h por IP).");
    info("  → Autentícate para subirlo a 5000/h: " + c.bold("gh auth login") + " o " + c.bold("export GITHUB_TOKEN=…"));
    info("  → O instala Engram con " + c.bold("brew") + " / " + c.bold("go") + " (ver opciones abajo).");
  }
  return null;
}

/**
 * Resuelve { version, url, asset } del binario precompilado de Engram para este SO/arch,
 * quedándose con el release estable más reciente que contenga el asset.
 * Devuelve null si no hay red/herramienta o no hay binario.
 */
function resolveEngramAsset(platform, arch) {
  const res = fetchEngramReleases();
  if (!res) return null;
  return pickEngramAsset(res.releases, platform, arch);
}

/**
 * Descarga url → dest con curl (o wget como fallback), solo por HTTPS y sin permitir
 * que un redirect degrade el protocolo. Devuelve true si tuvo éxito.
 */
function download(url, dest) {
  if (which("curl")) {
    return spawnCmd("curl", ["-fL", "--proto", "=https", "--proto-redir", "=https", "--retry", "2", "--max-time", "600", "-o", dest, url]) === 0;
  }
  if (which("wget")) {
    return spawnCmd("wget", ["--https-only", "--max-redirect=5", "--timeout=600", "-O", dest, url]) === 0;
  }
  warn("No se encontró curl ni wget para descargar el binario de Engram.");
  return false;
}

/** SHA-256 en hex (minúsculas) de un archivo local. Zero-dep (node:crypto). */
function sha256File(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
  catch { return null; }
}

/**
 * Verifica el tarball descargado contra el `checksums.txt` del MISMO release publicado
 * por GoReleaser. Fail-closed: si no se puede descargar o parsear el manifiesto, o el
 * hash no coincide, devuelve false y NO se instala nada.
 */
function verifyEngramTarball(tarball, assetURL, assetName, tmpDir) {
  const checksumsURL = checksumsURLFor(assetURL);
  if (!checksumsURL) { warn("No pude derivar la URL de checksums.txt del release."); return false; }

  const manifest = path.join(tmpDir, "checksums.txt");
  if (!download(checksumsURL, manifest)) {
    warn("No pude descargar checksums.txt del release de Engram — no instalo un binario sin verificar.");
    return false;
  }

  let expected = null;
  try { expected = parseChecksums(fs.readFileSync(manifest, "utf8"), assetName); } catch { /* ignore */ }
  if (!expected) {
    warn(`checksums.txt no contiene una entrada válida para ${assetName} — abortando por seguridad.`);
    return false;
  }

  const actual = sha256File(tarball);
  if (!actual) { warn("No pude calcular el SHA-256 del archivo descargado."); return false; }
  if (actual !== expected) {
    err("¡El SHA-256 del binario descargado NO coincide con el publicado por el proyecto!");
    info(`  esperado: ${expected}`);
    info(`  obtenido: ${actual}`);
    warn("Descarga descartada. Puede ser una descarga corrupta o manipulada; reintenta o instala con brew/go.");
    return false;
  }

  ok(`SHA-256 verificado contra checksums.txt (${c.dim(actual.slice(0, 16) + "…")}).`);
  return true;
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
  const asset = resolved.asset || engramAssetName(plat, process.arch, version);

  // Cinturón y tirantes: pickEngramAsset ya filtra, pero nunca descargamos de un origen
  // que no sea un asset de release del repo oficial sobre HTTPS.
  if (!isTrustedEngramURL(url)) {
    err(`URL de descarga no confiable para Engram: ${url}`);
    warn("Solo se aceptan assets de https://github.com/Gentleman-Programming/engram/releases/download/…");
    return false;
  }

  info(`Descargando binario precompilado de Engram ${c.bold("v" + version)} (${process.arch})…`);

  let tmpDir;
  try { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-engram-")); }
  catch { warn("No pude crear un directorio temporal para la descarga."); return false; }

  try {
    const tarball = path.join(tmpDir, asset);
    if (!download(url, tarball)) { warn("Falló la descarga del binario de Engram."); return false; }

    // Verificación de integridad ANTES de extraer ni ejecutar nada.
    if (!verifyEngramTarball(tarball, url, asset, tmpDir)) return false;

    const extractDir = path.join(tmpDir, "x");
    ensureDir(extractDir);
    // --no-same-owner/--no-same-permissions: no heredamos uid/gid ni bits setuid del archivo.
    if (spawnCmd("tar", ["-xzf", tarball, "-C", extractDir, "--no-same-owner", "--no-same-permissions"]) !== 0) {
      warn("Falló la extracción del tarball de Engram (¿tar disponible?).");
      return false;
    }

    const binSrc = findEngramBinary(extractDir);
    if (!binSrc) { warn("No encontré el binario engram dentro del tarball."); return false; }

    // El tarball no puede sacarnos del directorio temporal (path traversal / symlink).
    let realSrc, realRoot;
    try {
      realSrc = fs.realpathSync(binSrc);
      realRoot = fs.realpathSync(extractDir);
    } catch { warn("No pude resolver la ruta del binario extraído."); return false; }
    if (!(realSrc === realRoot || realSrc.startsWith(realRoot + path.sep))) {
      err("El tarball intentó escribir fuera del directorio temporal — instalación abortada.");
      return false;
    }

    const destDir = path.join(HOME, ".local", "bin");
    const dest = path.join(destDir, "engram");
    try {
      ensureDir(destDir);
      fs.copyFileSync(realSrc, dest);
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
  } finally {
    // Nunca dejamos el binario descargado (verificado o no) tirado en /tmp.
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
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

/**
 * Warning reutilizable sobre el estado del plugin engram@engram en Claude Code.
 * Distingue entre "no instalado" y "instalado pero deshabilitado".
 * Devuelve true si emitió warning (es decir, el plugin no está OK).
 */
/**
 * El plugin figura habilitado pero no aporta servidor MCP: `/plugin` se ve bien y las tools
 * `mem_*` no existen. Se arregla registrando el servidor a mano con el mismo comando que usa la
 * variante del plugin que sí lo trae.
 */
function warnEngramMcpServer(mcp) {
  warn("Engram MCP: el plugin está habilitado pero " + c.bold("no registra ningún servidor MCP") + ".");
  info(`  ${mcp.detail}.`);
  info("  Por eso " + c.bold("/mcp") + " no lista engram y las tools " + c.bold("mem_*") + " no cargan,");
  info("  aunque el binario esté en PATH y " + c.bold("/plugin") + " muestre el plugin como Enabled.");
  info("  → Regístralo a mano (scope user, disponible en todos tus proyectos):");
  info(`     ${c.bold(mcp.fix)}`);
  info("  → Verifica con " + c.bold("claude mcp list") + " (debe decir engram: Connected) y reinicia Claude Code.");
  return true;
}

function warnEngramPluginStatus(plugin, label = "Claude Code") {
  if (!plugin.installed) {
    warn(`Engram MCP: el plugin engram@engram NO está instalado en ${label}.`);
    info(`  El binario engram está en PATH, pero eso no basta. ${label} no levanta el MCP`);
    info(`  hasta que el plugin esté instalado y habilitado a nivel usuario.`);
    info(`  → Corre en ${label}:`);
    info(`     ${c.bold("/plugin install engram@engram")}`);
    info(`  → Luego verifica en /plugin que engram esté Enabled (instalar para mí).`);
  } else if (!plugin.enabled) {
    warn(`Engram MCP: el plugin engram@engram está instalado pero NO habilitado en ${label}.`);
    info(`  → Entra al plugin en /plugin y selecciona "instalar para mí" (Enable).`);
  } else {
    return false;
  }
  info(`  → Reinicia ${label} para recargar los MCP.`);
  info(`  → Si tras habilitarlo el MCP aparece 'failed', asegura que ~/.local/bin esté en tu PATH:`);
  info(`     ${c.dim('export PATH="$HOME/.local/bin:$PATH"')}`);
  return true;
}

/**
 * Warning reutilizable sobre el estado de Engram MCP en opencode.
 * Devuelve true si emitió warning (es decir, no está configurado o deshabilitado).
 */
function warnEngramOpencodeStatus(plugin) {
  if (!plugin.configured) {
    warn(`Engram MCP: no está configurado en opencode.`);
    info(`  El binario engram está en PATH, pero eso no basta. opencode no levanta el MCP`);
    info(`  hasta que esté configurado en opencode.json (proyecto o global).`);
    info(`  → Corre en tu terminal:`);
    info(`     ${c.bold("engram setup opencode")}`);
  } else if (!plugin.enabled) {
    warn(`Engram MCP: está configurado en opencode pero NO habilitado.`);
    info(`  → Revisa opencode.json y asegura que ${c.bold("mcp.engram.enabled")} sea true.`);
  } else {
    return false;
  }
  info(`  → Reinicia opencode para recargar los MCP.`);
  info(`  → Si tras habilitarlo el MCP aparece 'failed', asegura que ~/.local/bin esté en tu PATH:`);
  info(`     ${c.dim('export PATH="$HOME/.local/bin:$PATH"')}`);
  return true;
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

  // Fase A — escaneo (read-only). Miembros = repos git hijos + folders de un *.code-workspace.
  let root = cwd;
  let ws = detectWorkspace(root, { depth, noCodeWorkspace: opts.noCodeWorkspace, scanAll: opts.scanAll });
  if (ws.members.length === 0) {
    // Caso típico: se corrió PARADO DENTRO de un repo. Busca hacia arriba la carpeta que agrupa.
    const up = findWorkspaceRootUp(cwd, 3, { noCodeWorkspace: opts.noCodeWorkspace });
    if (!up) {
      warn("No encontré repositorios git como hijos de esta carpeta.");
      info("Corre " + c.bold("ozali workspace") + " desde la carpeta que agrupa tus repos (o usa " + c.bold("--depth 2") + ").");
      info("También sirve una carpeta con un " + c.bold("*.code-workspace") + " de VSCode/Antigravity: sus folders se toman como miembros.");
      return 1;
    }
    const via = up.via === "code-workspace" ? "por su *.code-workspace" : "por sus repos hijos";
    warn(`Aquí no hay repos hijos, pero ${c.bold(up.root)} agrupa ${up.count} repo(s) ${c.dim("(" + via + ")")}.`);
    const go = opts.yes ? true : await confirm(`¿Uso ${c.bold(up.root)} como raíz del workspace?`, true);
    if (!go) { info("Cancelado. Corre " + c.bold("ozali workspace") + " desde la carpeta que agrupa tus repos."); return 1; }
    root = up.root;
    ws = detectWorkspace(root, { depth, noCodeWorkspace: opts.noCodeWorkspace, scanAll: opts.scanAll });
    if (ws.members.length === 0) { warn("Tampoco encontré repos ahí."); return 1; }
  }
  cwd = root;
  step("Repos detectados");
  if (ws.declaredBy === "code-workspace") {
    info(`Miembros tomados del ${c.bold("*.code-workspace")} del editor (manda sobre el escaneo).`);
  }
  printMembers(ws.members);
  if (ws.extras && ws.extras.length) {
    warn(`${ws.extras.length} repo(s) en disco NO declarados en el .code-workspace: ${c.bold(ws.extras.map((e) => e.dir).join(", "))}.`);
    info(`Quedan fuera. Para incluirlos: agrégalos al ${c.bold(".code-workspace")} en tu editor, o corre con ${c.bold("--scan-all")}.`);
  }

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
    ws = detectWorkspace(cwd, { depth, noCodeWorkspace: opts.noCodeWorkspace, scanAll: opts.scanAll }); // re-escanea tras remediar
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

/** Track 2 — instala la skill `ozali` en la raíz para calibrar miembros desde el workspace.
 *  Si ya existe la skill global, no duplica (evita duplicados del panel de skills).
 */
function ensureWorkspaceOzaliSkill(root) {
  const globalSkill = path.join(HOME, ".claude", "skills", "ozali");
  if (exists(globalSkill)) {
    info(`Skill global ya existe (${c.dim(globalSkill)}). No se duplica en la raíz del workspace.`);
    return;
  }
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
    const ws = m.fromCodeWorkspace ? c.dim(" ·code-workspace") : "";
    console.log(`  ${c.bold(m.dir.padEnd(pad))}  ${label}  ${sot}${eng}${ws}`);
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
    references: mergeReferences(existing.references, references),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJSON(WS_MANIFEST(root), manifest);
  const manual = manifest.references.filter((r) => r.source === "manual").length;
  ok(`Manifiesto escrito en ${c.bold("ozali-workspace.json")} (${members.length} repos, ${manifest.references.length} referencias${manual ? `, ${manual} manual(es) preservada(s)` : ""}).`);
  if (manual) info(`Las referencias con ${c.bold('"source": "manual"')} las escribiste tú: ozali no las toca al re-correr.`);
  return manifest;
}

/**
 * Une las referencias auto-detectadas con las que el usuario escribió a mano en el manifiesto.
 * Regla: todo lo detectado se reescribe como `source: "auto"`; lo que estaba antes y NO se
 * volvió a detectar se conserva como `source: "manual"` (así un `maven-dep` agregado a mano —o
 * cualquier relación que ozali no sabe inferir— sobrevive a la siguiente corrida).
 */
function mergeReferences(previous, detected) {
  const key = (r) => `${r.from}→${r.to}:${r.kind || ""}`;
  const auto = detected.map((e) => ({ from: e.fromDir, to: e.toDir, kind: e.kind, source: "auto" }));
  const seen = new Set(auto.map(key));
  const kept = [];
  for (const r of Array.isArray(previous) ? previous : []) {
    if (!r || !r.from || !r.to || seen.has(key(r))) continue;
    seen.add(key(r));
    kept.push({ from: r.from, to: r.to, kind: r.kind || "manual", source: "manual" });
  }
  return [...auto, ...kept];
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
  const cfg = readMergedConfig(cwd);
  const rows = [];
  const add = (label, good, detail) => rows.push({ label, good, detail });

  add("Repo git", env.git.isRepo, env.git.isRepo ? (env.git.commit ? `${env.git.branch}@${env.git.commit}` : "repo sin commits") : "no es repo git");
  add("Node ≥ 16", env.node.needsNode ? env.node.ok : true, env.node.needsNode ? env.node.version : `${env.node.version} (no aplica a este proyecto)`);
  add("Fuente de verdad", env.sot.found, env.sot.found ? `${env.sot.doc} + ${env.sot.dir}/` : "ausente (corre la skill 'ozali')");
  add("Skill ozali instalada", env.skill.installed, env.skill.installed ? env.skill.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init)");
  add("Skill skill-generator", env.skillGenerator.installed, env.skillGenerator.installed ? env.skillGenerator.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init)");
  add("Skill ozali-commit", env.ozaliCommit.installed, env.ozaliCommit.installed ? env.ozaliCommit.paths.map((p) => path.relative(cwd, p) || p).join(", ") : "no instalada (ozali init / ozali install-skills)");
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
  // Frontmatters `model:` — el contrato cdk v6 exige el modelo real, no el nivel abstracto.
  // Es un fallo SILENCIOSO hasta que alguien invoca la skill o el subagente, así que se chequea acá.
  const badModels = findAbstractModelFrontmatters(cwd);
  add("Frontmatters `model:`", badModels.length === 0,
    badModels.length === 0
      ? "sin niveles abstractos"
      : `${badModels.length} con nivel abstracto: ${badModels.map((b) => `${b.file} (${b.model})`).join(", ")}`);
  if (badModels.length) {
    warn("Hay frontmatters con un nivel cognitivo en vez del modelo real.");
    info("  Claude Code lee " + c.bold("model:") + " literal: solo acepta haiku/sonnet/opus/inherit o un model ID.");
    info("  Con un nivel ahí, la skill o el subagente fallan al invocarse:");
    info("  " + c.dim("There's an issue with the selected model (high). It may not exist…"));
    for (const b of badModels) {
      const runtime = b.file.startsWith(".opencode/") ? "opencode" : "claude";
      const real = resolveModelForLevel(cfg, b.model, runtime);
      info(`  → ${c.bold(b.file)}: model: ${b.model} → ${c.green(real || "?")}`);
    }
    info("  Corrígelo con " + c.bold("ozali doctor --fix") + " o regenerando con la skill " + c.bold("ozali") + ".");
  }

  add("Engram", env.engram.available, env.engram.available ? env.engram.bin : "no instalado → modo docs");
  if (env.engram.available) {
    const online = tryExec("engram", ["doctor"], { cwd }) !== null;
    add("Engram en línea", online, online ? "engram doctor OK" : "engram doctor no responde");
    const agent = (cfg && cfg.agent) || (env.agents.opencode.present && !env.agents.claudeCode.present ? "opencode"
      : env.agents.claudeCode.present && env.agents.opencode.present ? "both" : "claude-code");
    if (agent === "claude-code" || agent === "both") {
      add("Engram MCP plugin", env.engramPlugin.enabled, env.engramPlugin.enabled ? env.engramPlugin.detail : env.engramPlugin.detail);
      if (!env.engramPlugin.enabled) {
        warnEngramPluginStatus(env.engramPlugin, "Claude Code");
      } else {
        // El plugin "enabled" NO garantiza que el MCP se levante: hubo versiones publicadas sin
        // `mcpServers` ni `.mcp.json`, con lo que las tools mem_* nunca cargaban.
        const mcp = env.engramMcp;
        add("Engram MCP servidor", mcp.registered, mcp.registered ? `${mcp.detail} [${mcp.source}]` : mcp.detail);
        if (!mcp.registered) warnEngramMcpServer(mcp);
      }
    }
    if (agent === "opencode" || agent === "both") {
      add("Engram MCP opencode", env.engramOpencode.enabled, env.engramOpencode.enabled ? env.engramOpencode.detail : env.engramOpencode.detail);
      if (!env.engramOpencode.enabled) {
        warnEngramOpencodeStatus(env.engramOpencode);
      }
    }
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
  add("Agentes configurados", !!(cfg && cfg.agents), cfg && cfg.agents ? "agents.models OK" : "sin agents (ozali update --fix)");

  // Strict TDD (de la fuente de verdad)
  const tdd = readStrictTdd(cwd, env.sot);
  add("Strict TDD calibrado", tdd.found,
    tdd.found ? `strict_tdd: ${tdd.value}${tdd.source ? ` (${tdd.source})` : ""}` : "sin calibrar (Fase 3.5 del bootstrap)");

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

  // Verificación: config.json más nuevo que los subagentes generados (config stale)
  const stale = detectConfigStale(cwd);
  if (stale.stale) {
    console.log("");
    warn("⚠  Configuración modificada después de generar los subagentes");
    info(`   .ozali/config.json (o .local) fue editado ${stale.configMtimeAgo} después de los subagentes.`);
    info(`   Los cambios en modelos/agentes NO surten efecto hasta regenerar el cdk.`);
    info(`   Corre ${c.bold("ozali update")} o invoca la skill 'ozali' para re-generar cdk con la nueva config.`);
  }

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

    // Fix 3: Agentes
    const agentsRow = rows.find((r) => r.label === "Agentes configurados");
    if (agentsRow && !agentsRow.good) {
      const cfg2 = readJSON(CONFIG_PATH(cwd)) || {};
      if (!cfg2.agents) {
        cfg2.agents = defaultAgentsConfig();
        writeJSON(CONFIG_PATH(cwd), normalizeConfig(cfg2, cwd));
        ok("Configuración de agentes agregada a .ozali/config.json.");
        agentsRow.good = true;
        agentsRow.detail = "agents.models OK";
      }
    }

    // Fix 4: Testing (sync desde tech-stack.md si existe)
    const testingRow = rows.find((r) => r.label === "Runner de pruebas");
    if (env.sot.found) {
      const sync = syncTestingFromTechStack(cwd, env.sot);
      if (sync.synced) {
        info(`Sincronizado testing desde ${path.relative(cwd, path.join(env.sot.dir, "context", "tech-stack.md"))}: strict_tdd=${sync.strict_tdd}, runner=${sync.runner || "N/A"}, greenCommand=${sync.greenCommand || "N/A"}.`);
      }
    }

    // Fix 5: frontmatters con nivel abstracto en `model:` (contrato cdk v6).
    // Es un reemplazo determinista —el propio valor ES el nivel—, así que no hace falta
    // consultar el mapping rol→nivel: `model: high` resuelve a agents.models.<runtime>.high.
    const modelsRow = rows.find((r) => r.label === "Frontmatters `model:`");
    if (modelsRow && !modelsRow.good) {
      const cfgNow = readMergedConfig(cwd);
      const fixed = [];
      for (const b of findAbstractModelFrontmatters(cwd)) {
        const runtime = b.file.startsWith(".opencode/") ? "opencode" : "claude";
        const real = resolveModelForLevel(cfgNow, b.model, runtime);
        if (!real) { warn(`No pude resolver un modelo para el nivel "${b.model}" en ${b.file}.`); continue; }
        const abs = path.join(cwd, b.file);
        const out = setFrontmatterModel(fs.readFileSync(abs, "utf8"), real);
        if (!out) { warn(`No pude reescribir el frontmatter de ${b.file}.`); continue; }
        fs.writeFileSync(abs, out);
        fixed.push(`${b.file}: ${b.model} → ${real}`);
      }
      if (fixed.length) {
        ok(`Frontmatters corregidos (${fixed.length}):`);
        for (const f of fixed) info("  " + f);
        info("  El nivel cognitivo sigue documentado en el cuerpo de cada archivo.");
      }
      const left = findAbstractModelFrontmatters(cwd);
      modelsRow.good = left.length === 0;
      modelsRow.detail = left.length === 0 ? "sin niveles abstractos" : `${left.length} sin corregir`;
    }

    const badAfterFix = rows.filter((r) => !r.good).length;
    console.log("");
    if (badAfterFix === 0) ok("Todos los problemas detectados fueron remediados.");
    else warn(`${badAfterFix} punto(s) aún sin remediar.`);
    return badAfterFix === 0 ? 0 : 1;
  }

  // Auto-upgrade: si Engram acaba de instalarse y el config aún dice "docs", subir a hybrid.
  if (cfg && resolveMode(cfg) === "docs" && env.engram.available) {
    cfg.mode = "hybrid";
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

/** Detecta si .ozali/config.json (o .local) fue modificado después de generar los subagentes. */
function detectConfigStale(cwd) {
  const configPath = CONFIG_PATH(cwd);
  const localPath = CONFIG_LOCAL_PATH(cwd);
  const agentsDir = path.join(cwd, ".claude", "agents");
  const cdkSkillPath = path.join(cwd, ".claude", "skills", "cdk", "SKILL.md");

  const configMtime = exists(localPath) ? fs.statSync(localPath).mtimeMs : (exists(configPath) ? fs.statSync(configPath).mtimeMs : 0);
  if (!configMtime) return { stale: false };

  let newestAgentMtime = 0;
  if (exists(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith(".md")) {
        const m = fs.statSync(path.join(agentsDir, f)).mtimeMs;
        if (m > newestAgentMtime) newestAgentMtime = m;
      }
    }
  }
  if (exists(cdkSkillPath)) {
    const m = fs.statSync(cdkSkillPath).mtimeMs;
    if (m > newestAgentMtime) newestAgentMtime = m;
  }

  if (newestAgentMtime === 0) return { stale: false }; // no hay subagentes aún

  const stale = configMtime > newestAgentMtime;
  if (!stale) return { stale: false };

  const diffMin = Math.round((configMtime - newestAgentMtime) / 60000);
  const ago = diffMin < 60 ? `hace ${diffMin} min` : `hace ${Math.round(diffMin / 60)} h`;
  return { stale: true, configMtimeAgo: ago };
}

function readStrictTdd(cwd, sot) {
  // Orden de fuentes del contrato cdk v1: `.ozali/config.json` → `testing` manda. La Fase 3.5 del
  // bootstrap escribe ahí la calibración, y en el markdown suele quedar como bloque JSON
  // (`"strict_tdd": true`), que el parser de prosa de abajo no reconoce — leer solo el markdown
  // reportaba "sin calibrar" un repo perfectamente calibrado.
  const cfg = readMergedConfig(cwd);
  if (cfg && cfg.testing && typeof cfg.testing.strict_tdd === "boolean") {
    return { found: true, value: String(cfg.testing.strict_tdd), source: "config" };
  }
  const f = path.join(cwd, sot.dir, "context", "tech-stack.md");
  if (!exists(f)) return { found: false };
  const txt = fs.readFileSync(f, "utf8");
  // Acepta tanto la prosa ("Strict TDD: true") como la clave JSON ("strict_tdd": true).
  const m = txt.match(/Strict[\s_]*TDD["']?\s*[:*\s]+\s*(true|false)/i);
  return m ? { found: true, value: m[1].toLowerCase(), source: "tech-stack.md" } : { found: false };
}

/** Lee `.ai/context/tech-stack.md` y sincroniza `.ozali/config.json` → `testing`.
 *  Parsea markdown tables de forma naive pero robusta para el formato de ozali.
 */
function syncTestingFromTechStack(cwd, sot) {
  const f = path.join(cwd, sot.dir, "context", "tech-stack.md");
  if (!exists(f)) return { synced: false };
  const txt = fs.readFileSync(f, "utf8");
  // Acepta la prosa ("Strict TDD: true") y la clave JSON ("strict_tdd": true) que deja la Fase 3.5.
  const strictMatch = txt.match(/Strict[\s_]*TDD["']?\s*[:*\s]+\s*(true|false)/i);
  const strictTdd = strictMatch ? strictMatch[1].toLowerCase() === "true" : null;

  // Buscar "Comando verde" en el markdown (puede estar en negrita, backticks, etc.)
  const cmdMatch = txt.match(/Comando\s+verde[^:]*:\s*[`\*]*([^`\n\*]+)/i);
  const greenCommand = cmdMatch ? cmdMatch[1].trim() : null;

  // Buscar runner en tabla markdown: fila que empieza con | Runner ... |
  let runner = null;
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\|?\s*Runner[^|]*\|\s*([^|]+)/i);
    if (m) {
      runner = m[1].replace(/[`\*]/g, "").trim();
      break;
    }
  }

  // Si el markdown no declara nada, no hay nada que sincronizar. Escribir igual degradaba la
  // calibración del config a `strict_tdd: false` por un parseo fallido — un valor que nadie pidió.
  if (strictTdd === null && !runner && !greenCommand) return { synced: false };

  const cfg = readJSON(CONFIG_PATH(cwd)) || {};
  if (!cfg.testing) cfg.testing = defaultTestingConfig();
  if (strictTdd !== null) cfg.testing.strict_tdd = strictTdd;
  if (runner) cfg.testing.runner = runner;
  if (greenCommand) cfg.testing.greenCommand = greenCommand;
  writeJSON(CONFIG_PATH(cwd), normalizeConfig(cfg, cwd));
  return { synced: true, strict_tdd: cfg.testing.strict_tdd, runner, greenCommand };
}

// ---- seguridad: semver guard + backup + frozen --------------------------------

/** Crea un backup de una skill antes de sobreescribirla.
 *  El backup vive en `.ozali/backups/skills/v{version}/{skillName}/`.
 *  Si la skill no existe, no hace nada (silencioso).
 */
function backupSkill(skillDir, version, cwd) {
  if (!exists(skillDir)) return { backedUp: false, path: null, reason: "skill no existe" };
  const skillName = path.basename(skillDir);
  const backupDir = path.join(cwd, ".ozali", "backups", "skills", `v${version}`, skillName);
  if (exists(backupDir)) {
    return { backedUp: false, path: backupDir, reason: "backup ya existe" };
  }
  ensureDir(path.dirname(backupDir));
  copyDir(skillDir, backupDir);
  return { backedUp: true, path: backupDir };
}

/** Encuentra el backup más reciente de una skill (por semver descendente). */
function findLatestSkillBackup(skillDir, cwd) {
  const skillName = path.basename(skillDir);
  const backupsBase = path.join(cwd, ".ozali", "backups", "skills");
  if (!exists(backupsBase)) return null;
  const versions = fs.readdirSync(backupsBase).filter((v) =>
    exists(path.join(backupsBase, v, skillName, "SKILL.md"))
  );
  if (versions.length === 0) return null;
  versions.sort((a, b) => {
    const va = parseSemver(a.replace(/^v/, ""));
    const vb = parseSemver(b.replace(/^v/, ""));
    if (va.major !== vb.major) return vb.major - va.major;
    if (va.minor !== vb.minor) return vb.minor - va.minor;
    return vb.patch - va.patch;
  });
  return path.join(backupsBase, versions[0], skillName);
}

/** Restaura el backup más reciente de una skill. */
function restoreSkillBackup(skillDir, cwd) {
  const backupDir = findLatestSkillBackup(skillDir, cwd);
  if (!backupDir) return { restored: false, reason: "sin backup" };
  fs.rmSync(skillDir, { recursive: true, force: true });
  copyDir(backupDir, skillDir);
  return { restored: true, from: backupDir };
}

/** Decide si se deben actualizar skills considerando frozen + semver guard. */
async function shouldUpdateSkills(cfg, opts, currentVersion, askFn) {
  // Capa 3: frozen
  if (cfg && cfg.frozen === true && !opts.skills) {
    return {
      shouldUpdate: false,
      reason: "frozen",
      message: "Modo frozen activo. Skills NO actualizadas. Usa --skills para forzar.",
    };
  }

  // Capa 1: semver guard
  if (cfg && cfg.version) {
    const cmp = compareSemver(cfg.version, currentVersion);
    if (cmp.diff === "major") {
      if (!opts.yes && askFn) {
        const confirmed = await askFn(
          `Cambio de versión mayor detectado: ${cfg.version} → ${currentVersion}. Posibles breaking changes. ¿Actualizar skills?`,
          false
        );
        return {
          shouldUpdate: confirmed,
          reason: confirmed ? "major-bump" : "user-cancel",
          message: confirmed
            ? `⚠️  Update forzado a través de cambio mayor (${cfg.version} → ${currentVersion}).`
            : "Update cancelado por el usuario.",
        };
      }
      // En modo --yes permitir pero advertir
      return {
        shouldUpdate: true,
        reason: "major-bump",
        message: `⚠️  Cambio mayor ${cfg.version} → ${currentVersion} (modo --yes). Revisa breaking changes antes de trabajar.`,
      };
    }
  }

  return { shouldUpdate: true, reason: "normal" };
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

  const currentVersion = pkgVersion();

  // --- rollback mode (Capa 2) ---
  if (opts.rollback) {
    if (!env.skill.installed) { warn("Sin skills para restaurar."); return 1; }
    step("Rollback de skills");
    let restored = 0;
    for (const p of env.skill.paths) {
      const r = restoreSkillBackup(p, cwd);
      if (r.restored) { ok(`Skill ${c.bold(path.basename(p))} restaurada desde backup.`); restored++; }
      else warn(`No hay backup para ${c.bold(path.basename(p))}.`);
      // También restaurar ozali-commit y skill-generator del mismo backup base
      const commitDir = path.join(path.dirname(p), "ozali-commit");
      const rCommit = restoreSkillBackup(commitDir, cwd);
      if (rCommit.restored) { ok(`Skill ozali-commit restaurada.`); restored++; }
      const genDir = path.join(path.dirname(p), "skill-generator");
      const rGen = restoreSkillBackup(genDir, cwd);
      if (rGen.restored) { ok(`Skill skill-generator restaurada.`); restored++; }
    }
    info(restored > 0 ? `Restauradas ${restored} skills. Reinicia tu agente.` : "Nada que restaurar.");
    return 0;
  }

  // --- semver guard + frozen (Capa 1 y 3) ---
  const guard = await shouldUpdateSkills(cfg, opts, currentVersion, confirm);
  if (!guard.shouldUpdate) {
    info(guard.message);
  } else if (guard.shouldUpdate === true && guard.reason === "major-bump") {
    warn(guard.message);
  }

  // 1) Skill ozali (incluye las references: la base desde la que el agente regenera cdk)
  //    + ozali-commit (commit convencional) + skill-generator como skills hermanas.
  if (env.skill.installed && guard.shouldUpdate !== false) {
    for (const p of env.skill.paths) {
      // Capa 2: backup antes de sobreescribir
      const skillVersion = cfg?.version || "unknown";
      const bak = backupSkill(p, skillVersion, cwd);
      if (bak.backedUp) info(`Backup creado: ${path.relative(cwd, bak.path)}`);
      copyDir(SKILL_SRC, p);
      ok(`Skill ozali actualizada: ${path.relative(cwd, p) || p} → v${currentVersion}`);
      const commitDir = path.join(path.dirname(p), "ozali-commit");
      const freshCommit = !exists(commitDir);
      const bakCommit = backupSkill(commitDir, skillVersion, cwd);
      if (bakCommit.backedUp) info(`Backup creado: ${path.relative(cwd, bakCommit.path)}`);
      copyDir(COMMIT_SKILL_SRC, commitDir);
      ok(`Skill ozali-commit ${freshCommit ? "instalada" : "actualizada"}: ${path.relative(cwd, commitDir) || commitDir}`);
      const generatorDir = path.join(path.dirname(p), "skill-generator");
      const freshGenerator = !exists(generatorDir);
      const bakGen = backupSkill(generatorDir, skillVersion, cwd);
      if (bakGen.backedUp) info(`Backup creado: ${path.relative(cwd, bakGen.path)}`);
      copyDir(SKILL_GENERATOR_SRC, generatorDir);
      ok(`Skill skill-generator ${freshGenerator ? "instalada" : "actualizada"}: ${path.relative(cwd, generatorDir) || generatorDir}`);
    }
  } else if (!env.skill.installed) {
    warn("Skill ozali no instalada en esta ruta (corre " + c.bold("ozali init") + " para instalarla).");
  } else {
    info("Skills no actualizadas (modo frozen o cancelado). Config y permisos sí se refrescan.");
  }

  // Agente/scope: del config; si falta, infiere del entorno.
  const agent = (cfg && cfg.agent) || (env.agents.opencode.present && !env.agents.claudeCode.present ? "opencode"
    : env.agents.claudeCode.present && env.agents.opencode.present ? "both" : "claude-code");
  const scope = (cfg && cfg.scope) || "global";

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

  // 3.5) gitignore: migra repos previos a 0.17.0, que ignoraban .ozali/ entero.
  if (gitInfo(cwd).isRepo) {
    const { removed } = pruneGitignore(cwd, GITIGNORE_OBSOLETE);
    const { added } = ensureGitignore(cwd, GITIGNORE_ENTRIES);
    if (removed.length) {
      ok(`.gitignore migrado: retiradas ${removed.join(", ")}.`);
      info("  " + c.bold(".ozali/") + " (config del equipo y docs por hito) ahora se commitea; fuera quedan backups y state de sesión.");
      info("  Si ya tenías archivos de " + c.bold(".ozali/") + " sin trackear, aparecerán en tu próximo " + c.bold("git status") + ".");
    }
    if (added.length) {
      ok(`.gitignore actualizado: ${added.join(", ")}.`);
      if (added.includes(".ozali/metrics/") && gitTracks(cwd, ".ozali/metrics")) {
        info("  " + c.bold(".ozali/metrics/") + " ya estaba versionado: agregar la regla no lo destrackea.");
        info("  Para sacarlo del índice sin borrarlo del disco: " + c.bold("git rm -r --cached .ozali/metrics"));
      }
    }
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
    // Verificar estado real del plugin MCP (no solo el binario)
    if (agent === "claude-code" || agent === "both") {
      if (!env.engramPlugin.enabled) warnEngramPluginStatus(env.engramPlugin, "Claude Code");
      else if (!env.engramMcp.registered) warnEngramMcpServer(env.engramMcp);
    }
    if ((agent === "opencode" || agent === "both") && !env.engramOpencode.enabled) {
      warnEngramOpencodeStatus(env.engramOpencode);
    }
  } else {
    // Engram no está instalado: avisar y ofrecer instalar
    warn("Engram no está instalado.");
    const installNow = opts.yes ? true : await confirm("¿Instalo y configuro Engram ahora?", true);
    if (installNow) {
      const installed = installEngram();
      if (installed) {
        if (agent === "claude-code" || agent === "both") spawnCmd("engram", ["setup", "claude-code"]);
        if (agent === "opencode" || agent === "both") spawnCmd("engram", ["setup", "opencode"]);
        ok("Engram listo. Reinicia tu agente para que cargue el servidor MCP de Engram.");
      } else {
        warn("No se pudo instalar Engram automáticamente.");
        printEngramManualInstructions(agent);
      }
    } else {
      info("Modo docs activo. Cuando instales Engram, corre " + c.bold("ozali doctor") + " para activar hybrid.");
    }
  }

  // 4.55) Verificar skills globales si el repo ya tiene config pero faltan skills
  if (cfg && !env.skill.installed) {
    warn("Skill ozali no instalada globalmente.");
    info("Puedes instalar las skills con: " + c.bold("ozali install-skills") + " (o ozali init si el repo no está calibrado).");
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
  if (cfg) {
    if (!cfg.agents) { cfg.agents = defaultAgentsConfig(); info("Agregando configuración de agentes por defecto a .ozali/config.json"); }
    // Contrato cdk v6: IDs con versión → alias. Se avisa porque cambia lo que se estampa
    // en el frontmatter `model:` de los subagentes al regenerar cdk.
    if (cfg.agents.models && cfg.agents.models.claude) {
      const { changed } = migrateClaudeModelAliases(cfg.agents.models.claude);
      if (changed.length) {
        ok(`Modelos de Claude migrados a alias (contrato cdk v6): ${changed.join(", ")}.`);
        info("  Regenera cdk desde tu agente para que los subagentes estampen el alias en " + c.bold("model:") + ".");
      }
    }
    cfg.version = pkgVersion();
    cfg.updatedAt = new Date().toISOString();
    writeJSON(cfgPath, normalizeConfig(cfg, cwd));
  }
  // 5.5) Sync testing desde tech-stack.md si existe
  if (cfg && env.sot.found) {
    const sync = syncTestingFromTechStack(cwd, env.sot);
    if (sync.synced) info(`Sincronizado testing desde tech-stack.md: strict_tdd=${sync.strict_tdd}, runner=${sync.runner || "N/A"}, greenCommand=${sync.greenCommand || "N/A"}.`);
  }
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
    // Detectar solo referencias activas/invocaciones, no menciones negativas
    // (ej: "nunca copsis-commit", "no uses copsis-commit" son instructivas, no legado).
    const lines = txt.split(/\r?\n/);
    for (const line of lines) {
      if (/copsis-commit/i.test(line)) {
        const lower = line.toLowerCase();
        if (/nunca|no\b/.test(lower)) continue; // referencia negativa/instructiva
        hasCopsis = true;
        break;
      }
    }
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

// =========================================================== install-skills ===
/**
 * Instala las skills ozali, ozali-commit y skill-generator en el scope indicado
 * (global por defecto). Útil cuando el repo ya está calibrado y solo faltan las
 * skills a nivel de agente.
 */
export async function installSkills(cwd, opts = {}) {
  step("ozali install-skills — instalar skills globales");
  const env = detectAll(cwd);

  const scope = opts.scope || "global";
  const agent = opts.agent || (env.agents.opencode.present && !env.agents.claudeCode.present ? "opencode"
    : env.agents.claudeCode.present && env.agents.opencode.present ? "both" : "claude-code");

  // Claude Code
  if (agent === "claude-code" || agent === "both") {
    const target = skillTarget(cwd, scope);
    ensureDir(path.dirname(target));
    copyDir(SKILL_SRC, target);
    ok(`Skill ozali instalada: ${path.relative(cwd, target) || target}`);

    const commitTarget = commitSkillTarget(cwd, scope);
    copyDir(COMMIT_SKILL_SRC, commitTarget);
    ok(`Skill ozali-commit instalada: ${path.relative(cwd, commitTarget) || commitTarget}`);

    const generatorTarget = skillGeneratorTarget(cwd, scope);
    copyDir(SKILL_GENERATOR_SRC, generatorTarget);
    ok(`Skill skill-generator instalada: ${path.relative(cwd, generatorTarget) || generatorTarget}`);
  }

  // opencode
  if (agent === "opencode" || agent === "both") {
    const ocCommit = commitSkillTargetOpencode(cwd, scope);
    ensureDir(path.dirname(ocCommit));
    copyDir(COMMIT_SKILL_SRC, ocCommit);
    ok(`Skill ozali-commit instalada en opencode: ${path.relative(cwd, ocCommit) || ocCommit}`);

    const ocGen = skillGeneratorTargetOpencode(cwd, scope);
    copyDir(SKILL_GENERATOR_SRC, ocGen);
    ok(`Skill skill-generator instalada en opencode: ${path.relative(cwd, ocGen) || ocGen}`);
  }

  info("Reinicia tu agente para que reconozca las skills instaladas.");
  return 0;
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

  // Verificar que el plugin MCP esté habilitado (no solo el binario y el marketplace) y —lo que
  // no es lo mismo— que ALGO registre realmente el servidor. `env` se capturó antes de correr
  // `engram setup`, así que el registro se vuelve a detectar acá para no leer estado viejo.
  if (agent === "claude-code" || agent === "both") {
    if (!env.engramPlugin.enabled) {
      warnEngramPluginStatus(env.engramPlugin, "Claude Code");
    } else {
      const mcp = detectEngramMcpServer();
      if (mcp.registered) ok(`Engram MCP registrado: ${mcp.detail} [${mcp.source}].`);
      else warnEngramMcpServer(mcp);
    }
  }
  if ((agent === "opencode" || agent === "both") && !env.engramOpencode.enabled) {
    warnEngramOpencodeStatus(env.engramOpencode);
  }

  // Actualizar config de ozali si existe
  if (cfg) {
    let wrote = false;
    if (resolveMode(cfg) === "docs") {
      cfg.mode = "hybrid";
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
    if (resolveMode(cfg) === "hybrid" && tryExec("engram", ["--version"])) {
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
  if (resolveMode(cfg) === "hybrid" && tryExec("engram", ["--version"])) {
    info("Exportando memorias con engram sync…");
    if (spawnCmd("engram", ["sync"], { cwd }) === 0) {
      if (exists(engramLocal)) { copyDir(engramLocal, path.join(kRepo, "engram", project)); ok("Export de Engram copiado al repo de conocimiento."); }
      else info("engram sync no generó .engram/ (sin memorias nuevas).");
    } else {
      warn("engram sync falló; sincronizo solo docs. Revisa el output de arriba.");
    }
  } else if (resolveMode(cfg) === "hybrid") {
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

// ========================================================== dashboard =========
// Genera un dashboard .md agregado a partir de los hitos documentados en
// .ozali/docs/cdk/<hito>/, parseando 02-plan-aprobado.md (tipo, tamaño) y
// 06-uso-tokens.md (métricas). También espeja el resumen a Engram.

const DASHBOARD_PATH = (cwd) => path.join(cwd, ".ozali", "dashboard.md");
const CDK_DOCS_PATH = (cwd) => path.join(cwd, ".ozali", "docs", "cdk");

/** Extrae el valor de una línea tipo "Clave: valor", "**Clave:** valor" o "*Clave:* valor" en markdown. */
function extractLine(text, keyRe) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    let value = null;
    let startIdx = -1;
    // Markdown bold: **Key:** valor
    const boldPrefix = "**" + keyRe + ":**";
    startIdx = trimmed.indexOf(boldPrefix);
    if (startIdx !== -1) {
      value = trimmed.slice(startIdx + boldPrefix.length).trim();
    }
    // Markdown italic: *Key:* valor
    if (value === null) {
      const italicPrefix = "*" + keyRe + ":*";
      startIdx = trimmed.indexOf(italicPrefix);
      if (startIdx !== -1) {
        value = trimmed.slice(startIdx + italicPrefix.length).trim();
      }
    }
    // Formato plano: Key: valor
    if (value === null) {
      const plainPrefix = keyRe + ":";
      startIdx = trimmed.indexOf(plainPrefix);
      if (startIdx !== -1) {
        value = trimmed.slice(startIdx + plainPrefix.length).trim();
      }
    }
    if (value !== null) {
      // Si hay otro campo markdown en la misma línea, cortar ahí
      const nextField = value.search(/\s+\*\*[^*]+:\*\*|\s+\*[^*]+:\*/);
      if (nextField !== -1) {
        value = value.slice(0, nextField).trim();
      }
      return value;
    }
  }
  return null;
}

/** Extrae la tabla de métricas de 06-uso-tokens.md como objeto {input, output, total, costo}. */
function parseTokenMetrics(text) {
  const out = { input: null, output: null, total: null, costo: null, proveedor: null, modelo: null };
  if (!text) return out;
  out.proveedor = extractLine(text, "Proveedor");
  out.modelo = extractLine(text, "Modelo");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const mInput = line.match(/Tokens de entrada.*?\|\s*([\d,.\s]+|N\/A)/i);
    if (mInput && mInput[1] !== "N/A") out.input = parseInt(mInput[1].replace(/[\s,]/g, ""), 10) || null;
    const mOutput = line.match(/Tokens de salida.*?\|\s*([\d,.\s]+|N\/A)/i);
    if (mOutput && mOutput[1] !== "N/A") out.output = parseInt(mOutput[1].replace(/[\s,]/g, ""), 10) || null;
    const mTotal = line.match(/Total de tokens.*?\|\s*([\d,.\s]+|N\/A)/i);
    if (mTotal && mTotal[1] !== "N/A") out.total = parseInt(mTotal[1].replace(/[\s,]/g, ""), 10) || null;
    const mCosto = line.match(/Costo estimado.*?\|\s*([\d,.\s$]+|N\/A)/i);
    if (mCosto && mCosto[1] !== "N/A") out.costo = mCosto[1].trim();
  }
  return out;
}

/** Parsea un hito completo desde sus archivos. */
function parseHito(cwd, slug) {
  const base = path.join(CDK_DOCS_PATH(cwd), slug);
  const plan = exists(path.join(base, "02-plan-aprobado.md"))
    ? fs.readFileSync(path.join(base, "02-plan-aprobado.md"), "utf8")
    : "";
  const tokens = exists(path.join(base, "06-uso-tokens.md"))
    ? fs.readFileSync(path.join(base, "06-uso-tokens.md"), "utf8")
    : "";
  const prompt = exists(path.join(base, "01-prompt-entrada.md"))
    ? fs.readFileSync(path.join(base, "01-prompt-entrada.md"), "utf8")
    : "";

  const tipo = extractLine(plan, "Tipo") || "—";
  const tamaño = extractLine(plan, "Tamaño") || "—";
  const fecha = extractLine(prompt, "Fecha/Hora de la solicitud")
    || extractLine(plan, "Creado")
    || extractLine(plan, "Aprobado por.*?(\d{4}-\d{2}-\d{2})")
    || new Date().toISOString();

  const m = parseTokenMetrics(tokens);

  return {
    slug,
    tipo: tipo.replace(/\|.*$/, "").trim().toLowerCase(),
    tamaño: tamaño.replace(/\|.*$/, "").trim().toUpperCase(),
    fecha: fecha.slice(0, 10), // yyyy-mm-dd
    proveedor: m.proveedor || "—",
    modelo: m.modelo || "—",
    tokens: m.total || (m.input && m.output ? m.input + m.output : null) || 0,
    costo: m.costo || "—",
  };
}

/** Agrupa hitos por período (año-mes). */
function groupByPeriod(hitos) {
  const groups = {};
  for (const h of hitos) {
    const key = h.fecha.slice(0, 7); // yyyy-mm
    if (!groups[key]) groups[key] = [];
    groups[key].push(h);
  }
  return groups;
}

/** Genera el markdown del dashboard. */
function generateDashboard(project, hitos) {
  const groups = groupByPeriod(hitos);
  const periods = Object.keys(groups).sort().reverse();

  let md = `# Dashboard — ${project}\n\n`;
  md += `Generado: ${new Date().toISOString().slice(0, 10)}\n\n`;

  // Resumen global
  const totalHitos = hitos.length;
  const totalTokens = hitos.reduce((s, h) => s + (h.tokens || 0), 0);
  const tipoCounts = {};
  for (const h of hitos) { tipoCounts[h.tipo] = (tipoCounts[h.tipo] || 0) + 1; }

  md += `## Resumen global\n\n`;
  md += `- **Total de hitos:** ${totalHitos}\n`;
  md += `- **Total de tokens:** ${totalTokens.toLocaleString()}\n`;
  md += `- **Por tipo:** ${Object.entries(tipoCounts).map(([k, v]) => `${k}: ${v}`).join(" · ")}\n`;
  md += `\n`;

  // Tabla por período
  for (const per of periods) {
    const [y, m] = per.split("-");
    const label = `${y}-${m}`;
    md += `## ${label}\n\n`;
    md += `| Hito | Tipo | Tamaño | Tokens | Proveedor | Modelo |\n`;
    md += `|------|------|--------|--------|-----------|--------|\n`;
    for (const h of groups[per]) {
      const tks = h.tokens ? h.tokens.toLocaleString() : "—";
      md += `| ${h.slug} | ${h.tipo} | ${h.tamaño} | ${tks} | ${h.proveedor} | ${h.modelo} |\n`;
    }
    md += `\n`;
  }

  if (periods.length === 0) {
    md += `> Aún no hay hitos documentados en \`.ozali/docs/cdk/\`.\n\n`;
  }

  md += `---\n\n`;
  md += `*Dashboard generado automáticamente por \`ozali dashboard\`.*\n`;
  return md;
}

export async function dashboard(cwd, opts = {}) {
  step("ozali dashboard — resumen de hitos");
  const cfg = readJSON(CONFIG_PATH(cwd));
  const project = (cfg && cfg.project) || projectName(cwd);

  const docsDir = CDK_DOCS_PATH(cwd);
  if (!exists(docsDir)) {
    warn("No existe .ozali/docs/cdk/ todavía. Corré ozali init y generá al menos un hito con cdk.");
    return 1;
  }

  const entries = fs.readdirSync(docsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 0) {
    warn("No hay hitos documentados aún.");
    return 1;
  }

  const hitos = entries.map((e) => parseHito(cwd, e.name)).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const md = generateDashboard(project, hitos);
  const outPath = DASHBOARD_PATH(cwd);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, md);
  ok(`Dashboard escrito en ${c.bold(path.relative(cwd, outPath))} (${hitos.length} hitos).`);

  // Espejo a Engram (best-effort)
  const engramOk = tryExec("engram", ["--version"]);
  if (engramOk) {
    const summary = `${hitos.length} hitos · ${hitos.reduce((s, h) => s + (h.tokens || 0), 0).toLocaleString()} tokens · períodos: ${Object.keys(groupByPeriod(hitos)).join(", ")}`;
    try {
      spawnCmd("engram", [
        "save", "--title", `cdk/_project/dashboard`,
        "--topic", `cdk/_project/dashboard`,
        "--type", "architecture",
        "--project", project,
        "--scope", "project",
        "--content", summary,
      ]);
      info("Dashboard espejado a Engram (cdk/_project/dashboard).");
    } catch {
      warn("No se pudo espejar el dashboard a Engram.");
    }
  } else {
    info("Engram no disponible; dashboard quedó solo en disco.");
  }

  return 0;
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
