# Desplegar DevUP

Lo que sigue es lo que hay que tener resuelto antes de que alguien de fuera de
tu red escriba la primera contraseña.

---

## Lista de comprobación previa

La API **se niega a arrancar** en producción si alguna de estas cuatro está
mal. No avisa: aborta. Un aviso en el arranque no lo lee nadie; un proceso que
no levanta sí se ve.

| Variable | Por qué es fatal |
|---|---|
| `AUTH_SECRET` | Con el valor de `.env.example`, cualquiera que haya leído el repositorio puede firmar sesiones válidas. Genera 32 bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `COOKIE_SECURE=true` | Con `false`, la cookie de sesión viaja por HTTP plano y cualquiera en la red la roba |
| `APP_BASE_URL` en `https://` | De ahí salen los enlaces de invitación y de recuperación, que son credenciales de un solo uso |
| `TURN_SECRET` (o `METERED_API_KEY`) | Si hay `TURN_URLS` con credencial fija en vez de temporal o gestionada, es un relé abierto con tu factura |

Y estas dos, que no abortan pero avisan al arrancar:

- **Sin `TURN_URLS`**, las llamadas conectan pero no se oyen fuera de una LAN.
  Ver [`TURN.md`](TURN.md).
- **Sin `SMTP_URL`**, las invitaciones y los enlaces de recuperación se
  escriben en el registro del servidor en vez de enviarse. En producción eso
  significa que las credenciales de un solo uso quedan en texto plano en tus
  logs, y que nadie recibe nada.

---

## Piezas

| Pieza | Qué hace falta |
|---|---|
| **API** (`apps/api/Dockerfile`) | Un contenedor. Escucha en 4000 |
| **Web** (`apps/web/Dockerfile`) | Otro contenedor. Escucha en 3000 |
| **Postgres 17** | Gestionado (Neon, RDS, Supabase como base a secas) o propio |
| **Almacén S3** | Cloudflare R2, S3 o MinIO. Bucket **privado** |
| **TURN** | `coturn` propio o servicio gestionado (Metered.ca, Cloudflare Calls) |
| **SMTP** | Cualquiera. Sin esto no hay invitaciones |
| **Entrada pública** | Proxy inverso propio (Caddy/nginx) que termine TLS, o un Cloudflare Tunnel — ver «Sin VPS» más abajo |

```bash
cp .env.example .env.production   # y rellenarlo de verdad
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml exec api node apps/api/dist/db/migrate.js
```

**Ojo con las dos cosas que cambian frente a lo que parece obvio:**
- **`--env-file .env.production`** en el propio `docker compose`, no solo `env_file:` dentro del servicio. Compose solo lee `.env` automáticamente para sus propias variables `${...}`; un archivo con otro nombre hay que indicárselo explícitamente, o `POSTGRES_PASSWORD` y compañía se quedan sin valor al construir.
- **`node apps/api/dist/db/migrate.js`**, no `npm run db:migrate`. Ese script invoca `tsx src/db/migrate.ts`, y la imagen de producción no lleva el código fuente en TypeScript — solo el compilado en `dist/`. `npm run db:migrate` falla con `ERR_MODULE_NOT_FOUND` dentro del contenedor.

### Sin VPS: autoalojado con Cloudflare Tunnel

Si no quieres pagar un VPS ni abrir puertos en tu router, hay una variante que
funciona igual de bien para un equipo pequeño:

- **Cloudflare Tunnel** (`cloudflared`, como servicio de `docker-compose.prod.yml`)
  en vez de un proxy inverso propio. La conexión sale siempre desde tu máquina
  hacia Cloudflare; nunca hace falta abrir 80 ni 443. Cloudflare termina el TLS
  en su borde. Las rutas (`Public Hostname`) se configuran en su panel
  (Zero Trust → Networks → Tunnels), no en un archivo local.
- Si tu red no aguanta bien conexiones UDP largas, fuerza `tunnel --protocol
  http2` en el comando del servicio — QUIC (el protocolo por defecto) se corta
  seguido detrás de un NAT doméstico normal.
- **Metered.ca** (u otro TURN gestionado) en vez de `coturn` propio, para no
  tener que reenviar tampoco los puertos de voz. La integración vive en
  `apps/api/src/routes/ice.ts`: con `METERED_APP_NAME` y `METERED_API_KEY`
  puestos, la API le pide a Metered una credencial nueva en cada petición a
  `/calls/ice-servers` — nunca se guarda una credencial fija, así que no choca
  con la comprobación de `env.ts` que bloquea `TURN_STATIC_CREDENTIAL` en
  producción.
- Con esta variante no hace falta `PUBLIC_IP` ni reenviar ningún puerto del
  router: todo el tráfico entra por el túnel saliente.

---

## El detalle que se lleva media tarde: `NEXT_PUBLIC_*`

**Se incrusta en el bundle durante el `build`, no al arrancar.** Poner
`NEXT_PUBLIC_API_URL` en el `environment` del contenedor no hace nada: el
JavaScript que llega al navegador ya trae el valor con el que se construyó.

Por eso en la imagen de la web van como `ARG`. Cambiar el dominio de la API
obliga a **reconstruir**, no a reiniciar.

Es también la razón por la que las credenciales de TURN no viven ahí: todo lo
que empieza por `NEXT_PUBLIC_` es público, literalmente.

---

## Los dos roles de base de datos

No son un formalismo:

```bash
DATABASE_ADMIN_URL=postgres://postgres:...@host/devup   # solo migraciones
DATABASE_URL=postgres://devup_app:...@host/devup        # la API
```

`devup_app` no es propietario de las tablas. **Postgres salta RLS para el
propietario**: si alguien apunta `DATABASE_URL` al rol de las migraciones,
todas las políticas dejan de aplicarse y el aislamiento entre organizaciones
desaparece — sin un solo error en los registros, con las consultas
funcionando y devolviendo de más.

Es el fallo más peligroso de esta arquitectura porque no se manifiesta hasta
que un cliente ve datos de otro. `npm run test:rls` lo detecta.

---

## Migraciones al desplegar

Las migraciones viajan dentro de la imagen de la API a propósito: desplegar y
migrar tienen que poder hacerse con el mismo artefacto, o acaban
desincronizados.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api node apps/api/dist/db/migrate.js
```

El runner lleva un checksum de cada archivo aplicado. Si alguien editó una
migración ya aplicada, **para** en vez de continuar: es la forma más silenciosa
de que dos entornos acaben con el mismo número de versión y distinto esquema.

Con más de una instancia, migra antes de desplegar el código nuevo, y escribe
las migraciones para que el esquema viejo siga funcionando un rato — añadir una
columna sí, renombrarla no.

---

## Almacenamiento

- **Bucket privado.** Nunca público: el acceso va siempre por URL firmada con
  caducidad.
- **CORS.** La API la configura al crear el bucket. Si lo creas tú, tiene que
  permitir `PUT`, `GET` y `HEAD` desde el origen de la web, o la subida se
  queda en el preflight con un error de red genérico que no menciona el bucket.
- **Ciclo de vida.** Un barrendero retira cada quince minutos las reservas de
  subida que nunca se confirmaron, con su objeto.

---

## Después de levantarlo

1. **Crea la primera cuenta.** Con la instancia vacía, el alta está abierta
   aunque `SIGNUP_MODE=invite`: si no, no habría nadie que pudiera invitar.
   **Hazlo tú, y hazlo lo antes posible** — entre que la instancia es pública y
   que creas esa cuenta, cualquiera que encuentre la URL puede quedarse con la
   primera plaza.
2. Invita al resto desde la interfaz.
3. Comprueba que llegan los correos de invitación.
4. Entra en una llamada desde dos redes distintas —no dos pestañas— para
   verificar TURN. En `chrome://webrtc-internals`, el par de candidatos activo
   debería poder ser de tipo `relay`.
5. Comprueba que `npm run test:rls` pasa contra la base de producción recién
   migrada, en una base de datos desechable con el mismo esquema.

---

## Copias de seguridad

Postgres es la única fuente de verdad que no se puede reconstruir. El almacén
de archivos también, pero R2 y S3 ya versionan si se les pide.

Prueba la **restauración**, no la copia. Una copia que nunca se ha restaurado
es una suposición.

---

## Lo que todavía no está resuelto

Dicho aquí para que no sorprenda:

- **Una sola instancia de API.** La presencia de las llamadas y el contador del
  límite de peticiones viven en memoria. Con dos instancias detrás de un
  balanceador, dos personas en la misma sala pero en instancias distintas no se
  ven, y el límite efectivo se multiplica. La solución es Redis, y el único
  archivo que hay que tocar para la presencia es
  `apps/api/src/realtime/hub.ts`.
- **Sin métricas ni trazas.** Los registros van a stdout en JSON.
- **La grabación depende del navegador de quien graba** — por diseño, ver
  [`decisiones/0001-cifrado-de-salas.md`](decisiones/0001-cifrado-de-salas.md).
