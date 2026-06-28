// detect.mjs — detección read-only del entorno del proyecto destino.
import fs from "node:fs";
import path from "node:path";
import { exists, which, gitInfo, nodeMajor, HOME } from "./util.mjs";

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
    testing: detectTesting(cwd),
  };
}
