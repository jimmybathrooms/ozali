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

/** Parsea una versión semver "x.y.z" en {major, minor, patch} (enteros). */
export function parseSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

/** Compara dos versiones semver. Devuelve {diff, ahead} donde diff puede ser
 *  'same', 'patch', 'minor', 'major'. */
export function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (va.major !== vb.major) return { diff: "major", ahead: va.major > vb.major };
  if (va.minor !== vb.minor) return { diff: "minor", ahead: va.minor > vb.minor };
  if (va.patch !== vb.patch) return { diff: "patch", ahead: va.patch > vb.patch };
  return { diff: "same", ahead: false };
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

/** Repo oficial de Engram: única fuente aceptada para binarios descargados. */
export const ENGRAM_REPO = "Gentleman-Programming/engram";
const ENGRAM_DOWNLOAD_PREFIX = `/${ENGRAM_REPO}/releases/download/`;

/**
 * Valida que una URL de descarga apunte REALMENTE a un asset de release del repo
 * oficial de Engram, sobre HTTPS. Blinda contra una respuesta de la API manipulada
 * (o un mirror/redirect hostil) que intente colarnos un binario de otro origen.
 * Función pura. Devuelve true/false.
 */
export function isTrustedEngramURL(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;          // https://github.com@evil/…
  if (u.hostname !== "github.com") return false;
  return u.pathname.startsWith(ENGRAM_DOWNLOAD_PREFIX);
}

/** URL del manifiesto `checksums.txt` del MISMO release que `assetURL`. null si la URL no es confiable. */
export function checksumsURLFor(assetURL) {
  if (!isTrustedEngramURL(assetURL)) return null;
  const u = new URL(assetURL);
  u.pathname = u.pathname.replace(/[^/]+$/, "checksums.txt");
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Extrae el SHA-256 esperado de un asset desde el contenido de `checksums.txt`
 * (formato GoReleaser/sha256sum: `<hex>  <nombre>`). Función pura.
 * Devuelve el hash en minúsculas o null si el asset no aparece o el formato es inválido.
 */
export function parseChecksums(text, assetName) {
  if (!text || !assetName) return null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m && m[2] === assetName) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Proyecta la respuesta de `/releases` a solo los campos que usamos. El JSON real trae
 * el changelog completo de cada release (decenas de KB); esto mantiene el caché chico.
 * Función pura. Devuelve un array (vacío si la entrada no es un array).
 */
export function slimReleases(releases) {
  if (!Array.isArray(releases)) return [];
  return releases.map((r) => ({
    tag_name: r?.tag_name ?? null,
    draft: !!r?.draft,
    prerelease: !!r?.prerelease,
    published_at: r?.published_at ?? null,
    html_url: r?.html_url ?? null,
    assets: Array.isArray(r?.assets)
      ? r.assets.map((a) => ({ name: a?.name ?? null, browser_download_url: a?.browser_download_url ?? null }))
      : [],
  }));
}

/**
 * Lee el caché de releases y dice si sirve. Devuelve { releases, fresh } o null si el
 * caché está vacío/corrupto. `fresh` = dentro del TTL; una entrada vencida se devuelve
 * igual con fresh:false para poder usarla como red de seguridad si la API falla.
 * Función pura (sin I/O).
 */
export function readReleasesCache(cache, now = Date.now(), ttlMs = 6 * 60 * 60 * 1000) {
  if (!cache || !Array.isArray(cache.releases) || cache.releases.length === 0) return null;
  const fetchedAt = Number(cache.fetchedAt) || 0;
  if (!fetchedAt || fetchedAt > now) return null; // sin timestamp o del futuro → inservible
  return { releases: cache.releases, fresh: now - fetchedAt < ttlMs, ageMs: now - fetchedAt };
}

/**
 * Elige el binario precompilado de Engram para un SO/arch dado a partir de la lista de
 * releases (formato de la API de GitHub `/releases`). Se queda con el release ESTABLE
 * más reciente cuyo tag sea semver `vX.Y.Z` y que **realmente contenga** el asset
 * esperado, y devuelve su `browser_download_url` real. Ignora tags no-semver (p. ej.
 * `pi-v*`, builds de Raspberry Pi que NO traen binarios), draft/prerelease y cualquier
 * URL que no apunte al repo oficial sobre HTTPS.
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
    if (!asset || !asset.browser_download_url) continue;
    if (!isTrustedEngramURL(asset.browser_download_url)) continue; // origen no confiable → se ignora
    return { version, url: asset.browser_download_url, asset: name };
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
export const GITIGNORE_HEADER = "# ozali — histórico aislado (no commitear en el repo principal)";

/** Reglas que ozali escribía antes y que hoy sobran: `.ozali/` se commitea (config del equipo). */
export const GITIGNORE_OBSOLETE = [".ozali/*", "!.ozali/cloud.json"];

export function ensureGitignore(cwd, entries) {
  const gi = path.join(cwd, ".gitignore");
  const body = exists(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = body.split(/\r?\n/);
  const have = new Set(lines);
  const missing = entries.filter((e) => !have.has(e));
  if (missing.length === 0) return { added: [] };

  // Si el bloque de ozali ya existe, mete lo que falte DENTRO en vez de duplicar el encabezado.
  const at = lines.indexOf(GITIGNORE_HEADER);
  if (at !== -1) {
    lines.splice(at + 1, 0, ...missing);
    fs.writeFileSync(gi, lines.join("\n"));
    return { added: missing };
  }

  const block = (body && !body.endsWith("\n") ? "\n" : "") +
    "\n" + GITIGNORE_HEADER + "\n" + missing.join("\n") + "\n";
  fs.writeFileSync(gi, body + block);
  return { added: missing };
}

/**
 * Quita líneas exactas del .gitignore (reglas de ozali que quedaron obsoletas).
 * `ensureGitignore` solo agrega, así que sin esto un repo viejo conserva sus reglas
 * para siempre. Devuelve { removed }.
 */
export function pruneGitignore(cwd, entries) {
  const gi = path.join(cwd, ".gitignore");
  if (!exists(gi)) return { removed: [] };
  const body = fs.readFileSync(gi, "utf8");
  const lines = body.split(/\r?\n/);
  const drop = new Set(entries);
  const removed = entries.filter((e) => lines.some((l) => l.trim() === e));
  if (removed.length === 0) return { removed: [] };
  fs.writeFileSync(gi, lines.filter((l) => !drop.has(l.trim())).join("\n"));
  return { removed };
}

// ---- modelos de agentes -----------------------------------------------------

/**
 * Migra los IDs de modelo de Claude a los **alias** (`haiku`/`sonnet`/`opus`), que es lo que
 * exige el contrato cdk v6. Un ID con versión (`claude-opus-4`) envejece: queda apuntando a un
 * modelo viejo —o inexistente— cuando sale la familia siguiente. Los alias no.
 * Solo toca valores que sean claramente un ID de familia de Claude; un modelo custom se respeta.
 * Función pura. Devuelve { models, changed } (no muta la entrada).
 */
export function migrateClaudeModelAliases(claudeModels) {
  if (!claudeModels || typeof claudeModels !== "object") return { models: claudeModels, changed: [] };
  const out = { ...claudeModels };
  const changed = [];
  for (const level of ["low", "medium", "high"]) {
    const v = out[level];
    if (typeof v !== "string") continue;
    const m = /^claude-(haiku|sonnet|opus)(?:[-_.].*)?$/i.exec(v.trim());
    if (!m) continue; // ID custom o ya alias → intacto
    const alias = m[1].toLowerCase();
    if (v !== alias) { out[level] = alias; changed.push(`${level}: ${v} → ${alias}`); }
  }
  return { models: out, changed };
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
  // Expandir ~ antes de normalizar: path.resolve/fs.realpathSync no entienden ~
  let input = absPath;
  const home = os.homedir();
  if (input.startsWith("~") && home) {
    const rest = input.slice(1);
    input = home + (rest.startsWith(path.sep) || rest === "" ? rest : path.sep + rest);
  }
  // Normalizar con realpath para resolver symlinks (macOS: /var → /private/var)
  let normalized;
  try { normalized = fs.realpathSync(input); } catch { normalized = path.resolve(base || process.cwd(), input); }
  // 1) base-relative (preferido sobre home-relative: más portable entre máquinas)
  if (base) {
    let baseNorm;
    try { baseNorm = fs.realpathSync(base); } catch { baseNorm = path.resolve(base); }
    if (normalized.startsWith(baseNorm + path.sep)) {
      const rel = path.relative(baseNorm, normalized);
      // Defensa: si el relativo contiene ~ como segmento (incluyendo al inicio), el path
      // está corrupto (por un bug previo donde path.resolve trató ~ como directorio literal).
      const hasTildeSegment = rel.includes(path.sep + "~") || rel.endsWith(path.sep + "~") || rel.startsWith("~");
      if (!hasTildeSegment) {
        return rel;
      }
    }
  }
  // 2) home-relative → ~
  if (home && (normalized === home || normalized.startsWith(home + path.sep))) {
    const suffix = normalized === home ? "" : normalized.slice(home.length);
    // Defensa: si el suffix contiene ~ como segmento de directorio, el path está corrupto
    // (por un bug previo donde path.resolve trató ~ como directorio literal). No lo
    // compactamos a ~; devolvemos el absoluto para que sea visible y reparable.
    if (!suffix.includes(path.sep + "~") && !suffix.endsWith(path.sep + "~")) {
      return "~" + suffix;
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
