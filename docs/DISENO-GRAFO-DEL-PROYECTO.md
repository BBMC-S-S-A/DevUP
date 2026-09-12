# Diseño · El grafo del proyecto, o cómo se deja de pisar la cola

12 de septiembre de 2026.

Lo pedido, en tus palabras: que al terminar tareas y escribir sus descripciones
**toda esa información vaya a un sitio** —«las neuronas del proyecto»— del que
tanto las personas como la IA puedan tomar contexto, para trabajar **varios en
remoto sin pisarse**. «Es como tener un remote.»

Esa frase es la correcta, y conviene tomarla en serio: **un remote no guarda el
estado final, guarda lo que pasó.** Esa distinción decide todo lo demás.

---

## 1. Por qué hoy no se puede, en una frase

DevUP guarda **en qué estado está todo** y **no guarda nada de lo que pasó**.

Una tarea sabe en qué columna está, quién la tiene y qué texto lleva. No sabe
quién la movió, cuándo, desde dónde, ni por qué. Un despliegue no sabe de qué
commit salió — no hay ni una clave que los una. Un archivo no sabe de qué
conversación nació.

Por eso «¿qué me he perdido desde el viernes?» no tiene respuesta, y por eso dos
personas en remoto se pisan: no es que falte una pantalla, es que **la pregunta
no se puede hacer**.

---

## 2. La pieza que falta es una, y no es el dibujo

**El registro de actividad.** Una tabla de solo añadir donde cada hecho queda
escrito cuando ocurre:

| | |
|---|---|
| qué pasó | movida, cerrada, asignada, comentada, subido, desplegado |
| sobre qué | tipo y id — tarea, archivo, canal, entorno |
| quién | persona, regla o **agente** |
| cuándo | y nada más |

Tres cosas que parecen detalles y no lo son:

- **Solo se añade. Nunca se edita ni se borra.** Un registro que se puede
  reescribir no sirve para reconstruir nada, y lo que lo hace valioso es
  precisamente poder rehacer el grafo entero desde cero si una regla estaba mal.
- **La procedencia va en cada fila.** Que se pueda distinguir lo que hizo una
  persona de lo que dedujo una regla y de lo que escribió un agente es lo único
  que hace aceptable que un modelo escriba aquí. Sin eso, en un mes nadie se fía
  de nada de lo que hay dentro.
- **El grafo es un índice, no una fuente.** Las reglas leen actividad y escriben
  enlaces; nunca al revés. Si los enlaces también fueran fuente, no se podrían
  recalcular, y el día que una regla esté mal habría que arreglar los datos a
  mano.

**Sin esto, el resto de este documento no se puede construir.** Con esto, casi
todo lo demás cae solo.

---

## 3. Qué se puede preguntar en cuanto exista

Estas son las preguntas que hoy no tienen respuesta y que el registro contesta
sin ninguna pantalla nueva:

- **«¿Qué ha pasado aquí desde ayer?»** — una sola herramienta del MCP, y es la
  que de verdad resuelve trabajar en remoto sin pisarse. No hace falta que
  ningún agente emita nada: los hechos ya están escritos porque ocurrieron.
- **«¿Quién ha trabajado en esta categoría?»** — hoy la pantalla de Categorías
  dice «quién la lleva», que es quién tiene tareas asignadas. Con actividad pasa
  a ser quién movió y cerró, que es otra cosa.
- **«¿Qué tocó esta persona esta semana?»** — con el mismo cuidado de siempre:
  lo que hizo, no cuánto tardó ni cuándo se conecta.
- **«¿De qué commit salió este despliegue?»** — regla determinista, no
  adivinanza.

---

## 4. El dibujo: qué hay hoy y qué falta

Ya existe **la red de trabajo** en la pantalla de Categorías: personas ↔ tareas
↔ categorías, con las tres aristas que la base tiene hoy. Eso ya contesta qué
áreas toca cada persona y cuál está sin nadie.

Lo que le falta para ser lo que pides no es dibujo, son **aristas**:

| Arista | Estado |
|---|---|
| tarea ↔ persona | **existe** |
| tarea ↔ categoría | **existe** |
| tarea ↔ archivo | **existe** (`files.task_id`) |
| tarea ↔ mensaje | falta |
| tarea ↔ commit | falta — pide alojar el repositorio, o webhooks |
| despliegue ↔ commit | falta |
| cualquier cosa ↔ **lo que pasó** | falta — es el registro |

**Añadir nodos sin aristas nuevas no mejora el mapa, lo llena.** Por eso la red
de hoy dibuja solo lo que puede unir de verdad.

---

## 5. El aislamiento, que aquí es más difícil que de costumbre

Y es la razón por la que esto no se empieza a la ligera.

Una fila normal se protege preguntando si quien mira pertenece a la
organización. **Un enlace no**: toca dos extremos, y quien puede ver uno puede
no poder ver el otro. Un enlace entre un mensaje de un canal privado y una tarea
lo vería cualquiera con acceso al tablero — y con él, **la existencia de ese
canal**.

No es hipotético: es la misma fuga que el producto ya se cuidó de evitar en las
menciones, donde está escrito que avisar a quien no está en el canal «revelaría
que ese canal existe, que es media filtración».

**Hace falta `puede_ver_nodo(tipo, id)` antes de crear la tabla de enlaces, no
después.** Es trabajo real y merece su propia decisión escrita.

---

## 6. El orden, y por qué este y no otro

| | Qué | Quién | Por qué ahí |
|---|---|---|---|
| **1** | El registro de actividad | Juan Bonilla | Todo lo demás cuelga de esto |
| **2** | Escribir actividad al mover, cerrar y asignar | Juan Bonilla | El registro vacío no sirve |
| **3** | «¿Qué ha pasado desde…?» en el MCP | Juan Bonilla | Es **el** desbloqueo del trabajo en remoto |
| **4** | «Quién ha trabajado» de verdad, en Categorías | Juan Medina | Cae solo con 1 y 2 |
| **5** | `puede_ver_nodo` y la tabla de enlaces | Juan Bonilla | Antes de tejer nada |
| **6** | Las reglas que tejen: commit→tarea, despliegue→commit | Juan Bonilla | Ya hay de dónde |
| **7** | La red con las aristas nuevas | Juan Medina | Dibujar es lo último y lo barato |

**El 3 es el que hay que mirar.** Es una herramienta y contesta la pregunta que
motivó todo esto. Lo demás es construir encima.

---

## 7. Lo que NO haría, y conviene dejarlo escrito

- **Que cada agente mande su contexto cada cierto tiempo.** Es ruido caro que
  crece sin que crezca la utilidad, y obliga a decidir qué se manda — que es
  donde se filtra lo que nadie quería compartir. Con los hechos escritos no hace
  falta que nadie emita nada: hace falta **poder preguntar**.
- **Guardar el texto de las tareas en un sitio aparte.** Ya está en la tarea. Lo
  que falta no es una copia, es saber **qué le pasó** a esa tarea.
- **Medir horas.** Con el registro se puede, y por eso hay que decir que no
  ahora: eso es control horario, se mide mal siempre, y convertiría la
  herramienta de trabajo en una de vigilancia. La línea es la misma que ya se
  puso en la ficha de una persona: lo que hace y decidió compartir, sí; cuánto
  tarda y cuándo se conecta, no.

---

## 8. En una frase

Lo que pides no es una pantalla: es **dejar de guardar solo el estado final y
empezar a guardar lo que pasa**. Con eso, el mapa, el «qué me he perdido» y el
contexto para la IA caen casi solos; sin eso, cualquier dibujo es una foto bonita
de lo que hay ahora y no sirve para no pisarse.
