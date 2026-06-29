// ozali-jarvis-plugin — recordatorios de memoria (Engram) para opencode.
// Generado por `ozali init`. NO es la fuente de verdad del comportamiento:
// la persona ozali-jarvis vive en AGENTS.md + el agente de opencode.json.
// Este plugin solo refuerza, en eventos de sesión, el ciclo recall → capturar → resumir.
// Marca de idempotencia: ozali-jarvis (no reescribir si ya existe esta marca).

/** @type {import("@opencode-ai/plugin").Plugin} */
export const OzaliJarvis = async () => {
  const note = (m) => { try { console.log(`[ozali-jarvis] ${m}`); } catch { /* noop */ } };
  return {
    event: async ({ event }) => {
      switch (event && event.type) {
        case "session.created":
          note("recall-first: confirma proyecto (mem_current_project) y recupera contexto de Engram (mem_context) antes de actuar.");
          break;
        case "experimental.session.compacting":
          note("antes de compactar: persiste el `state` recuperable en Engram (ver engram-convention §4).");
          break;
        case "session.idle":
          note("cierre: registra lo trabajado en Engram (scope: project, español) y haz mem_session_summary.");
          break;
        default:
          break;
      }
    },
  };
};
