# Tareas · dónde seguir

Lo tachado está hecho **y desplegado**, salvo donde se diga. Lo que no está
tachado es lo que queda.

Última actualización: 29 de agosto de 2026 · rama
`docs/traspaso-busqueda-boveda-github-spotify`

**Antes de tocar nada, lee esto:** [`traspaso-2026-08-29.md`](traspaso-2026-08-29.md)
—qué no se toca y qué trampas ya costaron tiempo— y
[`ESTADO-DEL-PRODUCTO.md`](ESTADO-DEL-PRODUCTO.md) —qué existe hoy—.

Y lo primero de todo: **pídele a Juan que abra Docker Desktop.** Se abre a mano
y solo mientras se trabaja; es un MVP y es deliberado. Sin él, todo falla con
errores de conexión que parecen otra cosa.

---

## Comprobar que sigue en pie

```bash
npm run typecheck && npm run test:rls && npm run test:world
npm run test:migraciones && npm run test:integraciones
npm run respaldo:probar
```

Los seis en verde antes de empezar. Hoy: **179 · 13 · 26 · 20** comprobaciones.

---


## Bloque A · Que nada se pierda

- [x] ~~Respaldos de la base y del almacén, con restauración probada~~
- [x] ~~Arreglar el planificador, que fallaba en silencio en cada reinicio~~
- [x] ~~Rotación de `VAULT_MASTER_KEY` (`npm run boveda:rotar`)~~
- [x] ~~SMTP: buzón de mentira en desarrollo y `npm run correo:probar`~~
- Lo de copiar `.env.production` a un gestor de contraseñas **está decidido que
  no**. Queda escrito una vez y no vuelve a la lista: `VAULT_MASTER_KEY` existe
  en un solo archivo de un solo ordenador, así que si ese archivo se pierde, las
  credenciales guardadas en la bóveda no se pueden volver a abrir. No hace falta
  volver a plantearlo.
- [ ] Llevarse la carpeta `respaldos/` de vez en cuando (`tar -czf …`). Son 2 MB.
      *Deja de hacer falta cuando el respaldo diario de Actions esté andando.*
- [ ] Alta de un proveedor de SMTP y pegar `SMTP_URL`. *Solo Juan.*
- [ ] **Alta de Metered para TURN**: `METERED_APP_NAME` y `METERED_API_KEY`.
      Sigue haciendo falta. Sin tarjeta son 0,5 GB al mes —solo para probar—;
      con tarjeta, 20 GB y no cobra. `coturn` propio necesitaría una máquina con
      IP pública, y no la hay. *Solo Juan.*

## Bloque M · Salir del portátil

Plan completo en [`plan-salir-del-portatil.md`](plan-salir-del-portatil.md), con
una corrección del 1 de septiembre por la noche: el compañero de Juan propuso
partir la API en dos en vez de meterla entera en Render, y cambia los pasos
5-7 de más abajo. Lo de antes de esta línea —Supabase y Google— sigue en pie
tal cual, porque la base de datos no depende de dónde corra el código.

**El reparto nuevo:**

| Pieza | Dónde | Por qué |
|---|---|---|
| `web` (Next.js) | **Vercel** | Ya no hay problema de WebSockets que lo descarte: si las llamadas y DevVerse viven aparte, lo que le queda a `web` es tráfico normal |
| `api`, **solo REST** | **Railway**, 30 días | Tareas, ventas, GitHub, ajustes… nada que necesite un socket abierto. *Ver el reloj más abajo* |
| `api`, **con los 5 sockets + DevVerse** | El portátil, en Docker, como hoy | Es la parte que de verdad necesita un proceso encendido. Sigue dependiendo de que el portátil esté prendido — **eso no cambia con este reparto**, es una decisión aceptada, no un efecto secundario |
| Postgres + almacén | **Supabase** | Sin cambios. Ya migrado, con Google login encima |

**Lo que hizo posible partir la API sin duplicar código:** una sola variable,
`REALTIME_ENABLED`. En `false` esa instancia no registra ni un solo socket —
`/ws/world` da 404 en vez de 101—, y en `true` (el valor por defecto, para no
romper nada de lo que ya corre) es la API de siempre. El ticket de
`/auth/ws-ticket` es un JWT firmado con `AUTH_SECRET`, no una entrada en
memoria: la instancia que lo emite (Railway) y la que abre el socket (el
portátil) no tienen que ser el mismo proceso, y `messages`/`notifications`/
`files`/`spotify` avisan al hub tras cada escritura sin que eso rompa nada si
no hay nadie escuchando — es un mapa vacío, no un error.

- [x] ~~`REALTIME_ENABLED` en `env.ts` y `server.ts`~~ — probado en caliente:
      con `false`, REST responde 200 y `/ws/world` da 404; con el valor por
      defecto (`true`), el mismo socket sube a 101. Las 179 de RLS y las 13 de
      mundo, sin cambios.
- [ ] **`docker-compose.prod.yml` no se ha tocado, a propósito.** Hoy sigue
      sirviendo tráfico real de producción con `web` y `api` juntos; recortarlo
      ahora apagaría el sitio hasta que Vercel y Railway estén de verdad
      levantados. Se recorta —fuera `web`, y luego `minio` cuando el almacén se
      mude— en el mismo momento en que se corte el DNS hacia allí, no antes.
- [ ] **Vercel Hobby prohíbe uso comercial** — sigue sin resolverse. Alguien
      cobrando por escribir este código ya cuenta como comercial según sus
      propios términos. O se paga Pro, o `web` se queda en Cloudflare Pages
      (gratis, permite uso comercial, y ya estaba evaluado como alternativa).
      *Decisión de Juan y su compañero.*
- [ ] **El reloj de Railway.** Sin tarjeta da $5 de crédito que caducan a los
      30 días (antes si se gastan); pasado eso son $5/mes con tarjeta. Anotar
      la fecha de alta aquí en cuanto se cree, para saber cuándo hay que decidir
      entre pagar o mudar la instancia REST a Render —`render.yaml` ya existe y
      sigue sirviendo para esto sin cambiar nada.
- [ ] Railway no necesita un archivo de configuración committeado: su formato
      `railway.json`/`railway.toml` se jubila el 1 de diciembre de 2026 a favor
      de uno nuevo, y para algo pensado para durar 30 días no vale la pena
      apostar por un formato en transición. En el panel: Dockerfile
      `apps/api/Dockerfile`, contexto la raíz del repo, ruta de salud
      `/health`, y `REALTIME_ENABLED=false` fijo entre las variables.
- [ ] Nueva ruta del túnel de Cloudflare: `live.hytrex.co` → el contenedor del
      portátil, para los sockets. `api.hytrex.co` pasa a apuntar a Railway. En
      el build de Vercel, `NEXT_PUBLIC_API_URL=https://api.hytrex.co` y
      `NEXT_PUBLIC_WS_URL=wss://live.hytrex.co` — se incrustan en el momento de
      compilar, no al arrancar, así que un cambio después pide reconstruir. Las
      cookies siguen sirviendo igual: las tres comparten `hytrex.co` como
      dominio raíz.

Sin una máquina propia sigue cabiendo todo en capa gratuita y **no se pierde
ninguna funcionalidad**. El orden de lo que sigue importa.

- [x] ~~2 · Plano de despliegue [`render.yaml`](../render.yaml)~~ — los dos
      servicios ya configurados. Se conecta el repositorio y crea `devup-api` y
      `devup-web`; los secretos van con `sync: false`, o sea a mano en el panel.
      **Cloudflare Pages ya no hace falta de entrada:** las 750 horas son una
      bolsa compartida, y como los servicios se duermen, dos caben. Si el primer
      mes se acerca al tope, ahí sí se mueve `web` a Pages.
- [x] ~~El puerto: Render lo asigna en cada arranque y lo pasa en `PORT`~~. Un
      proceso que escuche en otro parece sano y devuelve 502 desde fuera, sin un
      solo error en el registro.
- [x] ~~Separar dominios: no había nada que programar~~. `plugin.ts:21` ya lo
      contemplaba — `app.hytrex.co` y `api.hytrex.co` comparten dominio
      registrable, así que `sameSite: lax` vale tal cual. Es configuración.
- [x] ~~Correo por API HTTP~~ — `MAIL_API_KEY` manda sobre `SMTP_URL`, SMTP se
      queda para el buzón de mentira, y `npm run correo:probar` prueba las dos
      vías. Comprobado contra Resend de verdad.
- [x] ~~3 · Supabase montado~~ — proyecto `anrbogqmedmdvemldjkw` (us-west-2,
      Postgres 17.6). Las 25 migraciones aplicadas: **45 tablas, las 45 con RLS,
      142 políticas, 53 funciones**, `devup_app` creado sin ser dueño de nada, y
      `public.schema_migrations` relleno con los checksums que calculará el
      runner, para que `npm run db:migrate` no intente repetirlas. Probado en
      caliente: `devup_app` sin identidad ve **0 organizaciones y 0 usuarios**.
- [x] ~~Cerrar el acceso que Supabase abre por defecto~~ — su API REST exponía
      **40 funciones a `anon`** y otras 40 a `authenticated`, entre ellas
      `auth_credentials()` (devuelve hashes de contraseña) y
      `get_connection_secret_for_refresh()` (secretos de la bóveda). La clave
      `anon` es pública por diseño. Revocado, y guardado en
      [`grants.sql`](../db/grants.sql) para que no vuelva.
- [x] ~~Bucket `devup-files` creado, privado~~, con tope de 25 MB.
- [x] ~~**Entrar con Google**~~ (migración `0026`) — código listo y probado, en
      local y en Supabase. Quita el hash de contraseña de las cuentas nuevas y
      con él la mitad de la dependencia del correo. **Respeta la puerta de las
      invitaciones**: la comprobación se extrajo a `puertaDeAlta()` y la usan
      las dos vías de alta, porque dos copias acaban diciendo cosas distintas.
      `npm run test:google` — 24 comprobaciones.
- [ ] **Crear las credenciales en Google Cloud Console** (pantalla de
      consentimiento + ID de cliente OAuth). No pide facturación. Ojo con que
      la URI de redirección coincida carácter a carácter. *Solo Juan.*
- [ ] **Poner la contraseña de `devup_app`.** Es lo único que falta de la base y
      solo puede hacerlo Juan: una sentencia en el editor SQL de Supabase y la
      misma clave en `.env.production`. *Solo Juan.*
- [ ] 4 · Claves S3 del almacén (Storage → S3 Access Keys) y apuntar
      `S3_ENDPOINT` al de Supabase. *Solo Juan.*
- [ ] Ponerle `search_path` fijo a las seis funciones que no lo llevan
      (`current_user_id`, `global_search`, `mark_channel_read`,
      `touch_opportunity`, `touch_task`, `unread_counts`). Ninguna es
      `security definer`, así que corren con los privilegios de quien llama y
      RLS se les aplica — es higiene, no un agujero.
- [ ] 5 · **Superado por el reparto nuevo de arriba.** Era «alta en Render para
      `web` y `api` juntos»; ahora es alta en Vercel (`web`) + alta en Railway
      (`api` con `REALTIME_ENABLED=false`) + `docker-compose.prod.yml` del
      portátil con `REALTIME_ENABLED=true` explícito. Render se queda montado
      y a un lado, para cuando se acaben los 30 días de Railway. *Solo Juan.*
- [ ] 6 · Alta en Resend y **verificar el dominio** en Cloudflare. Sin eso solo
      se puede enviar desde su dirección de pruebas. *Solo Juan.*
- [ ] 7 · **También superado**: `app.hytrex.co` → Vercel, `api.hytrex.co` →
      Railway, `live.hytrex.co` (nuevo) → el portátil. De paso se arregla el
      apex.
- [x] ~~8 · Respaldo diario en [`respaldo.yml`](../.github/workflows/respaldo.yml)~~
      — por GitHub Actions, que ya usamos y no pide dar de alta nada. **El
      volcado se cifra antes de subirse**, porque el repositorio es público y
      sus artefactos los descarga cualquiera. De regalo mantiene despierto el
      proyecto de Supabase, que se pausa tras una semana sin actividad. Faltan
      los dos secretos: `DATABASE_ADMIN_URL` y `BACKUP_PASSPHRASE`. *Solo Juan.*
- [ ] Respaldo del **almacén de archivos**, que se quedó fuera: el volcado de
      Actions es solo de la base. Va cuando estén los archivos en Supabase y se
      sepa cuánto pesan.
- [ ] 9 · **Y solo entonces**, apagar el PC.

**Vigilar el primer mes:** las horas de Render. Son 750 al mes para los dos
servicios juntos, y quien las gasta sin que nadie trabaje es el tráfico de bots
contra el dominio público, que despierta a `web`.

## Bloque B · Cerrar lo abierto

- [x] ~~El 415 detrás del túnel (resuelto en cliente)~~
- [x] ~~TURN: código listo por las dos vías; es un alta, no una decisión~~
- [ ] **Cosechar las 5 pruebas de Playwright** de `claude/inicio-desarrollo-nu1ftu`.
      **No fusionar la rama**: sus migraciones `0007`/`0008` chocan de número y su
      búsqueda global ya existe aquí. Llevarse solo `tests/e2e/`,
      `playwright.config.ts` y `tsconfig.e2e.json`. Requiere
      `npx playwright install` (cientos de MB) — *decisión de Juan.*
- [ ] Fusionar el arreglo del 415 **de servidor** de esa misma rama.
- [ ] Explicar los 404 del conector de GitHub en la interfaz. Casi nunca es
      fallo nuestro, pero lo parece.
- [ ] Pedir la extensión de cuota de Spotify y añadir compañeros (5 plazas).
      *Solo Juan.*

## Bloque I · Interfaz

- [x] ~~I1 · Armazón de organización~~
- [x] ~~I2 · Marco de página, diálogo de confirmación, desplegable y área de texto~~
- [x] ~~I3 · Capa de datos con caché (`useRecurso` / `useMutacion`)~~
- [x] ~~I5 · Muestrario en `/dev/ui` y paleta de comandos con ⌘K~~
- [x] ~~Cajón de navegación en móvil, compartido por los dos armazones~~
- [x] ~~Alto de pantalla con `svh` y objetivos táctiles de 44 px~~
- [ ] **I4 · Partir `ventas`** (1.273 líneas) en cabecera, embudo, clientes y
      cotizaciones. Después `github` y `ajustes`. **Pide las pruebas de navegador
      antes**: es mover código sin cambiar comportamiento, y sin red se hace a
      ciegas.
- [ ] Responsive **dentro** de las pantallas grandes. El embudo y el tablero ya
      se desplazan a lo ancho, pero sus tarjetas están pensadas para un monitor.
      Va después de partir ventas.
- [ ] Migrar el resto de pantallas a `useRecurso`. Quedan ~88 llamadas sueltas;
      no hace falta un día de parón, solo que lo nuevo se escriba así.

## La tercera promesa

- [x] ~~Vista de entornos y despliegues (lee de GitHub)~~
- [x] ~~Base de datos como código: el criterio aplicado al repo del cliente~~
- [x] ~~Integraciones guiadas: el diagnóstico, con la prueba delante~~
- [ ] **Montar la integración** — la otra mitad de las guiadas. Hoy se
      diagnostica; el «¿lo monto?» necesita credenciales del proveedor.
- [ ] Segundo proveedor de despliegues. Hasta que no haya otro no se sabrá si la
      traducción de estados aguanta.
- [ ] **Agentes.** Ver más abajo: el plan nuevo cambia cómo se hacen.

## DevVerse

- [x] ~~Cartelera con nombre, rol y estado —incluido «ocupado, pero abierto a llamadas»~~
- [x] ~~Menú al acercarse: saludar o llamar, cámaras solo si los dos aceptan~~
- [x] ~~Pizarra por el canal de datos de la llamada~~
- [x] ~~Atuendos por organización~~
- [ ] **Economía de monedas** con su libro de cuentas. *Bloqueada:* hacen falta
      los tres ritos que acuñan moneda y el techo semanal por persona.
- [ ] Encender los muebles que ya están puestos —pantalla de despliegue y rack
      de servidores— con lo que sabe la vista de infraestructura.
- [ ] Tienda de ropa: es una tabla de desbloqueos sobre el catálogo que ya
      existe. Va después de la economía.

## Superficie de trabajo · el plan nuevo

Detalle en [`plan-superficie-de-trabajo.md`](plan-superficie-de-trabajo.md).

- [x] ~~4a · Mesa de trabajo: partir la pantalla en 1, 2 o 3 zonas~~
- [ ] **4b · Preajustes por rol.** Ahora que hay partición son cuatro
      disposiciones guardadas, no una funcionalidad nueva. **El rol es un
      preajuste, no un muro**: decide qué sale primero, no qué se puede abrir.
- [ ] Más herramientas en el catálogo de la mesa. Hoy caben las que ya eran
      componentes; ventas e infraestructura entran cuando se partan.
- [ ] **1 · Recopilador de contexto.** Notas que se **derivan** de lo que ya
      pasó, no que se escriben. Va primero de las tres ideas grandes: es lo que
      hace que el agente valga algo.
- [ ] **2 · Servidor MCP**, solo lectura primero: canales, tareas, repositorios,
      entornos, contexto. Cada herramienta tiene que pasar por el mismo
      aislamiento que la API — si consulta con el rol de la aplicación, le enseña
      a un agente los datos de todas las organizaciones.
- [ ] **3 · Diseñador de bocetos y MVP.** En este orden y no otro: lienzo de
      primitivas → capa libre → ascenso asistido. Al revés es el camino corto a
      generar código de los píxeles, que es la trampa.

## Otras cosas pendientes

- [ ] **`hytrex.co` no llega a DevUP** — devuelve la página aparcada de
      Hostinger. `api.hytrex.co` sí está bien enrutado. Se arregla en Cloudflare.
      *Solo Juan.*
- [ ] **Registrar el ejecutor** (`config.cmd` + token). Ojo: con Docker cerrado,
      un despliegue automático falla en el `docker compose up`. No rompe
      producción, pero el rojo llega igual. *Solo Juan.*
- [ ] **`user_tokens` es una tabla muerta** — creada en la `0006`, con
      aislamiento encendido, sin política y sin una sola referencia en el código.
      Borrarla es una migración destructiva, así que es una decisión.
- [ ] Nuestro propio `setInterval`: el reparto del mundo corre dentro del proceso
      de la API. Con dos instancias habría dos relojes. Hoy no duele.
- [ ] El repositorio es **público**. No hay secretos dentro, pero sí 32
      documentos de estrategia. *Decisión de Juan.*

---

## Decisiones que bloquean

| | Qué decide |
|---|---|
| Los tres ritos que acuñan moneda y el techo semanal | La economía entera de DevVerse |
| El tamaño del avatar y cuántos cuerpos base | El trabajo de arte |
| ¿La nota de contexto es de la organización o del espacio? | La política de aislamiento, y esa no se cambia después |
| ¿Se retira la clave del modelo de la bóveda? | Si DevUP es servidor MCP, guardarla deja de tener sentido |
| ¿Qué herramientas MCP pueden escribir? | Es la pregunta de «qué puede tocar un agente» |
| ¿Los roles son preajustes o permisos? | Si son permisos, esto se convierte en otro proyecto |
| ¿La clave del modelo para diseño a código la ponemos nosotros? | Recomendado que sí: coste acotado, a diferencia de un agente |
| ¿Instalamos Playwright? | Desbloquea partir ventas y el responsive de dentro |

---

## Cómo desplegar

Docker abierto, y desde la raíz del repositorio:

```bash
npm run respaldo:ahora
docker compose --env-file .env.production -f docker-compose.prod.yml build api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api web
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api node apps/api/dist/db/migrate.js
```

Y después **comprobar el resultado, no que la compilación pasó**: que las
migraciones estén aplicadas en la base de producción, que las rutas nuevas
respondan 401 y no 404, y que el CSS servido lleve lo que se cambió. Dar por
bueno un despliegue porque compiló ya escondió un `100vh` que seguía ahí.

## Cómo rehacer el PDF de la propuesta

El Python de esta máquina está incompleto —falta `C:\Python313\Lib`, no hay
`pip`—. Se hace en un contenedor, y la receta completa está en
[`propuesta/README.md`](propuesta/README.md). **Lánzala desde la raíz del
repositorio**: con `cd docs/propuesta` la ruta del volumen sale duplicada.

---

## Cuatro cosas que ya costaron tiempo

- **No lanzar `npm run build` con el servidor de desarrollo corriendo.** Le pisa
  `.next` y responde 500 a todo, con un error que no menciona la causa.
- **El panel de vista previa no repinta al cambiar de tema.** Los valores
  calculados y la maquetación del DOM son la fuente fiable; la captura, no.
- **Correr un análisis contra este mismo repositorio** encuentra lo que las
  pruebas inventadas no. Así se descubrió que el diagnóstico solo miraba el
  `package.json` de la raíz, y que a las migraciones propias les ponía errores
  que eran del criterio y no de ellas.
- **RLS falla en silencio.** Tabla sin política = cero filas y ningún error.
  Toda tabla nueva necesita política **y** caso en `isolation.test.ts`.
