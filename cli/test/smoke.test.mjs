// smoke.test.mjs — pruebas básicas del CLI (node:test, sin dependencias).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  engramAssetName, pickEngramAsset, isTrustedEngramURL, checksumsURLFor, parseChecksums,
  slimReleases, readReleasesCache, migrateClaudeModelAliases, gitTracks,
  toPortablePath, fromPortablePath,
} from "../lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "..", "bin", "ozali.mjs");
const PKG_ROOT = path.resolve(HERE, "..", "..");

function run(args, cwd, expectFail = false) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
  for (const cmd of ["init", "workspace", "doctor", "update", "sync", "audit"]) assert.match(stdout, new RegExp(cmd));
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
    assert.equal(cfg.mode, "docs", "--no-engram deja modo docs");
    assert.equal(cfg.frozen, false, "frozen default es false");
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

function initRepo(dir) {
  run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
}

function writeCdkStub(dir, body) {
  const f = path.join(dir, ".claude", "skills", "cdk", "SKILL.md");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
}

test("init instala la skill ozali-commit", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "ozali-commit", "SKILL.md")), "ozali-commit SKILL.md instalada");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init instala la skill skill-generator", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "skill-generator", "SKILL.md")), "skill-generator SKILL.md instalada");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "skill-generator", "references", "skill-creation-blueprint.md")), "skill-generator references instaladas");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init migra skills heredadas copsis-* a ozali-*", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    // Simular skills heredadas
    fs.mkdirSync(path.join(dir, ".claude", "skills", "copsis-commit"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "skills", "copsis-commit", "SKILL.md"), "# copsis-commit\n");
    fs.mkdirSync(path.join(dir, ".claude", "skills", "copsis-doctor"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "skills", "copsis-doctor", "SKILL.md"), "# copsis-doctor\n");
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    // Verificar migración
    assert.ok(!fs.existsSync(path.join(dir, ".claude", "skills", "copsis-commit")), "copsis-commit eliminado");
    assert.ok(!fs.existsSync(path.join(dir, ".claude", "skills", "copsis-doctor")), "copsis-doctor eliminado");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "ozali-commit", "SKILL.md")), "ozali-commit instalado");
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "skill-generator", "SKILL.md")), "skill-generator instalado localmente");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor marca cdk al día cuando la versión de contrato coincide", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    writeCdkStub(dir, "---\nname: cdk\ncdk_contract_version: 6\n---\n# cdk\n");
    const { stdout } = run(["doctor"], dir, true);
    assert.match(stdout, /Skill cdk/, "doctor reporta la fila Skill cdk");
    assert.match(stdout, /contrato v6 \(al día\)/, "doctor marca cdk al día");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor marca cdk desactualizada si referencia copsis-commit", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    writeCdkStub(dir, "---\nname: cdk\ncdk_contract_version: 2\n---\n# cdk\ninvoca copsis-commit al cierre del hito\n");
    const { stdout } = run(["doctor"], dir, true);
    assert.match(stdout, /copsis-commit/, "doctor avisa de copsis-commit");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor NO marca copsis-commit si solo es mención negativa (nunca copsis-commit)", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    writeCdkStub(dir, "---\nname: cdk\ncdk_contract_version: 6\n---\n# cdk\n5. **Commit:** invoca la skill **`ozali-commit`** (nunca `copsis-commit`) para el commit summary\n");
    const { stdout } = run(["doctor"], dir, true);
    assert.match(stdout, /Skill cdk/, "doctor reporta la fila Skill cdk");
    assert.doesNotMatch(stdout, /contiene copsis-commit/, "doctor NO debe marcar copsis-commit en menciones negativas");
    assert.match(stdout, /al día/, "doctor marca cdk al día");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update avisa y da pasos manuales si cdk está desactualizada (legado)", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    writeCdkStub(dir, "---\nname: cdk\n---\n# cdk legado que invoca copsis-commit\n");
    const { stdout } = run(["update"], dir);
    assert.match(stdout, /cdk desactualizada/, "update avisa de cdk desactualizada");
    assert.match(stdout, /copsis-commit/, "update menciona la migración de copsis-commit");
    assert.match(stdout, /skill ozali|pre-flight|migra/i, "update da pasos manuales");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update también instala ozali-commit en repos previos", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    // Simula instalación previa sin ozali-commit.
    fs.rmSync(path.join(dir, ".claude", "skills", "ozali-commit"), { recursive: true, force: true });
    assert.ok(!fs.existsSync(path.join(dir, ".claude", "skills", "ozali-commit", "SKILL.md")), "precondición: sin ozali-commit");
    run(["update"], dir);
    assert.ok(fs.existsSync(path.join(dir, ".claude", "skills", "ozali-commit", "SKILL.md")), "update instala ozali-commit");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ workspace
function wsRepo(root, name, { config = false, cdk = false, pkg = null, pom = null } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (config) {
    fs.mkdirSync(path.join(dir, ".ozali"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ozali", "config.json"), JSON.stringify({ agent: "claude-code" }));
  }
  if (cdk) {
    fs.mkdirSync(path.join(dir, ".claude", "skills", "cdk"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "skills", "cdk", "SKILL.md"), "---\nname: cdk\n---\n");
  }
  if (pkg) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  if (pom) fs.writeFileSync(path.join(dir, "pom.xml"), pomXml(pom));
}

/** pom.xml mínimo; incluye un plugin para verificar que no se confunde con el artifactId propio. */
function pomXml({ groupId = "com.acme", artifactId, deps = [] }) {
  const d = deps
    .map((x) => `<dependency><groupId>${x.groupId || "com.acme"}</groupId><artifactId>${x.artifactId}</artifactId><version>1.0</version></dependency>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<project><modelVersion>4.0.0</modelVersion>
  <groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>1.0</version>
  <dependencies>${d}</dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-war-plugin</artifactId></plugin></plugins></build>
</project>`;
}

test("workspace escanea y clasifica repos hijos sin escribir (dry-run)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "web", { config: true, pkg: { name: "web", dependencies: { api: "^1" } } });
    wsRepo(root, "lib-bare", { pkg: { name: "lib" } });
    const { stdout } = run(["workspace", "--dry-run"], root);
    assert.match(stdout, /listo/, "clasifica api como listo");
    assert.match(stdout, /sin calibrar/, "clasifica web como sin calibrar");
    assert.match(stdout, /sin init/, "clasifica lib-bare como sin init");
    assert.match(stdout, /web → api \(npm-dep\)/, "detecta la referencia npm web→api");
    assert.match(stdout, /no escribo nada/, "dry-run no escribe");
    assert.ok(!fs.existsSync(path.join(root, "ozali-workspace.json")), "dry-run: no hay manifiesto");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace escribe manifiesto + .code-workspace + jarvis y es idempotente", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    // Ambos ready (con cdk) → sin missing-init, no invoca init pesado.
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "web", { config: true, cdk: true, pkg: { name: "web", dependencies: { api: "^1" } } });
    run(["workspace", "--yes", "--no-trust"], root);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, "ozali-workspace.json"), "utf8"));
    assert.equal(manifest.members.length, 2, "manifiesto con 2 miembros");
    assert.ok(manifest.references.some((r) => r.from === "web" && r.to === "api"), "referencia web→api en el manifiesto");

    const wsFile = path.join(root, `${path.basename(root)}.code-workspace`);
    assert.ok(fs.existsSync(wsFile), ".code-workspace escrito");
    assert.equal(JSON.parse(fs.readFileSync(wsFile, "utf8")).folders.length, 2, "multi-root con 2 folders");
    assert.match(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), /ozali-workspace-jarvis:start/, "bloque jarvis en CLAUDE.md");
    // Track 2: si la skill global NO existe, se instala en la raíz; si existe, no se duplica.
    // En este entorno de test la global puede existir, así que solo verificamos que no hay duplicados.
    const localSkill = fs.existsSync(path.join(root, ".claude", "skills", "ozali", "SKILL.md"));
    const globalSkill = fs.existsSync(path.join(os.homedir(), ".claude", "skills", "ozali", "SKILL.md"));
    assert.ok(localSkill || globalSkill, "skill ozali disponible (local o global)");

    // idempotencia: re-correr no duplica
    run(["workspace", "--yes", "--no-trust"], root);
    const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    assert.equal((claude.match(/ozali-workspace-jarvis:start/g) || []).length, 1, "no duplica el bloque jarvis");
    assert.equal(JSON.parse(fs.readFileSync(wsFile, "utf8")).folders.length, 2, "no duplica folders");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace --doctor revisa cada miembro y saca resumen consolidado", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "web", { config: true, cdk: true, pkg: { name: "web" } });
    const { stdout } = run(["workspace", "--doctor"], root, true); // exit 1 esperado (repos sin sot/engram)
    assert.match(stdout, /health-check/i, "corre doctor por repo");
    assert.match(stdout, /Resumen del workspace/, "imprime el resumen consolidado");
    assert.match(stdout, /api/, "menciona el repo api en el resumen");
    assert.match(stdout, /web/, "menciona el repo web en el resumen");
    assert.ok(!fs.existsSync(path.join(root, "ozali-workspace.json")), "--doctor no escribe config");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace --update actualiza cada miembro y salta los sin init", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "bare", { pkg: { name: "bare" } }); // missing-init → se salta
    const { stdout } = run(["workspace", "--update", "--yes", "--no-jarvis"], root);
    assert.match(stdout, /Resumen del workspace/, "imprime el resumen consolidado");
    assert.match(stdout, /Sin ozali init/, "salta el repo sin init");
    assert.ok(!fs.existsSync(path.join(root, "ozali-workspace.json")), "--update no escribe config");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace no trata subcarpetas de un repo como miembros (solo repos propios)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root }); // la raíz ES un repo git
    fs.mkdirSync(path.join(root, "src"));                 // subcarpeta simple, NO repo propio
    fs.writeFileSync(path.join(root, "src", "index.js"), "//\n");
    wsRepo(root, "pkg", { config: true, cdk: true, pkg: { name: "pkg", version: "1.0.0" } }); // repo propio anidado
    const { stdout } = run(["workspace", "--dry-run"], root);
    assert.match(stdout, /\bpkg\b/, "incluye el repo propio anidado");
    assert.doesNotMatch(stdout, /\bsrc\b/, "no incluye la subcarpeta que no es repo propio");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace detecta dependencias Maven aunque la carpeta no se llame como el artefacto", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "core-polizas-new", { config: true, cdk: true, pom: { artifactId: "core-polizas" } });
    wsRepo(root, "apolizas-new", {
      config: true, cdk: true,
      pom: { artifactId: "apolizas", deps: [{ artifactId: "core-polizas" }, { groupId: "org.json", artifactId: "json" }] },
    });
    const { stdout } = run(["workspace", "--dry-run"], root);
    assert.match(stdout, /apolizas-new → core-polizas-new \(maven-dep\)/, "cruza por artifactId, no por nombre de carpeta");
    assert.doesNotMatch(stdout, /json/, "no inventa referencias con dependencias externas");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace preserva las referencias escritas a mano al re-correr", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "web", { config: true, cdk: true, pkg: { name: "web", dependencies: { api: "^1" } } });
    run(["workspace", "--yes", "--no-trust"], root);

    const file = path.join(root, "ozali-workspace.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(manifest.references.every((r) => r.source === "auto"), "lo detectado queda marcado como auto");
    manifest.references.push({ from: "api", to: "web", kind: "rest-api" }); // relación que ozali no infiere
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

    run(["workspace", "--yes", "--no-trust"], root);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    const manual = after.references.find((r) => r.kind === "rest-api");
    assert.ok(manual, "la referencia manual sobrevive a la re-corrida");
    assert.equal(manual.source, "manual", "queda marcada como manual");
    assert.ok(after.references.some((r) => r.from === "web" && r.to === "api" && r.source === "auto"), "la auto sigue ahí");
    assert.equal(after.references.filter((r) => r.kind === "rest-api").length, 1, "no la duplica");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace toma como miembros los folders de un *.code-workspace (aunque estén fuera de la raíz)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    const root = path.join(base, "grupo");
    const aparte = path.join(base, "aparte");
    fs.mkdirSync(root); fs.mkdirSync(aparte);
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "scripts", { pkg: { name: "scripts" } }); // en disco, pero NO declarado
    wsRepo(aparte, "legacy", { config: true, cdk: true, pkg: { name: "legacy" } });
    fs.writeFileSync(path.join(root, "grupo.code-workspace"),
      JSON.stringify({ folders: [{ path: "api" }, { path: "../aparte/legacy" }] }));

    const { stdout } = run(["workspace", "--dry-run"], root);
    assert.match(stdout, /legacy/, "incluye el repo declarado en el .code-workspace");
    assert.match(stdout, /code-workspace/, "lo marca como venido del .code-workspace");
    assert.match(stdout, /NO declarados/, "avisa del repo en disco que no está declarado");
    assert.doesNotMatch(stdout, /Aquí correría ozali init en:[^\n]*scripts/, "no trata como miembro lo no declarado");

    const todos = run(["workspace", "--dry-run", "--scan-all"], root);
    assert.match(todos.stdout, /Aquí correría ozali init en:[^\n]*scripts/, "--scan-all sí lo incluye");

    const solo = run(["workspace", "--dry-run", "--no-code-workspace"], root);
    assert.doesNotMatch(solo.stdout, /legacy/, "--no-code-workspace vuelve al escaneo puro");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("workspace corrido DENTRO de un repo sube a la carpeta que lo agrupa", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "web", { config: true, cdk: true, pkg: { name: "web", dependencies: { api: "^1" } } });
    const { stdout } = run(["workspace", "--dry-run", "--yes"], path.join(root, "web"));
    assert.match(stdout, /agrupa 2 repo/, "avisa que encontró la raíz real");
    assert.match(stdout, /\bapi\b/, "escanea desde la carpeta padre");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace inicializa los repos sin init sin reventar (regresión: root indefinido)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ozali-ws-"));
  try {
    wsRepo(root, "api", { config: true, cdk: true, pkg: { name: "api", version: "1.0.0" } });
    wsRepo(root, "bare", { pkg: { name: "bare" } }); // missing-init → entra a Fase B
    const { stdout } = run(["workspace", "--yes", "--no-trust", "--no-engram"], root);
    assert.doesNotMatch(stdout, /root is not defined/, "no revienta al heredar el knowledgeRepo");
    assert.ok(fs.existsSync(path.join(root, "bare", ".ozali", "config.json")), "corrió ozali init en el repo sin init");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test(".gitignore ignora solo el ruido local; .ozali/ es commiteable", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.doesNotMatch(gi, /^\.ozali\/\*$/m, "ya NO ignora .ozali/ entero");
    assert.doesNotMatch(gi, /!\.ozali\/cloud\.json/, "la negación quedó obsoleta y no debe escribirse");
    assert.match(gi, /^\.ozali\/backups\/$/m, "ignora los backups de skills");
    assert.match(gi, /^\.ozali\/\.session-state\.json$/m, "ignora el state de sesión");
    assert.match(gi, /^\.engram\/$/m, "ignora .engram/");
    assert.doesNotMatch(gi, /^\.ozali\/docs/m, "la doc por hito de cdk se versiona en el repo principal");
    assert.match(gi, /^\.ozali\/metrics\/$/m, "la telemetría de tokens es caché local derivado: fuera del repo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update migra un .gitignore legado (.ozali/* → solo ruido local)", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    // Simula el .gitignore que escribían las versiones < 0.17.0.
    fs.writeFileSync(path.join(dir, ".gitignore"),
      "node_modules/\n\n# ozali — histórico aislado (no commitear en el repo principal)\n.ozali/*\n!.ozali/cloud.json\n.engram/\n");

    run(["update"], dir);

    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.doesNotMatch(gi, /^\.ozali\/\*$/m, "update retira .ozali/*");
    assert.doesNotMatch(gi, /!\.ozali\/cloud\.json/, "update retira la negación obsoleta");
    assert.match(gi, /^\.ozali\/backups\/$/m, "update agrega el ignore de backups");
    assert.match(gi, /^\.ozali\/\.session-state\.json$/m, "update agrega el ignore del state");
    assert.match(gi, /^\.ozali\/metrics\/$/m, "update agrega el ignore de la telemetría");
    assert.match(gi, /^node_modules\/$/m, "no toca reglas ajenas");
    assert.equal(gi.match(/# ozali — histórico aislado/g).length, 1, "no duplica el encabezado del bloque");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init/update retiran .ozali/docs/ si el agente la metió al .gitignore", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);

    // Simula lo que hacía el agente al calibrar siguiendo su propio SKILL.md, que decía
    // (mal) que la doc por hito iba gitignored en el repo principal.
    const gi0 = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    fs.writeFileSync(path.join(dir, ".gitignore"),
      gi0.replace(/^\.ozali\/backups\/$/m, ".ozali/backups/\n.ozali/docs/\n.ozali/docs/cdk/"));
    assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.ozali\/docs\/$/m, "precondición: la regla está");

    run(["update"], dir);

    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.doesNotMatch(gi, /^\.ozali\/docs\/$/m, "update retira .ozali/docs/");
    assert.doesNotMatch(gi, /^\.ozali\/docs\/cdk\/$/m, "update retira también la variante por-skill");
    assert.match(gi, /^\.ozali\/backups\/$/m, "no se lleva por delante el ignore de backups");
    assert.match(gi, /^\.engram\/$/m, "no toca .engram/");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update avisa cómo destrackear .ozali/metrics/ si ya estaba versionado", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);

    // Simula un repo de antes de la regla: la telemetría quedó en el índice de git.
    fs.mkdirSync(path.join(dir, ".ozali", "metrics"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ozali", "metrics", "token-metrics.json"), '{"hits":[]}');
    execFileSync("git", ["add", "-f", ".ozali/metrics/token-metrics.json"], { cwd: dir });
    // Y su .gitignore todavía no tiene la regla.
    const gi0 = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    fs.writeFileSync(path.join(dir, ".gitignore"), gi0.replace(/^\.ozali\/metrics\/\n/m, ""));

    const { stdout } = run(["update"], dir);

    assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.ozali\/metrics\/$/m, "update agrega la regla");
    assert.match(stdout, /git rm -r --cached \.ozali\/metrics/, "avisa cómo sacarlo del índice");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gitTracks distingue lo que está en el índice de lo que no", () => {
  const dir = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, "algo"), { recursive: true });
    fs.writeFileSync(path.join(dir, "algo", "x.txt"), "x");
    assert.equal(gitTracks(dir, "algo"), false, "sin git add no está trackeado");
    execFileSync("git", ["add", "algo/x.txt"], { cwd: dir });
    assert.equal(gitTracks(dir, "algo"), true, "tras git add sí");
    assert.equal(gitTracks(dir, "no-existe"), false, "una ruta inexistente nunca está trackeada");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migrateClaudeModelAliases pasa IDs con versión a alias y respeta modelos custom", () => {
  const legacy = migrateClaudeModelAliases({ low: "claude-haiku-4-5", medium: "claude-sonnet-4-5", high: "claude-opus-4" });
  assert.deepEqual(legacy.models, { low: "haiku", medium: "sonnet", high: "opus" });
  assert.equal(legacy.changed.length, 3);

  const mixed = migrateClaudeModelAliases({ low: "haiku", medium: "mi-modelo-propio", high: "claude-opus-5" });
  assert.deepEqual(mixed.models, { low: "haiku", medium: "mi-modelo-propio", high: "opus" });
  assert.deepEqual(mixed.changed, ["high: claude-opus-5 → opus"], "solo migra lo que es un ID de familia Claude");

  assert.deepEqual(migrateClaudeModelAliases(null).changed, []);
});

test("init escribe los modelos de Claude como alias (contrato cdk v6)", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".ozali", "config.json"), "utf8"));
    assert.deepEqual(cfg.agents.models.claude, { low: "haiku", medium: "sonnet", high: "opus" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update migra los modelos legados y sube la versión del config", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const cfgPath = path.join(dir, ".ozali", "config.json");
    // Simula un config calibrado con una versión vieja (IDs con versión).
    const legacy = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    legacy.version = "0.14.0";
    legacy.agents.models.claude = { low: "claude-haiku-4-5", medium: "claude-sonnet-4-5", high: "claude-opus-4" };
    fs.writeFileSync(cfgPath, JSON.stringify(legacy, null, 2));

    const { stdout } = run(["update", "--yes"], dir);

    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    assert.deepEqual(cfg.agents.models.claude, { low: "haiku", medium: "sonnet", high: "opus" }, "migra a alias");
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
    assert.equal(cfg.version, pkg.version, "update sube la versión del config a la del CLI");
    assert.match(stdout, /alias \(contrato cdk v6\)/, "avisa de la migración de modelos");
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

test("toPortablePath convierte absolutos a ~ o relativo", () => {
  const home = os.homedir();
  const cwd = "/project";
  assert.equal(toPortablePath(path.join(home, ".ozali", "knowledge"), cwd), "~/.ozali/knowledge");
  assert.equal(toPortablePath("/project/.k", "/project"), ".k");
  assert.equal(toPortablePath("/outside", "/project"), "/outside");
});

test("fromPortablePath expande ~ y resuelve relativos", () => {
  const home = os.homedir();
  const cwd = "/project";
  assert.equal(fromPortablePath("~/.ozali/knowledge", cwd), path.join(home, ".ozali", "knowledge"));
  assert.equal(fromPortablePath(".k", cwd), "/project/.k");
  assert.equal(fromPortablePath("/abs", cwd), "/abs");
});

test("toPortablePath prefiere base sobre home cuando el path está bajo ambos", () => {
  const home = os.homedir();
  const project = path.join(home, "projects", "foo");
  const knowledge = path.join(project, ".k");
  assert.equal(toPortablePath(knowledge, project), ".k");
});

test("toPortablePath expande ~ antes de resolver y no usa process.cwd()", () => {
  const home = os.homedir();
  const cwd = "/project";
  // ~/foo debe resolverse contra home, no contra process.cwd()
  assert.equal(toPortablePath("~/.ozali/knowledge", cwd), "~/.ozali/knowledge");
  // path relativo debe resolverse contra base, no contra process.cwd()
  assert.equal(toPortablePath(".k", cwd), ".k");
});

test("toPortablePath no compacta paths con ~ interno (corrupción legacy)", () => {
  const home = os.homedir();
  const project = path.join(home, "projects", "foo");
  // Simula un path corrupto generado por una versión anterior:
  // ~/projects/foo/~/projects/foo/.ozali/knowledge
  const corrupt = path.join(home, "projects", "foo", "~", "projects", "foo", ".ozali", "knowledge");
  const result = toPortablePath(corrupt, project);
  // No debe compactarse a ~... porque contiene ~ como segmento interno
  assert.ok(!result.startsWith("~"), "path corrupto NO debe quedar como ~ portable");
  assert.ok(path.isAbsolute(result), "path corrupto debe quedar como absoluto visible");
});

test("update limpia knowledgeRepo corrupto con ~ interno", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    // Corromper el config simulando un path legacy con doble ~
    const cfgPath = path.join(dir, ".ozali", "config.json");
    const home = os.homedir();
    const corrupt = path.join(home, path.relative(home, dir), "~", path.relative(home, dir), ".ozali", "knowledge");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.knowledgeRepo = "~" + corrupt.slice(home.length);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    // update debe re-normalizar y dejarlo limpio (relativo al proyecto)
    run(["update"], dir);
    const fixed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    assert.ok(!fixed.knowledgeRepo.includes(path.sep + "~"), "update limpia ~ interno");
    assert.ok(!fixed.knowledgeRepo.startsWith("~") || !fixed.knowledgeRepo.includes(path.sep + "~"), "no queda path corrupto");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init guarda knowledgeRepo como path portable", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".ozali", "config.json"), "utf8"));
    assert.ok(cfg.knowledgeRepo, "config tiene knowledgeRepo");
    assert.ok(!path.isAbsolute(cfg.knowledgeRepo), "knowledgeRepo NO debe ser absoluto");
    assert.equal(cfg.knowledgeRepo, ".k", "knowledgeRepo debe ser relativo al proyecto");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sync resuelve knowledgeRepo portable correctamente", () => {
  const dir = tmpProject();
  try {
    run(["init", "--yes", "--no-engram", "--no-trust", "--no-jarvis", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    // Crear algo en .ozali/docs/ para que sync tenga qué copiar
    fs.mkdirSync(path.join(dir, ".ozali", "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ozali", "docs", "test.md"), "# test\n");
    const { stdout } = run(["sync", "--yes"], dir);
    assert.match(stdout, /copiados|Docs copiados/, "sync debe encontrar el repo de conocimiento");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pickEngramAsset ignora tags no-semver sin binarios (pi-v*) y draft/prerelease", () => {
  const B = "https://github.com/Gentleman-Programming/engram/releases/download";
  // Shape real de la API de GitHub: el 'latest' es pi-v0.1.9 (0 assets); los binarios
  // viven en tags vX.Y.Z. Además metemos un prerelease más nuevo que debe saltarse.
  const releases = [
    { tag_name: "pi-v0.1.9", prerelease: false, draft: false, assets: [] },
    { tag_name: "v2.0.0", prerelease: true, draft: false, assets: [
      { name: "engram_2.0.0_linux_amd64.tar.gz", browser_download_url: B + "/v2.0.0/engram_2.0.0_linux_amd64.tar.gz" },
    ] },
    { tag_name: "v1.17.0", prerelease: false, draft: false, assets: [
      { name: "checksums.txt", browser_download_url: B + "/v1.17.0/checksums.txt" },
      { name: "engram_1.17.0_linux_amd64.tar.gz", browser_download_url: B + "/v1.17.0/engram_1.17.0_linux_amd64.tar.gz" },
      { name: "engram_1.17.0_darwin_arm64.tar.gz", browser_download_url: B + "/v1.17.0/engram_1.17.0_darwin_arm64.tar.gz" },
    ] },
  ];
  // Linux x64 → salta pi-v* (sin assets) y el prerelease → v1.17.0, con la URL REAL del asset.
  assert.deepEqual(pickEngramAsset(releases, "linux", "x64"), {
    version: "1.17.0",
    url: B + "/v1.17.0/engram_1.17.0_linux_amd64.tar.gz",
    asset: "engram_1.17.0_linux_amd64.tar.gz",
  });
  // macOS arm64 → mismo release, su asset darwin_arm64.
  assert.deepEqual(pickEngramAsset(releases, "darwin", "arm64"), {
    version: "1.17.0",
    url: B + "/v1.17.0/engram_1.17.0_darwin_arm64.tar.gz",
    asset: "engram_1.17.0_darwin_arm64.tar.gz",
  });
  // Arch sin binario → null.
  assert.equal(pickEngramAsset(releases, "linux", "ia32"), null);
  // Sin releases utilizables → null.
  assert.equal(pickEngramAsset([{ tag_name: "pi-v0.1.9", assets: [] }], "linux", "x64"), null);
  assert.equal(pickEngramAsset(null, "linux", "x64"), null);
});

test("pickEngramAsset descarta assets cuya URL no es del repo oficial", () => {
  const releases = [
    { tag_name: "v1.17.0", assets: [
      { name: "engram_1.17.0_linux_amd64.tar.gz", browser_download_url: "https://cdn-suplantado.tld/engram_1.17.0_linux_amd64.tar.gz" },
    ] },
    { tag_name: "v1.16.0", assets: [
      { name: "engram_1.16.0_linux_amd64.tar.gz", browser_download_url: "https://github.com/Gentleman-Programming/engram/releases/download/v1.16.0/engram_1.16.0_linux_amd64.tar.gz" },
    ] },
  ];
  const picked = pickEngramAsset(releases, "linux", "x64");
  assert.equal(picked.version, "1.16.0", "salta el release con URL de origen no confiable");
});

test("isTrustedEngramURL solo acepta assets de release del repo oficial por HTTPS", () => {
  const good = "https://github.com/Gentleman-Programming/engram/releases/download/v1.17.0/engram_1.17.0_linux_amd64.tar.gz";
  assert.equal(isTrustedEngramURL(good), true);
  assert.equal(isTrustedEngramURL(good.replace("https:", "http:")), false, "HTTP → rechazado");
  assert.equal(isTrustedEngramURL("https://github.com.suplantado.tld/Gentleman-Programming/engram/releases/download/v1/x.tar.gz"), false, "host parecido → rechazado");
  assert.equal(isTrustedEngramURL("https://github.com@suplantado.tld/Gentleman-Programming/engram/releases/download/v1/x.tar.gz"), false, "userinfo → rechazado");
  assert.equal(isTrustedEngramURL("https://github.com/otro/repo/releases/download/v1/x.tar.gz"), false, "otro repo → rechazado");
  assert.equal(isTrustedEngramURL("https://github.com/Gentleman-Programming/engram/archive/main.tar.gz"), false, "no es asset de release → rechazado");
  assert.equal(isTrustedEngramURL(null), false);
});

test("checksumsURLFor apunta al manifiesto del mismo release", () => {
  const asset = "https://github.com/Gentleman-Programming/engram/releases/download/v1.17.0/engram_1.17.0_linux_amd64.tar.gz";
  assert.equal(checksumsURLFor(asset), "https://github.com/Gentleman-Programming/engram/releases/download/v1.17.0/checksums.txt");
  assert.equal(checksumsURLFor("https://suplantado.tld/x.tar.gz"), null, "URL no confiable → null");
});

test("parseChecksums extrae el sha256 del asset exacto", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const txt = hashA + "  engram_1.17.0_linux_amd64.tar.gz\n" + hashB + "  engram_1.17.0_darwin_arm64.tar.gz\n";
  assert.equal(parseChecksums(txt, "engram_1.17.0_darwin_arm64.tar.gz"), hashB);
  assert.equal(parseChecksums(txt, "engram_1.17.0_windows_amd64.zip"), null, "asset ausente → null");
  assert.equal(parseChecksums("basura sin formato", "engram_1.17.0_linux_amd64.tar.gz"), null);
  assert.equal(parseChecksums("", "x"), null);
});

test("slimReleases se queda solo con los campos que usamos", () => {
  const slim = slimReleases([{
    tag_name: "v1.20.0", draft: false, prerelease: false, published_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/x", body: "changelog gigante".repeat(500),
    assets: [{ name: "engram_1.20.0_linux_amd64.tar.gz", browser_download_url: "https://github.com/a", size: 123, uploader: { login: "bot" } }],
  }]);
  assert.deepEqual(Object.keys(slim[0]).sort(), ["assets", "draft", "html_url", "prerelease", "published_at", "tag_name"]);
  assert.deepEqual(Object.keys(slim[0].assets[0]).sort(), ["browser_download_url", "name"]);
  assert.equal(slimReleases(null).length, 0);
});

test("readReleasesCache distingue caché fresco, vencido e inservible", () => {
  const now = 1_000_000_000_000;
  const ttl = 6 * 60 * 60 * 1000;
  const releases = [{ tag_name: "v1.20.0" }];

  const fresh = readReleasesCache({ fetchedAt: now - 60_000, releases }, now, ttl);
  assert.equal(fresh.fresh, true, "dentro del TTL → fresco");

  const stale = readReleasesCache({ fetchedAt: now - ttl - 1, releases }, now, ttl);
  assert.equal(stale.fresh, false, "fuera del TTL → sirve como red de seguridad");
  assert.ok(stale.ageMs > ttl);

  assert.equal(readReleasesCache(null, now, ttl), null);
  assert.equal(readReleasesCache({ releases }, now, ttl), null, "sin fetchedAt → inservible");
  assert.equal(readReleasesCache({ fetchedAt: now + 60_000, releases }, now, ttl), null, "timestamp futuro → inservible");
  assert.equal(readReleasesCache({ fetchedAt: now, releases: [] }, now, ttl), null, "lista vacía → inservible");
});

test("update respeta frozen y crea backup; rollback restaura", () => {
  const dir = tmpProject();
  try {
    // init con scope project para tener skills locales
    run(["init", "--yes", "--no-engram", "--no-trust", "--agent", "claude-code", "--scope", "project", "--knowledge-repo", path.join(dir, ".k")], dir);
    const skillDir = path.join(dir, ".claude", "skills", "ozali");
    assert.ok(fs.existsSync(skillDir), "skill local existe tras init");

    // Congelar el repo
    const cfgPath = path.join(dir, ".ozali", "config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.frozen = true;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    // update sin --skills no debe tocar skills
    const { stdout: out1 } = run(["update", "--yes"], dir);
    assert.match(out1, /frozen/, "update avisa de frozen");

    // Modificar SKILL.md en destino para detectar si se sobreescribió
    const skillMd = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillMd, fs.readFileSync(skillMd, "utf8") + "\n<!-- MODIFIED -->\n");
    assert.match(fs.readFileSync(skillMd, "utf8"), /MODIFIED/, "skill modificada para test");

    // update con --skills debe actualizar y crear backup
    const { stdout: out2 } = run(["update", "--yes", "--skills"], dir);
    assert.match(out2, /Backup creado/, "update con --skills crea backup");
    assert.ok(!fs.readFileSync(skillMd, "utf8").includes("MODIFIED"), "skill fue sobreescrita tras --skills");

    // Restaurar con --rollback
    const { stdout: out3 } = run(["update", "--yes", "--rollback"], dir);
    assert.match(out3, /restaurada/, "rollback restaura skill");
    assert.match(fs.readFileSync(skillMd, "utf8"), /MODIFIED/, "skill restaurada con contenido previo tras rollback");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor en proyecto backend (sin Node) no marca Node como fallo", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    // Simular proyecto Java backend: pom.xml, sin package.json
    fs.writeFileSync(path.join(dir, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");
    const { stdout } = run(["doctor"], dir, true);
    assert.match(stdout, /Node ≥ 16.*no aplica/, "doctor muestra Node como no aplica en backend");
    assert.doesNotMatch(stdout, /✖ Node ≥ 16/, "doctor NO marca Node como fallo en proyecto sin Node");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor en proyecto frontend (con Node) marca Node si es viejo", () => {
  const dir = tmpProject();
  try {
    initRepo(dir);
    // Simular proyecto frontend: package.json
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"test"}');
    const { stdout } = run(["doctor"], dir, true);
    // No podemos simular Node < 16, pero verificamos que NO diga "no aplica"
    assert.doesNotMatch(stdout, /Node ≥ 16.*no aplica/, "doctor NO muestra 'no aplica' en proyecto con Node");
    assert.match(stdout, /Node ≥ 16/, "doctor verifica Node en proyecto con package.json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
