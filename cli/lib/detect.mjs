// detect.mjs — detección read-only del entorno del proyecto destino.
import fs from "node:fs";
import path from "node:path";
import { exists, which, gitInfo, nodeMajor, HOME, readJSON, projectName, DEFAULT_KNOWLEDGE } from "./util.mjs";

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

/** Engram disponible (binario CLI en PATH). El MCP no se puede sondear desde aquí. */
export function detectEngram() {
  const bin = which("engram");
  return { available: !!bin, bin: bin || null };
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

/** Snapshot completo del entorno. */
export function detectAll(cwd) {
  return {
    cwd,
    node: { major: nodeMajor(), version: process.versions.node, ok: nodeMajor() >= 16 },
    git: gitInfo(cwd),
    sot: detectSourceOfTruth(cwd),
    agents: detectAgents(cwd),
    skill: detectInstalledSkill(cwd),
    engram: detectEngram(),
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
 * Junta las rutas de repos git bajo `root` hasta `depth` niveles. Un directorio que
 * ES repo git se trata como hoja (no se desciende dentro). Salta ocultos/ignorados.
 */
function collectRepoDirs(root, depth, level = 1, acc = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (isKnowledgeRepo(full)) continue;
    if (gitInfo(full).isRepo) { acc.push(full); continue; } // repo = hoja
    if (level < depth) collectRepoDirs(full, depth, level + 1, acc);
  }
  return acc;
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
  const dirs = collectRepoDirs(root, depth);
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
      git: { branch: g.branch || null, remote: g.remote || null },
    };
  }).sort((a, b) => a.dir.localeCompare(b.dir));
  const existing = readJSON(path.join(root, "ozali-workspace.json"));
  return { root, members, existing };
}

/**
 * Infiere referencias entre repos (aristas dirigidas {from, to, kind}). Zero-dep,
 * best-effort: dependencias npm cruzadas, submódulos git y contextos de docker-compose.
 * `from` depende de / apunta a `to`. Devuelve aristas únicas.
 */
export function detectReferences(members) {
  const byPkg = new Map();
  const byDir = new Map();
  for (const m of members) {
    if (m.pkgName) byPkg.set(m.pkgName, m);
    byDir.set(path.basename(m.dir), m);
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
    // 2) submódulos git (.gitmodules → path de cada submódulo)
    const gm = path.join(m.path, ".gitmodules");
    if (exists(gm)) {
      const txt = fs.readFileSync(gm, "utf8");
      for (const match of txt.matchAll(/^\s*path\s*=\s*(.+)$/gim)) {
        const target = byDir.get(path.basename(match[1].trim()));
        if (target) push(m, target, "git-submodule");
      }
    }
    // 3) docker-compose (build context que apunte a un repo hermano)
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
