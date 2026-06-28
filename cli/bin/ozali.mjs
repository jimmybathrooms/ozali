#!/usr/bin/env node
// ozali — CLI plug-n-play (Node, CERO dependencias, SIN lifecycle scripts).
// Seguridad: sin dependencias ni scripts de instalación. Ejecuta seguro con
// `pnpm dlx ozali` o `npx --ignore-scripts ozali`. Ver docs/security.md.
import { c, err, pkgVersion } from "../lib/util.mjs";
import { init, doctor, update, sync } from "../lib/commands.mjs";

const HELP = `
${c.bold("ozali")} ${c.dim("v" + pkgVersion())} — bootstrap de IA por equipo (TDD/SDD + memoria Engram)

${c.bold("Uso:")}
  ozali <comando> [opciones]

${c.bold("Comandos:")}
  init      Detecta el agente (Claude Code/opencode), instala la skill ozali,
            aísla el histórico, configura Engram y el repo de conocimiento.
  doctor    Health-check read-only del proyecto (fuente de verdad, Engram, TDD…).
  update    Actualiza la skill ozali instalada a la versión de este paquete.
  sync      Sincroniza el histórico (docs + Engram) con el repo de conocimiento.

${c.bold("Opciones comunes:")}
  --yes, -y            No interactivo: usa defaults.
  --dry-run            (init) Muestra el plan sin escribir nada.
  --agent <a>          (init) claude-code | opencode | both.
  --scope <s>          (init) project | global.
  --knowledge-repo <p> (init) Ruta del repo de conocimiento.
  --no-engram          (init) No usar Engram; arranca en modo docs.
  --no-trust           (init) No marcar el workspace como confiable en Claude Code.
  --import             (sync) Importa del repo de conocimiento a local.
  --push               (sync) Hace push al remoto del repo de conocimiento.
  --cloud              (sync) Replica también a Engram Cloud (si está habilitado).
  -h, --help           Esta ayuda.    -v, --version   Versión.

${c.bold("Instalación segura:")}
  pnpm dlx ozali@<versión> init            ${c.dim("# recomendado (pnpm 10: postinstall off)")}
  npx --ignore-scripts ozali@<versión> init
  git clone … && node cli/bin/ozali.mjs init
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--import") opts.import = true;
    else if (a === "--push") opts.push = true;
    else if (a === "--cloud") opts.cloud = true;
    else if (a === "--no-engram") opts.noEngram = true;
    else if (a === "--no-trust") opts.noTrust = true;
    else if (a === "--agent") opts.agent = argv[++i];
    else if (a === "--scope") opts.scope = argv[++i];
    else if (a === "--knowledge-repo") opts.knowledgeRepo = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else opts._.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];

  if (opts.version) { console.log(pkgVersion()); return 0; }
  if (!cmd || opts.help || cmd === "help") { console.log(HELP); return 0; }

  const cwd = process.cwd();
  switch (cmd) {
    case "init": return await init(cwd, opts);
    case "doctor": return doctor(cwd);
    case "update": return update(cwd);
    case "sync": return sync(cwd, opts);
    default:
      err(`comando desconocido "${cmd}". Usa ${c.bold("ozali --help")}.`);
      return 1;
  }
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  err(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
