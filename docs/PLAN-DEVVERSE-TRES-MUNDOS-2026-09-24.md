# DevVerse: tres mundos, uno por nivel

24 de septiembre de 2026. Plan de mejora del DevVerse —personajes, animaciones y
cómo se plasman en él las funciones de DevUP—, pedido por Juan Medina con una
condición concreta: **que haya tres entornos**, el de la persona, el de la
organización y el del espacio de trabajo.

Todo lo del §1 está comprobado contra el código de hoy, no contra la memoria de
lo que se hizo.

---

## Resumen para quien no vaya a leer el resto

- **Hoy el DevVerse es un solo mundo: la oficina de un espacio de trabajo.** No
  hay nivel de organización ni sitio propio de la persona, aunque el producto ya
  tiene los dos desde la decisión del 20-sep («la organización es un nivel»).
- **Los personajes están bien construidos y quietos.** Caminan, se sientan y
  hacen cuatro gestos, pero de pie y sin moverse no hacen nada: se leen como
  desconectados aunque la persona esté trabajando.
- **Media aplicación no está en el mundo.** Reuniones, anuncios, avisos, el
  marcador, las ramas, los repositorios y los despliegues existen en DevUP y no
  tienen un solo objeto en la oficina.
- **La propuesta:** tres mundos que son los tres niveles —**el cuarto** (tú),
  **el edificio** (la organización) y **la oficina** (el espacio)—, con el mismo
  personaje pasando de uno a otro, y cada función de DevUP en el nivel donde
  tiene su alcance. Seis fases; la primera ya está hecha.
- **La regla que no se toca:** el mundo proyecta lo que existe. Nada vive solo
  en el DevVerse, y cada objeto abre la pantalla de verdad de la vista
  profesional (decisión 0002).

---

## 1. Lo que hay hoy

### 1.1 Los personajes

Se dibujan a mano en canvas (`lib/world/atlas.ts`), con formas y no con sprites.
Fue una decisión: el renderizador se construyó entero sin esperar a un pack de
arte con licencia, y cambiar a sprites es reemplazar el cuerpo de `drawAvatar`
por `drawImage` — ni el renderizador ni la red se enteran.

| Pieza | Variantes | Nota |
|---|---|---|
| Complexión | 3 | cambian ancho de hombros **y** altura: se distinguen de lejos |
| Peinado | 6 | |
| Parte de arriba / de abajo | 5 / 4 | |
| Gorro | 7 | del 4 en adelante, de pago (tienda, 0069) |
| Gafas | 4 | del 3 en adelante, de pago |
| Barba / zapatos | 4 / 3 | |
| Tonos | 16 de piel, 16 de pelo, 16 de ropa | índices, no colores |

- **Cuatro direcciones**, con perfil de verdad: de lado el cuerpo se estrecha y
  la cara cambia de sitio.
- **Atuendo por espacio o por organización** además del personaje base: se
  puede ir de una manera con el equipo y de otra con el cliente.
- **Los índices nunca se reordenan.** Lo que la gente lleva está guardado como
  número; mover el 2 al 3 le cambia el gorro a alguien sin que nadie toque nada.
- **El agente tiene silueta propia** (`drawAgente`) y es lo único que respira.

### 1.2 Las animaciones

| Animación | Cómo | Estado |
|---|---|---|
| Caminar | 4 fases de 130 ms: pie adelante, pie atrás, rebote de 1 px | bien |
| Sentarse | baja 7 px y recoge las piernas | instantáneo, sin transición |
| Gestos | 4 emojis (saludar, sí, aplaudir, mano) que suben 15 px y se apagan | solo con teclas 1-4 |
| Burbuja de texto | lo que se dice en un canal, sobre la cabeza | bien |
| Respirar | ciclo de 4 s | **solo el agente** |
| En reposo | — | **nada**: de pie y quieto, el personaje es una estatua |
| Trabajar | — | **nada**: sentado a un escritorio no teclea |

### 1.3 El mundo

Uno por espacio de trabajo (`/app/w/:id/devverse`). **Cada canal es una sala**,
y el tema de la sala sale del nombre del canal —«música» la amuebla con
instrumentos, «daily» como sala de reuniones— sin guardarse en ninguna parte.
El mobiliario es determinista: dos personas ven la misma taza en la misma mesa.

Lo que ya conecta con DevUP:

| Objeto | Lleva a |
|---|---|
| Pizarra | el tablero, abierto encima del mundo |
| Estantería | la biblioteca (**enlazaba mal hasta hoy**: iba al canal general) |
| Monitor | el canal de esa sala |
| El agente | su panel |
| Sala de voz | la llamada, por cercanía; corrillos sin canal; pizarra compartida |
| En vivo | columnas del tablero, actividad de cada canal, en qué anda el agente |

### 1.4 Lo que existe en DevUP y no en el mundo

Reuniones con hora · anuncios · avisos · el marcador de puntos (la tienda sí
está, en el vestuario) · ramas de trabajo · repositorios y CI · entornos y
despliegues · ventas · **el nivel de la organización entero** · **el sitio de la
persona entero**.

### 1.5 La interfaz

Arriba: cuánta gente hay, en qué sala estás, «Amueblar» y «Mi personaje».
Abajo: la ayuda o la acción disponible.

**Hasta hoy se movía solo con teclado.** Ni un manejador de toque ni de clic:
en un teléfono la oficina era un dibujo. Arreglado en esta misma tanda (§5,
fase A).

---

## 2. La idea: tres mundos, que son los tres niveles

La decisión del 20-sep es que DevUP es un sistema de carpetas —persona →
organización → espacio— y que **la mayoría de las funciones existen en varios
niveles con distinto alcance**: ventas en la organización es el embudo de todos
los proyectos; dentro de un espacio, el de ese proyecto. El DevVerse tiene que
decir lo mismo con sitios.

```
        EL CUARTO                  EL EDIFICIO                 LA OFICINA
        (tú)                       (la organización)           (un espacio)
   ┌──────────────┐          ┌─────────────────────┐      ┌──────────────────┐
   │ lo que tengo │  puerta  │ vestíbulo · tablón  │ as-  │ una sala por     │
   │ mis avisos   │ ───────► │ recepción · marcador│ cen- │ canal · ramas ·  │
   │ mi marcador  │          │ ventas · lo atascado│ sor  │ repos · entornos │
   │ vestuario    │ ◄─────── │ una planta por      │ ───► │ reuniones ·      │
   │ mi agente    │          │ espacio de trabajo  │      │ biblioteca       │
   └──────────────┘          └─────────────────────┘      └──────────────────┘
      privado                   toda la organización          el equipo
```

**El mismo personaje pasa de uno a otro**, con el atuendo que corresponda a
cada sitio (ya existe: base, por organización y por espacio).

### 2.1 El cuarto — el mundo de la persona

Tu sitio, y **privado**: solo entras tú y tu agente. Es la portada de la persona
(`GET /me/inicio`) hecha habitación:

| Objeto | Qué es | De dónde sale |
|---|---|---|
| El escritorio | lo que tienes entre manos, de **todas** tus organizaciones | `/me/inicio` |
| El buzón | la campana: lo que te ha llegado | `/notifications` |
| La estantería de trofeos | tu marcador, con lo ganado a solas en la misma línea | `/organizations/:id/puntos` |
| El armario | el vestuario y la tienda | ya existe |
| El reloj de pared | tus reuniones de hoy, de todos tus espacios | `/workspaces/:id/events` |
| Tu agente | sentado contigo; aquí es tuyo | ya existe |
| Las puertas | una por organización, que lleva a su edificio | `/organizations` |

**No necesita base de datos nueva.** Es un solo jugador: no hay nadie más que
ver, así que no hace falta sala en el socket. Se construye entero en el cliente
con rutas que ya existen.

### 2.2 El edificio — el mundo de la organización

El vestíbulo y las plantas. **Cada espacio de trabajo es una planta**, y se sube
por el ascensor a su oficina.

| Sitio | Qué es | De dónde sale |
|---|---|---|
| El tablón del vestíbulo | los anuncios; se ilumina cuando hay uno nuevo | `/organizations/:id/announcements` |
| La recepción | quién está en la organización; invitar desde aquí | `/organizations/:id/members` |
| El panel de la entrada | lo **atascado** y lo que **no tiene dueño**, de todos los proyectos | `/organizations/:id/panorama` |
| El marcador | el de toda la organización | `/organizations/:id/puntos` |
| La sala de ventas | el embudo, por etapas | `/organizations/:id/pipeline` |
| El ascensor | una planta por espacio, con cuánta gente hay en cada una | `/organizations/:id/workspaces` + presencia |

**Aquí sí hace falta base y servidor** (fase E): una sala por organización, y
presencia agregada —cuánta gente hay en cada planta— sin mandar la posición de
todo el mundo a todo el mundo.

### 2.3 La oficina — el mundo del espacio

La que existe, completada con lo que falta:

| Objeto nuevo | Qué es | Regla |
|---|---|---|
| Mesas por rama | en la sala de trabajo, un grupo de mesas por rama con su letrero y su gerente | **no son zonas**: una zona es la proyección de un canal y nunca existe sin él |
| La pantalla de repositorios | PRs abiertos y el último CI; roja si el CI falla | `/workspaces/:id/github/repos` |
| El semáforo de entornos | un rack con una luz por entorno: verde, ámbar desplegando, rojo | `/workspaces/:id/environments` |
| El reloj de la sala de reuniones | la próxima reunión; la puerta se abre cuando empieza | `/workspaces/:id/events` |

---

## 3. Personajes: que parezca que hay alguien dentro

Por orden de lo que cambia para quien mira:

1. **Reposo.** Un parpadeo cada pocos segundos y la respiración de 1 px que ya
   tiene el agente. El momento de cada persona sale de su identificador —nada
   de `Math.random`—, así que dos navegadores ven parpadear a la misma persona a
   la vez y veinte personas no parpadean en sincronía.
2. **La presencia, en el cuerpo.** Hoy es un punto de color en una lista.
   Ocupada: auriculares. No molestar: una luz roja sobre la cabeza. Así se ve de
   lejos a quién no interrumpir, que es para lo que existe el estado.
3. **Trabajar.** Sentada a un escritorio de una sala de trabajo, la persona
   teclea (dos fotogramas de brazos). Es la diferencia entre una oficina con
   gente y una sala de espera.
4. **Sentarse y levantarse con transición**: dos fotogramas en vez de un salto.
5. **Gestos con el dedo**: un botón con los cuatro, para quien no tiene las
   teclas 1-4.

**Sprites o formas.** Se sigue con formas hasta que se decida el tamaño del
sprite y cuántos cuerpos base (decisión abierta desde el 13-sep). Cuando se
decida, lo que se entrega a quien dibuje es una hoja por pieza de **32 × 44 px**,
con **4 direcciones × (reposo 2 · caminar 4 · sentado 1 · teclear 2)**, y el
contrato de los índices intacto. `atlas.ts` es el único archivo que cambia.

---

## 4. Animaciones que dicen algo

**Una animación es una señal, no un adorno.** Cada una de esta tabla contesta a
algo que ya pasó en DevUP; ninguna existe por sí misma.

| Cuando en DevUP… | En el mundo… | Dónde |
|---|---|---|
| cierras una tarea | «+10» sube sobre tu personaje, y un destello | los tres |
| te asignan una tarea | un sobre cae en tu buzón; en la oficina, una campanita sobre la cabeza | cuarto, oficina |
| se publica un anuncio | el tablón del vestíbulo se ilumina; quien lo publicó saluda | edificio |
| empieza una reunión | la sala enciende la luz y abre la puerta | oficina |
| un despliegue sale bien / mal | la luz del rack pasa a verde / parpadea en rojo | oficina |
| el CI se pone rojo | la pantalla de repositorios se tiñe de rojo | oficina |
| se escribe en un canal | una burbuja breve sobre el monitor de esa sala | oficina |
| alguien entra en una llamada | ondas en la sala de voz (ya existe, con el halo) | oficina |

Tres reglas para que esto no se convierta en ruido:

- **Una sola cosa parpadeando a la vez** en pantalla. Si hay dos, gana la más
  reciente y la otra se queda encendida sin parpadear.
- **`prefers-reduced-motion`** apaga todo lo que se mueve sin que lo pida quien
  mira: se cambia de color, no se anima.
- **Nada se anima dos veces por lo mismo.** El «+10» sale al cerrar, no cada vez
  que se vuelve a entrar en la oficina.

---

## 5. Fases

| Fase | Qué | Quién | Base de datos | Tamaño |
|---|---|---|---|---|
| **A** ✅ | Tocar el suelo para caminar, botón de acción, hablar con el dedo, ayuda en el móvil, enlace de la biblioteca | hecho hoy | no | — |
| **B** | Personajes vivos: reposo, presencia en el cuerpo, teclear, transiciones, gestos con el dedo, «+10» al cerrar | Juan Medina | no | ~1 semana |
| **C** | La oficina completa: mesas por rama, pantalla de repositorios, semáforo de entornos, reloj de reuniones. Ampliar `/world/live` con esos datos | Juan Medina (mundo) · Juan Bonilla (`/world/live`) | no | 1–2 semanas |
| **D** | El cuarto de la persona: ruta propia, un solo jugador, construido con `/me/inicio` y lo que ya existe | Juan Medina | no | ~1 semana |
| **E** | El edificio de la organización: sala por organización, presencia agregada por planta, vestíbulo, ascensor | Juan Bonilla (base, socket) · Juan Medina (mundo) | **sí**: migración, RLS y su caso en `isolation.test.ts` | 2–3 semanas |
| **F** | El arte: sprites, cuando se decida el tamaño | quien dibuje, de fuera · Juan Medina | no | depende |

**EL DEVVERSE SE QUEDÓ SIN DUEÑO EL 19-SEP.** Lo llevaba Carlos Cáceres, que
dejó el equipo ese día, y el reparto es ahora entre dos. Por eso casi todo el
mundo cae en Juan Medina y la base y el servidor en Juan Bonilla — y por eso el
orden importa más que si fueran tres: **B y D primero**, que no tocan la base ni
dependen de nadie.

**B, C y D no dependen entre sí** y se pueden hacer a la vez. **E es la única
con base de datos y la más cara**, y por eso va detrás: para cuando llegue, el
cuarto y la oficina ya habrán dicho si la idea de tres mundos se sostiene.

---

## 6. Cómo encaja con el plan del MVP

El plan de UX del 20-sep (`PLAN-UX-MVP-2026-09-20.md`) dice en su §5 «**Tocar
DevVerse**: sale del menú por defecto y se queda como está». Conviene decirlo en
vez de pasarlo por alto:

- Es una **recomendación de lo que no hacer ahora**, no una decisión: la de
  sacar DevVerse del menú por defecto sigue abierta (y vencida, tarea
  `0a96538f`).
- Su propio punto 11 pide **recorrer el DevVerse en un teléfono**, y eso es
  exactamente lo que no se podía y la fase A arregla.
- **Nada de este plan cambia el menú.** Si el DevVerse sale del menú por
  defecto, sale con estos tres mundos detrás del mismo interruptor
  (`capacidades`) y nadie que no lo abra se entera.

---

## 7. Lo que hay que decidir

1. **El tamaño del sprite y cuántos cuerpos base.** Bloquea la fase F. Abierta
   desde el 13-sep.
2. **Si el cuarto es privado de verdad o visitable.** La propuesta es privado:
   es donde está lo tuyo, incluida la campana. Visitable por invitación se puede
   añadir después; quitar visitas cuando ya se hacen, no.
3. **Si la sala de ventas va en el edificio** mientras Ventas salga del menú del
   MVP. Si sale, en el edificio queda una puerta cerrada con el mismo
   interruptor.
4. **Si el DevVerse está en el MVP.** Este plan no lo necesita resuelto: todo va
   detrás del interruptor.

---

## 8. Lo que no se hace, y por qué

- **Nada que solo exista en el mundo.** Ni misiones, ni objetos que no abran una
  pantalla de verdad, ni datos que no estén en la vista profesional. Es la regla
  de la decisión 0002 y es lo que impide que acaben siendo dos productos.
- **Nada de juego por el juego**: niveles, experiencia, puntos por caminar. Los
  puntos se ganan cerrando trabajo (0055) y no hay otra manera; inventarse otra
  es inventarse una economía que nadie calibró.
- **Nada en 3D.** La perspectiva ¾ sobre rejilla cenital ya da la profundidad
  que hace falta, sin dibujar cada mueble en cuatro orientaciones.
- **No se enseña dónde está cada persona a toda la organización.** En el
  edificio se ve cuánta gente hay en cada planta, no por dónde camina cada una:
  la posición exacta es del equipo del espacio, no de la empresa entera.
