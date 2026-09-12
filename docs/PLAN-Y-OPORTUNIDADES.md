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

**Los dos modelos de categoría.** `task_categories` hereda el responsable;
`tags.owner_id` no hereda nada. Se ven iguales en pantalla y se portan distinto.
Quien archive en una etiqueta esperando que caiga en su jefe de rama se encuentra
una tarea sin responsable y nada se lo explica. **Es una decisión de producto, no
de código**, y lleva días pendiente.

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
