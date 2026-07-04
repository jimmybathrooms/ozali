#!/usr/bin/env node
// ozali — CLI plug-n-play (Node, CERO dependencias, SIN lifecycle scripts).
// Seguridad: sin dependencias ni scripts de instalación. Ejecuta seguro con
// `pnpm dlx ozali` o `npx --ignore-scripts ozali`. Ver docs/security.md.
import { c, err, pkgVersion } from "../lib/util.mjs";
import { init, doctor, update, sync, audit, cloud, workspace } from "../lib/commands.mjs";

const HELP = `
${c.bold("ozali")} ${c.dim("v" + pkgVersion())} — bootstrap de IA por equipo (TDD/SDD + memoria Engram)

${c.bold("Uso:")}
  ozali <comando> [opciones]

${c.bold("Comandos:")}
  init      Detecta el agente (Claude Code/opencode), instala las skills ozali y
            ozali-commit, aísla el histórico, configura Engram y el repo de conocimiento.
  workspace Multi-repo: escanea los repos de la carpeta raíz, remedia los que no tienen
            ozali init, guía la calibración y escribe la config para trabajar en conjunto.
            Con --doctor / --update opera sobre TODOS los repos miembros desde la raíz.
  doctor    Health-check read-only del proyecto (fuente de verdad, Engram, versión de cdk, TDD…).
  update    Actualiza la instalación (skills ozali + ozali-commit + ozali-jarvis + permisos)
            al paquete y avisa si la skill cdk quedó desactualizada.
  sync      Sincroniza el histórico (docs + Engram) con el repo de conocimiento.
  audit     Navega/audita la memoria de Engram del proyecto (o general).
  cloud     Gestiona Engram Cloud: status, upgrade, repair, dashboard, config.

${c.bold("Opciones comunes:")}
  --yes, -y            No interactivo: usa defaults.
  --dry-run            (init) Muestra el plan sin escribir nada.
  --agent <a>          (init) claude-code | opencode | both.
  --scope <s>          (init) project | global.
  --depth <n>          (workspace) Niveles a escanear bajo la raíz (default 1).
  --doctor             (workspace) Health-check de TODOS los repos miembros + resumen.
  --update             (workspace) Actualiza (skills/permisos/jarvis) TODOS los repos miembros.
  --knowledge-repo <p> (init) Ruta del repo de conocimiento.
  --no-engram          (init) No usar Engram; arranca en modo docs.
  --no-trust           (init) No marcar el workspace como confiable en Claude Code.
  --no-jarvis          (init/update) No crear/refrescar el orquestador ozali-jarvis.
  --import             (sync) Importa del repo de conocimiento a local.
  --push               (sync) Hace push al remoto del repo de conocimiento.
  --cloud              (sync) Replica también a Engram Cloud (si está habilitado).
  --general            (audit) Auditoría general (todos los proyectos en Engram).
  --tui                (audit) Abre el navegador interactivo de Engram.
  --search <q>         (audit) Busca <q> en la memoria.
  --dashboard          (audit) Abre el dashboard de Engram Cloud en el navegador.
  --conflicts          (audit) Lista conflictos de memoria pendientes.
  --judged             (audit --conflicts) Muestra conflictos ya juzgados.
  --stats              (audit --conflicts) Estadísticas de conflictos.
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
    else if (a === "--no-jarvis") opts.noJarvis = true;
    else if (a === "--general") opts.general = true;
    else if (a === "--tui") opts.tui = true;
    else if (a === "--search") opts.search = argv[++i];
    else if (a === "--dashboard") opts.dashboard = true;
    else if (a === "--conflicts") opts.conflicts = true;
    else if (a === "--judged") opts.judged = true;
    else if (a === "--stats") opts.stats = true;
    else if (a === "--agent") opts.agent = argv[++i];
    else if (a === "--scope") opts.scope = argv[++i];
    else if (a === "--depth") opts.depth = argv[++i];
    else if (a === "--doctor") opts.wsDoctor = true;
    else if (a === "--update") opts.wsUpdate = true;
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
  // Banner de versión: confirma qué versión de ozali está corriendo en cada comando.
  console.log(`${c.bold("ozali")} ${c.dim("v" + pkgVersion())}`);
  switch (cmd) {
    case "init": return await init(cwd, opts);
    case "workspace": return await workspace(cwd, opts);
    case "doctor": return doctor(cwd);
    case "update": return update(cwd, opts);
    case "sync": return sync(cwd, opts);
    case "audit": return await audit(cwd, opts);
    case "cloud": return await cloud(cwd, opts);
    default:
      err(`comando desconocido "${cmd}". Usa ${c.bold("ozali --help")}.`);
      return 1;
  }
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  err(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
