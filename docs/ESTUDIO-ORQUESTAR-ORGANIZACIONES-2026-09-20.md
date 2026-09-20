# Orquestar una organización: el estudio

_20 de septiembre de 2026. Segunda parte de [PLAN-UX-MVP-2026-09-20](PLAN-UX-MVP-2026-09-20.md).
El primero midió la forma —anchos, marcos, cuántos destinos—. Este mira la
estructura: qué contesta cada nivel, qué contesta cada función, y qué se
contesta dos veces._

---

## 0. El hallazgo, en una frase

**DevUP tiene tres niveles y ninguno tiene casa.**

| Ruta | Qué parece | Qué es de verdad |
|---|---|---|
| `/app` | la entrada | una **redirección**: lee el último espacio del navegador y te manda allí |
| `/app/o/[orgId]` | la organización | una **lista** titulada «Espacios de trabajo» |
| `/app/w/[id]` | el espacio | una **redirección** al canal general |
| `/app/inicio` | — | la **única portada real**, y es personal: cruza todas las organizaciones |
| `/app/organizaciones` | — | la lista de listas, con seis botones repetidos por organización |

La jerarquía que se ve en el riel —persona → organización → espacio— no existe
en el producto. Lo que hay es **persona → espacio**, con la organización de
carpeta. Por eso «Inicio» lleva a otra parte: no es un fallo suelto, es la
consecuencia de que el nivel del medio no tenga contenido propio.

### La prueba de que esto no es una impresión

`app/w/[workspaceId]/layout.tsx:341` — el «Inicio» de la barra de un espacio
apunta a `/app/inicio`. Es decir: **estando dentro de Gestek, «Inicio» te saca a
una portada que suma Gestek y devup**. De ahí el «52 tareas en 2 espacios» de la
captura. La pantalla no está rota; está bien hecha y colgada del sitio
equivocado.

Y `/app/organizaciones` lo dice de sí misma en su propio comentario: *«con tres
organizaciones, dieciocho botones con seis nombres»*. Ese problema se resolvió
quitando la lista de la ruta `/app`… y dejándola intacta un poco más allá.

---

## 1. Las tres casas que faltan

La regla que las separa: **cada nivel contesta una pregunta que los otros dos no
pueden contestar, y ninguno redirige al de abajo.**

### Casa 1 — la persona (`/app/inicio`, evolucionada)

> «¿Dónde estoy metido y qué me espera?»

Hoy ya contesta la mitad buena: lo vencido primero, luego lo urgente, y el
desglose de participación sin un número único —esa decisión está bien tomada y
no hay que revisarla—. Le falta la otra mitad, que es la que pide el encargo:

- **Mis organizaciones**, con su pulso, no su recuento: qué se movió, quién está
  dentro ahora mismo.
- **La gente**: quién de mis organizaciones está conectado, en qué anda, en qué
  sala de voz está metido.
- **Las invitaciones que me esperan**, que hoy solo llegan por correo.

Lo que hay que quitar de ahí: `ORGANIZACIONES 02 / WORKSPACES 05`. Contar cosas
no es informar de nada — nadie decide nada distinto sabiendo que tiene dos.

### Casa 2 — la organización (`/app/o/[orgId]`, reescrita)

> «¿Cómo va la empresa y quién la está moviendo?»

Es la que **no existe** y la que más falta hace, porque es donde se orquesta.
Hoy enseña una lista de espacios y el marcador de puntos. Debería enseñar:

- **Las personas**: quién hay, con qué papel, desde cuándo, qué tocó por última
  vez. Todo eso ya se lee —el registro de actividad lleva semanas llenándose—.
- **Invitar y retirar** desde aquí, no desde Ajustes. Invitar a alguien es un
  gesto de plantilla, no de configuración.
- **Lo que está vivo**: tareas activas por espacio, y sobre todo **las que no
  tiene nadie** — que es la única cifra de esta pantalla que hace que alguien
  haga algo al leerla.
- **Los espacios**, sí, pero como una sección más y no como el contenido entero.

### Casa 3 — el espacio (`/app/w/[id]`, que hoy es una redirección)

> «¿Cómo va este proyecto?»

Aterrizar en el canal general fue una buena decisión cuando la alternativa era
una biblioteca vacía (decisión 001). Pero un canal contesta «¿de qué se está
hablando?», no «¿cómo va esto?». El resumen del espacio —lo que hay en curso,
lo que se movió desde ayer, qué PR están abiertos, qué está bloqueado— no vive
en ninguna pantalla: está repartido entre Panel, Qué ha pasado y el Tablero.

**Y aquí el «Inicio» de la barra debe apuntar a esta casa, no a la de la
persona.** Es un enlace de una línea y arregla el peor salto que tiene hoy el
producto.

---

## 2. El error de jerarquía del pie — y es peor de lo que parece

No es que el pie esté mal colocado. Es que **hay dos pies distintos y no se
comportan igual**:

| | Armazón de organización | Armazón de espacio |
|---|---|---|
| Tu nombre | un `<p>`: **texto muerto** | un botón que abre tu menú |
| Estado y tema | dos filas fijas en el pie | dentro del menú |
| Cerrar sesión | un icono suelto que **sale sin preguntar** | dentro del menú, **con confirmación** |
| Campana | en el pie | en el pie |

La captura de Ventas es del armazón de organización: por eso el nombre no
responde. No está roto en todas partes — está arreglado en un sitio y sin
arreglar en el otro, que es peor, porque el gesto se aprende en una pantalla y
falla en la siguiente.

Lo grave no es la incoherencia visual: es que **en la mitad de la aplicación se
cierra sesión con un clic y sin preguntar**, a dos centímetros del nombre del
espacio, donde un icono de puerta parece decir «salir de aquí». El propio
comentario de `MenuDeUsuario.tsx` explica por qué eso estaba mal… y describe una
mudanza que solo se hizo en un armazón.

### Lo que propone el encargo, y lo que ya está construido

Pulsar tu avatar debe abrir **tu perfil como lo ve la gente**, no un menú de
ajustes. Y eso **ya existe**: `components/perfil/TarjetaPersona.tsx`, 200 líneas,
usada en ocho pantallas. Enseña quién eres, tu cargo, tu presencia, en qué andas
y lo último que tocaste. Es exactamente el preview que se pide.

No hay que construirlo: hay que **engancharlo al avatar** y poner debajo la
entrada a la configuración de la cuenta.

Con eso, «Mi cuenta» sale de la barra lateral —que es lo que chirría: la
configuración de una persona no es un destino de la organización— y `cuenta`
(1.520 líneas: foto, personaje, conexiones de agente, contraseñas) pasa a
colgar del perfil, que es de donde se busca.

**La campana, arriba a la derecha.** Un aviso es algo que llega; el pie de la
barra es donde vive lo que uno va a buscar. Además libera el pie para lo único
que debe quedar ahí: quién eres.

---

## 3. El enlace de invitación

Hoy hay dos formas de entrar y las dos empiezan por el correo de alguien:

1. **Token por correo** — `/invitacion?token=…`, una invitación por persona.
2. **Código corto** — dictable por teléfono, se puede regenerar, caduca. En la
   base solo vive su hash: no se puede «ver el código de antes», solo pedir otro.

Falta lo que se pide: **un enlace de la organización, reutilizable, sin correo**.
Es el gesto de Discord y es el correcto para meter a cinco personas de golpe.

Ahora bien, un enlace reutilizable es **una puerta abierta**, y el resto del
producto se toma la seguridad en serio (RLS como único límite, política de datos
escrita). Así que no es «generar una URL»; son cuatro decisiones:

- **Caducidad** obligatoria, corta por defecto.
- **Límite de usos**, y que se pueda dejar en uno —que es el caso más común.
- **Revocación** desde donde se creó, visible.
- **Quién puede crearlo**, y con qué papel entra quien lo use. Nunca admin.

Y un quinto punto que no es negociable: entrar por enlace **queda en el registro
de actividad con el enlace que se usó**. Si un día hay que preguntar «¿esta
persona quién la metió?», la respuesta tiene que existir.

---

## 4. Qué hace cada función, y qué se repite

Lo que sigue sale de leer cada pantalla, no de suponer.

| Función | Qué contesta | Solapa con |
|---|---|---|
| **Inicio** (persona) | qué me espera, en todos los espacios | Panel |
| **Panel** | «el panel personal» de ESTE espacio | Inicio, Mesa |
| **Mesa** | dos cosas a la vez: canal + tablero, archivos + canal | compone las demás |
| **Tablero** | el trabajo del espacio | Ramas de trabajo |
| **Ramas de trabajo** | quién lleva qué área y cuánto queda | Tablero (su filtro) |
| **Qué ha pasado** | «¿qué pasó desde que me fui?» | Auditoría › Registro, historial de tarea |
| **Auditoría** | *reúne lo que Base de datos e Integraciones ya analizan* | **lo dice su propio comentario** |
| **Base de datos** | esquema, migraciones, consola SQL | Auditoría, Infraestructura |
| **Integraciones** | qué está conectado y si responde ahora | Auditoría, Infraestructura |
| **Infraestructura** | «por ahora, solo arquitectura» | Integraciones |
| **GitHub** | repos de fuera | Repositorios, Entorno de dev |
| **Repositorios** | los que aloja DevUP (apagado por defecto) | GitHub |
| **Entorno de dev** | editor y terminal en el navegador | GitHub |
| **Red del proyecto** | qué está enlazado con qué | Ramas, Qué ha pasado |
| **Biblioteca** | los archivos | — |
| **Canales / DevCall** | donde se habla | — |
| **Buscar** | buscar | la paleta de comandos (⌘K) |
| **Ventas · Noticias** | de la empresa, no del proyecto | — |

**Lo que NO es duplicación, aunque lo parezca:** Ventas, Noticias, Ajustes y
Buscar existen en dos URLs (`/o/[orgId]/…` y `/w/[id]/…`) pero son **un solo
componente re-exportado**, para no cambiar de armazón al abrirlos. Está bien
resuelto y no hay que tocarlo.

### Los cuatro solapes de verdad

**1 · Tres portadas para el mismo día.** Inicio (persona), Panel (espacio) y
Mesa (composición) contestan versiones de «¿qué tengo delante?». La salida no es
borrar dos: es darle a cada una su nivel —Inicio es de la persona, Panel es el
resumen del espacio (la casa 3), Mesa es la herramienta de mirar dos cosas a la
vez— y **que Panel deje de llamarse «personal»**, porque en un espacio
compartido esa palabra ya la ocupó Inicio.

**2 · La cadena del proyecto está partida en seis pantallas.** GitHub,
Repositorios, Infraestructura, Base de datos, Integraciones y Auditoría son
seis puertas a una sola pregunta: **«¿cómo está este proyecto por dentro?»**.
Auditoría ya intentó unirlas y lo que consiguió fue ser la séptima. Van a ser
**una pantalla con pestañas**, y Auditoría es la pestaña de entrada.

**3 · El pasado se cuenta tres veces.** Qué ha pasado (el espacio), el registro
de Auditoría (el proyecto) y el historial de la tarea (la tarjeta) leen **la
misma tabla** con tres filtros. Son un solo componente con tres alcances, no
tres pantallas.

**4 · Ramas de trabajo y el filtro del Tablero** son el mismo dato mirado por
los dos ejes. Ramas debería ser una vista del Tablero, no un destino aparte.

Contando así: **22 destinos → 8**, sin borrar una sola función.

---

## 5. Cómo se conecta todo, que es la pregunta de fondo

Recortar y ordenar no hace un sitio de trabajo. Lo que lo hace es que **cada
cosa sepa de las demás**. La infraestructura para eso ya está construida y casi
no se usa:

- **El registro de actividad** llena una tabla desde hace semanas. Es lo que
  hace posible «quién ha hecho qué» en las tres casas, sin inventar nada.
- **El grafo** (`graph_links`, migración 0043) puede unir tarea ↔ rama ↔ PR ↔
  mensaje ↔ archivo. Tiene guardián, tiene rutas y tiene pantalla. Lo que le
  falta es que alguien escriba en él desde donde ya pasan las cosas.
- **`capacidades`** decide qué se enseña, así que recortar no obliga a borrar.

La frase que ordena el producto —y que ya está escrita en la propuesta— es
**«no somos un gestor de proyectos; somos el gestor del desarrollo del
proyecto»**. Aplicada a esto: el sitio donde vive una tarea tiene que enseñar su
rama, su PR, la conversación donde se decidió y lo que pasó después. Ese es el
hilo. Hoy cada uno de esos cuatro vive en su pantalla y el hilo se lleva en la
cabeza.

---

## 6. Lo que hay que decidir

1. **¿La organización es un nivel o una carpeta?** Si es un nivel, `/app/o/…`
   se reescribe entera y el riel empieza a llevar allí. Si es una carpeta, se
   asume y se quita del camino. Hoy está a medias, que es la peor de las tres.
2. **El enlace de invitación**: caducidad, usos y papel por defecto (§3).
3. **Panel y Mesa**: si Panel pasa a ser la casa del espacio, ¿Mesa sigue siendo
   una pantalla o se convierte en un modo de cualquiera de ellas?
4. **Las seis pantallas del proyecto en una**, que es el recorte más grande y el
   único que puede romper la costumbre de alguien.

## 7. El orden de trabajo

**Primero lo que no depende de ninguna decisión y quita bulto:**

- El «Inicio» de la barra del espacio apunta al espacio, no a la portada
  personal. *(una línea)*
- Un solo pie, el del espacio, en los tres armazones — con lo que se acaba el
  cierre de sesión sin preguntar. *(mediana, y es de seguridad)*
- El avatar abre `TarjetaPersona`, y debajo, la cuenta. «Mi cuenta» sale de la
  barra. *(el componente ya existe)*
- La campana, arriba a la derecha.
- Fuera los recuentos que no mueven a nadie: `ORGANIZACIONES 02`.

**Después, y en este orden:** la casa de la organización (§1), el enlace de
invitación (§3), la casa del espacio, y por último las uniones del §4, que son
las que tocan más código y las que más hay que acordar antes.

---

_Lo que este estudio **no** comprobó: nada de esto se ejecutó en un navegador.
Sale de leer el código y de las capturas. Antes de tocar el pie conviene abrir
las dos pantallas a la vez y confirmar que se ven como aquí se dice._
