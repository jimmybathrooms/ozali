// detect.mjs — detección read-only del entorno del proyecto destino.
import fs from "node:fs";
import path from "node:path";
import { exists, which, gitInfo, tryExec, nodeMajor, HOME, readJSON, projectName, DEFAULT_KNOWLEDGE } from "./util.mjs";

/** Variante de fuente de verdad: {found, doc, dir, variant} */
export function detectSourceOfTruth(cwd) {
  const variants = [
    { variant: "AI", doc: "AI.md", dir: ".ai" },
    { variant: "IA", doc: "IA.md", dir: ".ia" },
  ];
  for (const v of variants) {
    const docPath = path.join(cwd, v.doc);
    const dirPath = path.join(cwd, v.dir);
    if (exists(docPath) || exists(dirPath)) {
      return { found: true, ...v, hasDoc: exists(docPath), hasDir: exists(dirPath) };
    }
  }
  return { found: false, variant: "AI", doc: "AI.md", dir: ".ai" };
}

/** Agentes presentes: claude-code y/o opencode. */
export function detectAgents(cwd) {
  const claudeProject = exists(path.join(cwd, ".claude"));
  const claudeGlobal = exists(path.join(HOME, ".claude"));
  const opencodeProject = exists(path.join(cwd, "opencode.json")) || exists(path.join(cwd, ".opencode"));
  const opencodeGlobal = exists(path.join(HOME, ".config", "opencode"));
  return {
    claudeCode: { present: claudeProject || claudeGlobal, project: claudeProject, global: claudeGlobal },
    opencode: { present: opencodeProject || opencodeGlobal, project: opencodeProject, global: opencodeGlobal },
  };
}

/** ¿Está instalada la skill ozali? Devuelve rutas encontradas. */
export function detectInstalledSkill(cwd) {
  const candidates = [
    path.join(cwd, ".claude", "skills", "ozali"),
    path.join(HOME, ".claude", "skills", "ozali"),
  ];
  const found = candidates.filter((p) => exists(path.join(p, "SKILL.md")));
  return { installed: found.length > 0, paths: found };
}

/** ¿Está instalada la skill skill-generator? Devuelve rutas encontradas. */
export function detectInstalledSkillGenerator(cwd) {
  const candidates = [
    path.join(cwd, ".claude", "skills", "skill-generator"),
    path.join(HOME, ".claude", "skills", "skill-generator"),
  ];
  const found = candidates.filter((p) => exists(path.join(p, "SKILL.md")));
  return { installed: found.length > 0, paths: found };
}

/** ¿Está instalada la skill ozali-commit? Devuelve rutas encontradas. */
export function detectInstalledOzaliCommit(cwd) {
  const candidates = [
    path.join(cwd, ".claude", "skills", "ozali-commit"),
    path.join(HOME, ".claude", "skills", "ozali-commit"),
    path.join(cwd, ".opencode", "skills", "ozali-commit"),
    path.join(HOME, ".config", "opencode", "skills", "ozali-commit"),
  ];
  const found = candidates.filter((p) => exists(path.join(p, "SKILL.md")));
  return { installed: found.length > 0, paths: found };
}

/** Engram disponible (binario CLI en PATH). El MCP no se puede sondear desde aquí. */
export function detectEngram() {
  const bin = which("engram");
  return { available: !!bin, bin: bin || null };
}

/** Entradas de `engram@engram` en installed_plugins.json, tolerando el formato v2 y el legado. */
function engramPluginEntries(data) {
  if (!data || typeof data !== "object") return null;
  const fromV2 = data.plugins && data.plugins["engram@engram"];
  const fromLegacy = data["engram@engram"];
  const entries = Array.isArray(fromV2) ? fromV2 : fromLegacy;
  return Array.isArray(entries) ? entries : null;
}

/**
 * Verifica si el plugin engram@engram está instalado y HABILITADO a nivel usuario
 * en Claude Code (~/.claude/plugins/installed_plugins.json).
 * El binario puede estar en PATH y el .mcp.json clonado en marketplaces, pero si
 * el plugin no figura con scope:user, Claude Code NO levanta el servidor MCP.
 */
export function detectEngramPluginInstalled({ home = HOME } = {}) {
  const installedPath = path.join(home, ".claude", "plugins", "installed_plugins.json");
  if (!exists(installedPath)) {
    return { installed: false, enabled: false, path: installedPath, detail: "no existe installed_plugins.json" };
  }
  try {
    const data = JSON.parse(fs.readFileSync(installedPath, "utf8"));
    // El archivo tiene dos formatos: el legado pone las entradas en la raíz y el v2 las cuelga de
    // `plugins`. Leer solo la raíz daba un falso "no registrado" en instalaciones v2.
    const entries = engramPluginEntries(data);
    if (!Array.isArray(entries) || entries.length === 0) {
      return { installed: false, enabled: false, path: installedPath, detail: "plugin engram@engram no registrado" };
    }
    const userEntry = entries.find((e) => e && e.scope === "user");
    if (userEntry) {
      return {
        installed: true,
        enabled: true,
        path: installedPath,
        detail: `habilitado (scope: user, v${userEntry.version || "?"})`,
      };
    }
    return {
      installed: true,
      enabled: false,
      path: installedPath,
      detail: "plugin instalado pero no habilitado para el usuario (scope: user)",
    };
  } catch {
    return { installed: false, enabled: false, path: installedPath, detail: "error leyendo installed_plugins.json" };
  }
}

/**
 * ¿Claude Code termina levantando REALMENTE el servidor MCP de Engram?
 *
 * Que el plugin figure "enabled" no alcanza: el servidor se registra por el `.mcp.json` de la raíz
 * del plugin (auto-descubierto) o por la clave `mcpServers` de su `plugin.json`. Hubo versiones
 * del plugin para Claude Code publicadas **sin ninguno de los dos** —la variante para Codex del
 * mismo repo sí lo traía—, así que `/plugin` mostraba el plugin habilitado y las tools `mem_*`
 * nunca cargaban. Este check mira el registro efectivo, no el estado declarado.
 *
 * Acepta `home` para poder testearlo sin tocar el HOME real.
 * Devuelve { registered, source, detail, fix, pluginVersion }.
 */
export function detectEngramMcpServer({ home = HOME } = {}) {
  const FIX = "claude mcp add engram -s user -- engram mcp --tools=agent";
  const out = (registered, source, detail, pluginVersion = null) =>
    ({ registered, source, detail, fix: FIX, pluginVersion });

  // 1) El plugin instalado a nivel usuario: ¿aporta servidor?
  let installPath = null, pluginVersion = null;
  const installedPath = path.join(home, ".claude", "plugins", "installed_plugins.json");
  const installed = readJSON(installedPath);
  if (installed) {
    const entries = engramPluginEntries(installed);
    const userEntry = entries ? entries.find((e) => e && e.scope === "user") : null;
    if (userEntry) {
      installPath = userEntry.installPath || null;
      pluginVersion = userEntry.version || null;
    }
  }
  if (installPath && exists(installPath)) {
    const mcpJson = readJSON(path.join(installPath, ".mcp.json"));
    if (mcpJson && mcpJson.mcpServers && mcpJson.mcpServers.engram) {
      return out(true, "plugin (.mcp.json)", `el plugin v${pluginVersion || "?"} registra el MCP por su .mcp.json`, pluginVersion);
    }
    const manifest = readJSON(path.join(installPath, ".claude-plugin", "plugin.json"));
    if (manifest && manifest.mcpServers) {
      return out(true, "plugin (plugin.json)", `el plugin v${pluginVersion || "?"} declara mcpServers en su plugin.json`, pluginVersion);
    }
  }

  // 2) Registro manual del usuario (el workaround de `claude mcp add`).
  const userCfg = readJSON(path.join(home, ".claude.json"));
  if (userCfg && userCfg.mcpServers && userCfg.mcpServers.engram) {
    return out(true, "registro manual (~/.claude.json)", "el servidor está registrado a mano con scope user", pluginVersion);
  }

  if (!installPath) {
    return out(false, null, "el plugin engram@engram no está instalado con scope user", pluginVersion);
  }
  return out(
    false,
    null,
    `el plugin v${pluginVersion || "?"} está habilitado pero no registra ningún servidor MCP ` +
      "(su plugin.json no trae mcpServers y no hay .mcp.json en la raíz)",
    pluginVersion,
  );
}

/**
 * Verifica si Engram MCP está configurado en opencode.
 * Revisa opencode.json global y proyecto (incluyendo .jsonc).
 */
export function detectEngramOpencode(cwd) {
  const candidates = [
    path.join(cwd, "opencode.json"),
    path.join(cwd, "opencode.jsonc"),
    path.join(HOME, ".config", "opencode", "opencode.json"),
    path.join(HOME, ".config", "opencode", "opencode.jsonc"),
  ];
  for (const p of candidates) {
    if (!exists(p)) continue;
    try {
      const txt = fs.readFileSync(p, "utf8");
      // Simple JSONC comment stripping for parsing
      const cleaned = txt.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const data = JSON.parse(cleaned);
      if (data.mcp && data.mcp.engram) {
        const enabled = data.mcp.engram.enabled !== false;
        return {
          configured: true,
          enabled,
          path: p,
          detail: enabled ? `habilitado en ${path.basename(p)}` : `deshabilitado en ${path.basename(p)}`,
        };
      }
      if (data.mcpServers && data.mcpServers.engram) {
        const enabled = data.mcpServers.engram.enabled !== false;
        return {
          configured: true,
          enabled,
          path: p,
          detail: enabled ? `habilitado en ${path.basename(p)} (mcpServers)` : `deshabilitado en ${path.basename(p)} (mcpServers)`,
        };
      }
    } catch { /* ignore parse errors */ }
  }
  return { configured: false, enabled: false, path: null, detail: "no configurado en opencode" };
}

/** Detecta si Obsidian está instalado. Devuelve { installed, path } por SO. */
export function detectObsidian() {
  const plat = process.platform;
  if (plat === "darwin") {
    const appPaths = [
      "/Applications/Obsidian.app",
      path.join(HOME, "Applications", "Obsidian.app"),
    ];
    for (const p of appPaths) if (exists(p)) return { installed: true, path: p };
    const bin = which("obsidian");
    if (bin) return { installed: true, path: bin };
  } else if (plat === "linux") {
    const bin = which("obsidian");
    if (bin) return { installed: true, path: bin };
    const flatpak = path.join(HOME, ".var", "app", "md.obsidian.Obsidian");
    if (exists(flatpak)) return { installed: true, path: flatpak };
    const snap = "/snap/bin/obsidian";
    if (exists(snap)) return { installed: true, path: snap };
  } else if (plat === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
    const exe = path.join(localAppData, "Obsidian", "Obsidian.exe");
    if (exists(exe)) return { installed: true, path: exe };
  }
  return { installed: false, path: null };
}

/** Metadatos compartibles de Engram Cloud del proyecto (sin secretos). */
export function detectCloud(cwd) {
  const metaPath = path.join(cwd, ".ozali", "cloud.json");
  const meta = readJSON(metaPath);
  return { present: !!meta, path: metaPath, meta: meta || null };
}

/**
 * Capacidades de testing (heurística read-only). Devuelve runner(s), comando y
 * un conteo aproximado de archivos de prueba. NO resuelve strict_tdd (eso lo
 * hace el bootstrap en la Fase 3.5); aquí solo damos señales.
 */
export function detectTesting(cwd) {
  const out = { runners: [], command: null, testFiles: 0, hints: [] };
  const pkg = path.join(cwd, "package.json");
  if (exists(pkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkg, "utf8"));
      const deps = { ...j.dependencies, ...j.devDependencies };
      for (const r of ["vitest", "jest", "mocha", "@playwright/test", "cypress", "karma", "ava"]) {
        if (deps[r]) out.runners.push(r);
      }
      if (j.scripts && j.scripts.test) out.command = "npm test";
    } catch { /* ignore */ }
  }
  if (exists(path.join(cwd, "go.mod"))) { out.runners.push("go test"); out.command = out.command || "go test ./..."; }
  if (exists(path.join(cwd, "pom.xml"))) { out.runners.push("maven/junit"); out.command = out.command || "mvn test"; }
  if (exists(path.join(cwd, "pyproject.toml")) || exists(path.join(cwd, "pytest.ini"))) {
    out.runners.push("pytest"); out.command = out.command || "pytest";
  }
  out.testFiles = countTestFiles(cwd);
  if (out.runners.length === 0) out.hints.push("No se detectó runner de pruebas (strict_tdd tenderá a false).");
  return out;
}

function countTestFiles(dir, depth = 0, acc = { n: 0 }) {
  if (depth > 6 || acc.n > 9999) return acc.n;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc.n; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".") && e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) countTestFiles(full, depth + 1, acc);
    else if (/\.(spec|test)\.(ts|tsx|js|jsx)$|_test\.go$|Test\.java$|^test_.*\.py$/.test(e.name)) acc.n++;
  }
  return acc.n;
}

/** Detecta si el proyecto usa Node.js (package.json o archivos .js/.ts/.mjs). */
export function detectNeedsNode(cwd) {
  if (exists(path.join(cwd, "package.json"))) return true;
  const nodeExts = /\.(js|mjs|cjs|ts|tsx|mts|cts)$/i;
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (!e.isDirectory()) {
      if (nodeExts.test(e.name)) return true;
    } else if (!e.name.startsWith(".") && e.name !== "node_modules") {
      let sub;
      try { sub = fs.readdirSync(path.join(cwd, e.name), { withFileTypes: true }); } catch { continue; }
      for (const s of sub) {
        if (!s.isDirectory() && nodeExts.test(s.name)) return true;
      }
    }
  }
  return false;
}

/** Snapshot completo del entorno. */
export function detectAll(cwd) {
  return {
    cwd,
    node: { major: nodeMajor(), version: process.versions.node, ok: nodeMajor() >= 16, needsNode: detectNeedsNode(cwd) },
    git: gitInfo(cwd),
    sot: detectSourceOfTruth(cwd),
    agents: detectAgents(cwd),
    skill: detectInstalledSkill(cwd),
    skillGenerator: detectInstalledSkillGenerator(cwd),
    ozaliCommit: detectInstalledOzaliCommit(cwd),
    engram: detectEngram(),
    engramPlugin: detectEngramPluginInstalled(),
    engramMcp: detectEngramMcpServer(),
    engramOpencode: detectEngramOpencode(cwd),
    obsidian: detectObsidian(),
    cloud: detectCloud(cwd),
    testing: detectTesting(cwd),
  };
}

// ===================================================== workspace (multi-repo) ==

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", "target"]);

/** ¿La raíz misma es el knowledge repo (o vive dentro de él)? Para no auto-escanearlo. */
function isKnowledgeRepo(dir) {
  const k = path.resolve(DEFAULT_KNOWLEDGE);
  const d = path.resolve(dir);
  return d === k || d.startsWith(k + path.sep);
}

/**
 * ¿`dir` es la RAÍZ de su propio repo git? No basta con estar dentro de un work tree
 * (una subcarpeta de un repo también lo está): exigimos que el toplevel de git sea `dir`.
 * Así, correr `ozali workspace` dentro de un repo NO trata sus subcarpetas como miembros.
 */
function realOrSelf(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

function isRepoRoot(dir) {
  const top = tryExec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  if (!top) return false;
  try { return fs.realpathSync(top) === fs.realpathSync(dir); } catch { return false; }
}

/**
 * Junta las rutas de repos git bajo `root` hasta `depth` niveles. Un directorio que
 * ES la raíz de su propio repo git se trata como hoja (no se desciende dentro). Salta
 * ocultos/ignorados.
 */
function collectRepoDirs(root, depth, level = 1, acc = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (isKnowledgeRepo(full)) continue;
    if (isRepoRoot(full)) { acc.push(full); continue; } // repo propio = hoja
    if (level < depth) collectRepoDirs(full, depth, level + 1, acc);
  }
  return acc;
}

/** Lee el primer valor de un tag simple (`<name>valor</name>`). Zero-dep, best-effort. */
function xmlTag(xml, name) {
  const m = new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, "i").exec(xml);
  return m ? m[1] : null;
}

/**
 * Coordenadas Maven de un `pom.xml`: {file, groupId, artifactId, deps[], modules[]}.
 * Zero-dep y best-effort (regex, no parser XML): quita comentarios, aísla `<parent>` para
 * heredar el groupId y saca las `<dependency>` antes de leer las coordenadas propias
 * (así el primer `<artifactId>` restante es el del proyecto, no el de un plugin).
 */
export function readPom(file) {
  let txt;
  try { txt = fs.readFileSync(file, "utf8"); } catch { return null; }
  txt = txt.replace(/<!--[\s\S]*?-->/g, "");
  const parent = /<parent\b[^>]*>([\s\S]*?)<\/parent>/i.exec(txt);
  const body = txt.replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/gi, "");
  const deps = [];
  for (const m of body.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const artifactId = xmlTag(m[1], "artifactId");
    if (artifactId) deps.push({ groupId: xmlTag(m[1], "groupId"), artifactId });
  }
  const own = body.replace(/<dependency\b[^>]*>[\s\S]*?<\/dependency>/gi, "");
  const artifactId = xmlTag(own, "artifactId");
  if (!artifactId) return null;
  const modules = [...own.matchAll(/<module>\s*([^<]+?)\s*<\/module>/gi)].map((m) => m[1].trim());
  return { file, groupId: xmlTag(own, "groupId") || (parent ? xmlTag(parent[1], "groupId") : null), artifactId, deps, modules };
}

/** Poms de un repo: el de la raíz + los de sus `<module>` de primer nivel (multi-módulo). */
function pomsOf(dir) {
  const root = readPom(path.join(dir, "pom.xml"));
  if (!root) return [];
  const poms = [root];
  for (const mod of root.modules) {
    const sub = readPom(path.join(dir, mod, "pom.xml"));
    if (sub) poms.push(sub);
  }
  return poms;
}

/**
 * Repos declarados en un `*.code-workspace` (multi-root de VSCode/Antigravity) de `root`.
 * Permite que los miembros vivan FUERA de la carpeta raíz: el editor ya los agrupó ahí.
 * Solo se aceptan carpetas que sean raíz de su propio repo git.
 */
export function readCodeWorkspaceMembers(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const dirs = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".code-workspace")) continue;
    const cfg = readJSON(path.join(root, e.name));
    if (!cfg || !Array.isArray(cfg.folders)) continue;
    for (const f of cfg.folders) {
      if (!f || typeof f.path !== "string") continue;
      const full = path.resolve(root, f.path);
      if (isKnowledgeRepo(full) || !isRepoRoot(full)) continue;
      dirs.push(full);
    }
  }
  return dirs;
}

/**
 * Busca hacia ARRIBA (desde `start`, hasta `maxUp` niveles) una carpeta que agrupe repos:
 * o bien tiene un `*.code-workspace` con miembros válidos, o bien tiene repos git hijos.
 * Sirve cuando el usuario corre `ozali workspace` parado DENTRO de uno de sus repos.
 */
export function findWorkspaceRootUp(start, maxUp = 3, opts = {}) {
  let dir = path.resolve(start);
  for (let i = 0; i <= maxUp; i++) {
    const declared = opts.noCodeWorkspace ? [] : readCodeWorkspaceMembers(dir);
    if (declared.length) return { root: dir, via: "code-workspace", count: declared.length };
    if (dir !== path.resolve(start)) {
      const scanned = collectRepoDirs(dir, 1);
      if (scanned.length) return { root: dir, via: "scan", count: scanned.length };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Estado ozali de un repo: missing-init | needs-calibration | ready. */
function memberStatus(hasConfig, hasCdk) {
  if (!hasConfig) return "missing-init";
  if (!hasCdk) return "needs-calibration";
  return "ready";
}

/**
 * Inventario multi-repo de una carpeta raíz. Read-only. Por cada repo git hijo arma
 * su estado ozali (init/calibración), fuente de verdad, proyecto Engram y nombre de
 * package.json (para inferir referencias). `existing` = manifiesto previo, si lo hay.
 */
export function detectWorkspace(root, opts = {}) {
  const depth = Math.max(1, opts.depth || 1);
  const scanned = collectRepoDirs(root, depth);
  // Un *.code-workspace es una declaración EXPLÍCITA del equipo: si existe, manda. Los repos que
  // están en disco pero no declarados NO son miembros; se reportan aparte (extras) para que el
  // usuario decida (agregarlos al .code-workspace, o incluirlos con --scan-all).
  const declared = opts.noCodeWorkspace ? [] : readCodeWorkspaceMembers(root);
  const declaredSet = new Set(declared.map(realOrSelf));
  const declares = declared.length > 0 && !opts.scanAll;
  const dirs = [];
  const extraDirs = [];
  const seenDirs = new Set();
  for (const full of [...declared, ...scanned]) {
    const key = realOrSelf(full);
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);
    if (declares && !declaredSet.has(key)) { extraDirs.push(full); continue; }
    dirs.push(full);
  }
  const members = dirs.map((full) => {
    const hasConfig = exists(path.join(full, ".ozali", "config.json"));
    const hasCdk = exists(path.join(full, ".claude", "skills", "cdk", "SKILL.md"));
    const engramCfg = readJSON(path.join(full, ".engram", "config.json"));
    const pkg = readJSON(path.join(full, "package.json"));
    const g = gitInfo(full);
    return {
      dir: path.relative(root, full) || path.basename(full),
      path: full,
      project: projectName(full),
      pkgName: pkg && typeof pkg.name === "string" ? pkg.name : null,
      sot: detectSourceOfTruth(full),
      hasConfig,
      hasCdk,
      engramProject: engramCfg && engramCfg.project_name ? engramCfg.project_name : null,
      status: memberStatus(hasConfig, hasCdk),
      fromCodeWorkspace: declaredSet.has(realOrSelf(full)),
      git: { branch: g.branch || null, remote: g.remote || null },
    };
  }).sort((a, b) => a.dir.localeCompare(b.dir));
  const existing = readJSON(path.join(root, "ozali-workspace.json"));
  const extras = extraDirs.map((full) => ({ dir: path.relative(root, full) || path.basename(full), path: full }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
  return { root, members, extras, declaredBy: declares ? "code-workspace" : null, existing };
}

/**
 * Infiere referencias entre repos (aristas dirigidas {from, to, kind}). Zero-dep,
 * best-effort: dependencias npm cruzadas, submódulos git y contextos de docker-compose.
 * `from` depende de / apunta a `to`. Devuelve aristas únicas.
 */
export function detectReferences(members) {
  const byPkg = new Map();
  const byDir = new Map();
  const byMaven = new Map();   // "groupId:artifactId" y "artifactId" → miembro que lo publica
  const pomsByMember = new Map();
  for (const m of members) {
    if (m.pkgName) byPkg.set(m.pkgName, m);
    byDir.set(path.basename(m.dir), m);
    const poms = pomsOf(m.path);
    if (poms.length) pomsByMember.set(m.dir, poms);
    for (const pom of poms) {
      // el artifactId solo es suficiente si nadie más lo publica; el coord completo siempre gana
      if (pom.groupId) byMaven.set(`${pom.groupId}:${pom.artifactId}`, m);
      if (!byMaven.has(pom.artifactId)) byMaven.set(pom.artifactId, m);
    }
  }
  const edges = [];
  const seen = new Set();
  const push = (from, to, kind) => {
    if (!from || !to || from.dir === to.dir) return;
    const key = `${from.dir}→${to.dir}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: from.project, to: to.project, fromDir: from.dir, toDir: to.dir, kind });
  };

  for (const m of members) {
    // 1) dependencias npm cruzadas
    const pkg = readJSON(path.join(m.path, "package.json"));
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      for (const name of Object.keys(deps)) {
        const target = byPkg.get(name);
        if (target) push(m, target, "npm-dep");
      }
    }
    // 2) dependencias Maven cruzadas (pom.xml del repo + sus módulos de primer nivel).
    //    Se cruza por groupId:artifactId (o artifactId a secas): la carpeta puede llamarse
    //    distinto que el artefacto (p. ej. `sio4-core-polizas-new` publica `sio4-core-polizas`).
    for (const pom of pomsByMember.get(m.dir) || []) {
      for (const d of pom.deps) {
        const target = (d.groupId && byMaven.get(`${d.groupId}:${d.artifactId}`)) || byMaven.get(d.artifactId);
        if (target) push(m, target, "maven-dep");
      }
    }
    // 3) submódulos git (.gitmodules → path de cada submódulo)
    const gm = path.join(m.path, ".gitmodules");
    if (exists(gm)) {
      const txt = fs.readFileSync(gm, "utf8");
      for (const match of txt.matchAll(/^\s*path\s*=\s*(.+)$/gim)) {
        const target = byDir.get(path.basename(match[1].trim()));
        if (target) push(m, target, "git-submodule");
      }
    }
    // 4) docker-compose (build context que apunte a un repo hermano)
    for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
      const cf = path.join(m.path, f);
      if (!exists(cf)) continue;
      const txt = fs.readFileSync(cf, "utf8");
      for (const match of txt.matchAll(/context:\s*(\.{1,2}\/\S+)/gi)) {
        const target = byDir.get(path.basename(match[1].trim().replace(/\/+$/, "")));
        if (target) push(m, target, "compose");
      }
    }
  }
  return edges;
}

/** Detecta skills heredadas de versiones anteriores (copsis-*). */
export function detectLegacySkills(cwd) {
  const legacy = [];
  const candidates = [
    { name: "copsis-commit", path: path.join(cwd, ".claude", "skills", "copsis-commit"), target: "ozali-commit" },
    { name: "copsis-doctor", path: path.join(cwd, ".claude", "skills", "copsis-doctor"), target: null },
    { name: "copsis-commit", path: path.join(cwd, ".opencode", "skills", "copsis-commit"), target: "ozali-commit" },
    { name: "copsis-doctor", path: path.join(cwd, ".opencode", "skills", "copsis-doctor"), target: null },
  ];
  for (const c of candidates) {
    if (exists(c.path)) legacy.push(c);
  }
  return legacy;
}
