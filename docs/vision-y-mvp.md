# Visión, posicionamiento y el MVP

Qué es DevUP cuando esté terminado, contra quién no compite, y qué trozo de eso
es el MVP. Escrito el 27 de agosto de 2026 a partir de la visión dictada, del
código de hoy y de un vistazo al mercado.

Va después de `plan-interfaz.md` y no lo sustituye: aquel dice cómo se construye,
este dice qué.

---

## 1. Decisiones tomadas

Cierran cuatro de las cinco preguntas del §7 de `plan-interfaz.md`.

1. **Móvil: sí.** Deja de ser una pregunta. Entra en el plan de interfaz.
2. **`/app` es el hogar del producto**, y la plataforma y DevVerse se separan en
   dos mundos con puerta entre ellos, no en dos pestañas de lo mismo.
3. **El posicionamiento es aliado, no competidor.** GitHub, Supabase, Vercel y
   los gestores de proyectos son el sustrato sobre el que corre DevUP, no la
   plaza que se le disputa.
4. **El objetivo es un MVP** — pero uno donde lo que entre esté terminado, no una
   maqueta ancha de cosas a medias.

---

## 2. El posicionamiento, en una frase

> **No somos un gestor de proyectos. Somos el gestor del *desarrollo* del
> proyecto.**

Merece la pena desarrollar por qué esa frase es defendible y no un juego de
palabras.

Un gestor de proyectos —Jira, Linear, Asana— gestiona **la representación** del
trabajo: tarjetas que alguien mueve a mano y que describen algo que está pasando
en otro sitio. La tarjeta y el código no se tocan nunca; los une una persona
acordándose de arrastrarla.

Lo que la visión describe es lo contrario: el sitio donde el trabajo **ocurre**
—el repositorio, la base de datos, el despliegue, el agente, la conversación— y
donde el estado se deduce de lo que pasó, no de lo que alguien anotó.

Eso deja el enemigo bien identificado, y no es una empresa: **es la pérdida de
contexto entre ventanas.** El dato de mercado lo respalda —un índice de 2026
cifra en más del 40 % de la semana productiva lo que se va en saltar entre
sistemas desconectados— y encaja con lo que ya dijiste: unificar las ventanas en
un núcleo para no perder tiempo ni contexto.

Y explica de paso por qué la estrategia es ser aliado. Si el enemigo es la
dispersión, entonces cada integración es una victoria y cada plataforma
integrada es un aliado, no un rival. Competir con Supabase sería justo el
movimiento que estropea la tesis.

---

## 3. Qué hay ahí fuera, y qué robar

El research que pediste. Tres frentes, y la conclusión no es la misma en los
tres.

### 3.1 Oficinas virtuales — la categoría existe y no ha ido bien

Gather, Kumospace, SoWork, Roam, Branch, Virbela. Ninguna ha cerrado, pero
**Gather —el referente— se escindió en febrero de 2026 como pyme sin capital
riesgo, y su equipo de IA se fue a Figma.** Kumospace arrastra quejas de audio
que se rompe por encima de quince personas. La literatura recurrente habla de
fatiga de avatar y de gente que no quiere estar representada por un muñeco.

**La lectura, que es incómoda pero conviene tenerla:** el espacio recorrible por
sí solo no sostuvo un negocio para nadie. Cinco años y decenas de millones
después, la categoría es un buen producto pequeño.

**Y por qué eso no mata DevVerse, sino que lo coloca:** todas esas fracasaron
como *sustituto de la oficina* — su promesa era «vente aquí a estar». DevVerse
no tiene por qué prometer eso. Puede ser **la recompensa y la cara social de un
producto de trabajo que ya funciona sin él**, que es exactamente lo que la
gamificación con puntos, ropa y apartamentos describe. Nadie entra a DevUP para
estar en DevVerse; entra a trabajar, y DevVerse es donde eso se convierte en
algo.

Eso es también el argumento más fuerte para separarlos: si DevVerse fuera la
puerta, DevUP heredaría el problema de Gather. Siendo la trastienda, no.

**Qué robar:** el audio por cercanía de Gather (ya lo tenemos), el detalle de que
sus zonas tienen *función* y no solo decoración, y el aprendizaje de Kumospace
sobre el techo de la malla —que en nuestro caso ya está medido en la decisión
0002.

### 3.2 Orquestación de agentes — aquí sí hay carrera, y va rápida

Es el frente caliente. Conductor corre sesiones paralelas de Claude Code, Codex
y Cursor en workspaces aislados por *git worktree*. Warp se ha redefinido de
terminal a plataforma de automatización, con flotas de agentes. Devin apuesta
por workspaces compartidos para que los agentes no se redescubran el proyecto
cada vez. Y por debajo, MCP se ha vuelto el estándar de facto: GitHub, Supabase,
Playwright, Sentry, Notion y Cloudflare tienen servidor propio.

**Dos noticias.**

La mala: no llegamos primeros, y esto se mueve en meses. Es casi seguro que la
página que viste atacando el tema es de aquí.

La buena, y es grande: **todos ellos son herramientas de escritorio para una
persona.** Conductor corre en tu Mac. Warp es tu terminal. Ninguno tiene
organización, ni roles, ni canales, ni bóveda de credenciales compartida, ni
aislamiento entre clientes. DevUP tiene las seis cosas hechas y probadas —42
tablas con RLS, 156 comprobaciones de aislamiento en verde—.

**Ahí está el hueco: el agente en equipo.** No «un agente que trabaja por mí»
sino «un agente que trabaja *para la organización*, con las credenciales de la
organización, cuyo resultado ve el equipo». Eso hoy no lo hace ninguno, y es
justo lo que la bóveda existe para permitir.

**Qué robar:** el aislamiento por *worktree* de Conductor —es la respuesta
correcta a «¿qué puede tocar un agente?», que es la pregunta abierta de la
decisión 0004—, y la idea de Devin de que el contexto se comparte entre
sesiones en vez de reconstruirse.

### 3.3 Descubrimiento de integraciones — nadie lo hace, y es la mejor idea del dictado

La idea de «¿quieres integrar Supabase? hace esto, esto y esto — ¿sí? pues ya
está» no la he encontrado en ningún sitio. Todo el mundo tiene un catálogo de
integraciones donde tú buscas lo que ya sabes que quieres.

Y el diagnóstico de partida es correcto y está infravalorado: la razón por la
que mucha gente no usa Supabase no es que la haya evaluado y descartado, es que
**no sabe que existe**. Un catálogo no arregla eso. Un producto que dice «para
lo que estás haciendo, esto te ahorraría X» sí.

Es además donde mejor encaja el agente: la persona dice que sí, y el trabajo
—crear el proyecto, guardar las claves en la bóveda, escribir el esquema,
conectar el MCP— ocurre detrás. Que es literalmente lo que describiste.

**Es la pieza más diferenciadora de toda la visión y la que menos cuesta
enseñar.** Vuelve en el §6.

---

## 4. Los cuatro veredictos técnicos

Antes de planificar, cuatro trozos de la visión necesitan respuesta técnica,
porque dos se pueden hacer tal cual y dos no.

### 4.1 La zona DJ y la lista única — se puede, pero no como suena

Lo que pides: Pepito con Spotify y tú con YouTube Music, una sola cola
compartida, y un tablero dentro de DevVerse con lo que va sonando.

Lo que permiten las plataformas:

| | Reproducción en web | Coste | Estado |
|---|---|---|---|
| Spotify | Web Playback SDK | **Premium por oyente** | Nuestra app sigue en modo desarrollo: 5 cuentas |
| Apple Music | MusicKit JS | **99 $/año** de programa + suscriptor | Sin empezar |
| YouTube Music | **No hay API oficial** | — | Solo el reproductor de YouTube, con sus condiciones |

**Conclusión: la reproducción sincronizada entre plataformas distintas no es
posible.** No es cuestión de esfuerzo; no hay ninguna forma de que un cliente de
Spotify y uno de YouTube estén en el mismo segundo de la misma canción.

**Lo que sí es posible, y es casi todo lo que querías:** la cola es
**agnóstica**. Se guarda la canción, no el enlace de Spotify —ISRC, título,
artista, duración—, y **cada persona la reproduce en su propio servicio**. La
correspondencia entre plataformas es un problema resuelto: la API de
Songlink/Odesli traduce por ISRC entre Spotify, Apple Music, YouTube, Deezer y
Tidal.

Lo que se gana: una sola lista de verdad, cualquiera añade desde donde tenga
cuenta, y el tablero del DevVerse enseña la misma cola a todo el mundo. Lo que
se pierde: la escucha simultánea al segundo. A cambio, la cola deja de depender
de que Spotify nos levante la cuota.

**Y una consecuencia de diseño que vale la pena:** guardar la canción y no el
enlace es lo correcto aunque solo hubiera Spotify. El enlace es de una
plataforma; la canción es del equipo.

### 4.2 La cámara por cercanía — resuelto, ver `lluvia-de-ideas.md` §2

> **Actualización del 27 de agosto.** Este apartado se escribió suponiendo
> encendido automático. La versión aclarada —acercarse abre un menú con
> *saludar* y *llamar*, y las cámaras se encienden solo si los dos aceptan— no
> tiene ninguno de los dos problemas de abajo: una llamada individual es una
> sola conexión entre dos navegadores, cifrada de punta a punta por definición.
> **No hay nada que romper y no hay servidor de medios que meter.** El diseño
> completo, con la pizarra por canal de datos, está en
> [`lluvia-de-ideas.md`](lluvia-de-ideas.md) §2. Lo que sigue se queda porque
> el techo de la malla que describe sigue siendo real para las salas grandes y
> para la comunidad visitando edificios.

Dos problemas, uno de gente y uno de física.

**El de gente:** una cámara que se enciende sola porque un avatar pasó cerca es
la clase de cosa que se cuenta mal una vez y ya no se recupera. Y va contra la
cultura que este producto ya tiene escrita: grabar exige el permiso explícito de
todos los presentes (decisión 0001).

**El de física, que es el que decide:** las llamadas van en malla. La decisión
0002 §11 bis ya dice que doce personas en una sala piden once conexiones por
cabeza, y eso **con audio**. Vídeo son entre diez y veinte veces más ancho de
banda. Una plaza con veinte avatares y cámaras automáticas no va a ir despacio:
no va a ir.

**La versión que sí funciona, y que además es mejor idea:** acercarse abre el
**audio** —que es lo que ya hace y lo que ya está medido— y ofrece la cámara con
un gesto de un clic, con el vídeo limitado a grupos pequeños. Recordar la
preferencia por persona. Que encender la cámara sea un acto y no un accidente es
lo que hace que encenderla signifique algo.

La pizarra dinámica al acercarse, con guardar y grabar opcionales, entra tal
cual: es la parte de esta idea que no tiene ni problema de física ni de gente.

**Y la comunidad visitando edificios: el techo es este, no el diseño.** Malla
significa que una plaza pública con cincuenta personas no se sostiene. Eso pide
un servidor de medios (SFU), que es una decisión de arquitectura seria y cara —y
que rompería el cifrado extremo a extremo de la decisión 0001—. No es para el
MVP. Conviene saber ahora que ese es el muro, para no diseñar la comunidad
contra él.

### 4.3 La gamificación — la mecánica sí, la métrica hay que elegirla bien

Puntos por aportar, canjeables por ropa, apartamento, pisos, edificios. La
mecánica es sólida y el enganche está probado.

**El riesgo está en qué se puntúa.** Puntuar volumen —commits, líneas, tareas
cerradas— produce exactamente lo que se puntúa: muchos commits pequeños, tareas
troceadas, y a la persona que arregló el fallo difícil en tres líneas quedando
la última de la tabla. Y la literatura de 2026 coincide en que los perfiles
senior desprecian la gamificación cuando huele a gimmick.

**Lo que lo evita, y encaja con lo que este repositorio ya cree:** puntuar
**ritos de calidad**, que es lo que el propio proyecto ya considera innegociable.
Una migración con su política de aislamiento y su caso en `isolation.test.ts`.
Una revisión de PR con comentarios de fondo. Un fallo con prueba de regresión.
Dejar la CI en verde. Son cosas que cuesta hacer, que nadie quiere hacer, y que
son buenas se hagan por el motivo que se hagan — al revés que los commits.

Dos guardarraíles más: **nada de tabla de clasificación pública individual** —el
progreso es contra uno mismo y contra el equipo—, y **la recompensa es cosmética
o de espacio**, nunca acceso a funciones. En cuanto los puntos abren puertas,
dejan de ser un juego y se convierten en un sistema de castas.

Los apartamentos, los pisos y los edificios son buenas recompensas por una razón
que no es evidente: **son persistentes y se ven**. Una insignia se mira una vez;
un apartamento que se decora se visita.

### 4.4 Desplegar nosotros mismos — no, y no es cobardía

Preguntabas qué tan loco es. Respuesta: no es imposible, es **la forma más rápida
de contradecir la tesis del §2**.

Construir infraestructura de despliegue es competir con Vercel, Railway y Fly a
la vez, en su terreno, con su curva de costes, y es donde se van a ir todos los
puntos del plan. Y para el usuario, «DevUP despliega» y «DevUP orquesta tu
Vercel» se ven casi igual en pantalla.

**Lo coherente es orquestar**: guardar la credencial en la bóveda —que para eso
existe—, disparar el despliegue en la plataforma del cliente, y enseñar el
estado en una sola pantalla. Eso es el bloque D (S7) del plan A–H, tal como
está escrito. Nada que cambiar; solo que ahora se sabe por qué está bien.

Esto responde de hecho a la decisión 0003, que sigue abierta y bloquea D.

---

## 5. La arquitectura de la visión: dos mundos y una puerta

La separación que pediste, con nombres, porque ordena todo lo demás.

**La plataforma** — el trabajo. Organizaciones, workspaces, canales, tareas,
archivos, ventas, repositorios, bóveda, integraciones, agentes, infraestructura.
Va en móvil. Es densa, rápida, aburrida en el buen sentido, y **funciona entera
sin DevVerse**.

**DevVerse** — la vida. Espacio recorrible, avatares, apartamentos, edificios,
arcade, zona DJ, cercanía, comunidad. Es escritorio, es opcional y es *donde los
puntos se gastan*. **Funciona entera sin la plataforma abierta al lado.**

**La puerta** — lo único que los une, y en un solo sentido: **el trabajo genera
puntos, los puntos se gastan en DevVerse.** Un contrato pequeño, un módulo, una
tabla. Nada más cruza.

Que el contrato sea pequeño es lo que hace que la separación sea real y no un
dibujo: hoy los dos mundos comparten el socket, la sesión y media barra lateral,
y por eso tocar uno rompe el otro. Y es lo que permite que la plataforma vaya a
móvil sin arrastrar un mundo isométrico que en un teléfono no tiene sentido.

---

## 6. El MVP

Aquí está el recorte, que es lo que de verdad pedías al final.

La visión completa son varios cientos de puntos —más que los ~150 del plan A–H y
los ~28 del de interfaz juntos—. Hacerla entera antes de enseñarla es cómo se
tarda un año en descubrir qué sobraba.

### El criterio del recorte

Entra lo que cumple las tres: **(a)** demuestra la tesis del §2, **(b)** se
apoya en algo que ya existe y está probado, **(c)** se puede terminar hasta el
final en vez de quedarse a medias.

### Entra

| | Por qué |
|---|---|
| **Bloque A entero** (copias, SMTP, custodia de la clave) | Sin esto no hay MVP que enseñar a nadie de fuera. Es lo más barato del plan |
| **`plan-interfaz.md` I1–I3**, ahora con móvil | El armazón donde entra todo lo demás |
| **La separación en dos mundos** (§5) | Es más barata ahora que después de S7 |
| **Descubrimiento de integraciones** (§3.3) | La pieza más diferenciadora, y la que menos cuesta |
| **S7 / infraestructura orquestada** (bloque D) | Cierra la tercera promesa y enciende los muebles muertos de DevVerse |
| **Un agente, un permiso, un flujo** | Abrir un PR, con worktree, con la bóveda. Uno hecho del todo |
| **Puntos con dos o tres ritos** (§4.3), y ropa | El bucle entero, con el catálogo más pequeño posible |

### No entra en el MVP

No es que se descarte: es que se hace después.

- Apartamentos, pisos, edificios, comunidad, visitas. Es un juego entero, y el
  muro de la malla del §4.2 hay que resolverlo antes.
- Arcade. Es divertido y no demuestra nada de la tesis. Es lo primero que se
  añade cuando el resto esté en pie.
- Zona DJ multiplataforma. Lo que sí entra, si sale barato, es **la cola
  agnóstica** (§4.1) sobre el Spotify que ya funciona — porque el trabajo de
  verdad es dejar de guardar enlaces y empezar a guardar canciones, y eso es
  mejor hacerlo antes de tener mil enlaces guardados.
- Obsidian. Buena idea y la entiendo, pero es una integración más y la
  infraestructura de integraciones no está. Es un cliente perfecto para el §3.3
  *después*.
- Cámara automática por cercanía. Sustituida por el clic del §4.2.
- Infraestructura de despliegue propia (§4.4).

### El orden

```
A (nada se pierda) → C (pruebas de navegador) → I1-I3 (armazón + móvil)
   → separación de los dos mundos → S7 → integraciones guiadas
   → agente (un flujo) → puntos + ropa
```

B se hace en los huecos: son cosas de una tarde cada una.

---

## 6 bis. Público y modelo de negocio

Cerrado el 27 de agosto, y recogido en
[`DevUP-Propuesta-de-Desarrollo.pdf`](DevUP-Propuesta-de-Desarrollo.pdf).

**A quién va dirigido:** cualquier organización que construya software. Dos
perfiles que se parecen menos de lo que parece — la **empresa de desarrollo**,
que entrega a terceros y necesita aislamiento estricto entre clientes, y la
**empresa con un área de desarrollo**, que construye para sí misma. Y un tercero
que no paga y que importa igual: quien trabaja solo o con dos amigos, que es
quien más sufre la dispersión y menos herramientas tiene contra ella.

**Cómo se sostiene:** quien trabaja solo o casi solo no paga —hasta cuatro
personas, plataforma completa—. No es generosidad: es el canal de entrada. A
partir de ahí, por persona y mes: del orden de 12 USD el plan de equipo y 24 USD
el de empresa, con el **consumo de agente medido aparte**, porque tiene coste
variable real y meterlo en tarifa plana obliga a encarecer a todos o a poner un
tope silencioso.

La justificación del número es la única comparación que un comprador hace de
verdad: las herramientas que DevUP reúne se pagan hoy por separado, cada una en
el orden de 7 a 20 USD por persona, así que el conjunto queda por debajo de la
suma de lo que sustituye. Son cifras **para validar**, no una tarifa cerrada.

La venta de artículos cosméticos para DevVerse queda como idea sin cerrar y
fuera del plan — ver `avatares-y-economia.md` §5 bis para por qué vender
aleatoriedad es la puerta delicada y no la moneda.

---

## 7. Lo que necesito que decidas

1. **¿Cuál es la demo?** Lo que se enseña el primer día decide el orden de todo
   lo de arriba. Mi apuesta: **integraciones guiadas** (§3.3), porque es lo que
   nadie más hace y se entiende en treinta segundos.
2. **La página que viste.** Si la recuerdas, dímela. El §3.2 es lo más cerca que
   he llegado y no es lo mismo mirar el mercado que mirar a quien va por delante.
3. **¿Qué se puntúa exactamente?** Propongo tres ritos del §4.3 para empezar.
   Elegirlos es media hora y define la cultura del equipo durante años.
4. **¿Se pide la extensión de cuota de Spotify?** Sigue pendiente del plan A–H, y
   ahora además condiciona si la cola agnóstica entra en el MVP.
5. **Decisión 0003.** El §4.4 la responde de hecho: orquestar, no desplegar. Si
   estás de acuerdo, la cierro y desbloquea el bloque D.

---

## Fuentes

- Gather, escisión de 2026 y estado — [gather.town/whats-new](https://www.gather.town/whats-new), [sowork.com](https://www.sowork.com/blog/best-gather-alternatives-for-remote-teams-in-2026-complete-platform-comparison)
- Kumospace, estado y límites — [status.kumospace.com](https://status.kumospace.com/), [Product Hunt](https://www.producthunt.com/products/kumospace/reviews)
- Coste del cambio de contexto — [Zencoder, Developer Velocity Index 2026](https://zencoder.ai/blog/2026-developer-velocity-index-costs-context-switching-multi-platform-engineering)
- Orquestación de agentes y aislamiento por worktree — [Nimbalyst](https://nimbalyst.com/blog/best-ai-agent-orchestration-platforms-2026/), [Augment Code](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)
- MCP como estándar — [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp), [mejores servidores MCP 2026](https://www.ayautomate.com/blog/best-mcp-servers-2026)
- Gamificación para desarrolladores y sus trampas — [Trophy, caso GitHub](https://trophy.so/blog/github-gamification-case-study), [Smartexe](https://smartexe.com/blog/can-gamification-win-over-skeptical-developers-and-boost-team-performance)
- Spotify Web Playback SDK y Premium — [developer.spotify.com](https://developer.spotify.com/documentation/web-playback-sdk)
- MusicKit JS y programa de Apple — [developer.apple.com](https://developer.apple.com/documentation/musickit/using-automatic-token-generation-for-apple-music-api)
- Correspondencia entre plataformas por ISRC — [Songlink/Odesli API](https://publicapi.dev/songlink-odesli-api)
