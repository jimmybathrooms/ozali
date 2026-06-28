// prompt.mjs — prompts interactivos sin dependencias (node:readline callback,
// compatible con Node 16+; readline/promises no existe en 16, por eso envolvemos).
import readline from "node:readline";
import { c } from "./util.mjs";

function rl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(query) {
  return new Promise((resolve) => {
    const i = rl();
    i.question(query, (ans) => { i.close(); resolve(ans); });
  });
}

const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

/** Texto libre con valor por defecto. En no-TTY devuelve el default. */
export async function ask(message, def = "") {
  if (!interactive()) return def;
  const hint = def ? c.dim(` (${def})`) : "";
  const ans = (await question(`${c.cyan("?")} ${message}${hint}: `)).trim();
  return ans || def;
}

/** Confirmación sí/no. En no-TTY devuelve def. */
export async function confirm(message, def = true) {
  if (!interactive()) return def;
  const hint = def ? "Y/n" : "y/N";
  const ans = (await question(`${c.cyan("?")} ${message} ${c.dim("[" + hint + "]")} `)).trim().toLowerCase();
  if (!ans) return def;
  return ans[0] === "y" || ans[0] === "s"; // acepta sí/yes
}

/**
 * Selección de una opción. options: [{value, label}]. En no-TTY devuelve el
 * primero (o el marcado por defecto).
 */
export async function select(message, options, defIndex = 0) {
  if (!interactive()) return options[defIndex].value;
  console.log(`${c.cyan("?")} ${message}`);
  options.forEach((o, i) => {
    const mark = i === defIndex ? c.green("●") : c.dim("○");
    console.log(`  ${mark} ${c.bold(String(i + 1))}) ${o.label}`);
  });
  const ans = (await question(`  ${c.dim("Elige [" + (defIndex + 1) + "]")}: `)).trim();
  const n = ans ? parseInt(ans, 10) : defIndex + 1;
  const idx = Number.isInteger(n) && n >= 1 && n <= options.length ? n - 1 : defIndex;
  return options[idx].value;
}
