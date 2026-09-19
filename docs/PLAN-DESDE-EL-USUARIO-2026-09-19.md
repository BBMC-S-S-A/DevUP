# Plan de desarrollo · lo que pidió un usuario real

_19 de septiembre de 2026._

Un cliente, GESTEK (organización Develovers), usó DevUP con dos sesiones de IA
durante un evento con 4.000 boletas y nos devolvió un documento con **53
requisitos**, cada uno con lo que pasó sin él. Este plan contrasta ese
documento con el código, decide un orden y baja el trabajo al tablero de DevUP:
la idea es desarrollar DevUP usando DevUP.

El contrato de reparto sigue siendo [CAMINOS.md](./CAMINOS.md): la web es de una
sesión; migraciones, API y MCP son de otra. Cada tarea del tablero lleva el
identificador del requisito (SEG-01, TAB-03…) para poder volver al documento.

---

## 1. Cómo se leyó el documento

Es una lista de deseos de un usuario, no un contrato. Se usó así:

- **Se tomó como dato** que un cliente real dejó de poner datos de clientes en
  DevUP por falta de una política escrita, y que un agente creó una docena de
  etiquetas casi iguales sin que nada lo frenara. Las dos cosas son verificables
  en el código.
- **No se tomó como orden de compra** lo que pide el ciclo completo (fusionar y
  desplegar desde DevUP). Eso exige un modelo de permisos que aún no existe y va
  detrás de una decisión (tarea «Decidir · niveles de un agente»).
- Todo lo de abajo sale de leer el repositorio, **no de ejecutarlo**. Donde no
  se pudo comprobar, dice «no verificado».

## 2. Dónde está DevUP frente a los 53 requisitos

Resultado: **1 cubierto, 15 a medias, 2 por verificar, 35 sin empezar.**

| Req. | Estado | Lo que hay |
|---|---|---|
| SEG-01 política de datos | No | Nada en `docs/` ni en la raíz |
| SEG-02 cifrado en reposo | Parcial | Bóveda con AES-256-GCM. Base, adjuntos y respaldos dependen del proveedor y no está documentado |
| SEG-03 adjuntos privados | Parcial | Las subidas van con URL firmada y caducidad. La lectura no se verificó |
| SEG-04 tokens con alcance | Parcial | OAuth con caducidad y revocación. Sin alcance por nivel ni por proyecto |
| SEG-05 detector de secretos | No | |
| SEG-06 auditoría exportable | No | El registro de actividad guarda escrituras, no lecturas, y lo dice |
| SEG-07 terceros como dato | No | El MCP entrega texto de tareas tal cual |
| SEG-08 exportar y borrar | No | No se encontró |
| SEG-09 salida de personas | No | No se encontró |
| SEG-10 secretos nunca visibles | No verificado | Hay lectura de variables de Railway; falta comprobar qué sale |
| TAB-01 área y categoría | Parcial | Decidido en la 0050 (una rama por tarea, con gerente). El MCP sigue creando categorías por nombre si no existen |
| TAB-02 borrar y fusionar etiquetas | Parcial | `DELETE /tags/:id` existe. No hay fusión ni herramienta MCP |
| TAB-03 comentarios | No | Solo el verbo `comento` en el vocabulario, sin quien lo escriba |
| TAB-04 a TAB-06 | No | |
| COO-01, COO-03 | No | |
| COO-02 sesiones activas | Parcial | `estoy_haciendo` |
| PR-01 tarea ↔ PR | Parcial | `enlazar_rama` manual |
| PR-02 a PR-06 | No | |
| BD-01 registro de migraciones | Parcial | Hay `/environments/:id/migrate`; sin registro por entorno ni tipo aditiva/destructiva |
| BD-02 aplicar con nivel | Parcial | Sin niveles ni respaldo previo |
| BD-03, BD-04, BD-05, BD-07 | No | |
| BD-06 escritura con doble llave | No verificado | Existe `/database/query`; falta ver si separa lectura de escritura |
| ARQ-01 mapa de servicios | Sí | `ver_arquitectura`, `dibujar_arquitectura`, lector de Terraform |
| ARQ-02 variables por servicio | Parcial | Se leen para configurar la base; no hay vista «puesta sí o no» |
| ARQ-03 trabajos programados | No | |
| ARQ-04 commit desplegado | No | `/health` devuelve solo `ok` y la hora |
| ARQ-05 despliegue guiado | Parcial | `/deploy` existe; sin lista de pasos ni verificación |
| ARQ-06 vuelta atrás | No | |
| PRO-01 a PRO-07 | No | Ninguna vista de salud, rutas ni consumo |
| MAN-01 a MAN-03 | No | |
| CTX-01, CTX-04 | No | |
| CTX-02, CTX-05 | Parcial | `diario`, `panorama` |
| CTX-03 contexto de tarea | Parcial | `contexto_de_tarea` dice «ninguna conversación enlazada» casi siempre |

De las **33 herramientas MCP** que proponen, ninguna existe con ese nombre.

## 3. El orden, y por qué

**Fase 0 · lo que no espera (hasta el 17-oct).** La política de datos y
las comprobaciones de cifrado son texto y verificación, no código. Junto a ellas,
que ningún secreto salga por la API ni por el MCP.

**Fase 1 · lo que más horas costó (hasta el 31-oct).** Etiquetas que no se
duplican, comentarios que se añaden, tarea ↔ PR automático, registro de
migraciones, variables por servicio, commit desplegado, reservas entre agentes.

**Fase 2 · ver producción (hasta el 14-nov).** Salud, peticiones por ruta y
consumo contra el plan. Es la sección más vacía y la que más dolió: 535.744
peticiones en un día que nadie vio hasta agotar el cupo.

**Fase 3 · cerrar el ciclo, con freno (hasta el 5-dic).** Bandeja de PRs,
fusionar con reglas y escritura con doble llave. **Va después de los niveles del
agente (SEG-04) y de la decisión sobre qué puede hacer un agente sin persona.**
Construir la acción antes que el freno es el orden equivocado.

**Fase 4 y 5 · configuración invisible y memoria (hasta el 19-dic).** Trabajos
programados, aplicar migraciones con respaldo, tareas operativas, decisiones como
objetos, auditoría exportable y salida de personas.

## 4. Decisiones que hacen falta antes de construir

1. **Qué puede hacer un agente sin persona** (niveles N0 a N3 del documento) y
   quién lo configura. Bloquea SEG-04, PR-05 y BD-06.
2. **Si DevUP fusiona y despliega por el usuario o solo lo propone.** El
   documento pide lo primero; es un cambio de qué es el producto, no una función.
3. **Cómo se guarda un secreto «referenciado»** (SEG-05): dónde vive y quién lo
   puede leer, o el detector solo avisa.

## 5. Riesgos

- **El plan es largo y el equipo son tres.** Por eso las fases 3 a 5 quedan como
  dirección y no como compromiso; se revisan al terminar la fase 2.
- **API por delante de la interfaz.** Es lo que ya pasó una vez: nueve funciones
  hechas sin pantalla. Cada tarea de API con pantalla lleva su tarea de web
  enlazada, y no se cierra la primera sin la segunda.
- **Un cliente real espera respuesta.** La política de datos (SEG-01) es lo único
  con un interlocutor esperando, y por eso va primero.

## 6. Lo que hay en el tablero, y lo que no

El tablero de DevUP tenía 80 tareas, todas en Hecho. Este plan añade **35**, en
«Por hacer»: 10 de Fase 0, 9 de Fase 1, 5 de Fase 2, 4 de Fase 3, 4 de Fase 4 y
3 de Fase 5. Los 53 requisitos se agruparon; el identificador de cada uno va en
el título.

**Reparto de hoy: 28 tareas para la sesión de datos y 7 para la de web.** Está
descompensado porque casi todo lo que pide el documento es de API, migración o
MCP. Cada tarea de API con pantalla lleva su tarea de web enlazada, pero conviene
mirar si parte de la web pasa a otra persona antes de que la Fase 1 empiece.

**No se bajaron al tablero, a propósito** (son P2 y P3 del documento y ninguna
bloquea a otra): TAB-06 pedido a plan, COO-02 y COO-03 sesiones y restricciones
activas, PR-04 revisión por IA, PR-06 políticas de commits, BD-04 a BD-05 y BD-07
fichas de tabla, consultas guardadas y respaldos visibles, ARQ-05 y ARQ-06
despliegue guiado y vuelta atrás, PRO-04, PRO-06 y PRO-07, y MAN-01 a MAN-03. Se
revisan al cerrar la Fase 2.
