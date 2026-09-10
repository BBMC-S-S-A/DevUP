# Nueve tareas nuevas: agentes, participación y DevVerse

Añadidas el 10 de septiembre de 2026. Continúan
[`plan-interfaz.md`](plan-interfaz.md), [`vision-y-mvp.md`](vision-y-mvp.md) y
[`DevUP-Propuesta-de-Desarrollo.pdf`](DevUP-Propuesta-de-Desarrollo.pdf), y no
los sustituyen: aquí está lo nuevo y cómo encaja con lo que ya estaba ordenado.

---

## 1. Lo primero: son nueve tareas y tres cimientos

Leídas una a una parecen nueve funciones sueltas. Leídas juntas, **seis de las
nueve se apoyan en tres piezas que no existen todavía**, y construir esas tres
primero es la diferencia entre nueve trabajos y tres.

Lo comprobé en el código antes de escribir esto.

### Cimiento A · El registro de hechos

**No hay tabla de auditoría.** Hay `created_by` en 24 sitios, `author_id` en
siete, `assignee_id` en dos y un `updated_by` — es decir: la base sabe **quién
es el dueño de cada fila**, y no sabe **qué pasó ni cuándo**. `notifications`
tiene `actor_id`, pero eso es un aviso, no un historial.

Sin ese registro no se puede hacer ninguna de estas tres: el porcentaje de
participación (tarea 3), que Claude marque una tarea diciendo qué hizo
(tarea 5), ni saber qué hizo cada subagente (tarea 7).

Con él, las tres salen casi gratis. Una fila por hecho: **quién, qué verbo,
sobre qué objeto, cuándo, y con qué evidencia** —el commit, el PR, la ejecución
de integración continua—. Solo se añaden filas; nada se actualiza. Es la misma
forma que ya decidimos para el libro de monedas en
[`avatares-y-economia.md`](avatares-y-economia.md) §8, así que conviene que sea
la misma tabla o dos hermanas con el mismo criterio.

Y trae de regalo cosas que no estábamos pidiendo: el diario del proyecto, los
post-mortem, y la línea de tiempo que es la tesis del producto hecha pantalla.

### Cimiento B · El servidor MCP

**No hay una sola línea de MCP en el repositorio.** Es terreno virgen, lo cual
es buena noticia: se diseña bien desde el principio en vez de arreglarlo.

Es lo que habilita las tareas 2, 4, 5 y la mitad de la 7. Y es una sola pieza:
un servidor que expone la plataforma como herramientas, con los permisos que
ya existen por rol.

### Cimiento C · El contexto en archivos

Las «neuronas» de la tarea 1. Y no son documentación: **son la respuesta al
problema que la propuesta ya cita con datos**. El 66 % de los desarrolladores
pelea con respuestas de IA que están *casi* bien; un agente sin contexto del
proyecto produce exactamente eso. Las tareas 5 y 7 —que Claude planifique y que
varios subagentes trabajen— salen mal sin este cimiento y bien con él.

> **El orden que sale de esto:** A y C primero, porque son pequeños y todo lo
> demás los usa. B después. Y las seis tareas que se apoyan en ellos, al final,
> cuando ya no hay que inventarse la mitad.

---

## 2. Las tareas

Marco de coste como en el resto de los documentos: **P** horas o un día,
**M** días, **G** semanas.

### T1 · Neuronas: el contexto del proyecto en archivos · M

Archivos Markdown que le dan a cualquiera —persona o agente— el contexto de un
trozo del sistema sin tener que leerlo entero. Una por módulo: qué resuelve, qué
decisiones están tomadas, qué trampas tiene, qué archivos lo componen.

El repositorio ya tiene la materia prima: `CONTEXTO-COMPLETO.md`, las decisiones
numeradas y las cabeceras largas de archivos como `atlas.ts` o `scene.ts` son
neuronas sin recortar. Aquí se trata de partirlas por módulo y ponerlas donde un
agente las encuentre.

**Lo que decide si esto sirve o miente:** una neurona que se queda vieja es peor
que no tenerla, porque el agente se la cree. Así que cada neurona **declara qué
archivos cubre**, y la integración continua avisa cuando esos archivos cambiaron
y la neurona no. No es validar la prosa —eso no se puede— es detectar la deriva,
que es lo que de verdad pasa.

**Cuidado con una tentación:** una neurona no es un volcado del código. Si dice
lo mismo que el código, sobra y se desincroniza. Dice **por qué**, que es lo
único que no se puede deducir leyendo.

### T2 · MCP: control de la plataforma desde Claude · G

Un servidor MCP que exponga DevUP como herramientas: crear y mover tareas,
subir imágenes y archivos, convocar reuniones, leer el tablero, buscar,
consultar el estado de la infraestructura.

**La regla que ordena el diseño:** el MCP **no es una puerta nueva**, es otra
cara de la API que ya existe. Cada herramienta pasa por el mismo permiso de rol
y el mismo aislamiento entre organizaciones que la pantalla equivalente. Un
servidor MCP que se salte los roles es una escalada de privilegios con nombre
bonito.

Dos cosas que conviene fijar desde el principio: **toda acción del MCP deja su
fila en el registro de hechos** —si no, se pierde justo la trazabilidad que
buscamos— y **las acciones destructivas piden confirmación humana**, igual que
en la interfaz.

### T3 · Participación: quién hizo qué y cuándo · M

Sale casi solo del cimiento A: con el registro de hechos, la línea de tiempo por
persona, por semana y por módulo es una consulta.

**Pero hay que decidir bien qué se cuenta, y es una decisión delicada.** Un
porcentaje de participación entre tres socios es una cifra que se lee mucho más
de lo que se cree, y medir volumen repite exactamente el error que ya
descartamos para la gamificación: puntuar commits produce commits, y deja
último a quien arregló el fallo difícil en tres líneas.

Lo que propongo, y conviene discutirlo antes de construirlo:

- **La línea de tiempo primero, el porcentaje después.** «Qué pasó y quién lo
  hizo» es útil siempre. «Quién va ganando» solo es útil si está bien medido.
- **Que el porcentaje se base en los mismos hechos verificables** que acuñan
  moneda: migraciones con su política y su prueba, revisiones de fondo, fallos
  con prueba de regresión, integración continua devuelta a verde.
- **Detalle individual visible para cada uno sobre sí mismo**, y agregado para
  el equipo. Una tabla pública de tres personas ordenadas por porcentaje es un
  problema de convivencia, no un panel.
- **Contar también lo que no deja commits**: revisar, decidir, acompañar. Si el
  panel solo ve código, el que diseña aparece como el que menos trabaja.

### T4 · Arrastrar tareas y descripciones desde Claude · M

Que una tarea propuesta en una conversación aterrice en el tablero sin
copiar y pegar.

La mitad ya está hecha: `tasks` tiene posición fraccional —pensada precisamente
para soltar una tarjeta entre otras dos sin renumerar la columna— y el tablero
ya arrastra. Lo que falta es la otra punta del cable, que es T2.

**Un detalle con consecuencia:** cuando la tarea llega desde una conversación,
conviene guardar **de dónde vino**. Es una fila más en el registro, y es lo que
permite después abrir una tarjeta y volver a la conversación que la originó. Eso
es la tesis del producto —que el contexto no se pierda— en su versión más
pequeña y más barata.

### T5 · Que Claude proponga un plan, lo suba y lo cierre · G

Claude plantea un plan para X, lo sube con sus tareas, sus responsables y su
estimación, y después marca cada tarea como hecha **diciendo qué hizo**.

Necesita T1 (para que el plan tenga sentido), T2 (para subirlo) y A (para el
cierre con evidencia). Y necesita algo del esquema: `tasks` hoy no tiene
estimación ni fecha límite ni marca de cierre, así que hay tres columnas y su
migración —con su política de aislamiento y su caso de prueba, como toda tabla
o columna nueva que importe—.

**La regla no negociable, y la misma que ya está en la propuesta:** el agente
propone y la persona aprueba. Un plan que entra solo al tablero es ruido; un
plan que espera un visto bueno es una propuesta. Y **«hecho» dicho por un agente
va marcado como tal**, con su evidencia al lado: no es lo mismo que lo diga una
persona, y confundirlos envenena el panel de participación de T3.

### T6 · La pantalla que explica el proyecto solo · G

Un apartado que dibuja cómo funciona el proyecto según las herramientas que usa
—como el diagrama de arquitectura de la referencia— y donde al pulsar cada
recuadro se abre lo técnico de esa pieza.

**El hallazgo que convierte esto de dibujo en producto: no hay que dibujarlo.**
La bóveda ya sabe qué está conectado, el conector de GitHub ya sabe qué
repositorios hay, y la vista de infraestructura del bloque D va a saber qué
entornos y despliegues existen. **El diagrama se deriva de lo que está
conectado**, no se mantiene a mano.

Esa es toda la diferencia. Un diagrama dibujado a mano está desactualizado el
segundo martes. Uno derivado está bien siempre, y además enseña algo que nadie
más enseña: cuando se conecta una herramienta nueva, aparece.

Y al pulsar un recuadro, lo técnico sale de la neurona de T1 más el estado en
vivo: la última ejecución de integración continua, el último despliegue, quién
lo tocó. Es T1, el bloque D y el cimiento A confluyendo en una pantalla.

Dos avisos: **es el hermano visual del bloque D, no un sustituto** —conviene
hacerse después o con él, no antes—, y **el diagrama enseña topología, no
secretos**: qué pieza hay y cómo se conecta, nunca una credencial ni un
identificador de cuenta.

### T7 · Agentización: repartir el trabajo en subagentes · G

Partir una tarea en varios subagentes, elegir con cuánto esfuerzo trabaja cada
uno, y verlos como bots dentro de DevVerse.

Lo que hace falta: una tarea padre con sus hijas, un nivel de esfuerzo por
subagente —que se traduce en presupuesto y en profundidad—, aislamiento entre
ellos para que no se pisen (la copia de trabajo por rama de la que ya hablamos),
y el registro de hechos para saber qué hizo cada uno.

**Y aquí hay que ser explícito con algo, porque toca una decisión ya tomada.**
En [`vision-y-mvp.md`](vision-y-mvp.md) §5 la separación de los dos mundos tiene
un contrato de una sola dirección: el trabajo genera puntos, los puntos se
gastan en DevVerse. Ver los agentes como bots **abre un segundo cruce**, y eso
es correcto y bonito, pero conviene que sea igual de estrecho:

- El cruce es una **proyección de solo lectura**: DevVerse ve el estado del
  agente —trabajando, esperando aprobación, terminado— y nada más.
- **DevVerse nunca manda sobre el agente.** No se le da una orden a un bot
  empujándolo; el mando vive en la plataforma, donde hay permisos y registro.
- Si DevVerse está cerrado, los agentes siguen funcionando igual. El bot es la
  cara, no el cuerpo.

Sin esa disciplina, la separación que hace la plataforma llevable a móvil se
deshace por la puerta de atrás.

### T8 · Rediseño de arquitectura por jerarquía visual e importancia · G

El diagnóstico es correcto y coincide con el que ya está medido: el flujo actual
no está organizado para ahorrarle tiempo a quien desarrolla, sino según el orden
en que se fueron añadiendo las funciones.

**Conviene separar dos cosas que se confunden**, porque una ya está planificada
y la otra no.

Lo que **ya está en [`plan-interfaz.md`](plan-interfaz.md)** (fases I1–I5) es la
capa que falta: armazón, marco de página, primitivas, capa de datos, móvil. Eso
no hay que replanearlo, hay que hacerlo.

Lo que **es nuevo en esta tarea** es la pregunta de jerarquía, que es de
arquitectura de información y no de armazón: **qué es lo primero que se ve al
entrar, qué está a un clic y qué está a tres.** Hoy eso no está decidido — está
heredado. Y decidirlo tiene un criterio que sale del propio producto: lo que
ahorra un salto de ventana va arriba; lo que se consulta una vez al mes, abajo.

Concretamente, lo que hay que decidir: **qué pantalla es la portada**, qué vive
en la barra y qué en la paleta de comandos, y en qué orden. Mi apuesta es que la
portada acaba siendo la línea de tiempo del cimiento A y no un panel de
tarjetas — pero es una apuesta, y va antes de construir el armazón, no después.

### T9 · Empezar DevVerse · G

Personalización de personajes, skins y lo demás de la propuesta. Está
especificado de punta a punta en
[`direccion-de-arte.md`](direccion-de-arte.md) y
[`avatares-y-economia.md`](avatares-y-economia.md); aquí solo queda el orden de
arranque, que es el del apéndice de aquellos:

1. **La tabla de desbloqueos** sobre el catálogo de índices que ya existe. Es lo
   más pequeño de todo y es lo que abre la economía.
2. **La tubería de render**: modelo en 3D, esqueleto, render a sprite de 44 × 64
   en cuatro direcciones. Es la inversión; después cada prenda es barata.
3. **El cuerpo base masculino y el femenino**, con mezcla libre y el catálogo de
   cuerpos que recoge la inclusión que pediste.
4. **El editor de avatar** comprobando la posesión.
5. **Las skins enteras**, dos o tres para empezar.

Recordatorio de lo que sigue abierto y bloquea el paso 2: el tamaño definitivo
del sprite y cuántos cuerpos base hay de salida.

---

## 3. Cómo encaja con el orden que ya existe

El plan de la propuesta no cambia de forma; recibe las nuevas piezas donde
tienen sentido.

| | Bloque | Qué se añade |
|---|---|---|
| 1 | Que nada se pierda | Sin cambios. Sigue siendo lo primero |
| 2 | Cerrar lo a medias | Sin cambios |
| 3 | Pruebas de navegador | Sin cambios |
| — | **Cimientos A y C** | **Nuevo.** El registro de hechos y las neuronas. Pequeños y todo lo demás los usa |
| 4 | Interfaz (I1–I5) | Antes, decidir la jerarquía de T8 |
| — | **Cimiento B** | **Nuevo.** El servidor MCP |
| 5 | Infraestructura | Con T6 como su cara visual |
| 6 | Integraciones guiadas | Sin cambios |
| 7 | Agentes | Ahora incluye T5 y T7 |
| — | **DevVerse (T9)** | Puede ir en paralelo: no depende de nada de arriba |
| 8 | Base de datos como código | Sin cambios |
| 9 | Identidad y apertura | Con T3 ya construido |

Que T9 no dependa de nada es útil: es el trozo que una persona puede llevar en
paralelo sin bloquear a las otras dos.

---

## 4. Otras maneras de nutrir DevUP

Lo que apareció pensando en estas nueve. Marcadas las que creo que valen más de
lo que cuestan.

### Lo que sale del registro de hechos, casi gratis

- ★ **Reconstruir el contexto de una tarea.** Un botón en la tarjeta que trae el
  PR, los mensajes, la pizarra y la grabación de la llamada donde se habló de
  esto. **Es la tesis del producto convertida en un botón**, y con el cimiento A
  es una consulta. Si hubiera que elegir una sola función de esta lista, es
  esta. **M**
- ★ **El diario del proyecto.** «Esta semana pasó esto», generado, no escrito.
  Sirve para el equipo, para el cliente y para quien vuelve de vacaciones. **P**
- **Post-mortem automático.** Integración continua en rojo → qué cambió → quién
  → qué lo arregló, en un solo hilo. **M**
- **Onboarding de un día.** Neuronas + diagrama derivado + línea de tiempo hacen
  un «empieza aquí» que ninguna otra herramienta puede armar, porque ninguna
  tiene las tres cosas. **M**

### Lo que solo nosotros podemos medir

- ★ **Cuántos saltos de ventana ahorró DevUP.** El producto se vende con una
  cifra de la industria; medir la propia es otra cosa. Es el número que convierte
  la tesis en argumento comercial, y con el registro de hechos se puede
  estimar. **M**
- ★ **Coste real por proyecto**: tokens de agente + infraestructura + horas, por
  cliente. Para una empresa de desarrollo es el número que casi nadie tiene y
  todos quieren. **M**

### Lo que decide si alguien se cambia

- ★ **Importar desde Jira, Linear o Trello.** Sin camino de entrada nadie se
  muda, por bueno que sea el destino. Es aburrido y es de las cosas más
  rentables de la lista. **M**
- ★ **Acceso de lectura para el cliente.** Que el cliente vea el avance sin
  tocar nada y sin una reunión de estado. Para una empresa de desarrollo esto se
  vende solo, y el aislamiento por organización ya está construido. **M**
- **Plantillas de proyecto.** Un cliente nuevo arranca con la bóveda, el
  repositorio, la integración continua, los canales y el tablero ya creados. **M**

### Oficio

- **Búsqueda que responde.** Sobre mensajes, PRs y pizarras, contestando con la
  cita de dónde lo saca. La búsqueda global ya cubre seis cosas; esto es la capa
  de encima. **G**
- **El agente de guardia.** Vigila la integración continua de noche y abre una
  tarea con el diagnóstico. **M**
- **«No me molestes hasta que…»** El estado de presencia que vigila una
  condición —hasta que la integración pase, hasta las cuatro— y se apaga solo.
  Encaja con los cuatro estados de la cartelera. **P**

---

## 5. Lo que necesito que decidas

1. **Qué se cuenta como participación** (T3), y si el porcentaje individual es
   visible para todos o solo para cada uno. Es la decisión más delicada de este
   documento y la que más cuesta deshacer.
2. **Qué pantalla es la portada** (T8). Va antes de construir el armazón.
3. **Si el cruce agente → bot es de solo lectura** (T7). Yo lo daría por
   cerrado así, pero conviene decirlo en voz alta porque toca la separación de
   los dos mundos.
4. **Tamaño del sprite y cuántos cuerpos base** (T9). Sigue abierto desde
   agosto y bloquea el paso 2.
