# Plan de trabajo · La memoria del proyecto se ve

_12 de septiembre de 2026. Escrito después de fusionar los PR #57 y #58._

## 0. El hecho que cambia el plan

Hace dos días, cuando se diseñó el grafo del proyecto, la conclusión fue esta:

> «DevUP guarda en qué estado está todo y no guarda nada de lo que pasó.»

**Eso ya no es cierto.** Las migraciones 0038 a 0043 han entrado, y con ellas:

| Migración | Qué trajo |
|---|---|
| `0038_registro_de_actividad` | La tabla `activity`. Inmutable a propósito: no hay política de UPDATE ni de DELETE. |
| `0039_search_path_en_todas` | Las cinco funciones que faltaban, cerradas. |
| `0040_jefe_de_rama` | Una categoría tiene jefe, y no es lo mismo que el responsable de una tarea. |
| `0041_codigo_corto_de_invitacion` | Invitar dictando un código por teléfono. |
| `0042_is_org_admin_nunca_null` | El guardián que devolvía NULL y por eso no bloqueaba dentro de un `if not`. |
| `0043_puede_ver_nodo_y_enlaces` | La tabla de enlaces del grafo, y el guardián que decide qué extremo puede ver cada quien. |

Y la API ya las usa: `apps/api/src/lib/actividad.ts` define el vocabulario,
`routes/tasks.ts` escribe al mover, cerrar y asignar, y `routes/actividad.ts`
sirve las tres preguntas por tres rutas distintas.

**Lo que falta es la mitad de arriba.** La web no consume ni una sola de esas
rutas. El registro se está llenando desde hace días y no hay una sola pantalla
donde se vea. Ese es el trabajo de este tramo, y es literalmente lo que se
pidió: _«que toda esa información vaya a una parte donde estén neuronas del
proyecto… es como tener un remote»_.

No hay que diseñar nada nuevo para empezar. Hay que enchufar lo que ya existe.

---

## 1. Las tres preguntas, y dónde va cada una

La API no sirve «la actividad»: sirve tres preguntas distintas, y cada una
tiene su sitio natural en la interfaz. Meterlas todas en una pantalla de
«registro» sería el error clásico — un buzón que nadie abre.

### 1.1 «¿Qué le ha pasado a esta tarea?» → dentro de la tarea

`GET /actividad/de/:sujetoId`

El detalle de una tarea enseña hoy su estado. Debajo va su historia: quién la
movió, cuándo, de dónde a dónde, quién la asignó. Es el sitio donde la pregunta
se hace de verdad — nadie abre una pantalla de auditoría para enterarse de por
qué una tarea lleva tres días en «En curso».

### 1.2 «¿Qué ha pasado aquí desde que me fui?» → el espacio

`GET /workspaces/:workspaceId/actividad?desde=…`

**Esta es la del remote.** Es con lo que alguien vuelve el lunes, o entra desde
otro ordenador, o llega a un proyecto que no tocaba desde hace dos semanas. Sin
esto, volver al trabajo empieza por preguntar a alguien.

La ruta ya pagina por marca de tiempo y no por número de página, precisamente
para que «lo que ha pasado desde ayer» no cambie de significado mientras se lee.

### 1.3 «¿En qué anda esta persona?» → la rama y la ficha

`GET /organizations/:orgId/actividad/:personaId?dias=…`

Devuelve los renglones **y un recuento por verbo**, que es lo que contesta
«cerró cuatro esta semana» sin que nadie cuente a ojo. Y respeta el
aislamiento: si alguien trabaja en un proyecto que yo no veo, su trabajo de ahí
no aparece.

Va en dos sitios: la ficha de la persona, y el resumen de «quién ha trabajado
en esta rama» que se pidió para las categorías.

---

## 2. La red, con las aristas que le faltaban

`RedDeTrabajo.tsx` dibuja hoy tres aristas: persona↔tarea, tarea↔categoría y
tarea↔columna. Su propio comentario dice por qué no dibuja más:

> «No hay arista tarea↔commit, tarea↔mensaje ni tarea↔despliegue. Eso es el
> grafo con procedencia, y necesita el registro de actividad.»

Ya lo tiene. Y además tiene `graph_links`, que es donde viven los enlaces
explícitos. **Nadie escribe todavía en esa tabla**, así que el siguiente paso
no es dibujar: es tejer.

Dos cosas, en este orden:

1. **Rutas de enlaces** (API, sin tocar la base): crear un enlace, leer los de
   un nodo. Con `puede_ver_nodo` comprobando **los dos extremos** — que es para
   lo que se escribió: un enlace entre una tarea y un mensaje de un canal
   privado no puede revelar que ese canal existe.
2. **Tejer desde donde ya pasa**: al cerrar una tarea con descripción, al
   adjuntar un archivo, al mencionar una tarea en un mensaje. Un grafo que hay
   que rellenar a mano se queda vacío; uno que se teje solo crece.

Y entonces sí, la forma de neurona: la red deja de ser tres columnas y pasa a
alimentarse de todas las ramas, que es lo que se pidió.

---

## 3. El backlog huérfano

En el tablero hay **doce tareas con captura y sin responsable**, casi todas
vencidas: el rework de la landing, el fix de la mesa, la corrección de formas y
navegación, la barra de temas, el arreglo visual de las invitaciones…

Ninguna es mía ni de nadie. Una tarea vencida y sin dueño no es trabajo
pendiente: es ruido que hace que el tablero deje de leerse. Antes de añadir
nada nuevo hay que repartirlas o cerrarlas.

---

## 4. Lo que sigue delegado, y por qué

| Qué | Quién | Por qué no lo hago yo |
|---|---|---|
| Reuniones con hora en DevCall | Juan Bonilla | Migración: no hay tabla de eventos ni de asistentes. |
| Quién hay en una sala sin entrar | Carlos Cáceres | Esa presencia vive en la memoria del servidor de señalización. |
| El almacén de archivos sin respaldo | Juan Bonilla | Infraestructura y variables de entorno. |

La regla no cambia: **lo que toque variables de entorno o base de datos se
delega**, no se hace a medias.

---

## 5. El orden

1. Historial dentro de la tarea _(la más pequeña, y la que valida que el
   registro se está llenando bien de verdad)_.
2. «Qué ha pasado aquí» en el espacio — el remote.
3. Quién ha trabajado, en la rama y en la ficha.
4. Rutas de enlaces del grafo.
5. Tejer enlaces desde donde ya pasan las cosas.
6. La red alimentándose de todo eso.

Uno detrás de otro, cada uno con su PR. El primero se empieza ahora.
