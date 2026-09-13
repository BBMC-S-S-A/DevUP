# El flujo: dónde vive cada cosa y por qué

12 de septiembre de 2026. Lo escribe la sesión de **funcionalidades** a partir de
una revisión de pantallas de Juan; lo ejecuta la de **interfaz y flujo**, que es
quien tiene `apps/web` (ver `CAMINOS.md` §1).

Aquí no hay pantallas dibujadas: hay **decisiones de dónde va cada cosa**, con el
porqué de cada una y con lo que la API ya sirve para llevarlas a cabo. Lo que se
pide que no se cambie está marcado; el resto es criterio de quien lo monte.

---

## 0. El hallazgo, que cambia el orden de todo lo demás

**El Panel y la Mesa son la misma idea, construida dos veces.**

| | **Panel** (0019 + 0020) | **Mesa** (0025) |
|---|---|---|
| Qué guarda | qué widgets y dónde, en rejilla libre (`x/y/w/h`) | qué herramienta en cada zona |
| Alcance | **de la persona, global** | **de la persona EN un espacio** |
| Tope | ninguno | tres zonas |

Las dos contestan «quiero mis cosas en una sola pantalla». Y **cada una tiene la
mitad que a la otra le falta**: el Panel tiene la rejilla libre pero una sola
disposición para todos los espacios; la Mesa está bien acotada al espacio pero
solo admite tres zonas y una herramienta por zona.

Cuando se pidió «un apartado donde el usuario pueda llamar la mayoría de
funciones y acomodarlas como quiera, donde DevUP cobra vida», se estaba pidiendo
**la unión de las dos**. Mantenerlas separadas obliga a que cada función nueva se
añada a dos catálogos, y a que el usuario aprenda dos formas de colocar cosas que
hacen lo mismo.

**DECIDIDO Y HECHO** (migración 0049). Queda **una sola**: la rejilla libre del
Panel, con el alcance de la Mesa. La Mesa desaparece del menú.

Cómo se pide y cómo se guarda:

```
GET /me/dashboard?espacio=<uuid>   → { widgets, spotifyMode, layout, esDePartida }
PUT /me/dashboard                  → { espacio?, widgets, spotifyMode, layout? }
```

**`esDePartida` no es adorno.** Cada persona tiene un panel de partida —el que ya
tenía antes de la 0049, que no se ha perdido— y ese vale en todo espacio que no
tenga uno propio. La primera vez que alguien coloca algo estando en un espacio, se
guarda uno de ese espacio y deja de aplicar el de partida. La pantalla debería
decirlo («estás viendo tu panel de siempre»), porque si no, quien mueva una
tarjeta creerá que la movió solo aquí y la habrá movido en todas partes.

Sin `espacio`, las dos rutas hablan del de partida. La regla de cuál gana vive en
`panel_de()` en la base, no en el cliente: escrita en cada cliente estaría
repetida, y el síntoma de que divergieran sería que la misma persona ve un panel
distinto según por dónde entre — que no se parece a un fallo.

---

## 1. El orden del menú de un espacio

Hoy: DevCall · Panel · Mesa · Biblioteca · Tablero · Asistente · DevVerse, y
debajo, sueltos, VOZ y TEXTO.

Propuesta:

```
Panel        ← primero, y es lo que se pidió: lo importante en una pantalla
Tablero
DevCall      ← con los canales de voz y de texto DENTRO
Biblioteca
DevVerse
```

**Panel primero.** Es lo único de la lista que contesta «¿qué tengo delante?»; el
resto son herramientas concretas. Poner primero una herramienta obliga a elegir
cuál es la más importante, y no hay una — depende del día.

**Los canales entran en DevCall.** Hoy hay un apartado «DevCall» y, aparte, dos
listas sueltas de VOZ y TEXTO. Son la misma cosa: sitios donde se habla. Tenerlos
en dos alturas del menú obliga a decidir cada vez por cuál de las dos puertas se
entra a lo mismo. DevCall pasa a ser **el sitio donde se conversa**, con sus
canales dentro.

**Mesa desaparece** si se acepta el §0. Si no se acepta, hay que explicar en el
producto en qué se diferencia de Panel, y eso es difícil de explicar porque no se
diferencian.

**Asistente sale del menú del espacio** y se va a Integraciones (§5). Un asistente
no es un sitio al que se va: es algo que está disponible en todas partes.

---

## 2. La portada de una organización

Hoy enseña **la lista de sus espacios**, que es lo único que ya está en el menú
lateral a un clic. Es gastar la mejor posición del producto en un índice.

**La API ya sirve lo que hace falta**, en una sola petición:

```
GET /organizations/:orgId/panorama?dias=7
```

```
{
  dias,
  espacios:  [{ id, nombre, pendientes, cerradasReciente, personas, ultimoMovimiento }],
  gente:     [{ id, nombre, avatar, estado, oficio, permiso, enQue: ["Producto"] }],
  enMarcha:  [{ id, titulo, prioridad, tipo, espacio, espacioId, columna, responsable }],
  atascadas: [{ id, titulo, espacio, responsable, ultimoToque }]
}
```

Cuatro cosas que conviene no deshacer al pintar:

**`pendientes` y `cerradasReciente` van juntos.** Cuatro pendientes y nada cerrado
en la semana no se lee igual que cuatro pendientes y once cerradas. Enseñar solo
un número —«12 tareas»— no distingue un proyecto vivo de uno parado.

**`enQue` no es «a qué espacios pertenece».** Son las tareas sin terminar que
tiene asignadas. Pertenecer a cinco espacios y no estar tocando ninguno es lo
normal, y enseñar la pertenencia diría que todo el mundo está en todo.

**`atascadas` no es «vencidas».** Una tarea sin fecha no vence nunca y puede
llevar tres semanas quieta. Es la que hay que sacar a la superficie porque nadie
va a ir a buscarla. Si solo cabe una sección de las cuatro, que sea esta.

**`estado` es una elección, no una deducción** (0022). No se pinte «en línea»
deducido de si hay una pestaña abierta: un estado adivinado miente —dice
«disponible» de quien salió a comer con el portátil abierto— y enseña a no fiarse
de él, que es peor que no tenerlo. Quien no ha elegido sale sin decir.

**Y `oficio` no es `permiso`.** `permiso` es owner/admin/member y decide qué puede
tocar. `oficio` es a qué se dedica. Se confunden porque en inglés son la misma
palabra, pero un `member` puede ser quien dirige el producto. Enseñar «member»
donde se pregunta «¿a qué se dedica?» es la respuesta equivocada a la pregunta
correcta.

---

## 3. Ir y volver: organización ↔ espacio

El problema señalado: al pinchar el nombre de la organización se abre un selector
de organizaciones **que ya está en el riel de la izquierda**. Dos formas de hacer
lo mismo, y la del nombre además ocupa el gesto más natural de esa zona.

- **El riel de la izquierda** es y sigue siendo el único sitio para cambiar de
  organización y para crear una.
- **El nombre de la organización** deja de ser un selector y pasa a llevar a **su
  portada** (§2). Es el «volver arriba» que hoy no existe: se entra a Gestek y no
  hay gesto claro para salir al nivel de la organización.
- Dentro de un espacio, la cabecera dice dónde se está y cómo subir:
  `Develovers / Gestek`, con la primera mitad pinchable.

Son dos niveles y hay que poder subir del segundo al primero. Hoy solo se baja.

---

## 4. La persona: dos gestos distintos, hoy mezclados

Abajo del menú están el nombre, la foto, el estado y el tema. Son dos cosas que
se pidió separar, y con razón — una es **quién soy** y la otra es **cómo funciona
esto**:

**Al pinchar el nombre o la foto → la persona.** Foto, nombre, usuario, el oficio
**de esta organización** (§2), y el estado (disponible · ocupado pero abierto a
llamadas · no molestar). Todo lo que otra gente ve de mí.

**Al pinchar la tuerca → el panel técnico**, del estilo del de la última captura:
lista de secciones a la izquierda, contenido a la derecha, a pantalla completa.
Ahí van **cuenta, privacidad, notificaciones, voz y vídeo, apariencia (tema claro
/ oscuro / del sistema), idioma, integraciones (§5) y avanzado**.

El tema sale del menú lateral: es configuración, no una herramienta de trabajo, y
tenerlo ahí le da la importancia de algo que se toca a diario cuando se toca dos
veces al año.

Lo que la API ya sirve para esto:

```
select public.set_my_title($org, 'diseño')   -- el oficio de aquí (0048)
```

`presence` vive en `profiles` (0022) con tres valores: `available`, `busy_open`,
`do_not_disturb`. El de en medio es el importante y el que suele faltar en otras
herramientas: **ocupado, pero llámame si de verdad hace falta**. Sin él, la gente
se pone «no molestar» para que la dejen en paz y de paso se aísla de lo que sí
importaba.

---

## 5. Integraciones: un solo sitio

Hoy lo que conecta DevUP con el mundo está repartido: el Asistente en el menú del
espacio, las conexiones en Ajustes, GitHub bajo «Proyecto», y la puerta MCP en
ningún sitio visible.

Todo eso es **la misma pregunta** —«¿con qué está enchufado esto?»— y va en una
sección de Integraciones dentro del panel técnico (§4), en tres grupos:

- **Agentes** — las claves de IA por persona (0030) y las conexiones de agente
  (0029).
- **Puerta MCP** — cómo conectar Claude u otro cliente a este DevUP. Es lo que
  hoy no tiene pantalla ninguna y se configura a mano.
- **Herramientas** — GitHub, Spotify, y lo que venga. Ya existen como
  `connections` con sus secretos en la bóveda (0015/0018).

Que GitHub siga apareciendo también dentro del espacio como «Proyecto» está bien:
ahí es contenido, no configuración. Lo que no puede es que sea el único sitio
donde se conecta.

---

## 6. El login

Lo pedido: un edificio en la mitad, con la animación de DevUP y **tres**
personajes moviéndose solos entre trabajar, ir a por agua y demás.

Tres cosas que conviene fijar antes de empezar:

**Tres personajes, y que se note que son pocos.** La tentación es llenarlo. Un
edificio con doce figuras moviéndose es ruido detrás de un formulario de entrada,
y lo que se quiere contar —«aquí dentro hay un equipo trabajando»— lo cuentan tres
mejor que doce.

**Que no toque el DevVerse de verdad.** `components/world/**` y `lib/world/**` son
zona restringida y esto es una animación decorativa, sin sesión, sin servidor y
sin nadie al otro lado. Si comparte código con el mundo, un cambio en el mundo
rompe la pantalla de entrada de todos los que aún no han entrado — y nadie prueba
el login cuando toca el DevVerse.

**Que respete `prefers-reduced-motion`.** Es una animación en bucle en la primera
pantalla del producto; para quien la marea, es la primera pantalla del producto.

---

## 7. Prioridad, si no cabe todo

En este orden, y el motivo de cada puesto:

1. **§0, la decisión Panel/Mesa.** Bloquea lo demás: todo lo que se monte encima
   de cualquiera de las dos hay que rehacerlo si se fusionan.
2. **§2, la portada de la organización.** Ya tiene API y hoy esa pantalla no dice
   nada. Es el mayor salto por el menor trabajo.
3. **§3, ir y volver.** Es un fallo de navegación, no una mejora: hoy se baja y no
   se sube.
4. **§1, el orden del menú y los canales dentro de DevCall.** Barato y quita una
   confusión que se paga en cada sesión.
5. **§4, persona y panel técnico.**
6. **§5, integraciones.**
7. **§6, el login.** Lo último a propósito: es lo que más se ve y lo que menos
   cambia lo que se puede hacer con el producto.

---

## 8. Lo que esta sesión debe antes de que §0 se pueda montar

- La migración que le dé alcance de espacio al panel, **si se decide fusionar**.
- ~~El catálogo de widgets crece~~ **Hecho.** Los datos de los widgets van por
  **una sola ruta**, y ese es el punto:

```
GET /workspaces/:id/panel?widgets=resumen,mis_tareas,atascadas&dias=7
  → { dias, datos: { resumen: {...}, mis_tareas: [...], atascadas: [...] } }
```

  Seis con datos: `resumen`, `mis_tareas`, `atascadas`, `actividad`,
  `no_leidos`, `repositorios`. Un widget que se pinte solo —un reloj, unas
  notas— no está en la lista y no necesita tocar nada.

  **Los widgets se mandan en la URL, y hay que mandarlos.** Un panel de ocho
  widgets serían ocho peticiones al abrirlo: ocho barras de carga y ocho
  oportunidades de que una llegue tarde y deje un hueco que no se distingue de
  un widget vacío. Pero servir siempre las seis consultas para pintar dos no es
  una mejora, es el mismo trabajo con menos avisos — de ahí el filtro. Manda los
  que **estás pintando ahora**, no los que hay guardados: al colocar uno nuevo
  antes de guardar, no coinciden.

  Un nombre que no esté en el catálogo se rechaza en vez de ignorarse: una
  errata que devolviera el panel a medias sin decir nada se busca después en el
  sitio equivocado.

  Tres cosas que el servidor decide y conviene no repintar distinto:

  - **`atascadas` no son las vencidas.** Una tarea sin fecha no vence nunca y
    puede llevar un mes quieta; es justo la que el widget existe para sacar a la
    superficie. Y lo que solo está apuntado no está atascado — está esperando.
  - **`resumen` trae los tres números juntos** (pendientes, en curso, cerradas
    en la ventana) porque «12 pendientes» a secas no distingue un proyecto vivo
    de uno parado. Un widget de una sola cifra grande es el que mejor queda y el
    que menos dice.
  - **`repositorios` trae `refrescado` y `fallo`.** Las estadísticas las trae un
    barrendero cada diez minutos, y un número sin fecha al lado se lee como si
    fuera de ahora. Si el refresco lleva dos días fallando, el widget tiene que
    poder decirlo en vez de enseñar con confianza la cifra de anteayer.

  El catálogo de qué widgets existen y cómo se pintan sigue viviendo en el
  cliente (decisión de 0019): añadir uno que no necesite servidor no pide
  migración ni tocar la API.


---

# 9. Lo pedido el 13 de septiembre, y qué falta de cada cosa

Revisión de pantallas. **Cinco de las siete no necesitan nada de la API**: los
datos ya están y lo que falta es el gesto. Se dice cuáles para que no se pida
otra vez lo que ya se sirve.

## 9.1 · La tarjeta de una tarea enseña cinco campos de los diez que tiene

El modal pinta título, detalle, responsable, fecha, etiquetas, adjuntos e
historial. **Faltan cuatro que existen desde la 0045** y son justo los que
contestan «cómo se hizo»:

```
tipo        funcionalidad · arreglo · mejora · deuda · investigacion ·
            documentacion · diseno · infraestructura
prioridad   0 baja · 1 normal · 2 alta · 3 urgente
contexto    por qué se hace, hasta 4000
criterio    cuándo está hecha, hasta 4000
evidencia   [{ tipo: pr|commit|enlace|nota, url, titulo, nota, autor, creadaEn }]
ramas       [{ nombre, estado, repo }]
```

Todo eso viene ya en `GET /tasks/:id` y se escribe con `PATCH /tasks/:id`. La
evidencia tiene sus rutas (`POST /tasks/:id/evidencia`, `DELETE /evidencia/:id`)
y hay un cierre con prueba en el mismo gesto: `POST /tasks/:id/hecha`.

**Y mover de rama también se puede ya**: `PATCH /tasks/:id` acepta `categoryId`.
Nulo explícito la deja sin clasificar.

## 9.2 · El comportamiento de una rama, a la derecha

Hecho, §6.1. `GET /categories/:id/rama?dias=30` trae `porRepartir` y
`quienHaTrabajado` con desglose por verbo y última vez.

**Lo que NO se puede servir, dicho claro:** «cuánto tiempo han usado». El
registro anota cuándo pasó cada cosa, no cuánto duró — no hay cronómetro y no lo
hay a propósito (ver `herramientas/pasado.ts`: qué se hizo, no a qué hora trabaja
cada quien). Lo más cercano y honesto es **cuántos días tardó en cerrarse**, que
ya se calcula por persona con mediana (`cierresPorPersona`). Si hace falta al
lado de una rama, se pide y se añade; lo que no voy a hacer es enseñar un número
de horas que nadie midió.

## 9.3 · La biblioteca: carpetas hechas, preview no

**Carpetas (0053)**, con la misma división que en el tablero para que el producto
se explique con una regla: **la carpeta es dónde vive el archivo (una); la
etiqueta es lo que cruza (todas las que hagan falta)**.

```
GET    /workspaces/:id/carpetas   → [{ id, nombre, padreId, archivos, subcarpetas }]
POST   /workspaces/:id/carpetas   → { nombre, padreId? }
PATCH  /carpetas/:id              → { nombre?, padreId? }   (padreId: null = a la raíz)
DELETE /carpetas/:id              → 204
PATCH  /files/:id                 → { carpetaId? }          (null = a la raíz)
```

El árbol se arma en el cliente desde `padreId`: devolverlo anidado obligaría a
recorrerlo aquí para que la pantalla lo desarmara y lo volviera a armar.

**Dos cosas que conviene saber al pintarlo.** Borrar una carpeta **no borra sus
archivos** — suben a la raíz; sí se lleva sus subcarpetas. Y los ciclos los
impide la base, así que arrastrar una carpeta dentro de su propia hija devuelve
un `23514` con mensaje legible en vez de colgar la pantalla.

**El preview de la imagen es vuestro** y ya tenéis todo: `GET
/files/:id/download-url` firma una URL, y `mimeType` dice cuáles son imágenes.

## 9.4 · Lo que es enteramente de interfaz

- **Los canales de voz y texto dentro de DevCall**, fuera del menú lateral. Ya
  estaba en §1; la captura confirma que siguen en las dos alturas.
- **Las neuronas (el grafo) en el menú.** Rutas en §5, y desde hoy teje solo
  tarea↔mensaje: citar una tarea por su identificador en un canal la enlaza.
- **Que la tuerca lleve al panel técnico** (§4).
- **Editar y crear ramas desde la pantalla**: `POST/PATCH/DELETE
  /workspaces/:id/categories` existen, y los gerentes se ponen con
  `set_category_owner`.
