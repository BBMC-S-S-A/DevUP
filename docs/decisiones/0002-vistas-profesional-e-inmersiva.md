# 0002 · Dos vistas: profesional e inmersiva

**Estado:** propuesto — pendiente de visto bueno · **Fecha:** agosto de 2026 ·
**Decide sobre:** si DevUP incorpora una vista inmersiva opcional, tipo oficina
virtual con avatares, junto a la interfaz actual

---

## Resumen para quien no vaya a leer el resto

**Es viable, y hay un motivo técnico real —no estético— para hacerlo: la
proximidad arregla el límite de 6 personas de la malla WebRTC en vez de
empeorarlo.** Ese es el hallazgo de este análisis y está en §4.

Tres condiciones sin las cuales sale mal:

1. **El mundo es una proyección, nunca una fuente de verdad** (§5). Si un dato
   existe solo dentro del mundo, la promesa de «es opcional» ya está rota.
2. **No se construye antes de las dos semanas de uso real** que hoy son el
   siguiente paso del proyecto. El plan de 12 semanas dice que el hito que
   decide todo es la semana 6, y esto no acerca a ese hito.
3. **Se entra por una semilla de una semana, no por la visión completa.** La
   visión completa cuesta ~125 puntos: la mitad de lo que queda de hoja de ruta.

La recomendación concreta está en §8: construir la **Fase 0** (~16 puntos, una
persona, una semana), usarla durante el despliegue real, y decidir la Fase 1
con datos en vez de con intuición.

---

## 1. Qué se propone exactamente

Dos formas de habitar el mismo producto, con los mismos datos debajo:

| | **Vista profesional** | **Vista inmersiva** |
|---|---|---|
| Qué es | Lo que existe hoy: barra lateral, canales, biblioteca, tablero | Un espacio 2D donde tu avatar camina por la oficina del equipo |
| Para quién | Trabajo enfocado, cliente enterprise, sesión larga | Presencia ambiental, conversación espontánea, equipo remoto |
| Entrar a un canal de voz | Clic en el canal | Caminar hasta la zona de desarrollo |
| Ver quién está | Lista de participantes | Ves a la gente, dónde está y con quién habla |
| Obligatoria | Sí | **No. Nunca.** |

La vista inmersiva añade avatar personalizable, zonas temáticas (desarrollo,
música, entretenimiento, reuniones) y, más adelante, la posibilidad de que cada
equipo componga su propia oficina.

**La vista profesional no hay que construirla: ya está.** La interfaz actual es
minimalista, oscura y sobria. Lo que falta ahí es el conmutador entre vistas y
que la preferencia se recuerde. Eso es barato y conviene decirlo porque cambia
el cálculo: el coste de esta propuesta es el mundo, no las dos vistas.

---

## 2. Lo primero que hay que descartar: ¿choca con la regla permanente?

La regla permanente de producto (`CONTEXTO-COMPLETO.md` §2) dice:

> Si una funcionalidad exige que DevUP mantenga un proceso corriendo, un puerto
> abierto o un disco montado **en nombre del cliente**, está fuera de alcance
> por definición.

Un mundo multijugador exige exactamente un proceso corriendo con un puerto
abierto. La pregunta es legítima y hay que contestarla antes que nada.

**No choca.** La regla habla de infraestructura *del cliente* —su base de datos,
su cómputo, su servicio en producción—. El plano de control de DevUP es nuestro
y lo operamos nosotros; el propio documento lo aclara: «no hay contradicción en
que DevUP tenga servidores; la habría en que alojara la base productiva de un
cliente». El hub de presencia y señalización de voz ya es ese mismo tipo de
proceso, y nadie considera que la sala de voz esté fuera de alcance.

Lo que sí cambia es **el perfil de coste de ese proceso**, y eso es real:

| | Socket de voz (hoy) | Socket de mundo (propuesto) |
|---|---|---|
| Cuándo existe | Solo durante una llamada | Todo el día, mientras la pestaña esté abierta |
| Cuántos por persona | 0 casi siempre | 1 constante |
| Tráfico | Un puñado de SDP al entrar | Posiciones a ~10 Hz |

Es decir: la línea base de memoria y CPU de la API deja de ser «casi cero
cuando nadie llama» y pasa a ser proporcional a la gente conectada. A la escala
de un equipo (5–30 personas) esto es irrelevante para Node. A la escala de
varios clientes en la misma instancia, no.

Y hay una consecuencia de calendario: §5.3 dice que la presencia vive en el
proceso y que Redis es el punto 3 de la lista de pendientes, «el día que haya
más de una instancia de API». **La vista inmersiva no adelanta esa fecha, pero
sí sube el precio de equivocarse:** que dos personas en llamada no se vean
porque cayeron en instancias distintas es un fallo raro y visible; que dos
personas *en la misma oficina virtual* no se vean es el fallo que hace que la
funcionalidad entera parezca rota.

---

## 3. Por qué la idea es buena, dicho sin adornos

**Resuelve un problema que el producto ya tiene identificado.** La visión de
producto nombra el problema como «contexto que se pierde» y «el equipo se
convierte en el integrador humano del stack». La presencia ambiental ataca una
variante concreta de eso: en un equipo remoto, la conversación que no se agenda
no ocurre. Gather construyó una empresa sobre esa observación.

**El mercado inicial declarado encaja.** La estrategia (fase 1) apunta a
«equipos de producto y startups con stacks modernos». Ese público adopta esto.
El público enterprise de la fase 4 no, y por eso §6 exige que se pueda apagar a
nivel de organización.

**Es un diferenciador que se ve en una captura.** Conviene decirlo con
franqueza en vez de disfrazarlo de argumento técnico: parte del valor es que se
comparte solo. DevUP compite contra herramientas con años de ventaja en
funcionalidad; no compite contra ninguna que tenga esto.

**Y ninguna de esas tres razones justifica construirlo ahora.** Ver §7.

---

## 4. El hallazgo técnico: proximidad y malla se refuerzan

Este es el argumento fuerte a favor, y no es de producto sino de arquitectura.

§5.2 fija el límite honesto de la iteración actual:

> Por encima de ~6 participantes la malla se cae de bruces — cada cliente sube
> su audio N−1 veces.

Un mundo virtual sugiere lo contrario de lo que necesita ese límite: una
oficina con 20 personas dentro. Si todos se conectan con todos, la malla muere
y aparece la presión para meter un SFU — que es justo lo que la regla
permanente prohíbe y lo que rompería el cifrado extremo a extremo decidido en
`0001-cifrado-de-salas.md`.

**Pero el audio por proximidad no conecta a todos con todos. Conecta a cada
persona solo con quien tiene cerca.** Y «cerca» en una oficina virtual son 3 o
5 personas, no 20.

La proximidad le da a la malla lo que hoy no tiene: **un criterio con sentido
para no abrir la conexión número siete**. Hoy, si entran ocho personas a un
canal de voz, el sistema tiene que aguantarlas o negarse, y ambas opciones son
malas. Con proximidad, ocho personas en la misma oficina son ocho personas
repartidas en dos o tres corrillos, y cada cliente sostiene cuatro conexiones.
El límite deja de ser un techo arbitrario y pasa a ser una propiedad natural
del espacio.

Dicho de otro modo: **la vista inmersiva es la única funcionalidad propuesta
hasta ahora que aleja al proyecto de necesitar un SFU en vez de acercarlo.**

Además, la parte cara ya está construida. Cada par remoto llega hoy en su
propio `MediaStream` y se asigna a un elemento `<audio>` propio
(`ParticipantTile.tsx`). El volumen por distancia es literalmente
`element.volume = f(distancia)`. No hace falta WebAudio, ni mezclador, ni tocar
la señalización.

**El detalle que hay que hacer bien o esto se siente roto.** Abrir y cerrar
`RTCPeerConnection` según la gente camina provoca rotación de conexiones: cada
conexión nueva gasta 1–3 segundos en reunir candidatos ICE. Sin cuidado, pasar
al lado de alguien significa oírlo tres segundos después de haberlo cruzado.
La salida es la misma que ya se usó para el indicador de quién habla:
**histéresis**, con dos radios distintos.

- **Radio de conexión** (amplio): se abre la conexión, pero con volumen 0.
- **Radio audible** (estrecho): se sube el volumen. Sin conexión nueva, es
  instantáneo.
- **Radio de desconexión** (más amplio que el de conexión) **con retardo**: se
  cierra solo si la persona sigue lejos pasados unos segundos.

Con eso, la conexión se prepara antes de hacer falta y el audio entra sin
latencia. Es el mismo patrón que §5.2 ya documenta para el umbral de voz: un
solo umbral hace parpadear; dos, no.

---

## 5. La regla que decide si esto sale bien o mal

> **El mundo es una proyección de lo que ya existe, nunca una fuente de verdad.**
>
> Toda zona corresponde a un canal o un workspace que ya existe y que se puede
> usar entero desde la vista profesional. Lo único que puede vivir solo dentro
> del mundo es la decoración: dónde está puesta una planta y de qué color es tu
> camiseta.

Parece una restricción de diseño y es en realidad **la condición que sostiene
la promesa de que la vista inmersiva es opcional**.

El fallo del que hay que protegerse es concreto y ocurre solo. Alguien crea
«la sala de música» dentro del mundo porque es más cómodo que crear un canal.
Se conversa ahí. A la semana siguiente, quien usa la vista profesional no
encuentra esa conversación, porque esa sala no es un canal y no aparece en
ninguna barra lateral. En ese momento la vista inmersiva ha dejado de ser
opcional: se ha vuelto obligatoria para no perderse cosas, y el producto se ha
partido en dos que hay que mantener por separado.

De la regla salen consecuencias operativas que conviene escribir ahora:

- Crear una zona **crea el canal correspondiente**, con su fila, su RLS y su
  visibilidad. No hay zonas sin canal.
- Entrar a una zona de voz es **exactamente** entrar a ese canal de voz: mismo
  `join_call`, mismo historial, mismas grabaciones con consentimiento.
- Una zona que proyecta un canal privado **no se dibuja** para quien no tiene
  acceso. No se dibuja en gris, no se dibuja bloqueada: no existe en el mapa
  que recibe ese cliente.
- Una funcionalidad nueva se diseña **primero** para la vista profesional. Su
  representación en el mundo se añade después si es barata, y si no es barata,
  no se añade.

Ese último punto es el que evita el impuesto permanente de mantener dos
interfaces. Sin él, cada funcionalidad futura del producto cuesta el doble para
siempre, y ese es el motivo por el que los productos con dos vistas suelen
acabar abandonando una.

---

## 6. Seguridad, y la trampa que este proyecto ya conoce

`CONTINUAR-AQUI.md` avisa de un fallo que ya se cometió una vez:

> Un workspace personal no se protege con una columna. `can_access_channel` y
> la política de `files` miraban la organización, no el workspace.

**El mundo es exactamente la misma trampa con otra ropa.** El mapa que se envía
al cliente es una lista de zonas, y cada zona lleva el identificador del canal
que proyecta. Si ese mapa se compone mirando el workspace en vez de preguntando
por cada canal, el cliente recibe los nombres —y los identificadores— de los
canales privados a los que no pertenece. No podría leer sus mensajes, porque
RLS lo pararía; pero sabría que existen, cómo se llaman y quién está dentro.
Eso ya es una fuga.

Las reglas, entonces:

- **El mapa se filtra por `can_access_channel`, zona por zona**, en la API, al
  componerlo. Nunca se envía el mapa completo y se oculta en el cliente.
- **Moverse a una zona se valida en el servidor.** La posición es
  cliente-autoritativa —a nadie le importa que alguien haga trampas caminando—,
  pero *entrar a la zona que abre un canal de voz* no lo es.
- **Toda tabla nueva con `organization_id` necesita su política y su caso en
  `apps/api/src/db/isolation.test.ts`.** Son 3 tablas nuevas en la Fase 1. No
  es negociable; es el único freno automático contra una fuga entre clientes.
- **La organización puede apagar la vista inmersiva entera.** Un cliente
  enterprise en evaluación no debería descubrir que su plano de control tiene
  avatares. Un interruptor a nivel de organización, por defecto encendido en
  planes Free/Pro y apagado en Enterprise.

---

## 7. Lo que cuesta de verdad

En la unidad del plan: 1 punto ≈ 3 horas efectivas, 22 puntos por semana con
dos personas.

### Fase 1 — Presencia ambiental

| Trabajo | Puntos |
|---|---:|
| Endpoint `/ws/world`, `worldHub` y difusión por tick agrupada | 5 |
| Renderizador: tiles, sprites, orden por Y, cámara | 8 |
| Movimiento, interpolación y colisiones | 5 |
| Avatar personalizable (capas: piel, pelo, ropa) | 8 |
| Persistencia del avatar: migración, RLS y pruebas de aislamiento | 3 |
| Zonas ↔ canales, filtrado del mapa y validación al entrar | 5 |
| Audio por proximidad con volumen por distancia | 5 |
| Reparto de la malla por radio, con histéresis y pre-conexión | 8 |
| Conmutador de vista y preferencia persistida | 3 |
| Integración del pack de arte y una oficina diseñada | 5 |
| **Total** | **55** |

**55 puntos son dos semanas y media de equipo completo.** Para situarlo: es
aproximadamente lo que cuestan juntas la semana 4 (servicios, clientes y embudo
de ventas) y la semana 5 (objetivos y seguimiento), que son la capa de control
de ventas entera — la segunda de las tres promesas del producto.

### Fases posteriores

| Fase | Qué añade | Puntos |
|---|---|---:|
| 2 | Editor de zonas y mobiliario: colocar, rotar, guardar, permisos de quién edita | ~40 |
| 3 | Inventario, cosméticos, desbloqueos, invitados externos al espacio | ~30 |

**Visión completa ≈ 125 puntos ≈ 5,7 semanas de equipo completo.** Casi la
mitad de lo que queda de la hoja de ruta de 12 semanas, que hoy va por la
semana 3 y está al 97 % de ocupación sin colchón.

Ese número no es un argumento en contra de la idea. Es el argumento a favor de
entrar por una semilla y no por la visión.

### El coste que no está en la tabla: el arte

Es el que hunde los proyectos de este tipo, porque no es de ingeniería.

Habbo tiene veinte años de dibujo isométrico detrás. DevUP tiene cero sprites y
copiar los de Habbo no es una opción —son obra protegida, y además un clon
evidente contradice el posicionamiento serio del documento de visión—.

Tres salidas:

| Salida | Coste | Riesgo |
|---|---|---|
| Pack con licencia comercial (estilo LimeZu «Modern Interiors», o CC0 tipo Kenney) | 30–80 € | Aspecto compartido con otros productos; hay que leer la licencia antes, no después |
| Encargo a ilustrador | 1 500–5 000 € | Plazos fuera de nuestro control; identidad propia |
| Generado o procedural | Bajo | Incoherencia visual; es lo que hace que un producto parezca barato |

Para la semilla, **pack con licencia**. La identidad propia se plantea si la
funcionalidad demuestra que la merece.

---

## 8. Plan: entrar por una semilla

### Fase 0 — La semilla (~16 puntos, una persona, una semana)

Lo mínimo que prueba la idea de verdad y que se puede tirar sin dolor:

| Trabajo | Puntos |
|---|---:|
| `/ws/world` + `worldHub` + difusión por tick | 4 |
| Renderizador mínimo y movimiento (una oficina fija, sin editor) | 5 |
| Avatares asignados, sin personalización | 2 |
| Zonas ↔ canales: caminar a una zona abre ese canal | 3 |
| Conmutador de vista con preferencia | 2 |
| **Total** | **16** |

Sin personalización de avatar, sin editor, sin proximidad de audio, sin
inventario. **Con** presencia real: ves quién está conectado y dónde.

El criterio de éxito no es que funcione —funcionará—. Es: **durante las dos
semanas de uso real, ¿el equipo la deja abierta?** Si al cuarto día todos están
en la vista profesional, la respuesta llegó por 16 puntos en vez de por 125.

### Cuándo

**Después del despliegue, no antes.** Hoy el siguiente paso del proyecto es
desplegarlo y usarlo dos semanas, y todo lo que lo bloqueaba está resuelto. El
plan es explícito sobre lo que está en juego:

> El hito que decide todo es el final de la semana 6. Si el propio equipo no
> quiere abandonar sus herramientas actuales para usar DevUP, ningún cliente lo
> hará tampoco.

Una oficina virtual no acerca a ese hito. Y el propio documento de visión nombra
el riesgo número uno de esta categoría de producto: «alcance excesivo:
priorizar un wedge claro y probarlo con usuarios».

La secuencia que propongo aprovecha eso en vez de pelearse con ello: la semilla
se construye **durante** las dos semanas de uso real y se usa **dentro** de
ellas. Es el único momento en que se puede medir si engancha con gente que está
usando el producto en serio, y no cuesta ninguna semana de la hoja de ruta.

---

## 9. Decisiones técnicas propuestas

| Decisión | Propuesta | Por qué |
|---|---|---|
| **Perspectiva** | **Cenital sobre rejilla**, no isométrico | El isométrico de Habbo obliga a ordenar profundidad con planos de pared y suelo, y a dibujar cada mueble en cuatro orientaciones. La rejilla cenital ordena por Y y punto. Es lo que hace Gather, y es la referencia de la segunda imagen aportada |
| **Motor** | **Canvas 2D, sin motor** | Para una sala de 30×20 con 20 avatares, Canvas 2D va a 60 fps sin esfuerzo. El proyecto no tiene ORM ni framework de tiempo real; añadir Phaser (~1 MB) contradice esa disciplina. Aislado tras una interfaz, cambiar a PixiJS sería un archivo |
| **Red** | Intención a ~10 Hz, no posición a 60 Hz; difusión **agrupada por tick** | Un mensaje por jugador y por movimiento es N² mensajes. Un mensaje por tick con todos los que se movieron es N. Es la diferencia entre 4 000 y 10 mensajes por segundo con 20 personas |
| **Autoridad** | Cliente para la posición, servidor para el acceso a zonas | Hacer trampas caminando no le importa a nadie; entrar a un canal privado sí. Coincide con la filosofía del hub: «el servidor es un cartero» |
| **Persistencia** | Avatar y mapa en Postgres. **La posición no se guarda** | Es estado en vivo: se limpia solo cuando cae el socket. §5.2 ya lo decidió para las llamadas y el motivo es idéntico |
| **Hub** | Un `worldHub` nuevo junto a los cuatro existentes | Misma forma que `voiceHub`, `fileHub`, `channelHub` y `userHub`. Cuando llegue Redis, se respalda con ellos y en el mismo archivo |

---

## 10. Riesgos, y qué se hace con cada uno

| Riesgo | Respuesta |
|---|---|
| **El producto se parte en dos y toda funcionalidad futura cuesta el doble** | La regla de §5: el mundo proyecta, no origina. Diseño primero en la vista profesional |
| **Choque con el posicionamiento enterprise del documento de visión** | Interruptor por organización; apagado por defecto en Enterprise |
| **Se come la hoja de ruta** | Semilla de 16 puntos con criterio de éxito escrito antes de empezar. La Fase 1 no se aprueba sin datos de la semilla |
| **Rotación de conexiones WebRTC al caminar** | Histéresis de tres radios y pre-conexión silenciosa (§4) |
| **Fuga de canales privados por el mapa** | Filtrado por `can_access_channel` en la API, zona por zona (§6) |
| **La presencia en memoria no aguanta dos instancias** | Ya es una limitación conocida (§5.3). La semilla no la empeora; la Fase 1 la convierte en prerrequisito de escalar |
| **Nadie la usa** | Es un resultado válido y barato. Por eso la semilla es de una semana |
| **Licencia del arte** | Pack con licencia comercial revisada antes de integrarlo, no después |

---

## 11. Lo que se descarta, y por qué

**Isométrico tipo Habbo.** Descartado por coste, no por gusto: multiplica el
trabajo de dibujo y de ordenación de profundidad, y no aporta nada que la
rejilla cenital no dé. Si más adelante hay presupuesto de arte propio, se
reabre.

**Un motor de juego (Phaser, Excalibur).** Descartado por peso y por
coherencia: este proyecto escribe su propio tiempo real y su propio acceso a
datos precisamente para no atarse. Canvas 2D no tiene ese problema.

**Servidor autoritativo con reconciliación.** Descartado por innecesario. Es
maquinaria contra tramposos, y aquí no hay ventaja que ganar haciendo trampas.

**Estado propio del mundo (salas que no son canales, chat de zona que no es un
canal de texto).** Descartado por la regla de §5. Es el atajo que rompe la
promesa de opcionalidad.

**Vídeo por proximidad al estilo Gather.** Descartado para la Fase 1. Multiplica
el ancho de banda de la malla justo donde §5.2 avisa que se rompe. El audio por
proximidad es barato; el vídeo no.

**VR, Meta, WebXR.** Fuera de alcance y no se pidió. La palabra «metaverso»
carga un coste de credibilidad que este producto no necesita pagar; esto es una
oficina 2D, y llamarla por su nombre la vende mejor.

---

## 12. Preguntas abiertas

1. ¿Se acepta la secuencia —semilla durante las dos semanas de uso real, Fase 1
   solo con datos— o se prefiere abordar la Fase 1 completa ya?
2. ¿Cenital sobre rejilla, o isométrico pese al coste?
3. ¿Se acepta la regla de §5 —el mundo proyecta, no origina— como permanente?
   Es la que hay que aceptar antes de escribir código, porque relajarla después
   es rehacerlo.
4. ¿Pack con licencia para la semilla, o se encarga arte propio desde el
   principio?
5. ¿Va bien el interruptor por organización, apagado por defecto en Enterprise?
