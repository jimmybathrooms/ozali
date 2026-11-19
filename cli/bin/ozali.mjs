#!/usr/bin/env node
// ozali — CLI plug-n-play (Node, CERO dependencias, SIN lifecycle scripts).
// Seguridad: sin dependencias ni scripts de instalación. Ejecuta seguro con
// `pnpm dlx ozali` o `npx --ignore-scripts ozali`. Ver docs/security.md.
import { c, err, warn, pkgVersion } from "../lib/util.mjs";
import { patchCmd } from "../lib/patch.mjs";
import { renderCatalog } from "../lib/skills-catalog.mjs";
import { init, doctor, update, sync, audit, cloud, workspace, installEngramCmd, installSkills, installSkill, dashboard, stateCmd, cleanCmd, usageCommand } from "../lib/commands.mjs";

const HELP = `
${c.bold("ozali")} ${c.dim("v" + pkgVersion())} — bootstrap de IA por equipo (TDD/SDD + memoria Engram)

${c.bold("Uso:")}
  ozali <comando> [opciones]

${c.bold("Comandos:")}
  init      Detecta el agente (Claude Code/opencode), instala las skills ozali y
            ozali-commit, aísla el histórico, configura Engram y el repo de conocimiento.
  skills    Gestiona las skills de ozali. Subcomandos:
              install   Instala las skills base (ozali, ozali-commit, skill-generator) en el
                        scope indicado (global por defecto). Úsalo cuando el repo ya está
                        calibrado y solo faltan las skills a nivel de agente.
              add       Agrega skills opcionales para alimentar el proyecto: las del pool de
                        grill (grill-me, grilling, grill-with-docs, domain-modeling; alias
                        "grill" = set completo) y las independientes (python-utilitario o
                        --python). Uso: ozali skills add <skill>…
              list      Lista las skills opcionales y qué hace cada una (ozali skills sin
                        subcomando muestra también las base).
            Opcionales: grill-me, grilling, grill-with-docs, domain-modeling (entrevistas
            para afinar planes y documentar el dominio) y python-utilitario (utilitarios
            Python con su propio venv).
            (install-skills / install-skill siguen funcionando como alias deprecados.)
  install-engram
            Instala (o reinstala) Engram bajo demanda, registra su MCP en el agente
            y activa modo hybrid. Úsalo cuando saltaste la instalación en init.
  workspace Multi-repo: toma los repos de la carpeta raíz (y los folders de un
            *.code-workspace de VSCode/Antigravity), remedia los que no tienen ozali init,
            guía la calibración y escribe la config para trabajar en conjunto.
            Con --doctor / --update opera sobre TODOS los repos miembros desde la raíz.
  doctor    Health-check read-only del proyecto (fuente de verdad, Engram, versión de cdk, TDD…).
   update    Actualiza la instalación (skills ozali + ozali-commit + ozali-jarvis + permisos)
             al paquete y avisa si la skill cdk quedó desactualizada.
             Con --rollback restaura skills desde backup. Con --skills fuerza update en modo frozen.
  sync      Sincroniza el histórico (docs + Engram) con el repo de conocimiento.
  audit     Navega/audita la memoria de Engram del proyecto (o general).
  cloud     Gestiona Engram Cloud: status, upgrade, repair, dashboard, config.
  state     Estado por hito de cdk (.ozali/state/<hito>.json; espejo en .session-state.json):
            read [--hito] | list [--all] | clear [--hito] | write --hito <slug> --fase <fase>.
            Varios hitos pueden coexistir; permite cerrar un hito sin usar rm.
  patch     Mejoras de campo a cdk: marca <!-- ozali:local-patch id=… -->, y luego
            list | capture [<id>] | reject <id> --motivo | submit <id> [--yes]. Genera
            .ozali/proposals/<id>/ y abre un issue en el repo de ozali (o un PR a develop con --pr;
            fork automático si no tienes escritura). Dry-run salvo --yes. Nada entra sin revisión humana.
  clean     Borra los desechables de un hito (.ozali/tmp/<hito>/ y lo del manifiesto) sin rm.
            Dry-run por defecto; --yes aplica. Uso: ozali clean --hito <slug> [--yes].
  usage     Tokens por hito de cdk, sin plugins (lee los transcripts de Claude Code). Varios hitos
            pueden estar pendientes a la vez; cambiar de hito pausa el anterior.
            start|resume [--hito <slug>] · pause [--hito <slug>] [--nota <texto>] ·
            end --hito <slug> [--saved <n>] (JSON, costo N/A) · pending (bitácora de pendientes) ·
            discard --hito <slug> · read. Los hooks que instala init/update arrancan al invocar
            cdk y pausan al cerrar la sesión.
  dashboard Genera un resumen agregado de todos los hitos CDK documentados
            (.ozali/dashboard.md) con métricas de uso y telemetría.

${c.bold("Opciones comunes:")}
  --yes, -y            No interactivo: usa defaults.
  --dry-run            (init) Muestra el plan sin escribir nada.
  --agent <a>          (init) claude-code | opencode | both.
  --scope <s>          (init) project | global.
  --depth <n>          (workspace) Niveles a escanear bajo la raíz (default 1).
  --no-code-workspace  (workspace) Ignora los folders del *.code-workspace; solo escanea.
  --scan-all           (workspace) Incluye también los repos en disco no declarados en él.
  --doctor             (workspace) Health-check de TODOS los repos miembros + resumen.
  --update             (workspace) Actualiza (skills/permisos/jarvis) TODOS los repos miembros.
   --knowledge-repo <p> (init) Ruta del repo de conocimiento.
   --knowledge-only     (init) Solo configura el repo de conocimiento (sin skills/agents/Engram).
   --no-engram          (init/update) No usar ni instalar Engram; modo docs.
   --no-trust           (init) No marcar el workspace como confiable en Claude Code.
   --no-jarvis          (init/update) No crear/refrescar el orquestador ozali-jarvis.
   --rollback           (update) Restaura skills desde su backup más reciente.
   --skills             (update) Fuerza actualización de skills aunque esté frozen.
   --list               (skills add) Lista las skills del pool de grill y las independientes (= skills list).
   --python             (skills add) Instala la skill python-utilitario (independiente del pool de grill).
   --hito <slug>        (state read|clear|write / clean) Slug del hito.
   --all                (state list) Incluye también los hitos en fase completed.
   --fase <fase>        (state write) analysis_done | plan_approved | execution_done | testing_done | completed.
   --fix                (doctor) Auto-remedia problemas detectados (repo de conocimiento, TDD…).
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
    else if (a === "--obsidian") opts.obsidian = true;
    else if (a === "--force") opts.force = true;
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
    else if (a === "--no-code-workspace") opts.noCodeWorkspace = true;
    else if (a === "--scan-all") opts.scanAll = true;
    else if (a === "--doctor") opts.wsDoctor = true;
    else if (a === "--update") opts.wsUpdate = true;
    else if (a === "--knowledge-repo") opts.knowledgeRepo = argv[++i];
    else if (a === "--knowledge-only") opts.knowledgeOnly = true;
    else if (a === "--rollback") opts.rollback = true;
    else if (a === "--skills") opts.skills = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--python") opts.python = true;
    else if (a === "--fix") opts.fix = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--pr") opts.pr = true;
    else if (a === "--motivo") opts.motivo = argv[++i];
    else if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--base") opts.base = argv[++i];
    else if (a === "--hito") opts.hito = argv[++i];
    else if (a === "--nota") opts.nota = argv[++i];
    else if (a === "--session") opts.session = argv[++i];
    else if (a === "--saved") opts.saved = argv[++i];
    else if (a === "--fase") opts.fase = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else opts._.push(a);
  }
  return opts;
}

/**
 * `ozali skills <install|add|list>`. Reusa installSkills/installSkill, que leen sus
 * argumentos posicionales desde opts._.slice(1): por eso se quita el subcomando de opts._.
 */
async function skillsCmd(cwd, opts) {
  const sub = opts._[1];
  if (!sub) {
    console.log(`${c.bold("Uso:")} ozali skills <install|add|list>
  install          Skills base (ozali, ozali-commit, skill-generator). Global por defecto.
  add <skill>…     Skills opcionales. Con --python instala python-utilitario; "grill" = las 4 del pool.
  list             Lista las skills opcionales con qué hace cada una.
  Opciones de install/add: --scope global|project · --agent claude-code|opencode|both

${c.bold("Qué hace cada skill:")}
${renderCatalog({ bold: c.bold, dim: c.dim }).join("\n")}`);
    return 0;
  }
  const rest = { ...opts, _: ["skills", ...opts._.slice(2)] };
  switch (sub) {
    case "install": return await installSkills(cwd, rest);
    case "add": return await installSkill(cwd, rest);
    case "list": return await installSkill(cwd, { ...rest, list: true });
    default:
      err(`subcomando desconocido "${sub}". Usa: ozali skills install | add | list`);
      return 1;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];

  if (opts.version) { console.log(pkgVersion()); return 0; }
  if (!cmd || opts.help || cmd === "help") { console.log(HELP); return 0; }

  const cwd = process.cwd();
  // Banner de versión: confirma qué versión de ozali está corriendo en cada comando.
  // (`state` y `usage` lo omiten: su salida —JSON— la consume cdk y el banner la contaminaría.)
  if (cmd !== "state" && cmd !== "usage") console.log(`${c.bold("ozali")} ${c.dim("v" + pkgVersion())}`);
  switch (cmd) {
    case "init": return await init(cwd, opts);
    case "workspace": return await workspace(cwd, opts);
    case "doctor": return await doctor(cwd, opts);
    case "update": return await update(cwd, opts);
    case "sync": return await sync(cwd, opts);
    case "audit": return await audit(cwd, opts);
    case "cloud": return await cloud(cwd, opts);
    case "dashboard": return await dashboard(cwd, opts);
    case "state": return await stateCmd(cwd, opts);
    case "usage": return await usageCommand(cwd, opts);
    case "clean": return await cleanCmd(cwd, opts);
    case "patch": return await patchCmd(cwd, opts);
    case "skills": return await skillsCmd(cwd, opts);
    // Alias deprecados (antes de v0.28.0): se conservan para no romper docs ni scripts.
    case "install-skills":
      warn(`${c.bold("install-skills")} está deprecado: usa ${c.bold("ozali skills install")}.`);
      return await installSkills(cwd, opts);
    case "install-skill":
      warn(`${c.bold("install-skill")} está deprecado: usa ${c.bold("ozali skills add")} (o ${c.bold("ozali skills list")}).`);
      return await installSkill(cwd, opts);
    case "install-engram": return await installEngramCmd(cwd, opts);
    default:
      err(`comando desconocido "${cmd}". Usa ${c.bold("ozali --help")}.`);
      return 1;
  }
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  err(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
