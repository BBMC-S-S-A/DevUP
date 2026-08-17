# Continuar aquí

Informe de estado. Existe para que quien retome —persona o agente— no tenga que
redescubrir lo que ya se decidió ni volver a discutirlo.

**Empieza por aquí, y en este orden:**

1. Este archivo: dónde estamos y qué toca.
2. [`CONTEXTO-COMPLETO.md`](CONTEXTO-COMPLETO.md) — arquitectura y el porqué de
   cada decisión de la base.
3. [`plan-conectores-busqueda-e-interfaz.md`](plan-conectores-busqueda-e-interfaz.md)
   — el plan de este último tramo: búsqueda, bóveda, GitHub, Spotify e interfaz.
4. [`plan-mundo-y-plataforma.md`](plan-mundo-y-plataforma.md) — el plan de la
   vista inmersiva y la plataforma, de un tramo anterior.
5. [`decisiones/`](decisiones/) — las decisiones cerradas que no se reabren sin
   motivo nuevo.

---

## Dónde estamos

De las **tres promesas** del producto:

| Promesa | Estado |
|---|---|
| **Espacio de trabajo** | Completa. Canales, mensajería, voz, archivos, tareas, grabación, invitaciones, notificaciones, búsqueda global — más la vista inmersiva encima |
| **Control de ventas** | Completa. Servicios, clientes, embudo, objetivos que avanzan solos, cliente y cotización editables después de creados |
| **Infraestructura y agentes** | Empezada: bóveda de credenciales y dos conectores (GitHub, música compartida de Spotify). Falta el resto: despliegues, base de datos como código, agentes |

En la definición de «plataforma funcional» del plan (§9 de
`plan-mundo-y-plataforma.md`), **van seis de nueve capacidades completas y una
séptima a medias** (conectar GitHub sí, «su nube» — entornos y despliegues —
todavía no).

### Lo construido en este tramo

**Búsqueda global (S6) — el hito que el plan marcaba como decisivo:**

- Mensajes, archivos, tareas, clientes, servicios y oportunidades desde
  `/app/o/[orgId]/buscar`, un solo sitio en vez de por workspace.
- Función `global_search`, sin `security definer`: el aislamiento lo siguen
  poniendo las políticas de cada tabla, no la función.
- Entrada desde el sidebar del workspace y la lista de organizaciones.

**Bóveda de credenciales (S7, la fundación) — el activo más sensible del
producto:**

- `connections` (metadata) y `connection_secrets` (el token, cifrado con
  AES-256-GCM), org-scoped o user-scoped según el proveedor.
- `VAULT_MASTER_KEY` nueva en el entorno, 32 bytes en base64, distinta de
  `AUTH_SECRET`.

**Conector de GitHub — el primero sobre la bóveda:**

- Token de acceso personal de alcance fino por organización (no una GitHub
  App con OAuth — ver §5.1 de `plan-conectores-busqueda-e-interfaz.md`).
- Repos con commits recientes, PRs y issues abiertas, estado de la última
  ejecución de CI. Barrendero de refresco cada 10 minutos.
- Pestaña propia en la organización, junto a Ventas.

**Música compartida de Spotify — reproducción sincronizada real:**

- OAuth con estado firmado (no depende de que la cookie de sesión sobreviva
  el salto a Spotify y de vuelta).
- Buscar y añadir a la cola sin necesitar cuenta conectada (token de
  aplicación). Reproducir de verdad exige Spotify Premium conectado — el
  Web Playback SDK lo rechaza sin Premium.
- El estado ("qué suena, en qué segundo") se reparte por el mismo socket que
  ya reparte los mensajes del canal — nada de conexión nueva.
- Como icono, no como panel: en la cabecera del canal de voz y en la barra
  de llamada persistente (`ActiveCallBar`), para que siga disponible al
  navegar a otra pantalla sin colgar.
- **Decidido a propósito:** el audio nunca suena "dentro" de la llamada —
  rompería su cifrado extremo a extremo. Se sincroniza el estado, no el
  audio; quien quiera oírlo transfiere la reproducción a su propio
  dispositivo.

**Ficha de cliente y cotización editable:**

- Clientes: listar, renombrar, editar contacto y notas, borrar (solo quien
  administra). Antes solo se podían crear.
- Líneas de una cotización: corregir cantidad y precio sin borrar y volver
  a añadir — se perdía el orden de los servicios elegidos.

**Rediseño visual, primera pasada:**

- Logo real (el mismo de siempre, con el fondo desmatado — sin transparencia
  real en el original, se recuperó con clave de blanco y sin dejar halo).
- Login con entrada escalonada, máquina de escribir, marca animada.
- Sonner para avisos tipo toast, reemplazando mensajes en línea silenciosos
  en varios formularios (algunos de esos silencios eran fallos reales: crear
  un workspace que fallaba no decía nada).
- **No se tocó la oficina inmersiva** en ninguno de estos cambios, a
  propósito.

**Un bug de verdad en la oficina, reportado en producción:** `WebSocket.send()`
sin comprobar `readyState` al cruzar una zona en el primer fotograma —
`InvalidStateError` si el socket seguía en `CONNECTING`. Corregido con el
mismo guardián que ya usaba el envío de movimiento, dos líneas más abajo.

### Pruebas

| Comando | Qué cubre |
|---|---|
| `npm run test:rls` | **143 comprobaciones** de aislamiento entre organizaciones |
| `npm run test:world` | 13 del socket de la oficina (reparto por tick y zonas privadas) |
| `e2e/` | 12 guiones de navegador y de API — sin tocar en este tramo. Ver [`e2e/README.md`](../e2e/README.md) |

Los tres tienen que estar en verde antes de empezar nada.

---

## Lo siguiente, y en qué orden

### 1. Terminar S7 — vista unificada de infraestructura · ~22 puntos restantes

La bóveda y el primer conector (GitHub) ya están. Falta lo que completa la
tercera promesa: entornos y despliegues del cliente en una sola pantalla —
que es también lo que desbloquea los muebles vivos que quedan sin conectar
en la oficina (pantalla de despliegue, rack de servidores).

### 2. S8–S12

Base de datos como código, migraciones sincronizadas con el repo, agentes
(Codex, Claude Code), DevUP ID y beta. Detalle en el plan de 12 semanas
(`docs/DevUP-Plan-de-Desarrollo.pdf`).

### Pendientes sueltos, pequeños

- **Histéresis de tres radios dentro de una sala** (~8 pts). El reparto por
  zonas resuelve veinte personas en cuatro salas; no resuelve doce en una,
  donde la malla vuelve a pedir once conexiones por cabeza. Está descrito en
  §11 bis de la decisión 0002.
- **Redis** para presencia y límite de peticiones, el día que haya más de una
  instancia de API.
- **Reproducción sincronizada de Spotify, verificación pendiente en vivo.**
  El código está construido y probado hasta donde se puede sin una cuenta
  Premium real conectada (búsqueda, cola, OAuth con credenciales reales, RLS,
  todo verificado). Lo que falta comprobar con una cuenta de verdad:
  - Un **415** visto probando en producción, sin URL identificada — falta
    reproducirlo con más contexto de qué acción lo dispara.
  - Que el Web Playback SDK reproduce de verdad en un dispositivo con
    Premium (los avisos de PlayReady/EME en consola son ruido normal del SDK
    de Spotify negociando DRM, no necesariamente un fallo).
- **Acceso del conector de GitHub a organizaciones ajenas al usuario.** Un
  404 al añadir un repo de una organización de GitHub casi siempre es que el
  token de alcance fino no tiene ese repo autorizado, o que la organización
  bloquea tokens de alcance fino sin aprobar (Settings → Third-party access).
  No es un bug de DevUP, pero vale la pena explicarlo en la interfaz de
  conexión para que no parezca uno.

---

## Decisiones cerradas que no se reabren sin motivo nuevo

- **Aislamiento por RLS**, no por esquema por organización.
- **Sin Supabase**: el plano de control es propio.
- **Cifrado extremo a extremo siempre**, grabación en el cliente con
  consentimiento unánime ([`0001`](decisiones/0001-cifrado-de-salas.md)).
- **El mundo proyecta, no origina** ([`0002`](decisiones/0002-vistas-profesional-e-inmersiva.md)
  §5). Toda zona es un canal que ya existe; lo único que vive solo en el mundo
  es la decoración.
- **GitHub se conecta con un token de acceso personal, no con una GitHub App
  con OAuth** — coincide con BYOI y no exige registrar nada en GitHub para
  "ver estadísticas". Se revisará cuando haga falta abrir PRs automáticos
  (S9), que si acaso necesita la misma pieza para las dos cosas a la vez.
- **La música de Spotify sincroniza estado, no audio** — el audio nunca pasa
  por un servidor de DevUP ni por la llamada de voz. Reproducir de verdad
  exige Spotify Premium; quien no lo tenga puede buscar y proponer canciones
  igualmente.
- **La bóveda de credenciales usa dos tablas** (`connections` /
  `connection_secrets`), nunca una — mismo motivo que separa `users` de
  `profiles`: si el secreto viviera en la fila que se puede listar, cualquier
  política que deje ver la lista dejaría ver también el secreto.

## Decisiones aún abiertas

- SFU autoalojado o gestionado, cuando la malla se quede corta. **Ojo:** meter
  un SFU pierde el cifrado extremo a extremo por la puerta de atrás.
- Grabación con vídeo, que hoy es solo audio a propósito.
- Modelo de precios y residencia de datos.
- Si la vista inmersiva llega a fase 5 (inventario, cosméticos, invitados
  externos) o se queda donde está.
- GitHub App con OAuth en vez de PAT, si S9 (PRs automáticos) lo termina
  necesitando de todas formas.
- Cola de Spotify sin reproducción sincronizada como alternativa más barata,
  si el límite de Premium resulta ser un problema real de adopción.

---

## Trampas conocidas, añadidas en este tramo

Todas encontradas ejecutando el sistema, o corrigiendo antes de que llegaran a
producción. Las de tramos anteriores siguen en §9 de `CONTEXTO-COMPLETO.md` y
en la versión anterior de este archivo (historial de git).

| Síntoma | Causa | Salida |
|---|---|---|
| Un mensaje con HTML dentro podría ejecutarse al buscarlo | `ts_headline` + `dangerouslySetInnerHTML` en el snippet de búsqueda no escapa el resto del texto | Snippet como texto plano, sin `ts_headline`; React ya escapa por defecto |
| Buscar "secreto" no encuentra `secreto-de-ana.png` | `simple` tokeniza un nombre con guiones como una sola palabra compuesta | El mismo respaldo `ilike` que ya usaba `GET /workspaces/:id/files` |
| La bóveda sería ilegible hasta para el propio servidor | `connection_secrets` sin ninguna política de `SELECT` — RLS no distingue "lo pide una ruta" de "lo pide el conector" | Política de `SELECT` igual de estricta que `connections`; la disciplina de no exponerla vive en el código de cada ruta, no en la base |
| Un repo de GitHub nunca guardaba sus estadísticas | `jsonb` recibía el objeto de JS directo en vez de `JSON.stringify(...)` | Seguir el mismo patrón que ya usa `world.ts` para parámetros `jsonb` |
| Un fallo de refresco de GitHub borraba la última lectura buena | `upsert_github_repo_stats` sobrescribía `data` con `{}` incluso cuando el fallo era del intento nuevo, no del anterior | `_data` en null conserva la fila existente; solo se anota el error |
| La pantalla de GitHub se rompía entera al fallar el primer refresco | Un repo recién añadido con `data = {}` (objeto vacío, "truthy") hacía `undefined.length` en `recentCommits` | Comprobar un campo real (`defaultBranch`) en vez de la sola presencia del objeto |
| Las cantidades y precios de una línea de cotización nunca cuadraban en JS | `quantity` (numeric) y `unit_price_cents` (bigint) llegaban como texto — nadie los había consumido en la interfaz hasta ahora | Mismo patrón de `::text` + `Number()` que ya usan `pipeline` y `goals` |
| Una prueba mutaba un cliente y una línea que otra prueba, escrita antes, daba por invariables | Reutilizar `acmeSales.client` en vez de crear datos nuevos para el caso de edición | Datos propios y nuevos por prueba — la propia tabla de trampas de este archivo ya lo advertía |
| `InvalidStateError` al entrar en la oficina y cruzar una zona enseguida | `socketRef.current?.send(...)` del cambio de zona no comprobaba `readyState`, a diferencia del envío de movimiento dos líneas más abajo | Mismo guardián `readyState === WebSocket.OPEN` en los dos sitios |
| El popover de música se salía de la pantalla según dónde se abriera | Dirección fija (`bottom-full`) copiada de la campana de notificaciones, que vive arriba; el icono de la barra de llamada vive abajo | Prop `panelDirection`, "down" en la cabecera del canal, "up" en la barra persistente |

### Y la lección de método, que sigue valiendo más que la tabla

**De los fallos de este tramo, la mayoría los encontró probar de punta a
punta en el navegador real, no la revisión de código ni el tipado.** El de la
oficina, en concreto, lo reportó alguien usando la aplicación en producción —
ni 143 comprobaciones automáticas ni el typecheck lo habían visto.

---

## Puesta en marcha

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 y MinIO
npm run db:migrate   # 17 migraciones
npm run dev          # API en :4000, web en :3000

npm run test:rls     # 143 · que esté en verde antes de empezar nada
npm run test:world   # 13
```

Para las pruebas de navegador, ver [`e2e/README.md`](../e2e/README.md): hacen
falta los dos servidores levantados y `npm install --no-save playwright`.

Para probar GitHub o Spotify en local hace falta rellenar además
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` — sin
ellos, conectar Spotify avisa de que no está configurado en vez de fallar a
medias. GitHub no necesita nada en el entorno: el token lo pega quien
administra, desde la propia interfaz.

### Lo que más fácil es romper sin darse cuenta

- **`DATABASE_URL` tiene que ser el rol `devup_app`**, que no es propietario de
  las tablas. Apuntarla al rol de las migraciones desactiva todo el aislamiento
  **sin un solo error** en los registros.
- **Toda consulta pasa por `withUser()`**, que fija `app.user_id` con alcance
  local a la transacción. Los barrenderos periódicos (subidas abandonadas,
  refresco de GitHub) corren con `withUser(null, ...)`, y por eso las
  consultas que necesitan cruzar organizaciones ajenas tienen que ser
  funciones `security definer` — sin identidad, `is_org_member` no deja ver
  nada.
- **Las funciones de pertenencia son `SECURITY DEFINER` a propósito.**
- **Cada tabla nueva con `organization_id` (o que cuelgue de un canal)
  necesita su política y su caso en `isolation.test.ts`.** Es el único freno
  automático contra una fuga entre clientes, y en este tramo ha crecido de 98
  a 143 comprobaciones justamente por respetarlo.
- **Nada secreto en una variable `NEXT_PUBLIC_*`.**
- **El dinero va en céntimos enteros de punta a punta.** `0,1 + 0,2` no da `0,3`
  en coma flotante, y en una cotización eso es un céntimo que no cuadra.
- **`VAULT_MASTER_KEY` cifra la bóveda; si se pierde o se cambia sin migrar
  los secretos existentes, ninguna credencial guardada se puede volver a
  descifrar.** No hay recuperación posible: es la clave, no una contraseña.
