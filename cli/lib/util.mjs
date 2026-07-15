// util.mjs — helpers de bajo nivel, CERO dependencias (solo node:*).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ---- rutas del paquete ------------------------------------------------------
// Este archivo vive en <root>/cli/lib/util.mjs → la raíz del paquete es ../../..
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(HERE, "..", "..");
export const SKILL_SRC = path.join(PKG_ROOT, "skill");
export const COMMIT_SKILL_SRC = path.join(PKG_ROOT, "skill-commit");
export const SKILL_GENERATOR_SRC = path.join(PKG_ROOT, "skill-generator");
export const TEMPLATES_SRC = path.join(PKG_ROOT, "templates");

export function pkgVersion() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
    return p.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Nombre del asset de release de Engram para un SO/arch/versión dados.
 * Convención oficial: engram_<version>_<os>_<arch>.<ext> (.tar.gz en linux/darwin, .zip en windows).
 * Devuelve null si el SO o la arquitectura no están soportados. Función pura (sin red).
 */
export function engramAssetName(platform, arch, version) {
  const osMap = { darwin: "darwin", linux: "linux", win32: "windows" };
  const archMap = { x64: "amd64", arm64: "arm64" };
  const os = osMap[platform];
  const a = archMap[arch];
  if (!os || !a) return null;
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `engram_${version}_${os}_${a}.${ext}`;
}

/**
 * Elige el binario precompilado de Engram para un SO/arch dado a partir de la lista de
 * releases (formato de la API de GitHub `/releases`). Se queda con el release ESTABLE
 * más reciente cuyo tag sea semver `vX.Y.Z` y que **realmente contenga** el asset
 * esperado, y devuelve su `browser_download_url` real. Ignora tags no-semver (p. ej.
 * `pi-v*`, builds de Raspberry Pi que NO traen binarios) y draft/prerelease.
 * Función pura (sin red). Devuelve { version, url } o null.
 */
export function pickEngramAsset(releases, platform, arch) {
  if (!Array.isArray(releases)) return null;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const m = /^v(\d+\.\d+\.\d+)$/.exec(r.tag_name || "");
    if (!m) continue; // salta tags no-semver (pi-v*, etc.)
    const version = m[1];
    const name = engramAssetName(platform, arch, version);
    if (!name) return null; // SO/arch sin binario publicado
    const asset = Array.isArray(r.assets) ? r.assets.find((a) => a && a.name === name) : null;
    if (asset && asset.browser_download_url) return { version, url: asset.browser_download_url };
  }
  return null;
}

// ---- colores (sin deps; respeta NO_COLOR y no-TTY) --------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
};

export const ok = (m) => console.log(`${c.green("✔")} ${m}`);
export const warn = (m) => console.log(`${c.yellow("⚠")} ${m}`);
export const err = (m) => console.error(`${c.red("✖")} ${m}`);
export const info = (m) => console.log(`${c.cyan("•")} ${m}`);
export const step = (m) => console.log(`\n${c.bold(c.magenta("▸ " + m))}`);

// ---- filesystem -------------------------------------------------------------
export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Copia recursiva de un directorio (zero-dep). */
export function copyDir(src, dst) {
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

export function writeJSON(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

/** Abre una URL en el navegador por defecto. Devuelve true si pudo lanzar el comando. */
export function openURL(url) {
  if (!url) return false;
  if (process.platform === "darwin") return spawnCmd("open", [url]) === 0;
  if (process.platform === "win32") return spawnCmd("cmd", ["/c", "start", "", url]) === 0;
  return spawnCmd("xdg-open", [url]) === 0;
}

// ---- ejecución de comandos (read-only / git) --------------------------------
/** Ejecuta un binario y devuelve stdout recortado, o null si falla. */
export function tryExec(cmd, args = [], opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim();
  } catch {
    return null;
  }
}

/** Ejecuta un comando con I/O visible en la terminal. Devuelve el exit code (0 = éxito). */
export function spawnCmd(cmd, args = [], opts = {}) {
  try {
    execFileSync(cmd, args, { stdio: "inherit", ...opts });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

/** Detecta el gestor de paquetes disponible (pnpm > bun > yarn > npm). */
export function detectPkgManager() {
  for (const pm of ["pnpm", "bun", "yarn", "npm"]) {
    if (which(pm)) return pm;
  }
  return "npm";
}

export function which(bin) {
  const finder = process.platform === "win32" ? "where" : "which";
  return tryExec(finder, [bin]);
}

// ---- git --------------------------------------------------------------------
export function gitInfo(cwd) {
  const inside = tryExec("git", ["rev-parse", "--is-inside-work-tree"], { cwd }) === "true";
  if (!inside) return { isRepo: false };
  return {
    isRepo: true,
    branch: tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
    commit: tryExec("git", ["rev-parse", "--short", "HEAD"], { cwd }),
    remote: tryExec("git", ["remote", "get-url", "origin"], { cwd }),
    userName: tryExec("git", ["config", "user.name"], { cwd }),
    userEmail: tryExec("git", ["config", "user.email"], { cwd }),
  };
}

/** Nombre de proyecto normalizado (remoto git → minúsculas; si no, carpeta). */
export function projectName(cwd) {
  const g = gitInfo(cwd);
  if (g.isRepo && g.remote) {
    const m = g.remote.replace(/\.git$/, "").match(/([^/:]+)$/);
    if (m) return m[1].toLowerCase();
  }
  return path.basename(cwd).toLowerCase();
}

// ---- .gitignore idempotente -------------------------------------------------
export function ensureGitignore(cwd, entries) {
  const gi = path.join(cwd, ".gitignore");
  let body = exists(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = new Set(body.split(/\r?\n/));
  const missing = entries.filter((e) => !lines.has(e));
  if (missing.length === 0) return { added: [] };
  const block = (body && !body.endsWith("\n") ? "\n" : "") +
    "\n# ozali — histórico aislado (no commitear en el repo principal)\n" +
    missing.join("\n") + "\n";
  fs.writeFileSync(gi, body + block);
  return { added: missing };
}

// ---- node version -----------------------------------------------------------
export function nodeMajor() {
  return parseInt(process.versions.node.split(".")[0], 10);
}

// ---- rutas portables (cross-platform / cross-team) --------------------------

/**
 * Convierte un path absoluto a formato portable para guardar en config.json.
 * Reglas (en orden de prioridad):
 * 1. Si está bajo `os.homedir()`, reemplazar prefijo por `~`.
 * 2. Si `base` (cwd del proyecto) está definido y el path está bajo `base`,
 *    devolver relativo a `base`.
 * 3. Dejar absoluto (legacy; emitir warning en el caller si es necesario).
 */
export function toPortablePath(absPath, base = null) {
  if (!absPath) return absPath;
  // Normalizar con realpath para resolver symlinks (macOS: /var → /private/var)
  let normalized;
  try { normalized = fs.realpathSync(absPath); } catch { normalized = path.resolve(absPath); }
  const home = os.homedir();
  // 1) home-relative → ~
  if (home && (normalized === home || normalized.startsWith(home + path.sep))) {
    return "~" + normalized.slice(home.length);
  }
  // 2) base-relative
  if (base) {
    let baseNorm;
    try { baseNorm = fs.realpathSync(base); } catch { baseNorm = path.resolve(base); }
    if (normalized.startsWith(baseNorm + path.sep)) {
      return path.relative(baseNorm, normalized);
    }
  }
  // 3) absoluto legacy
  return normalized;
}

/**
 * Expande un path portable a absoluto.
 * Reglas:
 * 1. Si empieza con `~`, expandir a `os.homedir()`.
 * 2. Si es relativo, resolver contra `base` (cwd del proyecto).
 * 3. Si ya es absoluto (legacy), devolver tal cual.
 */
export function fromPortablePath(portablePath, base = null) {
  if (!portablePath) return portablePath;
  // 1) expandir ~
  if (portablePath.startsWith("~")) {
    const home = os.homedir();
    const rest = portablePath.slice(1);
    return home + (rest.startsWith(path.sep) || rest === "" ? rest : path.sep + rest);
  }
  // 2) relativo → absoluto contra base
  if (base && !path.isAbsolute(portablePath)) {
    return path.resolve(base, portablePath);
  }
  // 3) absoluto legacy o ya resuelto
  return path.resolve(portablePath);
}

export const HOME = os.homedir();
export const DEFAULT_KNOWLEDGE = path.join(HOME, ".ozali", "knowledge");
