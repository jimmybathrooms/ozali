// usage.mjs — medición de tokens de una corrida de cdk, SIN depender de ningún plugin.
// Fuente: los transcripts de Claude Code (~/.claude/projects/<cwd-codificado>/**/*.jsonl), donde cada
// mensaje del asistente trae `message.usage`. Cada hito acumula SEGMENTOS (rango de tiempo + sesión):
// `start` abre uno, `pause` (o el fin de sesión, o cambiar a otro hito) lo cierra. `end` suma solo lo que
// cayó dentro de los segmentos del hito. Varios hitos pueden estar pendientes a la vez: el ledger
// (.ozali/metrics/runs.json) es la bitácora de lo abierto. Costo: siempre null (N/A).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exists, ensureDir, readJSON, writeJSON } from "./util.mjs";

/** Claude Code nombra la carpeta del proyecto reemplazando todo no alfanumérico por "-". */
export function encodeProjectDir(absPath) {
  return String(absPath).replace(/[^a-zA-Z0-9]/g, "-");
}

/** Carpeta de transcripts del proyecto (respeta CLAUDE_CONFIG_DIR). */
export function transcriptsDir(root, home = os.homedir(), env = process.env) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  return path.join(base, "projects", encodeProjectDir(root));
}

/** Lista recursiva de .jsonl (incluye subagentes si viven en subcarpetas). Tolera errores. */
export function listTranscripts(dir) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Suma el uso de los mensajes del asistente que caen dentro de algún rango. Un rango es
 * `{ from, to, session? }` (ms): si trae `session`, solo cuentan los mensajes de esa sesión (así dos
 * sesiones en paralelo, cada una en su hito, no se mezclan). Lo que cae entre rangos (pausas) no cuenta.
 * Deduplica por `message.id` (un mismo mensaje aparece una vez por bloque de contenido) y
 * se queda con la última aparición. Función pura sobre las rutas de archivos dadas.
 */
export function aggregateUsage(files, ranges) {
  const byId = new Map();
  const minFrom = ranges.length ? Math.min(...ranges.map((r) => r.from)) : Infinity;
  for (const f of files) {
    let text;
    try {
      if (fs.statSync(f).mtimeMs < minFrom) continue; // nada escrito tras el primer inicio
      text = fs.readFileSync(f, "utf8");
    } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const m = o && o.message;
      if (o.type !== "assistant" || !m || !m.usage) continue;
      const ts = Date.parse(o.timestamp);
      if (!Number.isFinite(ts)) continue;
      const msgSession = o.sessionId || o.session_id || null;
      const inRange = ranges.some((r) => ts >= r.from && ts <= r.to && (!r.session || !msgSession || r.session === msgSession));
      if (!inRange) continue;
      const key = m.id || o.uuid;
      if (key) byId.set(key, { usage: m.usage, model: m.model, ts });
    }
  }
  const r = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: byId.size, models: [], firstTs: null, lastTs: null };
  const models = new Set();
  for (const { usage: u, model, ts } of byId.values()) {
    r.input += num(u.input_tokens);
    r.output += num(u.output_tokens);
    r.cacheRead += num(u.cache_read_input_tokens);
    r.cacheWrite += num(u.cache_creation_input_tokens);
    if (model && model !== "<synthetic>") models.add(model);
    r.firstTs = r.firstTs === null ? ts : Math.min(r.firstTs, ts);
    r.lastTs = r.lastTs === null ? ts : Math.max(r.lastTs, ts);
  }
  r.models = [...models];
  r.total = r.input + r.output + r.cacheRead + r.cacheWrite;
  return r;
}

// ---- ledger de hitos (.ozali/metrics/runs.json, gitignored) -------------------
// { hitos: { "<slug>": { estado: "en_curso"|"pausado", creado, ultimaActividad, nota?, segments: [{ start, end?, session? }] } } }
// `_sin-hito` agrupa lo que el hook abrió al invocar cdk antes de conocer el slug; `start --hito` lo adopta.
export const SIN_HITO = "_sin-hito";
export const STALE_MS = 6 * 3600 * 1000;           // segmento abierto sin actividad → se cierra solo
export const FORGOTTEN_DAYS = 7;                    // hito pendiente sin actividad → "olvidado"
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ledgerPath = (root) => path.join(root, ".ozali", "metrics", "runs.json");
const iso = (ms) => new Date(ms).toISOString();

export function readLedger(root) {
  const l = readJSON(ledgerPath(root));
  return l && l.hitos && typeof l.hitos === "object" ? l : { hitos: {} };
}
const saveLedger = (root, led) => writeJSON(ledgerPath(root), led);
const openSegs = (led) => {
  const out = [];
  for (const [slug, h] of Object.entries(led.hitos)) for (const seg of h.segments || []) if (!seg.end) out.push({ slug, seg });
  return out;
};
const toRanges = (segs, nowMs) => segs.map((s) => ({ from: Date.parse(s.start), to: s.end ? Date.parse(s.end) : nowMs, session: s.session || null }));

function filesOf(root) {
  const dir = transcriptsDir(root);
  return exists(dir) ? listTranscripts(dir) : [];
}

/** Cierra los segmentos abiertos sin actividad reciente (sesión muerta) en su última actividad real. */
function sweepStale(root, led, nowMs) {
  const files = filesOf(root);
  for (const { slug, seg } of openSegs(led)) {
    const from = Date.parse(seg.start);
    const last = aggregateUsage(files, toRanges([seg], nowMs)).lastTs ?? from;
    if (nowMs - Math.max(from, last) > STALE_MS) {
      seg.end = iso(Math.max(from, last));
      const h = led.hitos[slug];
      h.estado = "pausado";
      h.nota = h.nota || "pausado automáticamente por inactividad (la sesión se cerró sin pausa)";
    }
  }
}

/** Mueve a `slug` el segmento abierto de `_sin-hito` (el de esa sesión, o el más reciente). */
function adoptUnassigned(led, slug, session) {
  const sin = led.hitos[SIN_HITO];
  if (!sin) return null;
  const cands = sin.segments.filter((s) => !s.end && (!session || s.session === session));
  if (!cands.length) return null;
  const seg = cands.sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
  sin.segments = sin.segments.filter((s) => s !== seg);
  if (!sin.segments.length) delete led.hitos[SIN_HITO];
  return seg;
}

function ensureHito(led, slug, nowMs) {
  return (led.hitos[slug] = led.hitos[slug] || { estado: "en_curso", creado: iso(nowMs), ultimaActividad: iso(nowMs), segments: [] });
}

/** Resumen de pendientes (todo lo que no es `_sin-hito`), con días sin actividad y marca de "olvidado". */
export function pendingHitos(root, nowMs = Date.now()) {
  const led = readLedger(root);
  const lista = Object.entries(led.hitos).filter(([k]) => k !== SIN_HITO).map(([slug, h]) => {
    const dias = Math.floor((nowMs - Date.parse(h.ultimaActividad || h.creado)) / 86400000);
    return {
      hito: slug, estado: openSegs({ hitos: { [slug]: h } }).length ? "en_curso" : "pausado",
      segments: h.segments.length, ultimaActividad: h.ultimaActividad, diasSinActividad: Math.max(0, dias),
      olvidado: dias >= FORGOTTEN_DAYS, nota: h.nota || null,
    };
  }).sort((a, b) => Date.parse(a.ultimaActividad) - Date.parse(b.ultimaActividad));
  return { pendientes: lista, sinAsignar: (led.hitos[SIN_HITO]?.segments || []).filter((s) => !s.end).length };
}

const USO = "uso: ozali usage start|resume [--hito <slug>] | pause [--hito <slug>] [--nota <texto>] | end --hito <slug> [--saved <n>] | pending | status | discard --hito <slug> | read";

/** `ozali usage …`. Salida pura en JSON por stdout (la consume cdk). */
export async function usageCmd(root, opts = {}, io = { log: console.log, err: console.error }) {
  const [, sub, ...extra] = opts._;
  if (extra.length) { io.err(USO); return 1; }
  const now = Date.now();
  const X = opts.hito || null;
  const S = opts.session || null;
  if (X && !SLUG_RE.test(X)) { io.err(`usage: --hito "${X}" inválido (a-z, 0-9 y guiones).`); return 1; }
  if (X === SIN_HITO && sub !== "discard") { io.err("usage: nombre de hito reservado."); return 1; }

  if (sub === "start" || sub === "resume") {
    const led = readLedger(root);
    sweepStale(root, led, now);
    if (sub === "resume" && (!X || !led.hitos[X])) {
      io.err(`usage resume: ${X ? `el hito "${X}" no está pendiente` : "falta --hito <slug>"}. Pendientes: ${Object.keys(led.hitos).filter((k) => k !== SIN_HITO).join(", ") || "ninguno"}.`);
      saveLedger(root, led); return 1;
    }
    const mine = openSegs(led).filter(({ seg }) => (S ? seg.session === S : true));
    let status, seg;
    const pausados = [];
    if (!X) {
      // hook al invocar cdk: aún no hay slug.
      if (mine.length) status = "already-running";
      else { seg = { start: iso(now), ...(S ? { session: S } : {}) }; ensureHito(led, SIN_HITO, now).segments.push(seg); status = "started"; }
    } else {
      const h = ensureHito(led, X, now);
      const running = h.segments.find((s) => !s.end && (S ? s.session === S : true));
      if (running) { status = "already-running"; seg = running; }
      else {
        seg = adoptUnassigned(led, X, S);
        status = h.segments.length ? "resumed" : "started";
        if (!seg) seg = { start: iso(now), ...(S ? { session: S } : {}) };
        h.segments.push(seg);
      }
      // Cambio de hito: la sesión solo puede estar activa en uno; el resto queda pausado (pendiente).
      for (const o of openSegs(led)) {
        if (o.slug === X || o.slug === SIN_HITO || o.seg === seg) continue;
        if ((seg.session || null) === (o.seg.session || null)) {
          o.seg.end = iso(now); led.hitos[o.slug].estado = "pausado"; led.hitos[o.slug].ultimaActividad = iso(now); pausados.push(o.slug);
        }
      }
      h.estado = "en_curso"; h.ultimaActividad = iso(now); delete h.nota;
    }
    saveLedger(root, led);
    const pend = pendingHitos(root, now);
    io.log(JSON.stringify({ status, hito: X, ...(pausados.length ? { pausados } : {}), pendientes: pend.pendientes.filter((p) => p.hito !== X) }));
    return 0;
  }

  if (sub === "pause") {
    const led = readLedger(root);
    const targets = openSegs(led).filter(({ slug, seg }) => (X ? slug === X : S ? seg.session === S : true));
    if (!targets.length) { io.log(JSON.stringify({ status: "nothing-to-pause" })); return 0; }
    const hitos = new Set();
    for (const { slug, seg } of targets) {
      seg.end = iso(now);
      const h = led.hitos[slug];
      h.estado = "pausado"; h.ultimaActividad = iso(now);
      if (opts.nota && slug !== SIN_HITO) h.nota = String(opts.nota);
      hitos.add(slug);
    }
    saveLedger(root, led);
    io.log(JSON.stringify({ status: "paused", hitos: [...hitos], pausedAt: iso(now) }));
    return 0;
  }

  if (sub === "pending" || sub === "status") {
    const led = readLedger(root);
    sweepStale(root, led, now);
    saveLedger(root, led);
    io.log(JSON.stringify(pendingHitos(root, now)));
    return 0;
  }

  if (sub === "discard") {
    if (!X) { io.err("usage discard: falta --hito <slug>."); return 1; }
    const led = readLedger(root);
    const existed = !!led.hitos[X];
    delete led.hitos[X];
    saveLedger(root, led);
    io.log(JSON.stringify({ status: existed ? "discarded" : "not-found", hito: X }));
    return 0;
  }

  if (sub === "end") {
    const led = readLedger(root);
    if (!X) {
      const names = Object.keys(led.hitos).filter((k) => k !== SIN_HITO);
      io.err(`usage end: falta --hito <slug>. Pendientes: ${names.join(", ") || "ninguno"}.`);
      return 1;
    }
    // Si el hook abrió un segmento sin slug y nunca se asignó, pertenece a este hito.
    const adopted = adoptUnassigned(led, X, S);
    if (!led.hitos[X] && !adopted) {
      io.err(`usage end: no hay marca de inicio para "${X}" (corre \`ozali usage start --hito ${X}\` primero). Usa /cost o deja N/A.`);
      return 1;
    }
    const h = ensureHito(led, X, now);
    if (adopted) h.segments.push(adopted);
    for (const seg of h.segments) if (!seg.end) seg.end = iso(now);
    const ranges = toRanges(h.segments, now);
    const a = aggregateUsage(filesOf(root), ranges);
    const found = a.messages > 0;
    const durationSec = Math.round(ranges.reduce((t, r) => t + Math.max(0, r.to - r.from), 0) / 1000);
    const result = {
      provider: found ? "Claude (Anthropic)" : null,
      models: a.models,
      input: found ? a.input : null,
      output: found ? a.output : null,
      cacheRead: found ? a.cacheRead : null,
      cacheWrite: found ? a.cacheWrite : null,
      total: found ? a.total : null,
      messages: a.messages,
      durationSec, // suma de segmentos activos (sin pausas)
      segments: h.segments.length,
      pauses: Math.max(0, h.segments.length - 1),
      costUsd: null, // N/A por diseño
      source: found ? "transcript (Claude Code)" : "N/A",
      startedAt: h.segments[0].start,
      endedAt: iso(now),
      hito: X,
    };
    writeJSON(path.join(root, ".ozali", "metrics", "last-run.json"), result);
    // Agregado que lee `ozali doctor`. Solo con datos reales.
    if (found) {
      const mp = path.join(root, ".ozali", "metrics", "token-metrics.json");
      const prev = readJSON(mp);
      const hits = prev && Array.isArray(prev.hits) ? prev.hits.filter((x) => x && x.hito !== X) : [];
      const saved = Number(opts.saved);
      hits.push({ hito: X, input: a.input, output: a.output, total: a.total, savedByRecall: Number.isFinite(saved) ? saved : 0, at: result.endedAt });
      ensureDir(path.dirname(mp));
      writeJSON(mp, { hits });
    }
    delete led.hitos[X]; // cerrado: sale de la bitácora de pendientes
    saveLedger(root, led);
    io.log(JSON.stringify(result));
    return 0;
  }

  if (sub === "read") {
    io.log(JSON.stringify(readJSON(path.join(root, ".ozali", "metrics", "last-run.json"))));
    return 0;
  }

  io.err(USO);
  return 1;
}

const CDK_PROMPT_RE = /^\s*\/(?:[\w-]+:)?cdk(?:\s|$)/;
const isCdkSkill = (name) => typeof name === "string" && /^(?:[\w-]+:)?cdk$/.test(name.trim());

/**
 * Qué hace un hook de Claude Code ante su payload (JSON de stdin): arrancar/retomar la corrida cuando se
 * invoca la skill `cdk` y pausarla al cerrar la sesión. Devuelve "start" | "pause" | null (ignorar).
 * Función pura: el cableado va en `usageHook`.
 */
export function hookAction(payload) {
  if (!payload || typeof payload !== "object") return null;
  const ev = payload.hook_event_name;
  if (ev === "SessionEnd") return "pause";
  if (ev === "PreToolUse" && payload.tool_name === "Skill" && isCdkSkill(payload.tool_input?.skill)) return "start";
  if (ev === "UserPromptSubmit" && typeof payload.prompt === "string" && CDK_PROMPT_RE.test(payload.prompt)) return "start";
  return null;
}

/** `ozali usage hook`: lee el payload de stdin, actúa en silencio y sale siempre en 0 (nunca bloquea). */
export async function usageHook(root, stdinText) {
  try {
    let payload = null;
    try { payload = JSON.parse(stdinText || "null"); } catch { /* payload ilegible → ignorar */ }
    const action = hookAction(payload);
    if (!action) return 0;
    // Solo en proyectos con ozali: un hook global no debe ensuciar repos ajenos.
    if (!exists(path.join(root, ".ozali")) && !exists(path.join(root, ".claude", "skills", "cdk"))) return 0;
    const quiet = { log: () => {}, err: () => {} };
    const session = payload.session_id || payload.sessionId || null;
    await usageCmd(root, { _: ["usage", action], ...(session ? { session } : {}) }, quiet);
  } catch { /* la medición nunca bloquea */ }
  return 0;
}
