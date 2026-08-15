# Continuar aquí

Informe de estado. Existe para que quien retome —persona o agente— no tenga que
redescubrir lo que ya se decidió ni volver a discutirlo.

Contexto completo, con los motivos de cada decisión:
[`CONTEXTO-COMPLETO.md`](CONTEXTO-COMPLETO.md). Plan a 12 semanas con 94 tareas:
`DevUP-Plan-de-Desarrollo.pdf`.

---

## Dónde estamos

La iteración en curso —**llamadas de voz y un sitio donde alojar archivos**—
está construida y probada de punta a punta.

**Hecho y verificado**

- Esquema en `db/migrations/`, aplicado contra un Postgres real. `npm run
  test:rls` pasa con 45 comprobaciones de aislamiento, incluidos los workspaces
  personales y los mensajes de canales privados.
- API en Fastify: alta y acceso con scrypt, sesiones con token de refresco
  rotatorio, organizaciones, workspaces, canales, archivos con URLs firmadas y
  señalización por WebSocket.
- Interfaz en Next.js: acceso, selector de organización, barra lateral de
  canales, biblioteca de archivos con etiquetas, búsqueda y previsualización, y
  sala con voz, vídeo, pantalla compartida y duración de la llamada.
- Grabación en el navegador con consentimiento unánime, que acaba como un
  archivo más en la biblioteca del canal.
- Workspaces personales frente a compartidos, y tablero de tareas por workspace
  con arrastrar y soltar.
- Mensajería de texto en tiempo real: hilos, edición, borrado, adjuntos de la
  biblioteca y no leídos en la barra lateral.
- Altas solo por invitación, verificación de correo, recuperación de
  contraseña, límite de intentos y notificaciones con campana.
- CI que corre tipos, migraciones, aislamiento y build en cada push.
- Imágenes de Docker para API y web, y guía de despliegue.
- Prueba en navegador con dos pestañas y micrófono y cámara sintéticos: dos
  pares se conectan, se oyen, se ven, negocian el permiso de grabación, graban,
  guardan el archivo y cuelgan; el historial se cierra solo.

**Ya desplegado — agosto 2026**

Está en producción real, en **https://devup.hytrex.co**, autoalojado en la
máquina de Juan sin VPS y sin exponer ningún puerto del router. El detalle
completo de esa arquitectura y por qué está en la sección
[Despliegue actual](#despliegue-actual-sin-vps) más abajo.

El cifrado de las salas **ya está decidido**: extremo a extremo siempre,
grabación en el cliente con permiso de todos. El razonamiento completo, con lo
que se descartó y por qué, está en
[`decisiones/0001-cifrado-de-salas.md`](decisiones/0001-cifrado-de-salas.md).

---

## Despliegue actual (sin VPS)

Decisión de producto: sin presupuesto para un VPS, y sin querer exponer la red
doméstica abriendo puertos en el router. La combinación que sí cumple las tres
cosas a la vez (gratis, sin exponer la red, funcionalidad completa incluida la
voz) es esta:

| Pieza | Qué se usa | Por qué |
|---|---|---|
| Entrada pública | **Cloudflare Tunnel** (`cloudflared`, contenedor más en `docker-compose.prod.yml`) | Conexión siempre saliente desde la máquina hacia Cloudflare; nunca hay que abrir 80/443. Forzado a `--protocol http2` porque QUIC (UDP) se corta seguido en una red doméstica normal |
| TLS | Lo termina Cloudflare en su borde | Ya no hace falta Caddy ni gestionar certificados |
| TURN | **Metered.ca** (free tier, 500MB/mes, sin tarjeta) | Reemplaza a `coturn` propio — así tampoco hace falta reenviar puertos UDP de voz. Integrado en `apps/api/src/routes/ice.ts`: la API le pide una credencial *nueva* a Metered en cada llamada a `/calls/ice-servers`, nunca guarda una fija — respeta la comprobación de `env.ts` que bloquea credenciales estáticas de TURN en producción |
| DNS | Dominio `hytrex.co` movido de Hostinger a **Cloudflare** (solo el DNS, el registro sigue en Hostinger) | Necesario para que el Tunnel pueda enrutar por hostname. Los registros de correo (`Starter Business Email`, MX/SPF/DMARC/autodiscover) se replicaron a mano antes del cambio de nameservers — si hace falta tocar DNS de nuevo, cuidado con no perderlos |
| Subdominios | `devup.hytrex.co` (web), `api.hytrex.co` (API + WebSocket), `files.hytrex.co` (MinIO) | La raíz `hytrex.co` se dejó libre a propósito, para un futuro sitio de la empresa |

Variables nuevas en `.env.production` que no existían antes: `CLOUDFLARE_TUNNEL_TOKEN`
(token del túnel, se genera en Cloudflare Zero Trust → Networks → Tunnels),
`METERED_APP_NAME` y `METERED_API_KEY` (panel de Metered.ca → TURN Server).
`TURN_SECRET`/`TURN_URLS` quedan vacíos: no hay coturn propio en este despliegue.

**Aislamiento de proyectos de Compose.** `docker-compose.prod.yml` fija
`name: devup-prod` y da nombre explícito a sus volúmenes. Sin esto, Compose usa
el nombre de la carpeta como proyecto —el mismo que `docker-compose.yml` de
desarrollo— y los dos ficheros terminan compartiendo contenedores y volúmenes
con el mismo nombre corto. Ya pasó una vez en esta sesión: levantar el de
producción recreó y borró los contenedores de desarrollo (sin pérdida de datos
porque los volúmenes sobrevivieron, pero fue una advertencia real).

**Migrar en esta imagen no es `npm run db:migrate`.** La imagen de producción
no lleva el código fuente TypeScript, solo el compilado. El comando correcto:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node apps/api/dist/db/migrate.js
```

**Punto único de fallo, a propósito.** Todo corre en una sola máquina de
escritorio. Si se apaga o pierde internet, DevUP deja de responder para todo el
equipo. Es la contrapartida aceptada de no pagar un VPS; si el equipo crece o
esto se vuelve crítico, migrar a un VPS (~$5/mes, KVM 1 de Hostinger) es
sencillo porque las imágenes y el `docker-compose.prod.yml` son los mismos —
solo cambiaría quién aloja el Tunnel, o se podría volver a Caddy + coturn si se
prefiere no depender de terceros.

**Estado de las cuentas.** Altas por invitación (`SIGNUP_MODE=invite`);
`juan.bonilla@hytrex.co` es la cuenta administradora real de la organización
`hytrex`. **Sin SMTP configurado todavía**: las invitaciones no llegan por
correo, el enlace se escribe en el registro de la API
(`docker compose logs api`, buscar «correo sin enviar»). Hay que sacarlo de ahí
y reenviarlo a mano a cada persona invitada hasta que se configure un
proveedor SMTP (el correo de Hostinger de la propia empresa serviría).

**Bugs reales encontrados y corregidos en el despliegue** (no eran solo
configuración, sino código o documentación que no funcionaba como decía):
- `apps/web/Dockerfile` copiaba un `node_modules` que nunca existe por el
  *hoisting* de npm — el build de producción de la web fallaba siempre.
- `npm run dev` en la raíz corría los workspaces *secuencialmente*: la API
  arrancaba y la web nunca llegaba a hacerlo. Arreglado con `concurrently`.
- `.gitignore` no cubría `.env.production` — pudo haberse subido con secretos.
- El comando de migración documentado en `DESPLIEGUE.md` no funciona contra la
  imagen real (ver arriba).

**Sin resolver todavía**: un compañero reportó un `415` al marcar un canal como
leído (`POST /channels/:id/read`) desde el navegador, mientras que la misma
llamada sin cuerpo a `/auth/logout` funciona bien con el mismo cliente HTTP
compartido (`apps/web/src/lib/api.ts`). No se confirmó la causa raíz antes de
cortar la sesión de depuración — el mensaje de error del navegador
mencionaba también CORS en `/auth/ws-ticket`, que sí parece ruido transitorio
del túnel (el log del servidor muestra 200 en esas llamadas). Retomar
reproduciendo la petición exacta desde la consola del navegador con la sesión
real ya logueada, en vez de intentar reproducirla con curl.

---

## Cambio de arquitectura, agosto

El proyecto empezó sobre Supabase y ya no se apoya en él. Datos, autenticación,
almacenamiento y tiempo real son ahora propios.

Lo que **no** cambió: el aislamiento sigue viviendo en Postgres con RLS, que era
la decisión que importaba. Lo que cambió: `auth.uid()` pasó a ser
`public.current_user_id()` sobre la variable de sesión `app.user_id`, y las
políticas de `storage.objects` se sustituyeron por comprobaciones en la API
antes de firmar cada URL.

Motivo, en una línea: DevUP se vende como la capa que coordina infraestructura
ajena, y depender de un único proveedor para su propio plano de control
contradice el discurso justo en la parte que menos se puede mover después.

---

## Lo que más fácil es romper sin darse cuenta

- **`DATABASE_URL` tiene que ser el rol `devup_app`**, que no es propietario de
  las tablas. Postgres salta RLS para el propietario: apuntar esta variable al
  rol de las migraciones desactiva todo el aislamiento **sin un solo error** en
  los registros. Las consultas seguirían funcionando y devolverían de más.
- **Toda consulta pasa por `withUser()`**, que fija `app.user_id` con alcance
  local a la transacción. Con alcance de sesión, la conexión vuelve al pool con
  la identidad del último usuario dentro.
- **Las funciones de pertenencia son `SECURITY DEFINER` a propósito.** Quitarlo
  provoca recursión infinita en las políticas.
- **Un workspace personal no se protege con una columna.** `can_access_channel`
  y la política de `files` miraban la organización, no el workspace: si vuelven
  a mirar ahí, los canales y archivos de un espacio personal se ven desde todo
  el equipo. Tienen que colgar de `can_access_workspace`.
- **Cada tabla nueva con `organization_id` necesita su política y su caso en
  `apps/api/src/db/isolation.test.ts`.** Es la disciplina que impone elegir RLS,
  y el único freno automático contra una fuga entre clientes.
- **Nunca firmar una URL de almacenamiento sin comprobar antes la pertenencia.**
  La primera carpeta de la clave es la frontera de seguridad, y ya no hay
  políticas en el almacén que la vigilen por nosotros.
- **Nada secreto en una variable `NEXT_PUBLIC_*`.** Se incrusta en el bundle
  durante el build y cualquiera puede leerla. Por eso las credenciales de TURN
  las sirve la API y no el entorno de la web.

---

## Puesta en marcha

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 y MinIO
npm run db:migrate
npm run dev          # API en :4000, web en :3000
npm run test:rls     # que esté en verde antes de empezar nada
```

Para tocar la instancia de producción real (no la de desarrollo local), todos
los comandos de `docker compose` necesitan `--env-file .env.production` y
`-f docker-compose.prod.yml`; ver la sección
[Despliegue actual](#despliegue-actual-sin-vps) de arriba.

---

## Plan de desarrollo desde aquí

En orden, cada uno depende de que el anterior esté resuelto:

1. **Cerrar el `415` de `/channels/:id/read`.** Es lo único que queda a medias
   de esta sesión. Bloquea confiar del todo en la mensajería en producción.
2. **Configurar SMTP.** Sin esto, cada invitación exige que alguien con acceso
   a los contenedores saque el enlace del registro a mano — no escala ni a un
   equipo pequeño. El correo de empresa de Hostinger (`@hytrex.co`) ya existe y
   debería servir.
3. **Usarlo dos semanas de verdad, como equipo.** Es el hito que decide el
   proyecto (`CONTEXTO-COMPLETO.md`, hito H4): si el propio equipo no
   abandona sus herramientas actuales por DevUP, ningún cliente lo hará
   tampoco. Vale más lo que salga de ese uso real que seguir construyendo
   sobre una base sin estresar.
4. **Vigilar el consumo de Metered.ca** (500MB/mes gratis) durante esas dos
   semanas. Si el equipo lo agota, hay que decidir entre pagar su siguiente
   nivel o levantar coturn propio con reenvío de puertos.
5. **Decidir sobre el punto único de fallo.** Si para entonces DevUP ya es
   crítico para el día a día, evaluar mover el autoalojado a un VPS barato
   (~$5/mes) — es un cambio mecánico, no de arquitectura, porque las mismas
   imágenes y el mismo `docker-compose.prod.yml` sirven ahí.
6. **Control de ventas** (servicios, clientes, oportunidades, cotizaciones —
   semanas 4-5 del plan original en `DevUP-Plan-de-Desarrollo.pdf`). El nombre
   de la rama de este trabajo (`sales-control-workspace-platform`) ya apunta
   para acá. No arrancar esto antes de que el paso 3 esté cumplido: es
   exactamente la trampa que el propio plan advierte evitar.
7. Pendientes menores de la capa de espacio de trabajo, sin prisa: **búsqueda
   global** (hoy es por workspace) y **Redis para presencia/límite de
   peticiones** (solo hace falta el día que haya más de una instancia de la
   API corriendo a la vez).
