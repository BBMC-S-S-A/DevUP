# Estado del producto

Qué hace DevUP hoy y qué le falta. Escrito a partir del código —rutas,
migraciones y pantallas contadas una a una—, no de lo que los planes prometían.

Fecha: 29 de agosto de 2026 · todo lo de aquí está **desplegado en producción**.

**En una línea:** las tres promesas del producto están en pie. El espacio de
trabajo y el control de ventas, completos desde hace semanas; la tercera
—infraestructura— tiene ya su vista de entornos y despliegues, la base de datos
como código y las integraciones guiadas. Lo que no existe todavía de esa tercera
promesa son los **agentes**.

---

## De un vistazo

| | |
|---|---|
| Endpoints de API | **134** en 18 módulos |
| Tablas en base | **45**; 44 con política de aislamiento |
| Migraciones | **24** |
| Pantallas | **21** |
| Aislamiento entre organizaciones | **172** comprobaciones, en verde |
| Socket del mundo | **13**, en verde |
| Criterio de migraciones | **26**, en verde |
| Diagnóstico de integraciones | **20**, en verde |
| Integración continua | `ci.yml`: tipos, migraciones, aislamiento, mundo, criterio, diagnóstico, idempotencia y build |
| Guiones de navegador | **ninguno**. Es el hueco más grande que queda |

> La tabla anterior decía 42 tablas «con RLS en todas». La que falta es
> `schema_migrations`, que no guarda datos de nadie. Lo encontró el propio
> analizador de migraciones al correrse contra este repositorio.

---

## 1. Lo que funciona hoy

### Espacio de trabajo — completo

Organizaciones, espacios, canales, miembros y roles (propietario, admin,
miembro). Invitaciones por correo con caducidad; verificación de cuenta y
recuperación de contraseña.

- **Mensajería** por canal, con edición, borrado y marcado de leído.
- **Voz y vídeo** en malla WebRTC, con cifrado extremo a extremo (decisión
  0001), pantalla compartida, y **llamada persistente**: cambiar de pantalla no
  cuelga.
- **Grabación** de llamadas con consentimiento explícito de cada participante.
- **Archivos** con subida directa al almacén en tres pasos (reservar, subir,
  confirmar), etiquetas, previsualización y descarga firmada.
- **Tareas** en tablero por columnas, con etiquetas.
- **Notificaciones** con bandeja y marcado.
- **Búsqueda global** sobre mensajes, archivos, tareas, clientes, servicios y
  oportunidades, desde un solo sitio en vez de por espacio.
- **Paleta de comandos** con `⌘K` sobre esa misma búsqueda, desde cualquier
  pantalla.
- **Dos temas**, claro y oscuro, con «seguir al sistema» por defecto.
- **Estado de presencia** con tres valores, y el del medio es el que importa:
  *ocupado, pero abierto a llamadas*.
- **Navegación en cajón** debajo de 768 px, compartida por los dos armazones.

### Control de ventas — completo

Servicios, clientes, embudo de oportunidades, cotizaciones con líneas
editables, y objetivos que avanzan solos con las ventas.

El dinero va en **céntimos enteros de punta a punta**; solo se divide para
mostrarlo.

### Vista inmersiva (DevVerse) — funcional, en beta

El espacio recorrible con avatares, salas, zonas y muebles. Reparto de presencia
por zonas para que la malla de voz no pida una conexión por cada persona de la
organización. Editor de escenarios.

Tiene sus propios 13 casos de prueba del socket.

Y desde esta semana:

- **Cartelera** sobre cada personaje con nombre, rol y estado.
- **Acercarse abre un menú** —saludar o llamar—, y las cámaras se encienden solo
  si los dos aceptan. Una llamada individual son dos navegadores y una conexión
  directa, cifrada por definición.
- **Pizarra compartida** por el canal de datos de esa misma conexión: el
  servidor nunca ve lo que se dibuja.
- **Atuendos por organización**: el personaje base es quién eres, el atuendo es
  cómo vas aquí.

### Infraestructura — en pie; agentes, sin abrir

- **Vista de entornos y despliegues**: qué corre dónde y en qué estado quedó lo
  último que entró, con su commit, su autor y un enlace al registro. Pregunta a
  GitHub y **no despliega nada**: la decisión cerrada es orquestar, no competir
  con los proveedores.
- **Base de datos como código**: lee las migraciones del repositorio del cliente
  y las pasa por el criterio —solo se añade, se puede aplicar dos veces, el
  aislamiento va en la misma migración—. Eso es el producto, no un detalle
  interno: el criterio se aprendió a base de un fallo silencioso que costó una
  migración entera encontrar.
- **Integraciones guiadas**: qué se está resolviendo a mano y qué lo ahorraría,
  con la prueba delante —archivo y línea—. No es un catálogo, y esa es toda la
  diferencia: quien no sabe que una herramienta existe no la busca.
- **Bóveda de credenciales**: `connections` + `connection_secrets`, cifrado
  AES-256-GCM con una clave maestra propia, separada de la de sesiones, y con
  **rotación de esa clave** en una sola transacción.
- **Conector de GitHub**: repos con commits recientes, PRs e issues abiertas,
  estado de la última ejecución de CI, refrescado cada 10 minutos.
- **Música compartida**: reproducción real por canal y estado repartido por el
  mismo socket que los mensajes. La cola guarda **la canción y no el enlace**
  —su identificador internacional de grabación—, así que sobrevive al día que
  alguien se cambie de servicio.
- **Entorno de desarrollo embebido** (`/dev`): editor Monaco y terminal real
  sobre WebContainer. Fase 0.

### Personalización

- **Panel personal** en rejilla: cada tarjeta se arrastra y se redimensiona, y
  se guarda por persona. Nadie más en la organización puede verlo ni tocarlo.
- **Noticias** de la organización y **enlaces fijados**.
- **Foto de la organización**.

---

## 2. Lo que está a medias, y en qué punto

**Spotify: funciona, pero con un techo que no es nuestro.** La aplicación está
en *modo desarrollo* en el panel de Spotify, y eso impone dos límites que **no
se arreglan con código**:

- Solo **5 cuentas** además del dueño pueden usarla. Hoy la lista está vacía, así
  que a cualquier compañero le falla todo con «The user is not registered for
  this application».
- Las **canciones de una lista no se pueden leer** (403 en
  `/playlists/{id}/tracks`, también con `fields`, con `market` y pidiendo la
  lista entera). Se dejó de intentar a propósito. Poner una lista entera sí
  funciona, porque va por `context_uri`.

La salida de ambos es la misma: pedir la extensión de cuota en el panel de
Spotify.

**Entorno de dev (`/dev`): Fase 0 y con una condición frágil.** Necesita
aislamiento cross-origin, que ahora está acotado a su ruta porque aplicado a
todo el sitio impedía que el reproductor de Spotify arrancase. Eso obliga a
entrar por navegación dura (`<a>`, no `<Link>`). **Si alguien lo convierte en
`<Link>`, el entorno deja de funcionar** y no es evidente por qué.

**Conector de GitHub: falta explicar sus 404.** Un 404 al añadir un repo casi
siempre es que el token de alcance fino no lo tiene autorizado, o que la
organización bloquea esos tokens. No es un fallo de DevUP, pero la interfaz no
lo dice y parece uno.

---

## 3. Lo que falta

### Lo que cierra la tercera promesa

- **Agentes** sobre el entorno embebido. Antes de escribir código hacen falta
  dos decisiones: qué puede tocar un agente y con qué credenciales. La regla de
  producto sí está decidida y no se negocia: **el agente propone y la persona
  aprueba**.
- **Montar la integración**, que es la segunda mitad de las guiadas. Hoy se
  diagnostica; el «¿lo monto?» —crear el proyecto, guardar las claves en la
  bóveda, escribir el esquema— necesita credenciales del proveedor.
- **El segundo proveedor de despliegues**. La vista lee de GitHub; hasta que no
  haya otro no se sabrá si la traducción de estados aguanta.
- **Encender los muebles de DevVerse** con lo que ya sabe la vista de
  infraestructura: la pantalla de despliegue y el rack de servidores siguen
  siendo decorado.
- **DevUP ID** y la beta.

### Calidad e infraestructura propia

- **No hay una sola prueba que abra un navegador.** `ci.yml` cubre bien lo
  difícil —tipos, migraciones, aislamiento, mundo, el criterio de migraciones, el
  diagnóstico de integraciones, idempotencia y build— y nada de eso ejercita la
  interfaz. Ahí es donde se esconden los fallos que ninguna prueba de tipos ve:
  el bucket del almacén que nunca se creaba pasó meses sin detectarse porque solo
  se manifestaba a mitad de una subida real. Hay cinco pruebas de Playwright
  escritas en `claude/inicio-desarrollo-nu1ftu`, sin cosechar.
- **El despliegue automático está escrito pero no enchufado.** El runner está
  descargado y sin configurar: no hay `.runner` ni servicio. Y hay una
  contrapartida que conviene decidir antes de registrarlo: como Docker se abre
  solo mientras se trabaja —a propósito, es un MVP—, un despliegue con la máquina
  apagada falla en el `docker compose up`. No rompe producción, pero el rojo
  llega igual.
- **Redis** para presencia y límite de peticiones, el día que haya más de una
  instancia de API. Hoy ambos viven en memoria y no sobreviven a un segundo
  proceso.
- **SMTP real.** Sin él, invitaciones y recuperaciones se escriben en el registro
  del servidor en vez de enviarse: funciona para probar, no para usar.
- **TURN** para las llamadas. Sin él conectan, pero no se oye nada en NAT
  simétrico ni en buena parte de las redes móviles.
- **Llevarse las copias fuera de la máquina.** Los respaldos existen, con
  restauración probada, y viven en el mismo disco que la base. Son 2 MB: se
  copian a mano con un `tar` y no piden ninguna infraestructura. Lo que sí es
  urgente y no está hecho es sacar `.env.production` de aquí — lleva la clave
  que descifra la bóveda y existe en un solo archivo, en un solo ordenador.

### Pendientes acotados

- **Histéresis de tres radios dentro de una sala** (~8 puntos). El reparto por
  zonas resuelve veinte personas en cuatro salas; no resuelve doce en una, donde
  la malla vuelve a pedir once conexiones por cabeza. Descrito en §11 bis de la
  decisión 0002.
- **Decisiones 0003 y 0004 sin aprobar**: arquitectura de despliegue (monolito
  frente a microservicios, VPS con y sin coste) y el conector de GitHub embebido
  con la semilla de agente.

---

## 4. Riesgos y deuda que conviene tener presentes

**Un arreglo mejor lleva días sin fusionar.** El 415 detrás del túnel está
resuelto en main **en el cliente**; en `claude/inicio-desarrollo-nu1ftu` hay una
solución **en el servidor** —analizador comodín que acepta cuerpo vacío, más
prueba de regresión— que protege a cualquier cliente y no solo al nuestro. La
rama también trae 5 pruebas de navegador en Playwright, que son justo el trozo
que a la integración continua le falta: hoy cubre tipos, migraciones y
aislamiento, pero nada que abra un navegador.

**RLS falla en silencio.** Una tabla sin política no da error: afecta 0 filas y
sigue. Ya pasó una vez —el refresco de tokens de Spotify no persistía nada— y
costó una migración (0018) encontrarlo. Toda tabla nueva necesita política **y**
un caso en `isolation.test.ts`, y todo UPDATE que importe debe comprobar
`rowCount`, no que no haya excepción.

**`VAULT_MASTER_KEY` no se puede perder ni cambiar.** Descifra todas las
credenciales de terceros guardadas. Si cambia, todas las conexiones quedan
indescifrables para siempre y hay que rehacerlas una a una.

**Las subidas estuvieron rotas desde el principio sin que se notara.** El bucket
del almacén nunca llegó a crearse: la API lo intentaba en cada arranque, MinIO lo
rechazaba y el aviso se perdía entre los registros. Como los bytes van directos
del navegador al almacén, el fallo era invisible desde el servidor. Arreglado el
18 de agosto. El patrón —un fallo de arranque que solo se manifiesta a mitad de
un flujo de tres pasos— es el que conviene vigilar en el resto.

**La oficina beta es zona restringida.** Instrucción expresa: no se toca
`components/world/**`, `lib/world/**`, las rutas de `devverse` ni
`lib/view-mode.tsx` sin pedirlo.

---

## 5. Cómo comprobar que sigue en pie

```bash
npm run typecheck && npm run test:rls && npm run test:world
```

Los tres tienen que estar en verde antes de empezar nada. Los guiones de
navegador, a mano, están descritos en `e2e/README.md`.

Desplegar:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

---

## Por dónde seguir leyendo

1. [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — el informe de estado vivo.
2. [`CONTEXTO-COMPLETO.md`](CONTEXTO-COMPLETO.md) — arquitectura y el porqué de
   cada decisión de la base.
3. [`traspaso-2026-08-18-fusion-y-boveda.md`](traspaso-2026-08-18-fusion-y-boveda.md)
   — lo aprendido en la sesión del 17–18 de agosto, con las trampas que ya
   costaron tiempo.
4. [`decisiones/`](decisiones/) — lo cerrado, que no se reabre sin motivo nuevo.
