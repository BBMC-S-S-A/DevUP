# El tablero de DevUP: tres áreas y su reparto

12 de septiembre de 2026. Es la entrada para poblar el tablero, no un plan
nuevo: todo lo de aquí sale de [`PLAN-DOS-SESIONES.md`](PLAN-DOS-SESIONES.md),
[`plan-agentes-y-participacion.md`](plan-agentes-y-participacion.md) y la
propuesta.

---

## 0. Lo que bloquea subirlo, y cómo se desbloquea

**El MCP de esta sesión no tiene token**, así que no he podido escribir en el
tablero de verdad. La propia herramienta dice cómo se arregla:

> En DevUP: Ajustes → Conexiones de agente → crear una, y pegar el token en
> `~/.devup/mcp.json` así:
> `{ "apiUrl": "https://api.hytrex.co", "refreshToken": "<el token>" }`

Con eso puesto, poblar el tablero son tres `crear_area` y una tanda de
`crear_tarea` — y como cada área lleva su delegado, **las tareas no hay que
asignarlas una a una**: caen solas en quien lleva el área.

**Un aviso de calendario:** las áreas necesitan la migración 0039 desplegada.
Hasta entonces `crear_area` dará error contra producción, aunque las tareas sí
se pueden crear.

---

## 1. Las tres áreas

| Área | La lleva | De qué trata |
|---|---|---|
| **Workflow y flujos** | Juan Medina | Cómo se mueve el trabajo por el producto: jerarquía de pantallas, el marco, la navegación, que ahorre saltos |
| **DevVerse** | Carlos Cáceres | El mundo: personajes, skins, economía, salas, el encuentro por cercanía |
| **Profundización de funcionalidades** | Juan Bonilla | Que lo que ya existe llegue hasta el final: registro, MCP, auditoría, agentes, integraciones |

**Tres y no más, a propósito.** Un tablero con ocho áreas que nadie usa es peor
que uno con tres: el eje sirve para leer el tablero de un vistazo, y ocho no se
leen de un vistazo.

---

## 2. Hecho — para crear y mover a «Hecho» directamente

Lo de esta sesión y la anterior. Va al tablero igual que lo pendiente: un
tablero que empieza con la historia ya dentro se lee como un sitio donde se
trabaja, no como una lista de deseos.

### Profundización de funcionalidades · Juan Bonilla

- **Registro de actividad: tabla, políticas y su caso de aislamiento** — La
  0038. Tabla de solo añadir con quién, qué verbo, sobre qué, cuándo y con qué
  origen. Sin política de UPDATE ni DELETE. Doble llave de aislamiento.
- **Escribir actividad al crear, mover, asignar y cerrar** — En los helpers
  compartidos, así que el asistente anota igual que la interfaz. Mover a columna
  terminal se anota «cerró» y salir de ella «reabrió».
- **Distinguir lo que hace el agente de lo que teclea la persona** — La columna
  `origen`. Sin ella la auditoría atribuiría a alguien las tareas que le pidió a
  su asistente.
- **La lectura del registro: línea de tiempo, recuento por persona e historia de
  una tarjeta** — `actividad.ts`. No calcula porcentajes: esa decisión sigue
  abierta.
- **Áreas del tablero, con delegado por defecto** — La 0039 y `crear_area` en el
  MCP.
- **«¿Qué ha pasado aquí desde…?» en el MCP** — `que_ha_pasado`. Entiende
  «ayer», «la semana pasada» o una fecha; agrupa por día y cuenta hacia
  adelante, porque una historia leída al revés se resume al revés sin que nada
  falle; y dice cuándo algo lo hizo el asistente de alguien y no esa persona.
  No resume a propósito: devuelve los hechos para que los resuma quien tiene el
  contexto de la conversación.
- **La pantalla de auditoría por persona** — Tercera vista de Auditoría, «El
  registro», leída de la 0038. Desglose por verbo y no un total —cuánto vale
  cerrar frente a crear sigue sin decidirse—, lo del asistente aparte, y
  «cuánto tarda en cerrarse» calculado de hechos fechados en vez de la
  aproximación por `updated_at` que la propia `auditoria.ts` avisaba de que
  era. Con su letra pequeña en pantalla, no solo en el código.
- **Control total de la tarjeta: tipo, prioridad, contexto, criterio, ramas y
  evidencia** — La 0042, con su API, su interfaz y sus dos herramientas nuevas
  del MCP (`enlazar_rama`, `marcar_hecha`). El tipo es vocabulario cerrado
  —ese eje no depende del proyecto, al contrario que las áreas—; la prioridad
  es número porque se ordena; contexto y criterio van separados porque se leen
  en momentos distintos, y el criterio se enseña justo al cerrar. La evidencia
  no se edita ni en la base: corregir es quitar y volver a poner.
- **Agrupar el tablero por área en la interfaz** — Filtro de chips con delegado
  y recuento. Filtro y no agrupación: agrupar partiría el tablero en una
  cuadrícula de áreas × columnas donde arrastrar deja de significar una sola
  cosa.
- **Código corto de invitación** — La 0040. Ocho símbolos del alfabeto de
  Crockford, que se puede dictar por teléfono. Guardado cifrado igual que el
  token, con una ruta para pedir otro si se pierde. No sustituye al enlace: la
  misma invitación tiene las dos puertas.
- **Arreglo: `is_org_admin` devolvía NULL en vez de `false`** — La 0041.
  Encontrado escribiendo lo de arriba, y era grave: cualquiera con sesión podía
  crear una invitación de administrador a una organización ajena sabiendo solo
  su id, y canjearla. `if not NULL` en PL/pgSQL no entra en el bloque, así que
  la comprobación de permisos no fallaba: se saltaba. En RLS no se notaba
  porque allí NULL y `false` niegan igual. Con su caso de regresión en
  `isolation.test.ts`.

### Workflow y flujos · Juan Medina

- **El riel ya no empuja la aplicación al desplazarse** — Un solo fallo
  explicaba tres síntomas. Ya fusionado en la #47.

---

## 3. Por hacer

### Workflow y flujos · Juan Medina

**Partida en dos caminos**, porque hay dos sesiones trabajándola a la vez desde
equipos distintos. El reparto está en [`CAMINOS.md`](CAMINOS.md) y es **por
archivos, no por temas**: ningún archivo pertenece a los dos caminos, que es lo
único que evita un conflicto de fusión en cada tanda. Cada tarea lleva enlazada
su rama, `camino-a` o `camino-b`, así que desde el tablero se ve quién está en
qué sin preguntar.

#### Camino A — el armazón y la navegación (`layout.tsx`, `Armazon`, `Pagina`)

- **Decidir qué pantalla es la portada** — Va ANTES de construir el armazón. Con
  el registro ya hecho, la línea de tiempo tiene más papeletas que un panel de
  tarjetas. Es una decisión, no una tarea de código.
- **El armazón de organización, naciendo con cajón para móvil** — Seis pantallas
  viven hoy sin barra. Construirlo con barra fija y desmontarlo después es justo
  lo que hay que evitar.
- **Marco de página: una cabecera, no cinco copiadas** — Y con él los tres
  finales de una carga: cargando, fallo, vacío.

#### Camino B — los datos y las piezas (`lib/`, primitivas, `page.tsx`)

- **Las primitivas que faltan, empezando por el diálogo de confirmación** — Ocho
  acciones irreversibles se deciden hoy en el cuadro gris del sistema operativo.
  Es lo que mejor relación esfuerzo/resultado tiene de todo el plan.
- **Capa de datos: acabar con los 88 `api.*` y 71 efectos sueltos** — Y escribir
  de paso la regla de errores: el de un campo junto al campo, el de una acción
  en un aviso flotante.
- **Partir las pantallas grandes** — Ventas tiene 1.273 líneas. Después de la
  capa de datos, no antes.

### DevVerse · Carlos Cáceres

- **La tabla de desbloqueos sobre el catálogo de avatar** — Lo más pequeño de
  todo y lo que abre la economía. El catálogo de índices ya existe.
- **Montar la tubería: modelo 3D, esqueleto y render a sprite** — Cuatro
  direcciones de girar el modelo, no de dibujarlas. Es la inversión; después
  cada prenda es barata.
- **Cuerpo base masculino y femenino, con mezcla libre** — Con el catálogo de
  cuerpos que recoge la inclusión pedida.
- **Editor de avatar comprobando la posesión**
- **Dos o tres skins enteras de salida**
- **El menú al acercarse: saludar y llamar** — La llamada individual es una sola
  conexión cifrada de punta a punta: no hay nada que romper.
- **Que el audio de la zona se agache al entrar en una llamada** — Media tarde,
  y es la diferencia entre «funciona» y «está bien hecho».
- **Decidir el tamaño del sprite y cuántos cuerpos base** — Abierto desde
  agosto y bloquea la tubería.

### Profundización de funcionalidades · Juan Bonilla

- **El «+» del riel, ahora que el código existe** — La API ya está (0040); falta
  la pantalla: pegar un código, ver de qué organización es y entrar.
- **Tope de sala para compartir pantalla, y decirlo** — En malla, compartir con
  seis son cinco subidas de vídeo desde un portátil. Hay que poner el tope y
  que se vea, no descubrirlo en una reunión.
- **Reconstruir el contexto de una tarea en un botón** — El PR, los mensajes, la
  pizarra y la grabación. Es la tesis del producto en un clic.
- **El diario del proyecto, versión cronológica** — Agrupar el registro por
  semana. La versión en prosa necesita el agente y va después.
- **Decidir qué se cuenta como participación** — La decisión más delicada de
  todas y la que más cuesta deshacer.

---

## 3bis. Lo que necesita variables de entorno · Juan Bonilla

**Por qué van todas juntas y a la misma persona.** No es un criterio temático
—hay correo, vídeo, música y respaldos mezclados— sino de acceso: son las
tareas que **no se pueden terminar desde el editor**. Cada una acaba en un
panel de un tercero, una clave pegada en el entorno de producción y un
despliegue para comprobar que quedó bien. Repartirlas por área significaría
que tres personas piden las mismas credenciales y ninguna sabe cuáles están ya
puestas. Van al área de profundización porque es donde ya viven las
integraciones.

**Todas tienen la misma forma de «hecho»**: la variable puesta en producción,
anotada en `.env.example` con su comentario, y **comprobada contra el sistema
de verdad** —no «la puse», sino «mandé un correo y llegó»—. Lo sacado del
código: `apps/api/src/env.ts` declara 37 variables y estas son las que hoy
están vacías o apuntando a local.

- **TURN de verdad, propio o gestionado** — `TURN_URLS` + `TURN_SECRET`, o
  `METERED_APP_NAME` + `METERED_API_KEY`. Hoy están las cuatro vacías y solo
  hay STUN. El propio `env.ts` avisa al arrancar en producción: sin TURN «las
  llamadas conectarán pero no se oirá nada en NAT simétrico ni en buena parte
  de las redes móviles». Es el fallo que más caro sale de descubrir en una
  demo. **Con credenciales temporales, no fijas**: `TURN_STATIC_*` es solo para
  el coturn de desarrollo y en producción el arranque lo rechaza.
- **Correo que salga de verdad** — `MAIL_API_KEY` (+ `MAIL_API_URL`,
  `MAIL_FROM`) o `SMTP_URL`. Sin esto las invitaciones y los correos de
  recuperación **se escriben en el registro** y nadie los recibe. La vía de
  producción es la API HTTP, no SMTP: las plataformas gestionadas bloquean los
  puertos 25/465/587 y ahí SMTP no falla, se queda esperando —la invitación se
  crea y nadie se entera de que no llegó—. Bloquea el código corto de
  invitación: sin correo, el código hay que dictarlo por teléfono siempre.
- **Respaldos fuera de la máquina, con restauración probada** —
  `RUTA_RESPALDOS`. Los guiones ya existen (`scripts/respaldo-*.sh`,
  `probar-restauracion.sh`), pero por defecto escriben en `./respaldos`, **el
  mismo disco que la base y el almacén**. Un respaldo que muere con lo que
  respalda no es un respaldo. La tarea no está hecha hasta que
  `probar-restauracion.sh` levanta una copia desde el destino remoto.
- **Custodia y rotación de `VAULT_MASTER_KEY`** — Descifra todas las
  credenciales de terceros guardadas en la bóveda: perderla es perderlas
  todas, y cambiarla sin rotar también. `rotar-clave-boveda.mjs` ya existe;
  falta decidir dónde vive la clave, quién la tiene y cada cuánto se rota, y
  escribirlo. Es media hora de decisión y cero de código, pero mientras no
  esté, hay un solo punto de fallo sin dueño.
- **Entrar con Google** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`. Sin las tres la ruta devuelve 404 y la web no enseña
  el botón, que es el comportamiento correcto. Ojo con la de redirección:
  coincide carácter a carácter o el error es `redirect_uri_mismatch`, que no
  dice cuál esperaba.
- **Spotify, y el trámite de sacarlo del modo desarrollo** —
  `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`. Aquí la
  variable es lo fácil: en modo desarrollo Spotify solo admite **cinco cuentas
  dadas de alta a mano**, y salir de ahí exige cifras de organización grande.
  La tarea real es averiguar hasta dónde llegamos y decidir si la zona de
  música sale con Spotify limitado a los cinco o solo con YouTube.
- **YouTube como segunda fuente** — `YOUTUBE_API_KEY`. La que no tiene lista
  blanca, así que es la que hace que la música funcione para quien se registre
  hoy. Sin ella, buscar contesta que no está configurada y pegar un enlace
  tampoco funciona.
- **Almacén de producción apuntando a un bucket real** — `S3_ENDPOINT`,
  `S3_ENDPOINT_INTERNO`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`. Las dos direcciones no son redundancia: la pública la
  abre el navegador de cada persona con las URLs firmadas, la interna es por
  donde el servidor se habla a sí mismo. Con una sola, comprobar una subida
  salía a internet y volvía —154 ms medidos contra 3 ms— y cualquier corte de
  salida se convertía en «la subida no llegó» sobre un archivo bien guardado.
- **Tope de sala para compartir pantalla** — La variable y que **se vea en la
  interfaz**. En malla, compartir con seis son cinco subidas de vídeo desde un
  portátil. Está también arriba, en la lista general, porque tiene mitad de
  código; se repite aquí porque sin la variable no se puede ajustar sin
  desplegar.

---

## 4. Dos cosas sobre cómo usar esto

**Las tareas «hechas» van al tablero igualmente.** No es para inflar la lista:
es que el registro de actividad ya anota quién cerró qué y cuándo, así que una
tarea creada y movida a «Hecho» deja su rastro y la auditoría empieza a tener
algo que contar desde el primer día.

**Las que son decisiones van marcadas como tales** —la portada, el tamaño del
sprite, qué cuenta como participación—. Son tareas de media hora de
conversación, no de código, y mezclarlas con las de semanas hace que el tablero
mienta sobre cuánto queda.
