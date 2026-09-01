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
- [ ] **Sacar `.env.production` de la máquina** — a un gestor de contraseñas.
      Lleva la clave que descifra la bóveda y existe en **un solo archivo, en un
      solo ordenador**. Es lo más grave de toda la lista y cuesta un copiar y
      pegar. *Solo Juan.*
- [ ] Llevarse la carpeta `respaldos/` de vez en cuando (`tar -czf …`). Son 2 MB.
- [ ] Alta de un proveedor de SMTP y pegar `SMTP_URL`. *Solo Juan.*
- [ ] **Alta de Metered para TURN**: `METERED_APP_NAME` y `METERED_API_KEY`.
      Sigue haciendo falta. Sin tarjeta son 0,5 GB al mes —solo para probar—;
      con tarjeta, 20 GB y no cobra. `coturn` propio necesitaría una máquina con
      IP pública, y no la hay. *Solo Juan.*

## Bloque M · Salir del portátil

Plan completo en [`plan-salir-del-portatil.md`](plan-salir-del-portatil.md).
**Oracle está descartado: la cuenta no salió.** Sin una máquina propia sigue
cabiendo todo en capa gratuita y **no se pierde ninguna funcionalidad**, pero
`docker-compose.prod.yml` deja de ser la unidad de despliegue, la API se duerme a
los 15 minutos, y TURN pasa a depender de un tercero sí o sí. El orden importa.

- [ ] **1 · `.env.production` a un gestor de contraseñas.** Es el mismo punto
      del bloque A, y aquí además es el paso 1: una mudanza es cuando eso se
      pierde. *Solo Juan.*
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
- [ ] 3 · Supabase: alta, rol de aplicación **sin ser dueño de las tablas**, y
      aplicar las 25 migraciones. Después **restaurar el respaldo contando
      filas**. *Solo Juan (alta).*
- [ ] 4 · Almacén a Supabase Storage (compatible con S3: es cambiar `endpoint`).
- [ ] 5 · Alta en Render, conectar el repositorio y pegar los secretos del
      `.env.production`. *Solo Juan.*
- [ ] 6 · Alta en Resend y **verificar el dominio** en Cloudflare. Sin eso solo
      se puede enviar desde su dirección de pruebas. *Solo Juan.*
- [ ] 7 · Apuntar `app.hytrex.co` y `api.hytrex.co` a Render. De paso se arregla
      el apex.
- [ ] 8 · Reubicar los respaldos: hoy son contenedores del compose, y **no
      pueden caer en Supabase**, que es donde vive la base. Recomendado: volcado
      cifrado a un repositorio privado, que son 4,7 MB y no depende de que el
      portátil esté encendido.
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
