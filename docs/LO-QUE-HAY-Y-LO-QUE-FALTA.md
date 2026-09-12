# DevUP · Lo que hay y lo que falta

Estado real del producto a 9 de septiembre de 2026 (la sección «pantalla por
pantalla» viene de una auditoría de Juan probando cada una a mano ese día;
el resto es del 3 de septiembre y sigue vigente). Este documento y
[PLAN-DE-PRODUCCION.md](PLAN-DE-PRODUCCION.md) son los dos únicos que hay que
leer para ponerse al día; el resto de documentos de planificación se retiraron
porque decían cosas distintas entre sí y ya nadie sabía cuál valía.

Para el trabajo que viene —el motor agéntico— la guía es
[HEARTH-Y-LA-PUERTA-MCP.md](HEARTH-Y-LA-PUERTA-MCP.md).

Lo que **no** está aquí, a propósito:

- El **porqué** de las decisiones caras vive en [`decisiones/`](decisiones/), y
  el código las cita por ruta. No se tocan.
- Cómo se **despliega**: [PLAN-DE-PRODUCCION.md](PLAN-DE-PRODUCCION.md).
  Por qué la voz no se oye sin TURN: [TURN.md](TURN.md).

---

## Dónde vive DevUP

Nada corre ya en el portátil de nadie. Cinco piezas, las cinco fuera:

| Pieza | Dónde | Dirección |
|---|---|---|
| Web (aplicación + landing) | Cloudflare Workers | `devup.hytrex.co` |
| API | Railway | `api.hytrex.co` |
| Tiempo real (WebSockets) | Railway | `live-production-976a.up.railway.app` |
| Base de datos | Railway, red privada | `postgres.railway.internal` |
| Archivos (MinIO) | Railway, con volumen | `storage-production-2cdb.up.railway.app` |

**La API pasó a `api.hytrex.co` el 9 de septiembre por la noche, y no fue
estética: era lo que dejaba entrar a la gente.** Con la API en
`api-production-7b95.up.railway.app` y la web en `hytrex.co`, la cookie de
sesión era de terceros, y Safari en macOS las bloquea de fábrica. Ver la
trampa correspondiente. El dominio de Railway sigue vivo y sirve de vuelta
atrás: `NEXT_PUBLIC_API_URL` es una variable del repositorio.

**`live.hytrex.co` sigue sin usarse**, y no corre prisa: el tiempo real no
autentica por cookie sino por un tique de un solo uso, así que estar en otro
dominio no le afecta.

`hytrex.co` (el apex) sigue apuntando a un túnel que ya no existe y da 530,
aunque la landing está desplegada. Es un cambio de DNS.

---

## Lo que funciona hoy

Todo lo de esta lista está probado contra producción, no solo escrito.

### Entrar
- Correo y contraseña, y **entrar con Google** (cualquier cuenta, no solo
  `@hytrex.co`).
- Se puede **ver la contraseña** al escribirla.
- Cada empresa es su propia organización, aislada por RLS en la base.

### Invitaciones
- Al invitar aparece el **enlace para copiarlo** y mandarlo por donde sea. No
  depende de que el correo llegue.
- El correo **sí** sale: Resend configurado y el dominio verificado.
- **Se invita a un workspace concreto**, no siempre a toda la organización.
  Quien entra invitado a un workspace ve ese y ninguno más; quien entra a la
  organización entera los sigue viendo todos (`organization_members.all_workspaces`).

### Música
- **Spotify**: catálogo, reproducción sincronizada por sala, cola compartida.
  Limitado a **5 cuentas** dadas de alta a mano — ver la sección de límites.
- **YouTube**: sin lista blanca, para todo el que se registre. Se busca o se
  pega un enlace. El vídeo se ve en una esquina, y tiene que verse: lo exigen
  los términos de YouTube.

### Canales, presencia y tema
- **Canales de texto y voz/vídeo: totalmente funcionales.**
- **Estados de presencia tipo Discord** (disponible, ocupado, no molestar).
- **Tres temas**: claro, oscuro y el que decida el sistema operativo.

---

## Pantalla por pantalla (auditoría del 9 de septiembre, revisada el 11)

Lo que Juan encontró probando cada apartado a mano. Reemplaza a la vieja
línea «todo eso ya estaba y sigue en pie» — que era cierta a medias: estaba,
pero no toda "en pie" de la misma forma.

**Revisado el 11 de septiembre.** Cuatro filas decían «no funcional» y ya no es
cierto, y una de ellas nunca lo fue: lo que estaba roto no eran las pantallas
sino dos cosas debajo. La causa está contada en
[AUDITORIA-DE-LA-APLICACION.md](AUDITORIA-DE-LA-APLICACION.md) §0 y en los
commits `b01d928` (GitHub por enlace) y `488dcbd` (el fallo de la capa de
datos). Se deja lo que decía cada fila, tachado, porque un documento de estado
que borra sus propios errores no sirve para aprender de ellos.

| Pantalla | Estado |
|---|---|
| **Panel** | Funciona: saludo, fecha, tareas pendientes, quién está conectado, música (Spotify/YouTube), infraestructura y tareas asignadas. |
| **Mesa** | Básico. El catálogo de herramientas para añadir no está completo. |
| **Biblioteca** | Solo sube archivos y quedan en el workspace. **Pendiente revisar si de verdad persisten** (no confirmado más allá de la subida). |
| **Tablero** | Básico: añadir y asignar tareas, y desde la 0037 una tarea puede estar **hecha**. Falta que se comporte dinámico, tipo Trello (arrastrar entre columnas). |
| **Ventas** | CRUD de clientes, ventas y servicios, con balance automático. Funcional para lo básico. |
| **GitHub** | ~~Falla la conexión por token; explorar que baste con pegar el link del repo~~ → **hecho**: se pega el enlace y ya, sin token. El token pasó a ser lo que hace falta solo para repositorios privados, y es de cada workspace. Sigue siendo solo lectura. |
| **Noticias** | Se publican y notifican, pero al pulsar para ver el detalle **lleva a una pantalla distinta del workspace principal, sin una vuelta intuitiva**. Carlos ya corrigió el widget de Mesa el 8 de septiembre (PR #38, en `main` pero **todavía sin desplegar**); falta unificar el resto y que «volver» regrese a la pestaña donde se estaba, no a un sitio fijo. |
| **Infraestructura** | ~~No funcional.~~ → **Funciona.** Nunca estuvo vacía: lo que fallaba era que crear o sincronizar un entorno dejaba la pantalla cargando para siempre, por un fallo de la capa de datos. Además tiene ahora la pestaña **Arquitectura**: un diagrama de nodos y enlaces que se dibuja a mano o lo genera el agente por MCP. |
| **Base de datos** | ~~No funcional~~ → **Funciona.** Lee las migraciones del repositorio y las pasa por el criterio. Lo que la rompía era un 500 sin explicación cuando GitHub contestaba mal; ahora dice qué pasó. Sin token lee 12 archivos en vez de 40, por el cupo anónimo compartido. |
| **Integraciones** | ~~No funcional — solo pide conectar GitHub.~~ → **Funciona** sin token, por el mismo arreglo. Sigue siendo un diagnóstico de seis reglas: señala lo que se está haciendo a mano, no lo monta. |
| **Entorno de desarrollo** | Mal resuelto: al entrar cambia de pestaña sola. Solo ofrece Node.js. No funciona en la VPS. Desde la 0035 vive dentro del workspace, porque lo que abre son sus repositorios. |
| **Ajustes de organización** | Básico: cambiar foto, ver usuarios, añadir enlaces y personas. Nada más todavía. |
| **Perfil de usuario** | ~~No existe personalización todavía.~~ → **Existe** desde la PR #42: nombre, cargo y foto, y el cargo se ve donde sirve y no solo dentro de DevVerse. |

**Y una cosa que la tabla no decía porque no se veía:** hasta la migración 0035,
GitHub, Base de datos, Infraestructura y Arquitectura colgaban de la
organización, así que los tres proyectos de una empresa veían exactamente los
mismos repositorios y entornos. Ahora cada workspace tiene su git, su base, su
infraestructura y su propia credencial.

---

## Lo que falta

Ordenado por lo que más duele.

### Bloqueado por terceros, no por nosotros
- **Spotify solo admite 5 cuentas.** Su app está en «modo desarrollo» y hay que
  dar de alta a cada persona a mano en su panel, con el correo de su cuenta.
  Salir de ahí (Extended Quota Mode) exige, desde mayo de 2025, ser una
  organización con **250.000 usuarios activos al mes**. No es configuración: es
  un muro. Por eso existe YouTube al lado.
- **YouTube: 100 búsquedas al día** en la cuota gratuita (una búsqueda cuesta
  100 de 10.000 unidades). **Pegar un enlace cuesta 1**, así que ese camino
  aguanta cuando la búsqueda se agota, y el mensaje de error lo dice.
- **Vídeos bloqueados por el titular de los derechos.** `videoEmbeddable=true`
  en la búsqueda no basta: hay vídeos que solo se descubren imposibles al
  ponerlos. Se saltan solos al siguiente de la cola y se avisa por qué.

### Nuestro, y pendiente
- **Respaldo del almacén de archivos.** El volcado automático de GitHub Actions
  es solo de la base. Hoy no urge —el almacén está vacío— pero en cuanto haya
  archivos de verdad hace falta.
- ~~**El respaldo de la base apunta a Supabase**~~ — **rehecho contra Railway**
  el 12 de septiembre de 2026. Iba roto por partida doble: apuntaba a una base
  de la que el producto ya se había ido, y volcaba con `pg_dump` 17 contra un
  servidor 18, que se niega. Ahora abre un túnel con la CLI de Railway —y no un
  proxy TCP público: una base expuesta para que la respalde un cron es la clase
  de puerta que nadie recuerda haber abierto— y **se restaura a sí mismo en un
  Postgres de usar y tirar antes de guardarse**, comprobando que trae
  organizaciones y no solo tablas. Un respaldo que nadie ha restaurado nunca se
  descubre el día que hace falta, que es el único día en que no se arregla.
  **Queda por poner los secretos `RAILWAY_TOKEN` y `POSTGRES_PASSWORD`** en el
  repositorio; hasta entonces el trabajo para en el primer paso y lo dice.
- **`search_path` fijo** en seis funciones que no lo llevan (`current_user_id`,
  `global_search`, `mark_channel_read`, `touch_opportunity`, `touch_task`,
  `unread_counts`). Ninguna es `security definer`, así que es higiene, no un
  agujero.
- ~~**`user_tokens` es una tabla muerta**~~ — **era falso, y borrarla habría
  roto producción.** `account.ts` la usa para verificar el correo y para
  restablecer la contraseña, a través de `issue_user_token` y
  `consume_user_token`, que son `security definer`. No tiene política porque
  nadie la consulta directamente **a propósito**. Se queda como está. Se
  descubrió el 9 de septiembre leyendo el código para diseñar la puerta MCP.
- **Partir `ventas`** (1.273 líneas) en cabecera, embudo, clientes y
  cotizaciones. Pide las pruebas de navegador antes: es mover código sin
  cambiar comportamiento, y sin red se hace a ciegas.
- **Responsive dentro de las pantallas grandes.** El embudo y el tablero se
  desplazan a lo ancho, pero sus tarjetas están pensadas para un monitor.
- **El reparto del mundo corre en un `setInterval`** dentro del proceso de la
  API. Con dos instancias habría dos relojes. Hoy no duele.
- **El repositorio es público.** No hay secretos dentro, pero conviene saberlo.

### Solo Juan
- Dar de alta compañeros en el panel de Spotify (5 plazas).
- Apuntar `hytrex.co` a la landing.

---

## Trampas que ya costaron horas

Están aquí porque volver a caer sale caro.

- **Web y API tienen que compartir dominio registrable, o Safari deja fuera a
  media plantilla.** Si la API vive en un dominio distinto al de la web, su
  cookie de sesión es de terceros y hace falta `SameSite=None`; Safari en
  macOS trae «Impedir el seguimiento entre sitios» activado de fábrica y la
  tira. Y el fallo no se parece a un fallo de sesión: `POST /auth/login`
  contesta **200** y el `GET /auth/me` de dos líneas después contesta **401**,
  así que parece que la contraseña está mal. En los registros se ve como una
  persona reintentando cinco veces con contraseña y siete con Google sin
  conseguir una sola sesión, mientras a otra le entra a la primera desde
  Chrome. Costó una noche el 9 de septiembre.
- **RLS falla en silencio.** Tabla sin política = cero filas y ningún error.
  Toda tabla nueva necesita política **y** caso en `isolation.test.ts`.
- **`db:migrate` cambia la contraseña de `devup_app`, y la saca de
  `APP_DB_PASSWORD` — que `dotenv` rellena desde tu `.env`.** Al migrar contra
  un entorno remoto hay que pasarla **a mano**, con la que ese entorno ya usa
  (la de su propio `DATABASE_URL`). Si no, le pone la de tu portátil: la API se
  queda sin poder entrar a su propia base y `/health` sigue en 200 porque no la
  toca, así que parece que todo va bien mientras nada funciona.
  Esta trampa se cobró dos caídas —3 y 9 de septiembre— y la segunda fue
  siguiendo esta misma lista, que hasta entonces señalaba `DATABASE_URL`, la
  variable equivocada. Desde el 9 hay una **guarda en `migrate.ts`**: si el
  destino no coincide con el del `.env` y la contraseña no viene explícita,
  para antes de tocar nada.
  Y ojo con cómo se prueba esa guarda: **no contra el túnel de producción**.
  Probarla ahí con una contraseña de mentira es exactamente el fallo que la
  guarda existe para evitar, y así se cobró la tercera caída del mismo día.
- **Una política de SELECT que llama a una función que vuelve a consultar la
  misma tabla rompe `insert ... returning`.** Postgres aplica la política de
  SELECT también a la fila recién insertada, y la función no la ve todavía.
  Las políticas de una tabla se escriben sobre las columnas de su propia fila.
- **`globals.css` tiene `body > * { position: relative }` fuera de toda capa
  CSS.** Las utilidades de Tailwind van dentro de una capa, y en la cascada lo
  no-capado gana sin importar la especificidad: `fixed` y `absolute` se quedan
  en `relative`. Si algo tiene que flotar, la posición va en línea.
- **`NEXT_PUBLIC_*` se incrusta al compilar.** Cambiarlas obliga a reconstruir
  y volver a desplegar la web; cambiarlas en el panel no hace nada.
- **El error real no está en el texto del registro** de Railway sino en el
  campo `err` de la entrada estructurada: `deploymentLogs { attributes }`.
- **No lanzar `npm run build` con el servidor de desarrollo corriendo.** Le
  pisa `.next` y responde 500 a todo, con un error que no menciona la causa.

---

## Cómo se verifica que algo funciona

```bash
npm run typecheck      # los dos paquetes
npm run test:rls       # aislamiento entre organizaciones (necesita Postgres)
npm run test:youtube   # análisis de enlaces de YouTube
npm run test:google    # qué tokens de Google se aceptan
npm run test:world     # el reparto del mundo
npm run test:migraciones
```

`test:rls` es el que importa: si alguien añade una tabla y se olvida de su
política, ahí es donde se ve.
