// skills-catalog.mjs — qué skills instala ozali y para qué sirve cada una (fuente única de la ayuda).
// `ozali skills`, `ozali skills list` y `ozali --help` leen de aquí; un test exige que toda skill
// instalable (pool de grill + independientes) tenga entrada, para que la ayuda no se quede atrás.

/** group: base (la instala `skills install`/`init`) | grill (pool de grill) | independiente. */
export const SKILL_CATALOG = [
  {
    name: "ozali", group: "base",
    summary: "Diagnostica y calibra el proyecto y genera la skill cdk (plan, GATE, TDD, docs por hito).",
    when: 'Invócala con "diagnostica el proyecto" o "prepara cdk".',
  },
  {
    name: "ozali-commit", group: "base",
    summary: "Redacta el commit convencional desde lo que está en stage y commitea tras tu aprobación.",
    when: "Al cerrar un hito o cuando pidas \"commitea\". Acepta --skip-ci ([skip ci] en el mensaje).",
  },
  {
    name: "skill-generator", group: "base",
    summary: "Convierte una tarea repetitiva en una skill reutilizable (SKILL.md + referencias).",
    when: 'Cuando digas "haz una skill para…" o cdk detecte un patrón repetido.',
  },
  {
    name: "grill-me", group: "grill",
    summary: "Entrevista implacable, pregunta por pregunta, para afinar un plan o diseño.",
    when: "Solo manual (/grill-me): úsala antes de implementar algo que aún no tienes claro.",
  },
  {
    name: "grilling", group: "grill",
    summary: "La misma entrevista, pero el agente la activa solo al oír frases tipo \"grill me\" o \"stress-test\".",
    when: "Versión invocable por el modelo; recorre el árbol de decisiones hasta acordar contigo.",
  },
  {
    name: "grill-with-docs", group: "grill",
    summary: "Como grill-me, y además va creando docs (ADRs y glosario del dominio) mientras entrevista.",
    when: "Solo manual (/grill-with-docs): cuando quieres que las decisiones queden escritas.",
  },
  {
    name: "domain-modeling", group: "grill",
    summary: "Construye y afina el modelo de dominio: terminología, CONTEXT.md y ADRs.",
    when: "Al discutir nombres del dominio o al escribir/editar un CONTEXT.md o un ADR.",
  },
  {
    name: "python-utilitario", group: "independiente", alias: "python",
    summary: "Fabrica utilitarios Python autocontenidos: un solo run_<nombre>.sh con su propio venv, log por corrida y --dry-run.",
    when: 'Cuando pidas "un script de python empaquetado" o "empaqueta este .py", sin instalar nada en tu máquina.',
  },
];

const GROUP_TITLES = {
  base: "Base — las instala `ozali init` / `ozali skills install`",
  grill: "Opcionales · pool de grill — `ozali skills add grill` instala las 4",
  independiente: "Opcionales · independientes — se instalan por nombre",
};

/** Skills opcionales (las que instala `skills add`). */
export const OPTIONAL_SKILLS = SKILL_CATALOG.filter((s) => s.group !== "base");

/**
 * Catálogo como líneas de texto. `{ onlyOptional }` limita a lo que instala `skills add`;
 * `bold`/`dim` permiten pintar sin acoplar este módulo a los colores del CLI.
 */
export function renderCatalog({ onlyOptional = false, bold = (s) => s, dim = (s) => s } = {}) {
  const lines = [];
  for (const group of ["base", "grill", "independiente"]) {
    if (onlyOptional && group === "base") continue;
    const items = SKILL_CATALOG.filter((s) => s.group === group);
    if (!items.length) continue;
    lines.push(bold(GROUP_TITLES[group]));
    for (const s of items) {
      const alias = s.alias ? dim(` (alias: ${s.alias})`) : "";
      lines.push(`  ${bold(s.name)}${alias}`);
      lines.push(`      ${s.summary}`);
      lines.push(`      ${dim(s.when)}`);
    }
    lines.push("");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
