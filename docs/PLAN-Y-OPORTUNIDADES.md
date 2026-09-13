# Qué falta, y qué podría ser DevUP

12 de septiembre de 2026. Dos partes: **el inventario de lo que falta**, sacado
del repositorio y no de la memoria, y **un brainstorm de lo que se podría
construir encima de lo que ya hay** — que es distinto de una lista de deseos,
porque cada idea de abajo dice con qué piezas existentes se monta.

---

# PARTE 1 · Lo que falta

## 1.1 El problema que no está en ninguna lista: la API se está adelantando

Esto salió al auditar el repositorio y es el dato más importante del documento.

**134 rutas en la API.** De las que se escribieron en esta tanda, esto es lo que
la web llama hoy:

| Lo que hace | Ruta | ¿Pantalla? |
|---|---|---|
| Portada global («¿qué tengo?») | `/me/inicio` | página hecha, **sin enlace que lleve a ella** |
| Portada de una organización | `/organizations/:id/panorama` | **ninguna** |
| Diario del proyecto | `/workspaces/:id/diario` | **ninguna** |
| Contexto de una tarea | `/tasks/:id/contexto` | **ninguna** |
| El grafo (3 rutas) | `/grafo/...` | **ninguna** |
| Qué ha pasado, cruzando todo | `/me/actividad` | **ninguna** |
| Renovar el código de invitación | `/invitations/:id/codigo` | botón **desactivado** |
| El oficio de cada quien | `set_my_title` | **ninguna** |
| Datos de los widgets | `/workspaces/:id/panel` | **ninguna** |

Nueve funciones terminadas, probadas y en verde **que nadie puede usar**.

No es un fallo del reparto por capas: es la consecuencia natural de que una
sesión construya más rápido de lo que la otra pinta. Pero tiene un coste que
crece solo — cada semana que una función espera pantalla es una semana en la que
puede quedarse obsoleta antes de estrenarse, y el día que se monten todas de
golpe se montarán deprisa.

**Decisión que hace falta:** o la sesión de interfaz se dedica un tramo entero a
vaciar esta lista, o la de funcionalidades para de añadir rutas y se mete en otra
cosa (MCP, agentes, integraciones — cosas que no necesitan pantalla). Seguir como
vamos es acumular.

## 1.2 Huecos funcionales de verdad

**El grafo no teje tarea↔mensaje.** Es el único hueco real que le queda. Hoy
`contexto_de_tarea` dice «ninguna conversación enlazada» casi siempre, y no
porque no las haya: porque las menciones solo saben apuntar a personas. Esto es
lo que hace que la tesis del producto —«¿por qué se hizo así?»— conteste a
medias. Base, API y MCP.

**La puerta MCP no se puede probar desde aquí.** Sigue bloqueada por la política
de salida del contenedor (403 al CONNECT contra `api.hytrex.co`), no por falta de
token. Funciona; no se puede verificar desde esta sesión.

**Las grabaciones no llevan a ningún sitio.** `call_recordings` y
`call_recording_consents` existen desde 0003 y no hay pantalla ni transcripción.
Una llamada grabada que nadie vuelve a abrir es un archivo pesado.

**La arquitectura se dibuja pero no se compara.** El lector de Terraform y el
deductor de arquitectura funcionan y tienen pruebas. Lo que no existe es la
segunda lectura: qué cambió desde la anterior.

## 1.3 Deudas conocidas

**Los dos modelos de categoría.** Ver §1.5, que lo desarrolla: no son dos
modelos parecidos, son **dos significados de la palabra «dueño»**, y cada sesión
eligió uno.

**El backlog huérfano**: doce tareas vencidas sin dueño.

**Y dos cosas de higiene**: 28 commits con marca de autoría en la historia, y
**el token de la captura, que sigue sin revocar** — quinto día, y es el único de
todos los pendientes que empeora solo con el tiempo.

## 1.4 Lo que sí está sólido, para no volver a tocarlo

El aislamiento (286 comprobaciones, sin un solo `where organization_id`), el
registro de actividad, el grafo con sus reglas que tejen y destejen, el código
corto de invitación, la ficha de tarea, el panel por espacio, y el arranque de la
API en CI — que se añadió después de descubrir que el tronco llevaba días sin
arrancar.

## 1.5 Las categorías: qué hay que decidir exactamente

No es «hay dos modelos parecidos». Es que **«dueño de un área» significa dos
cosas distintas**, y cada camino implementó una:

| | `task_categories` (0044) | `tags.owner_id` (0040) |
|---|---|---|
| Una tarea está en… | **una** | **varias** |
| Alcance | espacio | organización |
| Qué es el dueño | **delegado por defecto**: archivar ahí **asigna** | **jefe de rama**: responde por el área, las tareas **no** son suyas |

Y las dos migraciones lo dicen explícitamente, cada una en su cabecera. La 0040:
*«que alguien sea jefe de un área no significa que todas esas tareas sean suyas
— de hecho delega»*. La 0044: *«crear una tarea en DevVerse la asigna a quien
lleva DevVerse»*.

**Las dos tienen razón.** Son dos hechos reales del trabajo: quién responde por
un área, y a quién le cae lo que se archiva ahí. El problema es que en pantalla
las dos se llaman igual, así que se archiva esperando una cosa y pasa la otra —
sin error, sin aviso, y sin nada que lo explique después.

### Las dos decisiones

**D1 · ¿Una tarea vive en un área o en varias?**
*Recomendación: una.* El argumento ya está escrito en la 0044 y se sostiene: si
son varias, «las tareas de DevVerse» deja de ser una lista y pasa a ser una
opinión. Las etiquetas siguen para lo suyo —«urgente», «deuda», «diseño»—, que
es cruzar varias cosas a la vez. Implica **retirar `tags.owner_id`** y devolver
las etiquetas a ser etiquetas.

**D2 · ¿El dueño asigna o responde?**
*Recomendación: responde, y asignar es una casilla aparte por área.* «Carlos
lleva Ventas» y «lo que se archive en Ventas se le asigna» son dos afirmaciones
distintas, y la segunda tiene que verse **antes** de archivar. Así las dos
lecturas conviven y ninguna queda implícita.

Coste: una migración pequeña (`task_categories.asigna_por_defecto boolean`, y
retirar `tags.owner_id` migrando lo que hubiera). Lo caro no es el código: es
que la decisión lleva días sin tomarse y el riesgo corre mientras tanto.

---

# PARTE 2 · Qué podría ser DevUP

La regla de esta parte: **cada idea se monta con piezas que ya existen**. Lo que
hace valioso a este repositorio no son las funciones sueltas, es que tiene cuatro
cosas que casi ningún producto de gestión tiene juntas:

1. **Un registro de hechos** que anota quién hizo qué y **si salió de una persona,
   de una regla o de un agente**.
2. **Un grafo** que sabe relacionar ocho tipos de cosa respetando quién ve qué.
3. **Una puerta MCP** por la que un modelo puede leer y escribir en el tablero.
4. **Una bóveda** de credenciales cifradas, y un modelo de infraestructura
   (entornos, servicios, despliegues, arquitectura).

Casi todo lo interesante sale de **cruzar dos de esas cuatro**.

## 2.1 Lo que ya está a un paso

### El «¿por qué?» en todas partes, no solo en las tareas

`contexto_de_tarea` ya funciona. La misma maquinaria sirve para un **archivo**
(«¿de qué reunión salió este PDF?»), un **repositorio** («¿qué tareas se han
tocado aquí este mes?») y un **entorno** («¿qué se desplegó y quién lo pidió?»).
El grafo ya tiene esos tipos de nodo. Es la misma ruta con otro sujeto.

### El repaso del viernes

Ya existe: el diario por semanas, lo atascado, y el MCP por el que un agente
escribe marcando lo suyo como `agente`. Falta el bucle: **un agente que los
viernes lea el diario y lo atascado y deje un mensaje en el canal** con lo que se
cerró, lo que lleva parado y qué va a chocar la semana que viene. Nadie tiene que
acordarse de pedirlo.

### Lo que va a llegar tarde, antes de que llegue tarde

`cierresPorPersona` ya calcula la **mediana** de días que tarda cada quien en
cerrar (mediana y no media a propósito: una tarea abandonada seis meses no puede
decidir la cifra de un trimestre). Cruzado con la fecha de vencimiento y la
prioridad, sale una señal honesta: «esto vence el jueves y lo que se le parece
suele tardar seis días». No es una predicción mágica: es aritmética sobre hechos
propios, y por eso se puede defender delante de un equipo.

### El primer día de alguien nuevo

Contexto + diario + grafo, juntos: **«ponte al día de este proyecto»** en una
pantalla. Qué se ha hecho, por qué se decidió así, quién sabe de qué, qué está
parado. Hoy eso son tres días de preguntar a la gente, y las respuestas dependen
de a quién le toque.

## 2.2 Lo que cruza dos mundos que hoy no se hablan

### Ventas ↔ proyecto

`clients` y `opportunities` existen, y las tareas también, **y no se tocan**.
Para un estudio que lleva varios clientes —que es exactamente Hytrex— la pregunta
cara es: *«¿el proyecto de este cliente va bien, ahora que toca renovar?»*. Con un
enlace de grafo entre una oportunidad y un espacio de trabajo, eso se contesta
solo: tantas cerradas este mes, tantas atascadas, última vez que se tocó.

Esto convierte dos módulos a medias en una razón para usar el producto.

### Las reuniones que dejan rastro

Hay llamadas, hay grabaciones y hay consentimientos. Lo que no hay es lo que pasa
después. **Un acta que enlaza al grafo** —«de esta reunión salieron estas tres
tareas»— cierra el círculo entero del producto: la conversación, la decisión, el
trabajo y la prueba, todo unido. Es la tesis de DevUP en una función.

La raya, igual que en el resto: lo que no se dijo no se inventa. Un acta con una
tarea que nadie acordó es peor que no tener acta.

### Secretos para agentes sin enseñárselos

La bóveda cifra credenciales de terceros. La puerta MCP deja que un modelo actúe.
Cruzarlas bien es una función que casi nadie ofrece: **un agente puede usar una
clave sin llegar a verla**, con alcance limitado, caducidad y todo anotado en el
registro. Hoy, dejar que un agente toque un servicio externo significa pegarle la
clave en un fichero.

### Infraestructura: qué cambió, no qué hay

El lector de Terraform y el deductor de arquitectura ya funcionan. Guardar la
lectura y **comparar con la anterior** da «esta semana apareció un Redis y nadie
lo apuntó». Un diagrama es una foto; lo que se mira de verdad es la diferencia.

## 2.3 El DevVerse, con un motivo

Hoy es bonito y decorativo, y ese es su problema: no hay ninguna razón para
entrar. Tiene salas, zonas, presencia y avatares.

La idea que le daría sentido: **que refleje el trabajo de verdad**. Quien está en
un canal de voz aparece en esa sala. Quien tiene una tarea en curso lo lleva
encima. Las salas se llaman como los espacios. Entonces asomarse contesta algo
que ninguna lista contesta igual de rápido —*«¿quién está y en qué anda?»*— y deja
de ser un juguete.

El edificio del login que se pidió es la versión pequeña de esto, y sirve de
ensayo: tres personajes, sin sesión, sin servidor.

## 2.4 Dos ideas que son producto, no función

**Plantillas de espacio.** Un espacio nace hoy con sus columnas (0046). Una
plantilla llevaría además las áreas, las etiquetas, los canales y las tareas de
arranque. Para una agencia que monta un proyecto por cliente, esto es la
diferencia entre media hora y un clic — y hace que todos los proyectos se parezcan
lo suficiente como para poder compararlos.

**Buscar y ver lo relacionado.** `global_search` ya cruza organizaciones. Cruzarla
con el grafo cambia el resultado: no una lista de coincidencias, sino *«esto, y
lo que está pegado a esto»*.

---

# PARTE 3 · El orden que yo seguiría

**Primero, lo que no cuesta nada y evita un accidente:** revocar el token de la
captura y tomar la decisión de las dos categorías. Ninguna de las dos es trabajo
de programar y las dos tienen a alguien esperando.

**Luego, vaciar el §1.1.** Nueve funciones hechas sin pantalla es la deuda más
cara que tenemos, porque es valor ya pagado y sin cobrar. En orden: la portada de
la organización, el enlace a Inicio, el contexto de una tarea, y el botón del
código.

**En paralelo, y sin pisarse:** tejer tarea↔mensaje. Es lo único que le falta al
grafo, no necesita pantalla nueva —mejora la que ya se esté montando— y es lo que
hace que «¿por qué se hizo así?» conteste entero.

**Y lo siguiente que yo elegiría para crecer, si hay que elegir una:** el repaso
del viernes. Es la primera vez que el producto **hace algo solo**, usa las cuatro
piezas que lo hacen distinto, y se nota desde el primer viernes sin que nadie
cambie cómo trabaja.

Las grandes —actas de reunión, ventas cruzado con proyecto, el DevVerse con
motivo— valen más, pero ninguna cabe en una semana. Que esperen a que la lista de
§1.1 esté vacía.


---

# PARTE 4 · Cómo se une todo

Hasta aquí, funciones. Esta parte es la otra pregunta: **qué es DevUP cuando las
piezas dejan de ser una lista.**

## 4.1 La tesis, en una frase

Casi toda herramienta de gestión contesta **«¿qué hay que hacer?»**. Muy pocas
contestan **«¿por qué se hizo así?»**, y esa es la pregunta que cuesta dinero:
es la que hace que alguien vuelva a decidir desde cero —a veces al revés— algo
que ya se decidió una vez.

DevUP puede contestar la segunda porque ya tiene las dos cosas que hacen falta y
que no se pueden añadir después: **un registro de hechos** que distingue lo que
hizo una persona de lo que hizo una regla o un agente, y **un grafo** que
relaciona ocho tipos de cosa respetando quién ve qué.

Todo lo demás —el tablero, el panel, el diario, las llamadas, el mundo— son
**vistas** de eso. Esa es la unión.

## 4.2 La regla que mantiene la unión

**Nada guarda su propia historia.** Lo que pasa se anota en `activity`; lo que se
relaciona se teje en `graph_links`. Una función nueva no inventa su tabla de
«recientes» ni su columna de «relacionado con».

Hoy eso ya se cumple casi entero, y **es la razón de que cada cosa nueva salga
barata**: el diario, el contexto, el panorama y los widgets no tuvieron que
guardar nada — son consultas sobre lo que ya estaba. Escrito como regla, lo
siguiente también lo será.

El corolario: **el grafo es un índice, no una fuente**. Se puede borrar entero y
recalcular. Por eso las reglas destejen además de tejer.

## 4.3 Los tres niveles, y uno transversal

La navegación se ordena sola cuando se ve así:

```
PERSONA        /app/inicio        ¿qué tengo, en todo?          ← cruza organizaciones
ORGANIZACIÓN   panorama           ¿cómo va esto y quién está?
ESPACIO        panel · tablero    ¿qué hago yo hoy, aquí?
               devcall · biblioteca

  ───────── transversal, en los tres ─────────
MEMORIA        contexto · diario · grafo · buscar     ¿por qué se hizo así?
```

Las tres primeras son **dónde estoy**. La cuarta no es un sitio: es algo que se
pregunta desde cualquiera de los tres, y por eso no debe ser una entrada de menú
sino un gesto disponible en todas partes — sobre una tarea, sobre un archivo,
sobre un repositorio.

Ahí encaja también el asistente, que hoy está como si fuera un sitio al que se va.

## 4.4 El cuarto actor

Hay tres actores hoy: la persona, la regla y el agente — y el registro ya los
distingue. Lo que falta es que el tercero **haga algo por su cuenta**.

Ese es el salto de producto, y no necesita nada nuevo: el agente ya puede leer el
diario, ver lo atascado y escribir en el tablero marcando lo suyo. Falta el
disparador. El repaso del viernes es el primero, y el más barato de probar: si no
sirve, se apaga y no se ha roto nada.

La raya, que conviene fijar antes y no después: **un agente propone y anota,
nunca decide en silencio**. Todo lo suyo queda marcado como suyo, y por eso se
puede revisar y deshacer. Un agente que escribe sin marca es indistinguible de
una persona, y entonces nadie puede auditar nada.

---

# PARTE 5 · Las decisiones, juntas

Las que hacen falta para que lo de arriba avance. Ninguna es de código.

| | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Una tarea vive en un área o en varias? | **Una.** Retirar `tags.owner_id`; las etiquetas vuelven a cruzar |
| **D2** | ¿El dueño de un área asigna o responde? | **Responde**, y asignar es una casilla aparte y visible |
| **D3** | ¿Se para de añadir API hasta vaciar las nueve sin pantalla? | **Sí**, o fijar un tramo de interfaz solo para eso |
| **D4** | ¿Los canales de voz y texto entran en DevCall? | **Sí** (§1 de `INTERFAZ-EL-FLUJO.md`) |
| **D5** | ¿El DevVerse recibe un motivo o se congela? | **Motivo**: que refleje el trabajo real. Si no, congelarlo sin pena |
| **D6** | ¿Ventas es parte del producto o un módulo aparte? | **Parte**, enlazado al grafo. Medio construido y desconectado es lo peor |
| **D7** | ¿El agente puede escribir solo, o solo a petición? | **Solo**, empezando por el repaso del viernes, siempre marcado |
| **D8** | ¿Las grabaciones se transcriben? | Decisión con implicaciones de privacidad. El consentimiento ya está modelado (0003) |

**Las dos primeras son las urgentes**, porque el riesgo corre mientras no se
tomen. El resto ordenan el trabajo pero no hacen daño esperando.
