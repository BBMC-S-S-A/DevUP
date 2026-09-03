# DevUP · Lo que hay y lo que falta

Estado real del producto a 3 de septiembre de 2026. Este documento y
[PLAN-DE-PRODUCCION.md](PLAN-DE-PRODUCCION.md) son los dos únicos que hay que
leer para ponerse al día; el resto de documentos de planificación se retiraron
porque decían cosas distintas entre sí y ya nadie sabía cuál valía.

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
| API | Railway | `api-production-7b95.up.railway.app` |
| Tiempo real (WebSockets) | Railway | `live-production-976a.up.railway.app` |
| Base de datos | Railway, red privada | `postgres.railway.internal` |
| Archivos (MinIO) | Railway, con volumen | `storage-production-2cdb.up.railway.app` |

**Los dominios bonitos (`api.hytrex.co`, `live.hytrex.co`) están pendientes**:
sus certificados se quedaron atascados en Railway durante horas con el DNS ya
correcto, así que se apuntó todo a los dominios `*.up.railway.app`, que
funcionan desde el primer minuto. Cuando Railway los emita, hay que cambiar
`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` **y reconstruir la web** (se
incrustan al compilar), más `GOOGLE_REDIRECT_URI` y `COOKIE_SAME_SITE=lax`.

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

### Lo demás
Canales de texto y voz cifrada extremo a extremo, biblioteca de archivos,
tablero de tareas, embudo de ventas, conector de GitHub, entorno de desarrollo
embebido, DevVerse y la mesa de trabajo. Todo eso ya estaba y sigue en pie.

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
- **El respaldo de la base apunta a Supabase**, de donde ya nos fuimos. Hay que
  rehacerlo contra Railway, que es red privada y pide un túnel.
- **`search_path` fijo** en seis funciones que no lo llevan (`current_user_id`,
  `global_search`, `mark_channel_read`, `touch_opportunity`, `touch_task`,
  `unread_counts`). Ninguna es `security definer`, así que es higiene, no un
  agujero.
- **`user_tokens` es una tabla muerta**: creada en la 0006, con aislamiento
  encendido, sin política y sin una sola referencia en el código. Borrarla es
  una migración destructiva, así que es una decisión.
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

- **RLS falla en silencio.** Tabla sin política = cero filas y ningún error.
  Toda tabla nueva necesita política **y** caso en `isolation.test.ts`.
- **`db:migrate` cambia la contraseña de `devup_app`, y la saca de
  `DATABASE_URL`.** Al migrar contra un entorno remoto, `DATABASE_ADMIN_URL` va
  al superusuario y `DATABASE_URL` a `devup_app` **con su contraseña de
  verdad**. Pasarle la del superusuario deja la API sin poder entrar a su
  propia base, y `/health` sigue en 200 porque no la toca.
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
