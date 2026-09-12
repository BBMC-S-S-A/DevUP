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

### Workflow y flujos · Juan Medina

- **El riel ya no empuja la aplicación al desplazarse** — Un solo fallo
  explicaba tres síntomas. Ya fusionado en la #47.

---

## 3. Por hacer

### Workflow y flujos · Juan Medina

- **Decidir qué pantalla es la portada** — Va ANTES de construir el armazón. Con
  el registro ya hecho, la línea de tiempo tiene más papeletas que un panel de
  tarjetas. Es una decisión, no una tarea de código.
- **«Te espera» con trabajo real, no avisos** — Hoy lista notificaciones sin
  leer, que son hechos que ocurrieron, no trabajo pendiente. Con `is_terminal`
  ya se puede construir de las tareas en columnas no terminales.
- **El armazón de organización, naciendo con cajón para móvil** — Seis pantallas
  viven hoy sin barra. Construirlo con barra fija y desmontarlo después es justo
  lo que hay que evitar.
- **Marco de página: una cabecera, no cinco copiadas** — Y con él los tres
  finales de una carga: cargando, fallo, vacío.
- **Las primitivas que faltan, empezando por el diálogo de confirmación** — Ocho
  acciones irreversibles se deciden hoy en el cuadro gris del sistema operativo.
  Es lo que mejor relación esfuerzo/resultado tiene de todo el plan.
- **Capa de datos: acabar con los 88 `api.*` y 71 efectos sueltos** — Y escribir
  de paso la regla de errores: el de un campo junto al campo, el de una acción
  en un aviso flotante.
- **Agrupar el tablero por área en la interfaz** — La base ya lo devuelve; falta
  que la pantalla lo use, con filtro y contador por área.
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

- **Código corto de invitación** — Las invitaciones ya existen con su token y su
  canje; falta un código que se pueda dictar por teléfono. Una columna en
  `invitations` y un campo donde pegarlo. Es lo que necesita el «+» del riel.
- **«¿Qué ha pasado aquí desde…?» en el MCP** — Ya tiene de dónde leer.
- **La pantalla de auditoría por persona** — Qué cerró, cuánto y cuánto tardó,
  sobre el recuento que ya devuelve la API.
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

## 4. Dos cosas sobre cómo usar esto

**Las tareas «hechas» van al tablero igualmente.** No es para inflar la lista:
es que el registro de actividad ya anota quién cerró qué y cuándo, así que una
tarea creada y movida a «Hecho» deja su rastro y la auditoría empieza a tener
algo que contar desde el primer día.

**Las que son decisiones van marcadas como tales** —la portada, el tamaño del
sprite, qué cuenta como participación—. Son tareas de media hora de
conversación, no de código, y mezclarlas con las de semanas hace que el tablero
mienta sobre cuánto queda.
