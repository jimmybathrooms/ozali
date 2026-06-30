// smoke.test.mjs — pruebas básicas del CLI (node:test, sin dependencias).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engramAssetName } from "../lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "..", "bin", "ozali.mjs");
const PKG_ROOT = path.resolve(HERE, "..", "..");

function run(args, cwd, expectFail = false) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    if (!expectFail) throw e;
    return { code: e.status, stdout: (e.stdout || "") + (e.stderr || "") };
  }
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("--version imprime la versión del package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
  const { stdout } = run(["--version"]);
  assert.equal(stdout.trim(), pkg.version);
});

test("--help menciona los comandos", () => {
  const { stdout } = run(["--help"]);
  for (const cmd of ["init", "doctor", "update", "sync", "audit"]) assert.match(stdout, new RegExp(cmd));
});

test("audit imprime cabecera y no rompe (general)", () => {
  const dir = tmpProject();
  try {
    // Sin Engram → fallback a docs; con Engram → comandos read-only. Ambos exit 0.
    const { stdout } = run(["audit", "--general", "--yes"], dir);
    assert.match(stdout, /auditoría de memoria/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("comando desconocido sale con código 1", () => {
  const { code } = run(["frobnicate"], process.cwd(), true);
  assert.equal(code, 1);
});

test("doctor en proyecto vacío reporta pendientes (exit 1)", () => {
  const dir = tmpProject();
  try {
    const { code, stdout } = run(["doctor"], dir, true);
    assert.equal(code, 1);
    assert.match(stdout, /health-check/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --yes instala la skill, aísla el histórico y escribe config", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "ozali", "SKILL.md")), "SKILL.md instalada");
    assert.ok(fs.existsSync(path.join(dir, ".ozali", "config.json")), "config escrita");
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".ozali", "config.json"), "utf8"));
    assert.equal(cfg.memoryMode, "docs", "--no-engram deja modo docs");
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.match(gi, /\.ozali\//);
    assert.match(gi, /\.engram\//);
    // perfil base de permisos de Claude Code
    const settingsPath = path.join(dir, ".claude", "settings.json");
    assert.ok(fs.existsSync(settingsPath), "settings.json de Claude Code escrito");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.ok(Array.isArray(settings.permissions.allow) && settings.permissions.allow.length > 0, "allow no vacío");
    assert.ok(settings.permissions.deny.includes("Bash(rm -rf *)"), "deny bloquea rm -rf");
    // ozali-jarvis (Claude Code)
    assert.match(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /ozali-jarvis:start/, "bloque jarvis en CLAUDE.md");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "agents", "ozali-jarvis.md")), "subagente jarvis");
    assert.ok(settings.hooks && settings.hooks.SessionStart, "hooks de recordatorio jarvis");
    const eng = JSON.parse(fs.readFileSync(path.join(dir, ".engram", "config.json"), "utf8"));
    assert.ok(eng.project_name, ".engram/config.json con project_name");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --no-jarvis no crea el orquestador", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.md")), "sin CLAUDE.md");
    assert.ok(!fs.existsSync(path.join(dir, ".claude", "agents", "ozali-jarvis.md")), "sin subagente jarvis");
    assert.ok(!fs.existsSync(path.join(dir, ".engram", "config.json")), "sin .engram/config.json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init opencode crea jarvis (AGENTS.md + agente + plugin)", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--agent", "opencode", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    assert.match(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), /ozali-jarvis:start/, "bloque jarvis en AGENTS.md");
    const oc = JSON.parse(fs.readFileSync(path.join(dir, "opencode.json"), "utf8"));
    assert.equal(oc.agent["ozali-jarvis"].mode, "primary", "agente jarvis primary en opencode.json");
    assert.ok(fs.existsSync(path.join(dir, ".opencode", "plugins", "ozali-jarvis.js")), "plugin jarvis opencode");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update agrega ozali-jarvis en un repo que no lo tenía", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    assert.ok(!fs.existsSync(path.join(dir, ".claude", "agents", "ozali-jarvis.md")), "precondición: sin jarvis");
    run(["update"], dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "agents", "ozali-jarvis.md")), "update crea subagente jarvis");
    assert.match(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /ozali-jarvis:start/, "update crea bloque jarvis");
    assert.ok(fs.existsSync(path.join(dir, ".engram", "config.json")), "update fija .engram/config.json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --dry-run no escribe nada", () => {
  const dir = tmpProject();
  try {
    run(["init", "--dry-run", "--yes", "--no-engram"], dir);
    assert.ok(!fs.existsSync(path.join(dir, ".ozali")), "no debe crear .ozali en dry-run");
    assert.ok(!fs.existsSync(path.join(dir, ".claude")), "no debe crear .claude en dry-run");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("el paquete NO tiene dependencias ni lifecycle scripts (seguridad)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0, "cero dependencias");
  for (const s of ["preinstall", "install", "postinstall", "preuninstall", "postuninstall", "prepare"]) {
    assert.ok(!(pkg.scripts && pkg.scripts[s]), `sin script de ciclo de vida: ${s}`);
  }
});

test("--help menciona el comando cloud", () => {
  const { stdout } = run(["--help"]);
  assert.match(stdout, /cloud/, "help debe mencionar cloud");
  assert.match(stdout, /--dashboard/, "help debe mencionar --dashboard");
  assert.match(stdout, /--conflicts/, "help debe mencionar --conflicts");
});

test("cloud status imprime cabecera y no rompe", () => {
  const dir = tmpProject();
  try {
    const { code, stdout } = run(["cloud", "status"], dir, true);
    assert.match(stdout, /ozali cloud status/, "debe imprimir cabecera de cloud status");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cloud con subcomando desconocido sale con código 1", () => {
  const dir = tmpProject();
  try {
    const { code, stdout } = run(["cloud", "frobnicate"], dir, true);
    assert.equal(code, 1, "debe salir con código 1");
    assert.match(stdout, /Subcomando desconocido/, "debe indicar subcomando desconocido");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(".gitignore del repo destino permite .ozali/cloud.json (commiteable)", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.match(gi, /\.ozali\/\*/, "debe ignorar .ozali/*");
    assert.match(gi, /!\.ozali\/cloud\.json/, "debe permitir .ozali/cloud.json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("engramAssetName respeta la convención de release por SO/arch", () => {
  assert.equal(engramAssetName("linux", "x64", "1.17.0"), "engram_1.17.0_linux_amd64.tar.gz");
  assert.equal(engramAssetName("linux", "arm64", "1.17.0"), "engram_1.17.0_linux_arm64.tar.gz");
  assert.equal(engramAssetName("darwin", "arm64", "1.17.0"), "engram_1.17.0_darwin_arm64.tar.gz");
  assert.equal(engramAssetName("win32", "x64", "1.17.0"), "engram_1.17.0_windows_amd64.zip");
  assert.equal(engramAssetName("linux", "ia32", "1.17.0"), null, "arch no soportada → null");
  assert.equal(engramAssetName("freebsd", "x64", "1.17.0"), null, "SO no soportado → null");
});
