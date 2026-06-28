# Plantilla del harness `verify-structure.mjs`

Esqueleto parametrizado del **harness del analista** que `ozali` genera en la Fase 6
(punto 3) como `.claude/skills/cdk/verify-structure.mjs`. El script es el paso 1
obligatorio del `project-analyzer`: verifica la estructura REAL del repo contra la
arquitectura documentada — no confía en la doc.

> **Regla:** los valores de los parámetros salen de la **fuente de verdad validada en la
> Fase 3** (`.ai/context/architecture.md`) y de la inspección real del repo — nunca de
> supuestos. Cero dependencias, Node 16+.

---

## 1. Parámetros a sustituir

| Parámetro | Qué es | Ejemplo backend (Java) | Ejemplo frontend (Angular) |
|---|---|---|---|
| `{{PROJECT_NAME}}` | Nombre real del repo | `quattro-auto-mtto` | `biibiic` |
| `{{ROOT_MARKER}}` | Archivo que identifica la raíz (para subir buscándolo) | `pom.xml` | `angular.json` (o `package.json`) |
| `{{BASE_PATH}}` | Carpeta base del código, como array de segmentos | `["src","main","java","com","acme"]` | `["src","app"]` |
| `{{EXT}}` | Extensión de archivos a contar | `.java` | `.ts` |
| `{{EXPECTED}}` | Capas/carpetas esperadas + rol de una línea (de `architecture.md`) | `controllers`, `services/strategies/impl`, … | `components`, `services`, `guards`, `pages`, … |
| `{{KEY_CLASSES}}` | Clases/archivos clave que los agentes referencian (sin extensión) | `ApiResponse`, `ErrorCode` | `auth.guard`, `api.service` |
| `{{CONSISTENCY_CHECKS}}` | Gotchas verificados del repo (ver §3) | context-path, typos de nombres | rutas lazy, config de entornos |
| `{{TEST_DIR}}` | Carpeta(s) de pruebas a contar | `src/test` | `src` con sufijo `.spec.ts` |

---

## 2. Esqueleto del script

```javascript
#!/usr/bin/env node
// CDK — {{PROJECT_NAME}}
// Harness del analista: verifica la estructura real del proyecto contra la
// arquitectura documentada (.ai/context/architecture.md), localiza archivos clave
// y reporta discrepancias + candidatos a reutilizacion.
//
// Uso (desde cualquier carpeta dentro del repo):
//   node .claude/skills/cdk/verify-structure.mjs              # reporte completo
//   node .claude/skills/cdk/verify-structure.mjs --grep <palabra>
//
// Cero dependencias. Node 16+.

import fs from "node:fs";
import path from "node:path";

// ---- localizar la raiz del proyecto (sube buscando {{ROOT_MARKER}}) ---------
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(dir, "{{ROOT_MARKER}}"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const ROOT = findRoot(process.cwd());
const BASE = path.join(ROOT, ...{{BASE_PATH}});
const EXT = "{{EXT}}";

// ---- capas esperadas (lo que promete .ai/context/architecture.md) -----------
const EXPECTED = [
  // { pkg: "<carpeta relativa a BASE>", role: "<rol de una linea>" },
  {{EXPECTED}}
];

// ---- archivos clave que referencian los agentes -----------------------------
const KEY_CLASSES = [
  {{KEY_CLASSES}}
];

function countFiles(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return -1;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const c = countFiles(path.join(dir, e.name));
      if (c > 0) n += c;
    } else if (e.name.endsWith(EXT)) {
      n++;
    }
  }
  return n;
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (e.name === name + EXT) {
      return path.relative(ROOT, full);
    }
  }
  return null;
}

function grepFiles(dir, term, out, limit = 40) {
  if (out.length >= limit || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      grepFiles(full, term, out, limit);
    } else if (e.name.endsWith(EXT) && e.name.toLowerCase().includes(term.toLowerCase())) {
      out.push(path.relative(ROOT, full));
    }
  }
}

// ---------------------------------------------------------------------------
console.log("============================================================");
console.log(" CDK · {{PROJECT_NAME}} — Verificacion de estructura");
console.log("============================================================");
console.log("Root:", ROOT);
console.log("Base:", fs.existsSync(BASE) ? path.relative(ROOT, BASE) : "(!) NO ENCONTRADO");
console.log("");

const risks = [];

console.log("-- Capas / carpetas ---------------------------------------");
for (const { pkg, role } of EXPECTED) {
  const dir = path.join(BASE, ...pkg.split("/"));
  const c = countFiles(dir);
  const status = c < 0 ? "FALTA " : String(c).padStart(4) + " ";
  console.log(`  [${c < 0 ? "X" : "ok"}] ${pkg.padEnd(26)} ${status}files  — ${role}`);
  if (c < 0) risks.push(`Carpeta esperada ausente: ${pkg}`);
}
console.log("");

console.log("-- Archivos clave -----------------------------------------");
for (const cls of KEY_CLASSES) {
  const loc = findFile(BASE, cls);
  console.log(`  [${loc ? "ok" : "X"}] ${cls.padEnd(28)} ${loc || "(!) NO ENCONTRADO"}`);
  if (!loc) risks.push(`Archivo clave no encontrado: ${cls}`);
}
console.log("");

console.log("-- Chequeos de consistencia doc<->codigo -----------------");
// {{CONSISTENCY_CHECKS}}: gotchas VERIFICADOS del repo. Cada uno imprime [i] con el
// hallazgo y la regla practica. Si dejan de aparecer, actualizar tambien la seccion
// Gotchas del SKILL.md de cdk y .ai/knowledge/learning-notes.md. Ejemplos:
//  - typos en nombres reales de clases (no "corregirlos" sin refactor aprobado)
//  - prefijos globales (context-path / baseHref) que no van en el codigo
//  - donde vive cada propiedad de configuracion por entorno
//  - conteo de pruebas reales ({{TEST_DIR}}) → advertir si la cobertura es minima
{{CONSISTENCY_CHECKS}}
console.log("");

// ---- busqueda opcional de reutilizacion (busca antes de crear) --------------
const gi = process.argv.indexOf("--grep");
if (gi !== -1 && process.argv[gi + 1]) {
  const term = process.argv[gi + 1];
  console.log(`-- Reutilizacion: archivos que ya mencionan "${term}" ----`);
  const hits = [];
  grepFiles(BASE, term, hits);
  if (hits.length === 0) console.log("  (sin coincidencias por nombre de archivo)");
  for (const h of hits) console.log("  •", h);
  console.log("");
  console.log(`  >> Antes de crear codigo nuevo, revisa estos ${hits.length} archivo(s).`);
  console.log("");
}

console.log("============================================================");
if (risks.length) {
  console.log(` RIESGOS / HALLAZGOS (${risks.length}):`);
  for (const r of risks) console.log("  ⚠  " + r);
} else {
  console.log(" Estructura coherente con la arquitectura documentada.");
}
console.log("============================================================");
```

---

## 3. Secciones específicas por tipo de proyecto

Además del esqueleto, agrega los chequeos que apliquen:

**Backend (Java/Spring)**
- Sección extra de **dominio** si hay un patrón central (p. ej. en quattro-auto-mtto:
  listar carpetas bajo `services/strategies/impl/` y verificar que cada aseguradora tenga
  su `*Strategy`). Replica la idea para el patrón central del proyecto.
- Leer `context-path` de `application.properties`/`application.yml` y advertir que no se
  incluye en `@RequestMapping`.
- Contar `.java` en `src/test`.

**Frontend (Angular/React/Vue)**
- Verificar módulos/rutas declarados vs carpetas reales (lazy loading roto = riesgo).
- Leer `baseHref`/`deploy` de `angular.json` o equivalente.
- Contar `*.spec.ts` (o `*.test.tsx`) para reportar cobertura real.

**Ambos**
- El bloque de consistencia **siembra** `learning-notes.md`: todo gotcha que el harness
  detecte en su primera corrida debe quedar registrado ahí y en el SKILL.md de `cdk`.

---

## 4. Validación obligatoria al generarlo

Tras escribir el script, `ozali` **debe ejecutarlo** y verificar:
1. Corre sin errores con Node 16+ (`node .claude/skills/cdk/verify-structure.mjs`).
2. Todas las capas de `EXPECTED` reportan `[ok]` (si algo reporta `FALTA`, o la doc está
   mal o el parámetro está mal — corrígelo antes de cerrar la Fase 6).
3. Todos los `KEY_CLASSES` se localizan.
4. `--grep <término-conocido>` devuelve hits razonables.

La salida real de esta corrida se cita en el `02-plan.md` de la corrida de ozali como
evidencia. Ejemplo de referencia ya funcionando: el `verify-structure.mjs` de este repo
(`.claude/skills/cdk/verify-structure.mjs`).
