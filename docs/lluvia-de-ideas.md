# Lluvia de ideas

Sobre la visión del 27 de agosto. Va después de `vision-y-mvp.md`, que fija el
posicionamiento y el recorte; esto es la parte ancha: qué se podría hacer, con
cuánto cuesta cada cosa marcado al lado.

Notación: **P** pequeño (horas o un día) · **M** mediano (días) · **G** grande
(semanas). ★ = entra en el MVP tal como está recortado.

---

## 1. Lo primero, porque cambia el tamaño de todo lo demás

**El mundo ya está amueblado.** `lib/world/furniture.ts` tiene **55 muebles
dibujados**. Fui a mirar qué había pensando en encontrar mesas y sillas, y está
esto:

| Lo que pide la visión | Lo que ya está dibujado |
|---|---|
| Zona arcade | `arcade`, `pinball`, `poolTable`, `foosball`, `retroTv` |
| Zona DJ | `mixer`, `micStand`, `vinylShelf`, `speaker`, `drums`, `guitar`, `piano`, `acousticPanel` |
| Pizarra dinámica | `whiteboard`, `flipchart`, `corkBoard` |
| Apartamento | `sofa`, `beanbag`, `fridge`, `kitchenette`, `diningTable`, `bookshelf`, `rug`, `lamp`, `curtains`, `aquarium`, `sideboard`, `floorCushion` |
| Gamificación | **`trophyCase`** |
| Infraestructura (S7) | `serverRack`, `projector`, `tv`, `dualMonitor` |

Y el avatar ya es **un catálogo de índices**: cuerpo, pelo, camiseta, pantalón,
sombrero, gafas, barba, cada uno con su tono. No son colores literales
escritos a mano: son entradas de catálogo.

**Las dos consecuencias son grandes.**

La primera: casi nada de la visión pide dibujar un mundo nuevo. Pide **enchufar
el que ya hay**. La pizarra no es «diseñar una pizarra», es que el mueble
`whiteboard` que ya está colgado de la pared abra algo al pulsarlo. Es la misma
historia que ya cuenta el plan A–H sobre S7 y los muebles muertos —la pantalla
de despliegue y el rack— solo que ahora se ve que no eran dos muebles muertos:
eran veinte.

La segunda, y es la que más cambia el presupuesto: **la tienda de ropa es
ownership sobre un catálogo que ya existe.** No hay que modelar ropa. Hay que
añadir una tabla de qué índices tiene desbloqueada cada persona y una
comprobación en el editor de avatar. Eso es P, no G. La recompensa cosmética
—la primera y la que más se ve— es de las cosas más baratas de toda la visión.

---

## 2. El encuentro por cercanía, y por qué tu versión no rompe el cifrado

Preguntabas cómo implementarlo sin romper el extremo a extremo. La respuesta es
mejor de lo que esperaba: **tal como lo has descrito ahora, no hay nada que
romper.**

El problema que señalé en `vision-y-mvp.md` §4.2 era la cámara automática en un
espacio con mucha gente: malla + vídeo + veinte personas no se sostiene, y la
salida habitual —un servidor de medios— es justo lo que rompería el cifrado de
la decisión 0001.

Pero una llamada **individual** es el caso más fácil que existe. Dos personas es
**una sola conexión entre dos navegadores**, cifrada de punta a punta por
definición, sin nada en medio. No hay servidor de medios, no hay decisión que
revisar, no hay compromiso. El menú al acercarse no es un rodeo para esquivar el
problema: **es la arquitectura que este producto ya tiene, usada como toca.**

### Cómo funciona, paso a paso

1. **Acercarse.** Ya existe: `ProximityAudio` calcula la distancia cada
   fotograma para el gradiente de volumen. El menú usa el mismo número.
2. **El menú.** Aparece anclado al otro avatar. Es interfaz pura, sin ninguna
   implicación de medios. **P**
3. **Saludar.** Un evento por el socket que ya reparte presencia; los dos
   avatares hacen la animación. **Cero coste de medios y es lo que más se va a
   usar.** **P** ★
4. **Llamar.** Una invitación por el mismo canal de señalización. Suena, se
   acepta o se rechaza, y caduca sola.
5. **Al aceptar los dos**, se abre una llamada 1:1 aparte de la zona: una
   conexión, cifrada, con vídeo si cada uno quiere. **Que se pueda ser
   asimétrico** —yo te veo y no me ves— no es un caso raro: es la mitad de las
   llamadas reales.
6. **Dentro** ya está todo hecho: pantalla compartida, grabación con
   consentimiento de los dos, y ahora la pizarra.

### El detalle que decide si se siente bien

**Al entrar en una llamada individual, el audio ambiente de la zona se agacha.**
Si no, estás en dos conversaciones a la vez y no se entiende ninguna. Y al
colgar, vuelve. Ese fundido es media tarde y es la diferencia entre «funciona» y
«está bien hecho». **P**

Y una consecuencia narrativa que sale gratis: **los dos avatares se ven en
llamada desde fuera.** Quien pase al lado sabe que están hablando sin oír nada,
que es lo que pasa en una oficina de verdad y lo que ninguna videollamada
consigue.

### La pizarra, y el mismo cifrado

Los trazos van por el **canal de datos de esa misma conexión**. Consecuencia: la
pizarra está cifrada extremo a extremo igual que el audio, y **el servidor nunca
ve lo que se dibuja**. No es un extra: es la única forma coherente con la
decisión 0001. Que la pizarra fuera por el servidor mientras la voz va cifrada
sería una contradicción difícil de explicar.

Y guardar funciona exactamente como la grabación, que ya está resuelta: **uno de
los dos exporta y sube** por los tres pasos del almacén. El servidor recibe un
resultado, no el proceso.

Un detalle que sale bien solo: los trazos son **de solo añadir**, así que dos
personas dibujando a la vez no necesitan resolver conflictos — cada trazo es un
hecho consumado. Es la misma regla que este proyecto ya aplica a las
migraciones.

---

## 3. Ideas, por zona

### 3.1 El encuentro

- ★ **Menú al acercarse: saludar y llamar.** El núcleo. **M**
- ★ **Estados de disponibilidad** — disponible, concentrado, no molestar. En
  «concentrado» el menú ofrece dejar un recado en vez de llamar. **Es lo que
  hace que el espacio no sea una interrupción constante**, que es exactamente
  por lo que la gente abandona las oficinas virtuales. **P**
- **Más gestos**: chocar los cinco, aplaudir, señalar. Uno por rito de calidad
  desbloqueado — así el gesto es también recompensa. **P**
- **Golpear la puerta** de un despacho ocupado en vez de entrar. **P**
- **Corro**: tres o más cerca, y el menú ofrece abrir una llamada de grupo, con
  el tope de la malla como límite duro y dicho en pantalla. **M**
- **Seguir a alguien** hasta donde vaya, para no perseguirlo con las flechas. **P**
- **Recados en el sitio**: dejar una nota pegada al escritorio de quien no está.
  Es asincronía dentro de un espacio síncrono, y es lo que hace que entrar a las
  ocho de la mañana tenga sentido. **M**

### 3.2 La pizarra

- ★ **Pizarra en la llamada 1:1**, por canal de datos, con guardar en la
  biblioteca. **M**
- **La pizarra es el mueble.** Se abre pulsando el `whiteboard` que ya está
  colgado, y **lo dibujado se queda ahí** — quien entre mañana lo ve en la
  pared. Un espacio recorrible donde las cosas persisten en su sitio es la única
  ventaja real que tiene sobre una videollamada. **M**
- **Pegar capturas y trozos de código** en la pizarra. **P**
- **Exportar a la tarea**: la pizarra acaba adjunta a una tarjeta del tablero,
  no perdida en la biblioteca. **P**
- **Plantillas**: retrospectiva, diagrama de arquitectura, embudo. **P**
- **Puntero con el nombre** de quien dibuja. **P**

### 3.3 Repositorios y agentes

- ★ **Añadir un repositorio y trabajarlo dentro.** Hoy el conector de GitHub
  solo *mira* —commits, PRs, issues, estado de CI— y `/dev` arranca un entorno
  embebido en fase 0. Unirlos es la pieza central de la demo. **G**
- ★ **Un agente, un flujo, hasta el final**: abrir un PR desde una tarea, con
  las credenciales de la bóveda. Uno terminado vale más que cinco a medias. **G**
- **Aislamiento por copia de trabajo** (*worktree*): cada agente en su rama, sin
  pisar a nadie. Es la respuesta a «¿qué puede tocar un agente?», que es la
  pregunta abierta de la decisión 0004, y es lo que hace la competencia. **M**
- **El agente propone, la persona aprueba.** El diff se revisa dentro de DevUP
  antes de que nada salga. **M**
- **Presupuesto por organización** para el agente, visible. **P**
- **El agente en el canal**: se le habla como a un compañero y contesta con un
  enlace al PR. Aprovecha la mensajería que ya existe. **M**
- **La CI en rojo abre una tarea sola**, con el registro adjunto. El conector ya
  lee el estado de la última ejecución. **P**
- **Memoria de proyecto**: lo aprendido en una sesión queda para la siguiente.
  Es literalmente «que el contexto no se pierda», y es donde Devin apuesta. **G**

### 3.4 Integraciones guiadas

Lo más diferenciador. La forma corta: *«Estás guardando sesiones a mano. Supabase
te da autenticación, base y almacenamiento. ¿Lo monto?» → sí → pasa detrás.*

- ★ **Una integración guiada de punta a punta**, Supabase. Una sola, terminada:
  detectar, proponer, pedir permiso, crear, guardar en la bóveda, conectar el
  MCP, avisar. **G**
- **Catálogo de fichas** — qué es, qué resuelve, qué cuesta, qué se lleva de tus
  datos. La última columna no la pone nadie y es la que decide. **M**
- **Detección desde el repositorio**: leer el `package.json` y proponer a partir
  de lo que hay. **M**
- **Explicar el 404 de GitHub** — token de alcance fino sin autorizar, u
  organización que los bloquea. Ya está en el plan A–H (B.4) y es el primer
  ejemplo de este patrón. **P** ★
- **Deshacer una integración** sin dejar restos. Nadie prueba nada que no sepa
  desmontar. **M**
- **Obsidian como cliente de esto**, no como funcionalidad aparte: las notas del
  proyecto sincronizadas sin que nadie abra Obsidian. Después. **G**
- **Un mueble por integración conectada** en DevVerse. El rack se llena según
  crece el proyecto. Es vanidad, cuesta P, y de esto va DevVerse.

### 3.5 Gamificación y economía

Dices que es lo que más jugo le da, y estoy de acuerdo — con la advertencia del
§4 sobre en qué se pueden gastar.

- ★ **Monedas por ritos de calidad**, no por volumen. Migración con su política
  y su prueba de aislamiento; PR revisada de fondo; fallo con prueba de
  regresión; CI devuelta a verde. **M**
- ★ **Ropa desbloqueable** sobre el catálogo de avatar que ya existe. **P**
- **Rachas, pero blandas**: se pausan solas en vacaciones. Una racha que castiga
  por descansar es un producto que la gente acaba odiando. **P**
- **Vitrina de trofeos**: el mueble `trophyCase` ya está dibujado. Los trofeos
  son del **equipo** —una semana sin romper la CI, la migración número 25— y se
  ven en la sala común. **M**
- **Portátil propio** con pegatinas ganadas. Es la mejor recompensa de la lista:
  se ve todo el rato, cuesta P sobre el catálogo, y cada pegatina es una
  historia.
- **Temporadas** de tres meses, cada una con su tanda de cosmética. Da un motivo
  para volver sin inflar los números.
- **Recompensas de equipo**: se junta entre todos y se desbloquea una sala. Une
  en vez de comparar, que es lo contrario de una clasificación.
- **Regalar cosmética** a un compañero. Reconocimiento sin economía — ver §4.
- **Un rito nuevo al mes, elegido por el equipo.** La lista de qué se puntúa la
  escribe quien trabaja, no el producto. Es lo que evita que se sienta impuesto.

### 3.6 El apartamento

- **Apartamento personal**, privado por defecto, con el mobiliario que ya está
  dibujado como catálogo de compra. **G**
- **Puerta abierta o cerrada**: quien lo tenga abierto recibe visitas. La visita
  es una llamada 1:1 con el traslado hecho. **M**
- **Un mueble que hace algo**: el escritorio del apartamento abre tu tablero.
  Sin eso, es una casa de muñecas. **M**
- **Foto del apartamento** para compartir fuera. Es la captura que la gente
  enseña, y es publicidad gratis.
- **Estantería que se llena sola** con los proyectos entregados. Que el trabajo
  se convierta en decoración es la idea buena de todo este apartado.
- **Ventana con el estado de la CI**: verde y hace sol, rojo y llueve. Es
  ridículo y funciona.

### 3.7 Arcade

- **Un juego, no cinco.** Uno pulido con marcador de equipo bate a cinco a
  medias, y aquí es más cierto que en ninguna otra parte porque el listón de un
  juego lo pone el móvil de cualquiera. **M** cada uno.
- **Que sea de dos y por turnos**: la gracia no es el juego, es estar con
  alguien mientras se juega. El arcade es una excusa para una llamada.
- **La máquina existe y no hace nada** — `arcade`, `pinball`, `foosball`,
  `poolTable` están dibujados. El día que se enchufe una, la zona pasa a existir.
- **Se paga con monedas.** Cierra el bucle: trabajar da monedas, las monedas dan
  ratos.
- **Marcador en la pared**, junto a la máquina, en la vitrina de trofeos.

### 3.8 Zona DJ

Recordatorio del veredicto: la escucha sincronizada entre servicios distintos no
es posible. La cola sí.

- ★ **Cola agnóstica**: se guarda la canción (ISRC, título, artista), no el
  enlace. Cada uno reproduce en su servicio. **M**
- **El tablero es el mueble**: `vinylShelf` y `mixer` ya están; lo que suena se
  ve en la pared de la zona, no en un widget. **M**
- **Añadir desde cualquier servicio** pegando un enlace; la correspondencia por
  ISRC la resuelve Odesli. **M**
- **Turnos de DJ**: uno pincha, los demás piden. Una cola donde todos empujan a
  la vez no es de nadie.
- **Votar la siguiente.** **P**
- **Historial del año** del equipo. Una recapitulación de diciembre se comparte
  sola.
- **La música baja al entrar en una llamada.** Mismo agachado que el §2, misma
  media tarde. **P**
- **Un mueble que suena distinto**: el tocadiscos del apartamento pone lo tuyo,
  el de la zona pone lo del equipo.

### 3.9 Móvil y aplicación nativa

Quieres las tres: web, nativa y móvil. Merecen respuestas distintas.

- ★ **Móvil, la plataforma.** Canales, tareas, notificaciones, archivos,
  aprobar lo que propone un agente. **No DevVerse.** Ya está en I1 del plan de
  interfaz. **M**
- **Aprobar desde el móvil** es la función móvil que de verdad importa: el
  agente propone, tú vas en el autobús y das el visto bueno. Es corta, es
  frecuente y es exactamente lo que un teléfono hace bien.
- **Nativa: Tauri, y por un motivo concreto.** Envolver la web para tener un
  icono no vale la pena. Lo que **solo** puede hacer una aplicación nativa sí:
  **abrir tus repositorios de verdad en tu disco y ejecutar procesos de verdad**,
  en vez del entorno embebido de `/dev`, que corre dentro del navegador con sus
  límites. Ese es el salto — y es también lo que hace la competencia de
  escritorio. **G**
- **Y hay una razón de arquitectura para que la nativa llegue después y no
  antes:** la separación en dos mundos es justo lo que permite que la
  aplicación nativa cargue la plataforma sin arrastrar un mundo isométrico. Sin
  esa separación, la nativa hereda todo.
- **Notificaciones del sistema** — que la CI en rojo llegue sin tener la pestaña
  abierta. Es la mitad del valor de tener aplicación. **M**
- **Presencia real**: DevVerse sabe que estás porque la aplicación está abierta,
  no porque dejaste una pestaña. **P**

### 3.10 Transversales

- **Paleta de comandos (⌘K)** — ya en el plan de interfaz. Con 17 pantallas es
  lo que hace que la navegación deje de doler. **M**
- **Una línea de tiempo del proyecto**: commits, despliegues, decisiones,
  llamadas y pizarras en un solo hilo. **Es la tesis del producto hecha
  pantalla**: el contexto que hoy se pierde entre ventanas, en orden. Si hubiera
  que elegir una sola pantalla nueva que explique DevUP, es esta. **G**
- **Buscar también en pizarras y grabaciones.** La búsqueda global ya cubre seis
  cosas; estas dos son las que nadie más tiene. **M**
- **Resumen de la llamada** al colgar, con lo acordado y las tareas que salieron.
  Es lo que Gather acabó construyendo, y aquí sale mejor porque las tareas están
  al lado. **M**
- **Modo demo**: una organización de ejemplo con datos, para enseñar sin
  enseñar lo real. Cuando haya que enseñarlo veinte veces, esto se agradece. **M**

---

## 4. La advertencia: monedas por favores

Dijiste que quizá se puedan intercambiar monedas por favores, y que era una
idea sin cerrar. Vale la pena pensarla antes de construirla, porque es la única
pieza de todo lo de arriba que puede salir mal de verdad.

En cuanto una moneda compra **tiempo de otra persona**, deja de ser cosmética y
pasa a ser un sueldo paralelo. Y trae tres cosas que no se ven al diseñarla:

- Quien más monedas tiene es quien más ritos ha hecho, que suele ser quien más
  antigüedad tiene. Los juniors acaban comprando ayuda a los seniors con una
  moneda que ganan más despacio.
- Pedir ayuda pasa a costar. Hoy es gratis y es lo que hace que un equipo
  aprenda.
- Y rompe el guardarraíl que hacía segura toda la gamificación: **la recompensa
  es cosmética**. En cuanto abre puertas, la clasificación importa de verdad, y
  volvemos al problema de puntuar commits pero peor.

**La versión que da lo mismo sin el riesgo:** que se pueda **regalar
reconocimiento** —una moneda, una pegatina, una prenda— por algo concreto y con
el motivo escrito, visible para el equipo. Se gana lo que buscabas (que ayudar
tenga consecuencia) sin crear un mercado.

Y si quieres que existan encargos de verdad: **que los pague la organización, no
las personas.** Una tarea con recompensa puesta por quien la crea, del fondo
común. Es un incentivo, no una deuda entre compañeros.

No es una decisión que tenga que tomarse ya. Sí conviene que se tome a
propósito.

---

## 5. La demo, reordenada

Diste una lista larga: llamadas, cámara, pantalla, grabación, pizarra con
guardado, repositorios trabajables con o sin agente, integraciones guiadas,
música y gamificación.

Vale la pena ver cuánto de eso ya está de pie:

| Pieza | Estado |
|---|---|
| Llamadas, cámara, pantalla compartida | **Hecho** |
| Grabar con consentimiento | **Hecho** |
| Música compartida | **Hecho** (Spotify, con el techo de la cuota) |
| Entorno de desarrollo embebido | **Fase 0**, arranca |
| Repositorios | **Solo lectura** — commits, PRs, issues, CI |
| Menú al acercarse + llamada 1:1 | Falta. **M** |
| Pizarra con guardado | Falta. **M** |
| Trabajar el repositorio de verdad | Falta. **G** |
| Agente, un flujo | Falta. **G** |
| Integración guiada | Falta. **G** |
| Monedas + ropa | Falta. **M + P** |

**Seis de once están hechas.** La lista no es un producto entero por delante:
son **cinco piezas sobre una base construida**, y dos de las cinco son medianas.

Eso cambia mi recomendación anterior. Ya no hace falta elegir *una* cosa para la
demo — hace falta un orden que deje algo enseñable en cada parada:

```
1. Menú al acercarse + saludar + llamada 1:1    ← DevVerse deja de ser decorado
2. Pizarra en la llamada, guardada               ← la reunión deja rastro
3. Monedas + ropa                                ← el bucle se cierra y se ve
4. Repositorio trabajable dentro                 ← la tesis
5. Un agente, un flujo                           ← el hueco del mercado
6. Una integración guiada                        ← lo que nadie más hace
```

Del 1 al 3 son semanas y hacen que DevVerse se sostenga solo. Del 4 al 6 son el
producto. Y entre medias va lo de siempre: el bloque A antes que nada, y el
armazón con móvil antes que las pantallas nuevas.

---

## 6. Lo que haría mañana

Tres cosas pequeñas, en este orden, porque cada una desbloquea la siguiente y
ninguna llega a un día:

1. **Los ocho `confirm()`.** Media tarde, y arregla los ocho momentos en que el
   producto da miedo.
2. **Saludar.** Un evento por el socket que ya existe y una animación. Es la
   pieza más pequeña de toda la visión y la primera vez que DevVerse hace algo
   que una videollamada no puede.
3. **La tabla de desbloqueos del avatar.** Una tabla, su política de
   aislamiento, su caso en `isolation.test.ts`, y el editor comprobándola.
   Cuesta P y abre toda la economía.

Y una decisión que conviene tomar antes de tocar la economía: la del §4.
