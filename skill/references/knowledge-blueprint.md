# Blueprint de la base de conocimiento (AI.md + carpeta dotted)

Se usa en la **ruta GENERATE** (Fase 2 de `ozali`), cuando el repo **no** tiene ya
`AI.md`/`.ai` ni `IA.md`/`.ia`. La fuente de verdad **no se descarga de ningún lado**:
se **genera evaluando el proyecto real**. Este documento define la estructura canónica,
las reglas de generación y las diferencias frontend/backend.

> **Regla anti-invención:** todo el contenido se deriva del código, los manifiestos y la
> configuración REALES del repo. Lo que no se pueda derivar se marca como
> `<!-- PROVISIONAL: confirmar con el usuario -->` o se pregunta. Nunca inventes reglas de
> negocio, módulos, comandos ni versiones.

---

## 1. Detección frontend vs backend

Evalúa señales en la raíz del repo (la primera categoría con coincidencias gana; si hay
ambigüedad —p. ej. monorepo full-stack— **pregunta al usuario**):

**Frontend**
- `angular.json`, `package.json` con `@angular/*`, `react`, `next`, `vue`, `vite`, `svelte`
- carpeta `src/app` (Angular) o `src/pages`/`src/components`

**Backend**
- `pom.xml`, `build.gradle` (Java/Spring)
- `requirements.txt`, `pyproject.toml`, `manage.py` (Python)
- `go.mod` (Go), `Cargo.toml` (Rust)
- `package.json` con `express`/`nestjs`/`fastify` y sin framework de UI

---

## 2. Qué inspeccionar del proyecto antes de generar

| Aspecto | Dónde leerlo |
|---|---|
| Nombre real del proyecto | manifiesto (`pom.xml` `<artifactId>`, `package.json` `name`), README |
| Stack y versiones | `pom.xml`/`package.json`/`build.gradle` — versiones EXACTAS, no supuestas |
| Estructura de capas/módulos | árbol real de `src/` (paquetes Java, carpetas Angular, etc.) |
| Comandos build/test/run | scripts del manifiesto, wrappers (`mvnw`, `gradlew`), CI (`.github/`, pipelines) |
| Patrones de arquitectura | leer 3-5 clases/componentes representativos por capa |
| Convenciones de código | observar nombres, inyección, manejo de errores, estilo en el código real |
| Configuración por entorno | `application*.yml`/`.properties`, `environments/`, `.env*` |
| Estado de pruebas | contar archivos en `src/test`/`*.spec.ts` — reportar cobertura real |

---

## 3. Estructura canónica de la carpeta dotted

Por defecto genera `.ai/` + `AI.md` (usa `.ia/` + `IA.md` solo si el usuario lo pide o el
ecosistema del equipo ya usa esa variante).

```
.ai/
  agents/        → identidades por rol (difieren según front/back, ver §5)
  context/
    architecture.md       → capas/módulos REALES + diagrama de flujo (mermaid)
    coding-standards.md   → convenciones OBSERVADAS en el código + reglas de oro
    tech-stack.md         → stack, versiones exactas y comandos de build/test/run
  knowledge/
    README.md             → qué es esta carpeta y cómo se alimenta
    learning-notes.md     → memoria técnica: gotchas, lecciones, decisiones (inicia con
                            los hallazgos de la propia inspección)
  workflows/
    feature.md   → proceso para nueva funcionalidad
    bugfix.md    → proceso para corrección no crítica
    hotfix.md    → proceso express para incidente de producción (gate humano intacto)
    refactor.md  → proceso para mejora interna sin cambio de comportamiento
```

---

## 4. Estructura canónica de `AI.md` (documento guía / "Project Brain")

Modelo: punto de entrada corto; el detalle vive en `.ai/`. Secciones obligatorias:

```markdown
# <Proyecto> - Project Brain (AI.md)

Este archivo sirve como el "cerebro" del proyecto para asistir a agentes de IA y
desarrolladores en la comprensión de la arquitectura, flujos y estándares de <Proyecto>.

## 🚀 Descripción del Proyecto
<2-4 frases: qué es, qué resuelve, integraciones clave — derivado del código real>

Para detalles sobre el comportamiento de la IA en este proyecto, consulta:
- **[<Rol 1>](.ai/agents/<rol1>.md)**
- **[<Rol 2>](.ai/agents/<rol2>.md)**
- ...

## 📚 Contexto Global
| Documento | Alcance / Contenido |
|-----------|--------------------|
| **[Arquitectura](.ai/context/architecture.md)** | <resumen de una línea> |
| **[Stack Tecnológico](.ai/context/tech-stack.md)** | <resumen> |
| **[Estándares de Código](.ai/context/coding-standards.md)** | <resumen> |
| **[Log de Conocimiento](.ai/knowledge/learning-notes.md)** | Memoria técnica de la IA. |

## ⚙️ Workflow & Comandos
| Comando | Descripción |
|---------|-------------|
| <comando real 1> | <qué hace> |
| <comando real 2> | <qué hace> |

### Workflows de Agentes
- **[Desarrollo de Feature](.ai/workflows/feature.md)**
- **[Bugfix](.ai/workflows/bugfix.md)**
- **[Hotfix](.ai/workflows/hotfix.md)**
- **[Refactor](.ai/workflows/refactor.md)**

---
*Este documento es el punto de entrada. Las definiciones técnicas detalladas residen en `.ai/`.*
```

---

## 5. Diferencias frontend vs backend

| Aspecto | Frontend | Backend |
|---|---|---|
| `agents/` | `frontend.md`, `designer.md`, `reviewer.md`, `tester.md` | `architect.md`, `backend.md`, `dao-specialist.md` (si hay BD), `reviewer.md`, `tester.md` |
| `architecture.md` | estructura `src/app` (módulos, componentes, servicios, rutas, guards), flujo de datos UI ⇄ servicios ⇄ API | capas `Controller → Service → DAO/Repository → Entity` (+ DTO/Projection/Strategy según el repo), paquetes reales |
| `tech-stack.md` | framework UI + Node + tooling (versiones de `package.json`), comandos `npm ...` | lenguaje + framework + BD (versiones de `pom.xml`/etc.), comandos `mvn ...`/wrapper |
| `coding-standards.md` | reactividad, manejo de estado, i18n, accesibilidad, testing (Karma/Jest/Cypress) | inyección por constructor, DTO vs Entity, wrapper de respuesta, manejo de excepciones, transaccionalidad, testing (JUnit/mocks) |
| Comandos típicos | `npm start`, `npm run build`, `npm run test`, deploy (Firebase/CDN) | `mvn spring-boot:run`, `mvn test`, `mvn package`, perfiles por entorno |
| Zonas sensibles típicas | guards/auth, interceptores, modelos compartidos, config de entornos | config de datasource, clientes externos, exception handlers, DTOs de contrato público, ymls de uat/producción |

Los `workflows/` son comunes en estructura (feature/bugfix/hotfix/refactor) pero sus pasos
de validación usan los comandos reales del proyecto (npm vs mvn).

---

## 6. Reglas de generación

1. **Nomenclatura del repo:** nombres, títulos y rutas reales del proyecto; nada de
   placeholders genéricos de plantilla.
2. **Versiones leídas, no recordadas:** copia las versiones de los manifiestos.
3. **Convenciones observadas:** un estándar solo entra a `coding-standards.md` si se
   observa de forma consistente en el código (o el usuario lo confirma).
4. **Estado real de pruebas:** si `src/test` está casi vacío, dilo en `tech-stack.md` y en
   `learning-notes.md` — no asumas cobertura.
5. **Siembra `learning-notes.md`** con los hallazgos de la inspección (typos en nombres de
   clases, paquetes con nombre inesperado, módulos sin uso aparente, etc.).
6. **Todo lo generado es provisional** hasta pasar la validación de la Fase 3 de `ozali`.
