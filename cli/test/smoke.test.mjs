// smoke.test.mjs — pruebas básicas del CLI (node:test, sin dependencias).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("--help menciona los 4 comandos", () => {
  const { stdout } = run(["--help"]);
  for (const cmd of ["init", "doctor", "update", "sync"]) assert.match(stdout, new RegExp(cmd));
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
    run(["init", "--yes", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "ozali", "SKILL.md")), "SKILL.md instalada");
    assert.ok(fs.existsSync(path.join(dir, ".ozali", "config.json")), "config escrita");
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.match(gi, /\.ozali\//);
    assert.match(gi, /\.engram\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --dry-run no escribe nada", () => {
  const dir = tmpProject();
  try {
    run(["init", "--dry-run", "--yes"], dir);
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
