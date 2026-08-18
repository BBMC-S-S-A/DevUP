# Traspaso — sesión del 17–18 de agosto de 2026

Qué pasó en esta sesión, en qué estado queda todo y qué no hay que volver a
romper. Escrito para que otro agente retome sin repetir los errores que aquí
ya se pagaron.

Antes de esto, lee [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md): ahí está el estado
del producto. Este documento solo cubre **esta** sesión.

---

## 1. Qué se hizo

**Se fusionó el PR #10 de `carlos-caceres`** (entorno de desarrollo embebido:
editor Monaco, terminal xterm, WebContainer). Sin conflictos, aunque los dos
tramos tocaban `apps/web/src/lib/api.ts` y `apps/web/src/app/app/page.tsx`.
Cuatro dependencias nuevas: `@webcontainer/api`, `@monaco-editor/react`,
`@xterm/xterm`, `@xterm/addon-fit`.

**Se verificó el riesgo real de esa fusión.** WebContainer exige aislamiento
cross-origin, y las cabeceras COOP/COEP son conocidas por romper el SDK de
Spotify. Comprobado en navegador, no supuesto:

```
crossOriginIsolated: true     ← el aislamiento está activo
sdkCargado: "object"          ← el SDK de Spotify carga igual
```

Funciona porque la cabecera elegida es `credentialless`, no `require-corp`.
**Si alguien la endurece a `require-corp`, la música deja de funcionar.**

Matiz honesto que sigue abierto: eso prueba que el *script* carga. La
reproducción usa DRM (EME) y no se pudo probar en el navegador integrado, que
no trae módulo de contenido protegido. Si la música falla en Chrome desde que
existe `/dev`, ese es el primer sospechoso, y la salida sería acotar las
cabeceras a las rutas de `/dev` en vez de aplicarlas a todo el sitio.

**Se desplegó a producción** y se confirmó que conviven las dos líneas de
trabajo, comprobándolo dentro del contenedor: existe la ruta `/dev` de Carlos
y existen los arreglos de Spotify.

**Se desligó la cuenta de Spotify de Carlos**, a petición expresa: había
conectado la cuenta equivocada. Se borró solo su fila de `connections`; la
de Juan quedó intacta. El token cifrado se fue en cascada y no quedaron
secretos huérfanos. Carlos ya reconectó por su cuenta después.

**Se renovaron todos los tokens de Spotify.** Se hizo reusando el código real
(`refreshAccessToken` + `encryptSecret`) y **a través de `withUser`**, para que
RLS aplicara igual que en una petición de verdad. Las dos filas contestaron
`filas actualizadas=1`.

Eso último no es un detalle: **es la prueba en producción de que la migración
`0018_vault_update.sql` funciona.** Sin esa política de UPDATE, el refresco de
tokens afectaba 0 filas *sin lanzar ningún error* — el fallo silencioso que
hacía que Spotify se cayera solo al cabo de una hora.

---

## 2. Estado en el que queda todo

| Cosa | Estado |
|---|---|
| Rama `docs/traspaso-busqueda-boveda-github-spotify` | Al día con main, nada sin subir |
| PR #9 (Spotify) y PR #10 (entorno dev) | Los dos fusionados en main |
| Producción | Cinco contenedores sanos, sin migraciones pendientes, sin 500s |
| Tokens de Spotify | Renovados y vigentes; clave maestra correcta (32 bytes) |
| Servidor web local | En pie otra vez (se había caído, no roto) |
| `npm run test:rls` | 145 en verde |
| `npm run test:world` | 13 en verde |
| `npm run typecheck` | Limpio en api y web |

### Ojo: hay trabajo de otra persona sin commitear

El árbol de trabajo **no está limpio**, y no es basura: es una tanda de trabajo
en curso que esta sesión no tocó ni commiteó.

- Renombrado de `oficina/` a `devverse/`, con `DevVerseEntrance.tsx` nuevo.
- Un panel nuevo (`components/dashboard/`, `w/[workspaceId]/panel/`).
- Rutas de API nuevas: `announcements.ts`, `preferences.ts`.
- Migración `0019_personalizacion.sql`, **sin aplicar**.
- `.github/workflows/deploy.yml`, sin seguimiento en git.

**No lo commitees a ciegas.** Pregunta primero de quién es y si está terminado.
Varios de esos archivos son de la oficina inmersiva (`WorldView.tsx`,
`view-mode.tsx`), que esta sesión tenía prohibido tocar.

---

## 3. Reglas que no se negocian

1. **No se toca la oficina beta** (el minijuego tipo hotel). Fuera de límites:
   `components/world/**`, `lib/world/**`, `w/[workspaceId]/oficina|devverse/**`,
   `lib/view-mode.tsx`. Instrucción literal del usuario.
2. **No borres `apps/web/.next` con el servidor de desarrollo encendido.** Se
   hizo tres veces en sesiones anteriores y las tres veces tiró el sitio con
   500s por `routes-manifest.json`. Además está en `.gitignore`: borrarlo nunca
   hizo falta. Si hay que hacerlo, para el servidor primero.
3. **`VAULT_MASTER_KEY` no cambia jamás.** Descifra todas las credenciales de
   terceros guardadas. Si cambia, todas las conexiones quedan indescifrables
   para siempre y hay que reconectarlas una por una.
4. **`.env.production` no se commitea.** Tiene secretos reales y está ignorado.
5. **No entregues credenciales de otras personas**, aunque las pidan por su
   nombre. Ya se pidió una vez en este proyecto y se rechazó.

---

## 4. Trampas que ya costaron tiempo

**RLS falla en silencio.** Una tabla sin política no da error: afecta 0 filas y
sigue. Toda tabla nueva necesita política **y** un caso en `isolation.test.ts`.
Cuando pruebes un UPDATE, comprueba `rowCount`, no que no haya excepción.

**Spotify, cuatro causas distintas del mismo síntoma** («hay que darle varias
veces»): el dispositivo tarda en registrarse (404, reintentar); un `202
Accepted` significa «aceptado pero el dispositivo no está activo», no «suena»;
los IDs de dispositivo caducan (hay que renovar con disconnect/connect); y
`player_state_changed` no va marcando el tiempo. La única fuente que no miente
es `getCurrentState()`.

**Los `catch` que se tragan el error cuestan horas.** Un `setListas([])` dentro
de un catch genérico escondió durante horas que el fallo era un mapeo mío sobre
playlists con entradas nulas — parecía que Spotify no devolvía nada. Los
mensajes genéricos («no se pudo») cuestan más tiempo del que ahorran.

**La app de Spotify está en modo desarrollo, y eso explica dos fallos que no
se parecen entre sí.** Comprobado contra la API con tokens recién emitidos:

- Quien no esté en la lista de usuarios del panel de Spotify recibe 403 en
  *todo*, con el mensaje `The user is not registered for this application`.
  Le pasó a Carlos: pudo autorizar y obtener un token válido que no sirve para
  nada. Se arregla añadiéndolo en Dashboard → la app → Settings → User
  Management, con el correo de **su cuenta de Spotify** (no el del trabajo, si
  no coinciden).

  **El límite son 5 usuarios**, comprobado en el panel. El dueño de la app no
  cuenta: la lista está en 0/5 y la cuenta de Juan funciona igual. Eso es un
  techo real para un producto de equipo — la música compartida no puede pasar
  de 5 personas además del dueño mientras la app siga en modo desarrollo.
- `/playlists/{id}/tracks` contesta **403 para todas las listas**, incluidas
  las que la propia cuenta creó, mientras `/me/playlists`, `/me/tracks` y
  `/search` contestan 200 y los permisos concedidos están completos. No es un
  token viejo. Se quita pidiendo la extensión de cuota para sacar la app del
  modo desarrollo.

Lo importante para no rediseñar de más: **poner una playlist entera sigue
funcionando** sin leer sus pistas, porque va por `context_uri`. Verificado:
`PUT /me/player/play` con un `context_uri` de playlist devuelve 404
`NO_ACTIVE_DEVICE`, no 403 — el endpoint no está vetado, solo faltaba un
dispositivo activo.

**El 415 que estaba sin identificar era el cliente, y solo se ve en
producción.** `POST /channels/{id}/read` lo destapó. La causa: `request()` en
`apps/web/src/lib/api.ts` solo mandaba `content-type` cuando había cuerpo, así
que todo POST sin datos viajaba sin cabecera.

Lo que lo hace traicionero es que **en local no falla**: contra la API directa
—y contra el propio contenedor de producción— un POST sin `content-type`
devuelve 401/204 tranquilamente. El 415 solo aparece atravesando el túnel de
Cloudflare. Comprobado en los tres sitios, y por eso pasó meses sin detectarse.

Estaba roto en siete llamadas, todas envueltas en `.catch(() => {})`, que es lo
que lo mantuvo invisible: marcar canales y notificaciones como leídos, refrescar
un repo de GitHub, reiniciar una zona, **cerrar sesión** y **refrescar la
sesión**. Este último es el grave: el refresco fallaba siempre, así que ningún
401 se reintentaba y la sesión moría al caducar en vez de renovarse.

Arreglado en la raíz: POST, PUT y PATCH mandan siempre `content-type` y, si
quien llama no pasa cuerpo, un `{}`. Fastify quiere las dos cosas — sin cabecera
contesta 415, y con cabecera pero sin cuerpo contesta 400.

**`jsonb` se pasa con `JSON.stringify`**, no como objeto JS. Sigue el patrón de
`world.ts`.

**`docker compose exec -e VAR="$JSON"` se rompe si el JSON trae espacios**: los
argumentos se parten y `node` acaba buscando un módulo que no existe
(`MODULE_NOT_FOUND` despistante). Pasa los datos por fichero con `docker cp`, y
ejecuta con `sh -c "node ..."`.

---

## 5. Recetas

Desplegar:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Migrar y comprobar salud:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api node apps/api/dist/db/migrate.js
```

Antes de dar nada por bueno:

```bash
npm run typecheck && npm run test:rls && npm run test:world
```

---

## 6. Qué queda pendiente

- **Confirmar en Chrome de verdad** que la cola encadena y que la reproducción
  arranca al primer clic. Es lo único de Spotify que no se ha podido verificar
  sin una sesión con Premium y DRM reales.
- Decidir qué hacer con el trabajo sin commitear del §2 — es lo primero que hay
  que aclarar con el usuario.
- La migración `0019_personalizacion.sql` está escrita pero **sin aplicar**.
- Lo que ya venía en la lista de `CONTINUAR-AQUI.md`: terminar S7 (entornos y
  despliegues), Redis cuando haya más de una instancia de API, e histéresis de
  radios en la malla de voz.
