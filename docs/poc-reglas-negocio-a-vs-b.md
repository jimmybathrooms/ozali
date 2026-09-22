# POC de reglas de negocio: extractor (A) vs. base manual (B)

Evidencia para mejorar la Fase 2.5 de `ozali` ([`business-blueprint.md`](../skill/references/business-blueprint.md)).
Dos carpetas `.ai/business/` del **mismo repo** (`quattro-catalogos-api`, backend Spring Boot),
hechas por caminos distintos, comparadas el 2026-09-22.

| | **B — manual** | **A — extractor** |
|---|---|---|
| Cómo se hizo | A mano, leyendo el código con el agente sin blueprint formal | Fase 2.5 de `ozali` siguiendo el blueprint, **sin leer B** |
| Commit | `bfed9ff` (2026-08-19), rama `feature/poc-business-rules` | `28fc53e` (2026-09-21), rama `feature/poc-cdk-business-rules` |
| Base de código | `bfed9ff` | `95b54aa` — **162 archivos de `src/main` cambiaron entre ambos** |

La comparación se hizo con la extracción A ya commiteada, para que leer B no la contaminara.

---

## 1. Métricas

| | B | A |
|---|---|---|
| Archivos | 7 | 9 (3 workflows vs 1) |
| Líneas | 1 426 | 810 |
| Reglas | 12 secciones con subsecciones (≈24) | 18 secciones planas |
| PROVISIONAL | 26 | 13 |
| Citas `archivo:línea` | 141 | 151 |
| Archivos de código citados | 33 | 45 (17 en común) |
| Formato de cita | `VendedorService.java:152` | `services/VendedorService.java:152` |
| **Citas válidas en su commit base** | **138/141** | **151/151** |
| **Citas válidas hoy (`95b54aa`)** | 125/141 | 151/151 |

## 2. Precisión de las citas

- **B nació con 3 citas fuera de rango.** La peor sostiene una regla entera: §10 "Políticas de
  usuario" cita `PoliticaService.java:42-93` en un archivo que tenía **81 líneas**.
- **B perdió 11% de sus citas en un mes** (16 rotas hoy) por deriva normal del código. No es un
  defecto de B: es la vida útil real de una carpeta así sin revalidación.
- **A: 151/151**, porque un script verificó existencia y rango antes del GATE. Pero eso solo prueba
  que la línea existe, **no que diga lo que la afirmación dice** — y por ahí se coló el error de A
  (§3).

## 3. Errores encontrados, de cada lado

### En B

1. **Cuantificador absoluto falso, ya en su propio commit.** §1: *"No hay `delete()` en ningún
   repositorio de catálogo"*. Había tres borrados físicos: `CoberturaService.deleteAll`,
   `PaqueteService.delete` y `PaqueteService.deleteById`. Generalizó desde un caso
   (`ProductoSeguroService.deleteByID`) al repositorio entero.
2. **Regla sostenida por líneas inexistentes** (§10, ver arriba). Hoy el método ni existe:
   `PoliticaService` quedó en 21 líneas.
3. **Convención invertida por el tiempo.** §11 llama *"patrón obligatorio"* al `catch` de
   validación dentro de cada servicio. Hoy `CapturaSoloEnElControllerTest` **prohíbe** los `catch`
   en `services/` y `dao/`.

### En A

1. **Afirmación sobre una línea que existe pero dice otra cosa.** A sostenía que el mensaje de un
   409 del servicio OAuth se pierde al reenvolverse. Falso: `ValidationServiceException(String)`
   hace `super(errorMessage)`, así que `getMessage()` devuelve el texto y sobrevive. B lo tenía
   bien. Corregido en el repo destino.
2. **Menos trazabilidad en las validaciones declarativas.** B cita línea por campo; A da la tabla
   y una cita genérica al directorio `controllers/form/`.

## 4. Cobertura temática

| Tema | B | A |
|---|---|---|
| Borrado lógico, identidad, auditoría | ✅ | ✅ |
| Unicidad de correo, alta de vendedor, perfil automático | ✅ (mejor tabla de decisión) | ✅ |
| Paquetes, coberturas, ordinales de enum | ✅ | ✅ |
| Ciclo de vida del Lead | ✅ | ✅ |
| Catálogo de mensajes de error | ✅ completo | parcial |
| `Values.getValue` como semántica de patch | ✅ | ❌ |
| Editar un producto dado de baja lo **reactiva** | ✅ | ❌ |
| Cambio de contraseña forzado por `tipoCorreo` 1/5/6/7 | ✅ | ❌ |
| Clave temporal: 8 dígitos **solo numéricos** | ✅ | parcial |
| `updatable=false`: un paquete no cambia de ramo | ✅ | ❌ |
| `saveVendedor` guarda dos veces seguidas | ✅ | ❌ |
| Cuatro mecanismos de permisos (perfil, menú, rol, política) | ✅ | parcial (rol + banderas) |
| Kit de productos (módulo del 2026-09-14) | ❌ no existía | ✅ 6 reglas |
| `CamposForm` (no existía en agosto) | ❌ | ✅ |
| Identidad con `ScopedValue` | ❌ era `ThreadLocal` | ✅ |
| Roles de ramo: tipo 1 incluye / tipo 2 excluye | ❌ | ✅ |
| `@Valid` ausente en listas anidadas | ❌ | ✅ |
| Workflows | 1 (lead) | 3 (kit, vendedor, lead) |

Buena parte de lo que le falta a B es **cronología**, no calidad. Pero `Values.getValue`, la
reactivación al editar, `updatable=false`, el doble `save` y el cambio de contraseña **sí son
huecos del extractor**: ese código ya existía y no se miró.

## 5. Qué cambiar en la Fase 2.5

Convertido en backlog en [`pendientes.md`](pendientes.md):

| # | Cambio | Origen |
|---|---|---|
| P-004 | Verificar las citas **por contenido**, no solo por rango | error de A |
| P-005 | Prohibir cuantificadores absolutos sin un conteo que los respalde | errores 1 y 2 de B |
| P-006 | Ampliar las fuentes de extracción: anotaciones de entidad, utilidades de patch y olores de servicio | huecos de A |
| P-007 | Modo `--business` actualizar: revalidar citas y avisar de la caducidad | 11% de B en un mes |

## 6. Conclusión

El extractor **gana en trazabilidad y disciplina** (100% de citas verificadas, PROVISIONAL bien
acotados, alcance declarado) y **pierde en densidad**: B documenta más por sección y capturó
detalles de comportamiento que A no miró. La estructura plana y las rutas completas de A, más la
tabla de decisión y el detalle por campo de B, es la combinación a perseguir.

Y lo más importante: **ninguna de las dos sobrevive sola al paso del tiempo**. Revalidar citas
tiene que ser parte del ciclo, no un paso de la primera extracción.
