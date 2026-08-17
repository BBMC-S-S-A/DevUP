# Plan de desarrollo · Búsqueda global, conectores y rediseño de interfaz

**Estado:** propuesto · **Fecha:** agosto de 2026 · **Precede a:** ninguna
decisión cerrada todavía — este documento es el que hay que discutir antes de
escribir la primera migración.

Qué falta por construir de lo ya planeado (búsqueda global, la bóveda de
credenciales) y de lo que se ha pedido nuevo (GitHub, Spotify, un rediseño
visual con animaciones), y en qué orden encaja sin pisar la oficina inmersiva,
que queda fuera de este plan a propósito.

---

## 1. Dónde estamos

| Promesa | Estado |
|---|---|
| Espacio de trabajo | Completa. Canales, mensajería, voz, archivos, tareas, grabación, invitaciones, notificaciones, vista inmersiva |
| Control de ventas | Servicios, clientes, embudo y objetivos. Falta búsqueda global |
| Infraestructura y agentes | **Nada.** Ni bóveda de credenciales ni conectores |

Van **5 de 9** capacidades de la definición de «plataforma funcional» (§9 de
[`plan-mundo-y-plataforma.md`](plan-mundo-y-plataforma.md)). Este plan ataca la
capacidad 5 (búsqueda), abre la 6 (conectores, empezando por GitHub) y añade
una que no estaba en las 12 semanas originales: música compartida por Spotify.

**Ya hecho en este mismo tramo, sin esperar a este plan:** el acceso
(`/login`) tiene entrada animada, la marca `>_` dibujándose al montar y una
máquina de escribir con las frases del producto. Es la prueba de que el
rediseño visual del bloque E se puede hacer por partes sin parar nada más.

---

## 2. La idea que ordena este plan

Todo lo nuevo que se pide —GitHub, Spotify, lo que venga después— necesita lo
mismo: **guardar una credencial de un sistema ajeno y usarla en nombre de
alguien**. Eso es exactamente lo que dice el §1 de `CONTEXTO-COMPLETO.md` que
es «el activo más sensible del producto». No tiene sentido construirlo dos
veces, una para GitHub y otra para Spotify, con dos formas distintas de
cifrar, dos formas distintas de decidir quién puede desconectar la cuenta.

> **Una integración no es una pantalla nueva: es una fila en la bóveda con un
> proveedor distinto.**

Por eso el orden de este documento no es «GitHub primero porque lo pidieron
primero»: es bóveda → GitHub → Spotify, porque las dos últimas son la misma
pieza con dos formularios encima.

La búsqueda global (bloque A) no depende de nada de esto y es el hito que el
propio plan de 12 semanas marca como el que decide si el equipo abandona sus
herramientas actuales. Va primero en prioridad aunque no comparta código con
el resto.

---

## 3. Bloque A — Búsqueda global (S6) · ~22 puntos

Ya estaba planeada; se detalla aquí porque es lo próximo que toca según
[`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) y nadie ha empezado a escribirla.

### 3.1 Lo que ya existe y no hay que rehacer

Mensajes y archivos ya tienen su índice de texto completo
(`messages_search_idx` en español porque es prosa, `files_search_idx` en
`simple` porque los nombres son identificadores — el porqué está en la
cabecera de `0002_files.sql`). Ese mismo criterio decide el idioma del resto:

| Tabla | Campo(s) | Diccionario | Motivo |
|---|---|---|---|
| `tasks` | `title` + `description` | `spanish` | Prosa, como los mensajes |
| `clients` | `name` + `contact_name` + `notes` | `simple` | Nombres propios de empresas; el lematizador los destroza igual que destrozaba `informe-Q3-final` |
| `services` | `name` + `description` | `simple` | Catálogo, como los archivos |
| `opportunities` | `title` | `simple` | Los títulos de venta son casi nombres propios («Renovación anual Acme») |

### 3.2 La función unificada

Una sola `global_search(_organization_id, _query, _limit)` que hace `union
all` sobre las seis tablas y devuelve `(entity, id, title, snippet,
workspace_id, channel_id, rank, created_at)`. **Sin `security definer`**, igual
que `unread_counts` en `0005_messages.sql`: si la función saltara RLS para
«arreglar» un resultado vacío, un canal privado ajeno se filtraría por la
búsqueda antes que por ningún otro sitio.

Consecuencia de no tener `organization_id` en `messages` ni en `tasks`: la
consulta de mensajes entra por `channels`→`workspaces`, y la de tareas por
`workspaces`, solo para poder filtrar por la organización que pide la
búsqueda. El filtro de seguridad de verdad lo siguen poniendo
`can_access_channel` / `can_access_workspace` / `is_org_member` a través de
las políticas ya existentes — el `where organization_id = $1` es para acotar
el resultado a la organización correcta, no para protegerlo.

### 3.3 Superficie

- `GET /organizations/:orgId/search?q=...` en la API.
- `/app/o/[orgId]/buscar` en la web, con resultados agrupados por tipo y un
  enlace directo a cada uno (canal+mensaje, workspace+archivo, tarea con su
  tablero, cliente, oportunidad con su etapa).
- Entrada rápida desde la barra lateral del workspace (hoy no hay ninguna) y
  desde la página de organizaciones, junto al enlace a Ventas.

### 3.4 La trampa de siempre, multiplicada por seis

Una búsqueda que cruza seis tablas es **seis sitios** donde el aislamiento
puede escaparse en vez de uno. Cada tabla que entra necesita su caso en
`isolation.test.ts`: Bruno (otra organización) no encuentra nada de Acme por
ningún término, y Carla (misma organización, sin acceso a un canal privado)
no encuentra los mensajes de ese canal aunque coincida la palabra.

---

## 4. Bloque B — La bóveda de credenciales (fundación) · ~14 puntos

Es la parte de la §7 de `S7` que hace falta **antes** de poder construir
GitHub o Spotify, no una tarea aparte.

### 4.1 Dos tablas, no una — mismo motivo que `users` / `profiles`

```
connections           -- metadata pública: qué proveedor, quién lo conectó, cuándo
connection_secrets    -- el token cifrado, y nada más
```

`CONTEXTO-COMPLETO.md` §6 ya lo explica para contraseñas: si el secreto
viviera en la misma fila que lo que se puede enseñar en una lista, cualquier
política que deje ver la lista de conexiones dejaría ver también el secreto.
Aquí es igual: `connections` tiene política de `select` para
`is_org_member`/el propio usuario; `connection_secrets` **no tiene política de
`select` para ningún rol de aplicación** — solo lo lee la función interna que
llama al proveedor, y esa función corre con el mismo `devup_app` de siempre,
nunca con un rol aparte.

### 4.2 Org-scoped y user-scoped a la vez

GitHub se conecta una vez por organización (el equipo entero se beneficia de
un token). Spotify se conecta una vez por persona (cada quien autoriza su
propia cuenta). Una sola tabla sirve a las dos con:

```sql
organization_id uuid references organizations(id),
user_id         uuid references users(id),
check (
  (organization_id is not null and user_id is null)
  or (organization_id is null and user_id is not null)
)
```

y dos políticas de `select` distintas según cuál de las dos columnas esté
rellena — la misma idea que ya separa workspaces compartidos de personales.

### 4.3 Cifrado

Node trae lo que hace falta (`crypto.createCipheriv`, AES-256-GCM) sin añadir
una dependencia nueva — coherente con `scrypt` para contraseñas en vez de
`bcrypt` nativo. Una sola clave maestra, `VAULT_MASTER_KEY` (32 bytes,
generada igual que `AUTH_SECRET`), que vive solo en el entorno del servidor y
nunca en la base de datos. Cada secreto guarda su IV junto al texto cifrado;
rotar `VAULT_MASTER_KEY` sin tirar las conexiones existentes queda fuera de
este bloque y se apunta como pendiente.

### 4.4 Superficie común

- `POST /organizations/:orgId/connections` y `POST /connections` (personal) —
  admin de la organización para las de organización, cualquiera para las
  propias.
- `DELETE /connections/:id` — desconectar, borra ambas filas.
- `GET .../connections` — **nunca** incluye `connection_secrets` en el
  `select`; ni por accidente con un `select *`.

---

## 5. Bloque C — Conector de GitHub · ~18 puntos

### 5.1 Cómo se conecta

**Token de acceso personal de alcance fino (fine-grained PAT), pegado por un
administrador — no una GitHub App con OAuth.** Coincide con el propio
discurso de BYOI: el cliente trae su credencial, DevUP la custodia y la usa.
Una GitHub App con OAuth es mejor a la larga (hace falta de todos modos para
la S9, que abre PRs automáticos), pero exige registrarla en GitHub, mantener
su clave privada y gestionar la instalación por organización — trabajo que no
compensa para «ver estadísticas» y que si se hace, se hace una vez para las
dos cosas a la vez.

### 5.2 Qué se muestra

Por repositorio conectado: últimos commits, *pull requests* abiertas, issues
abiertas, y el estado de la última ejecución de CI. Con **caché propia**,
refrescada por un barrendero cada pocos minutos —igual que
`sweep_abandoned_uploads`—, no en cada carga de pantalla: un PAT normal tiene
5000 peticiones por hora, y una organización con varios repos abiertos a la
vez los agota rápido si cada visita a la página dispara una llamada nueva.

Los webhooks de GitHub entrantes son técnicamente viables —el túnel de
Cloudflare ya expone `api.hytrex.co` hacia dentro— pero quedan para una
segunda vuelta: firmarlos y verificarlos bien es trabajo aparte, y el sondeo
periódico ya resuelve el caso de uso de «ver el estado», que es lo pedido.

### 5.3 Esquema

```
github_repos        -- connection_id, full_name ("org/repo"), añadido por quién
github_repo_stats   -- github_repo_id, commits/PRs/issues/ci en jsonb, refreshed_at
```

RLS igual que `services`/`clients`: cuelga de la organización de la conexión,
`is_org_member` para leer, `is_org_admin` para añadir o quitar un repositorio.

### 5.4 Dónde vive en la interfaz

Una pestaña más a nivel de organización, junto a «Ventas» en `/app` — no
dentro de un workspace, porque los repos son del equipo, no de un sitio de
trabajo concreto.

---

## 6. Bloque D — Spotify: música compartida · ~8 a ~28 puntos según alcance

**Esto no estaba en las 12 semanas.** No es un conector de infraestructura
como GitHub; es una comodidad del espacio de trabajo. Se documenta aparte para
no mezclar su presupuesto con el de S7, y porque tiene una decisión de alcance
que cambia el coste en más de tres veces.

### 6.1 La decisión que hay que tomar antes de tocar el esquema

| Opción | Qué es | Coste | Exige |
|---|---|---|---|
| **1. Cola colaborativa** | Cada quien busca una canción y la añade a una cola por canal de voz; quien quiera escucharla abre un enlace `spotify:track:...` en su propia cuenta | ~8 pts | Solo credenciales de aplicación (client credentials), nada por usuario |
| **2. Reproducción sincronizada** | Quien controla la sala transfiere la reproducción a su dispositivo vía Spotify Connect; el resto ve qué suena | ~20 pts más | Login de Spotify **de cada participante** (OAuth con PKCE), y **Spotify Premium para quien reproduce** — el Web Playback SDK no funciona con cuentas gratuitas |

La opción 2 además choca con una decisión ya cerrada: las llamadas van
cifradas extremo a extremo y **el audio no pasa por ningún servidor nuestro**
(`decisiones/0001-cifrado-de-salas.md`). Eso significa que la música de
Spotify nunca podría sonar «dentro» de la llamada — solo puede sonar en los
altavoces de quien la reproduce, que sus compañeros oirán o no según esté en
la misma sala física. Es una limitación física, no de la implementación, y
hay que contarla igual que se cuenta la de la grabación.

**Recomendación:** empezar por la opción 1. Es útil, no depende de que todo el
equipo tenga Premium, y dejar la puerta abierta a la 2 más adelante no cuesta
nada porque son esquemas distintos.

### 6.2 Lo que hace falta y que solo puede traer quien lo pida

Una aplicación registrada en el panel de desarrolladores de Spotify:
**Client ID y Client Secret**, más una **Redirect URI** que apunte a
`https://api.hytrex.co/integrations/spotify/callback` (o la que se decida) —
tiene que coincidir exactamente con lo que se registre en Spotify. Sin esto no
hay integración posible, ni siquiera para probarla en desarrollo.

### 6.3 Esquema (opción 1)

```
connections            -- provider = 'spotify', user_id (no organization_id)
channel_playlists      -- channel_id, activa sí/no
playlist_tracks        -- playlist_id, spotify_track_id, título, artista,
                        -- añadido_por, posición, reproducida_en
```

Cuelga de `can_access_channel`, igual que los mensajes: la playlist de una
sala de voz es tan privada como la sala misma.

### 6.4 Superficie

- Buscar canciones: `GET /spotify/search?q=...` — usa credenciales de
  aplicación (client-credentials), no las de ningún usuario; buscar no exige
  que nadie haya iniciado sesión en Spotify.
- Añadir a la cola: si se implementa como enlaces (opción 1), no hace falta ni
  que quien añade tenga cuenta de Spotify — solo se guarda el ID de la pista.
- Panel en la sala de voz: lista de la cola, quién añadió qué, botón «abrir en
  Spotify».

---

## 7. Bloque E — Rediseño visual con animaciones · ~10 a ~24 puntos

**No toca la oficina inmersiva bajo ningún concepto** — ya se cumplió en el
login y sigue igual para todo lo demás: la vista Canvas 2D, sus muebles, su
editor y el renderizador quedan tal cual están.

### 7.1 Ya hecho

`/login`: entrada escalonada, marca `>_` dibujándose, máquina de escribir,
pestañas con indicador deslizante. Cero dependencias nuevas —
`prefers-reduced-motion` respetado con un `@media` que anula las animaciones
decorativas—, coherente con la filosofía de «sin dependencias nativas» que ya
rige el resto del proyecto.

### 7.2 Lo que queda, de más a menos impacto

| Superficie | Qué | Puntos |
|---|---|---|
| Navegación y listas (`/app`, sidebar de workspace) | Entrada escalonada de tarjetas, transición entre rutas, estados vacíos con el motivo `>_` en vez de un hueco en blanco | 6 |
| Tablero de tareas y embudo de ventas | Ya tienen arrastrar y soltar; falta el pulido — elevación al arrastrar, animación al soltar en la columna, contador que cuenta en vez de saltar | 6 |
| Botones, tarjetas y formularios en general | Micro-interacción consistente (prensa, foco, hover) como clase utilitaria reusable, aplicada en todas las pantallas a la vez | 4 |
| Avisos y confirmaciones | Sustituir los párrafos «aviso» en línea (como en `Invitaciones` de `/app`) por notificaciones tipo toast | 4 |
| Biblioteca de archivos y mensajería | Vista previa animada al abrir un archivo, mensajes entrando uno a uno en vez de aparecer todos de golpe | 4 |

**Primera pasada razonable si no se quiere todo de golpe:** los dos primeros
grupos, ~12 puntos, porque son lo que se ve nada más entrar.

### 7.3 Una dependencia nueva, si se acepta

Los avisos en línea de hoy (`Invitaciones`, formularios de ventas) son
correctos pero no se notan y no se apilan si pasan varios a la vez. Añadir
**Sonner** —una librería pequeña, ya usada en el ecosistema de Next.js, y hay
una guía completa de cómo integrarla bien— resolvería esto sin escribir un
sistema de toasts propio. Es la única dependencia nueva de todo este plan; se
señala aparte porque el resto del documento no añade ninguna.

---

## 8. Bloque F — Pendientes sueltos ya conocidos

Vienen de `CONTINUAR-AQUI.md`, sin cambios; se listan aquí para tener el
presupuesto completo en un solo sitio.

| Pendiente | Puntos | Urgencia |
|---|---:|---|
| Histéresis de tres radios en una sala de la oficina | 8 | Baja — solo importa con ~12 personas en una sala física |
| Ficha de cliente y detalle de cotización editable | 10 | Media — hoy las líneas de una venta no se pueden editar tras crearla |
| Redis para presencia y límite de peticiones | 12 | Ninguna hasta que haya una segunda instancia de la API |

---

## 9. Secuencia propuesta

| Bloque | Qué | Puntos | Bloqueado por |
|---|---|---:|---|
| 1 | **A** — Búsqueda global | 22 | Nada. Empieza ya |
| 2 | **E** (primera pasada) — navegación y listas | 12 | Nada. En paralelo con el 1 |
| 3 | **B** — Bóveda de credenciales | 14 | Nada, pero conviene después de A para no repartir la atención en RLS nuevo dos veces seguidas |
| 4 | **C** — Conector de GitHub | 18 | Bloque B |
| 5 | **F** — Ficha de cliente y detalle de cotización | 10 | Nada. Hueco pequeño, se puede colar entre otros bloques |
| 6 | **D** — Spotify, opción 1 | 8 | **Credenciales de Spotify** que solo puede traer quien administre esa cuenta de desarrollador, y la decisión de alcance del §6.1 |
| 7 | **E** (resto) — pulido general | 12 | Nada. Se reparte durante todo lo anterior en vez de al final |

**Por qué este orden:**

- **Búsqueda va primera** porque ya estaba planeada, es independiente de todo
  lo nuevo, y es el hito que el propio plan llama decisivo.
- **La bóveda va antes que GitHub** porque construir el conector sin ella
  significaría rehacerlo en cuanto llegue Spotify — la misma lógica por la que
  `0004` corrigió tres tablas a la vez en vez de una.
- **Spotify va detrás de todo lo demás** no por prioridad sino porque es lo
  único realmente bloqueado: sin Client ID y Client Secret no hay nada que
  construir, y mientras tanto el resto avanza.
- **El rediseño visual se reparte** en vez de hacerse de una sentada: es
  trabajo de interfaz puro, no compite por atención con el backend de los
  otros bloques, y ver resultados pronto (como ya pasó con el login) importa
  más que entregarlo todo junto al final.

---

## 10. Riesgos

| Riesgo | Respuesta |
|---|---|
| **La bóveda mal hecha es el peor fallo posible del producto** — es literalmente credenciales ajenas | `connection_secrets` sin política de `select` para ningún rol de aplicación; revisar ese archivo con más cuidado que ningún otro de este plan |
| **Spotify decide su alcance tarde y hay que rehacer el esquema** | La decisión del §6.1 se toma antes de escribir la primera tabla, no durante |
| **Un PAT de GitHub con permisos de más** | La interfaz de conexión avisa explícitamente de que el token debería limitarse a los repos que hacen falta, con un enlace a cómo crear uno de alcance fino |
| **Tocar un componente compartido (`Field`, por ejemplo) rompe una pantalla que no se estaba mirando** | Cualquier cambio a un componente usado en más de una pantalla se prueba en todas las que lo usan, no solo en la que motivó el cambio |
| **Seis tablas nuevas en la búsqueda global son seis sitios de fuga posibles** | Un caso por tabla en `isolation.test.ts`, sin excepción, antes de dar el bloque por cerrado |
| **La oficina inmersiva se toca sin querer** | Ningún archivo de `apps/web/src/components/world/`, `apps/web/src/lib/world/` ni `apps/web/src/app/app/w/[workspaceId]/oficina/` entra en ninguno de estos bloques |

---

## 11. Lo que necesito que decidas

1. **GitHub:** ¿PAT pegado por un administrador (bloque C tal como está, ya
   desplegable) o esperar a montar una GitHub App con OAuth propio —más
   trabajo ahora, pero la misma pieza que hará falta para que la S9 abra PRs
   automáticos?
2. **Spotify:** necesito el **Client ID y Client Secret** de una aplicación
   creada en el panel de desarrolladores de Spotify, y la **Redirect URI**
   exacta que se vaya a registrar. Y antes de eso, decidir entre la opción 1
   (cola con enlaces, ~8 pts) y la opción 2 (reproducción sincronizada, ~28
   pts, exige Premium a quien reproduce) del §6.1.
3. **Rediseño visual:** ¿la primera pasada de ~12 puntos (navegación y
   listas) para ver el resultado antes de seguir, o el pulido completo de una
   vez?
4. **Sonner:** ¿se acepta como la única dependencia nueva de todo el plan,
   para los avisos tipo toast del §7.3, o se prefiere seguir sin añadir nada?
5. **Orden general:** ¿confirmas búsqueda global primero pese a que GitHub y
   Spotify son lo que se acaba de pedir, o cambia la prioridad?
