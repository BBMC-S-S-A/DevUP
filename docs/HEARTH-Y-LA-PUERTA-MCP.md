# DevUP · Hearth y la puerta MCP

Guía para empezar a trabajar a fondo, con el motor agéntico como prioridad.
Sale de la propuesta de arquitectura
([DevUP-Propuesta-de-Arquitectura.pdf](DevUP-Propuesta-de-Arquitectura.pdf)) y
de leer el código de hoy, no de la propuesta sola. El estado de cada pantalla
está en [LO-QUE-HAY-Y-LO-QUE-FALTA.md](LO-QUE-HAY-Y-LO-QUE-FALTA.md); cómo se
despliega, en [PLAN-DE-PRODUCCION.md](PLAN-DE-PRODUCCION.md).

---

## 1. La decisión de orden, y por qué se cambia

La propuesta dejaba la puerta MCP en el **bloque 5**, detrás del grafo (bloque
2) y del tejido determinista (bloque 3). El razonamiento era: no se puede
exponer un grafo que no existe.

Sigue siendo cierto, y aun así **el orden se cambia a propósito**: la puerta
MCP va primero, en versión de solo lectura, sobre las tablas que ya hay.

El motivo es que el argumento original mezclaba dos cosas. Exponer *el grafo*
necesita el grafo. Exponer *el proyecto* no: hoy ya existen tareas, columnas,
clientes, ventas, oportunidades, mensajes, canales, archivos, anuncios,
repositorios, entornos y despliegues — 43 tablas con aislamiento por RLS y una
API que las sirve. Preguntarle al proyecto «¿en qué va el cobro de tal
cliente?» se puede contestar hoy, peor que con grafo, pero se puede.

Lo que se gana poniéndolo primero:

- **Se demuestra el ahorro con lo que ya está pagado.** El valor que se vende
  es «no reconstruir el contexto a mano». Eso se puede tener esta semana.
- **La fontanería que hace falta es la misma.** Identidad, revocación,
  registro de lo que el agente hizo y frontera de permisos son idénticos con
  grafo o sin él. Construirlos ahora no es trabajo que se repita después.
- **El grafo nace con un consumidor.** Un grafo diseñado en abstracto se
  diseña mal. Si las herramientas MCP existen antes, el grafo se construye
  para contestar preguntas que ya se están haciendo.

Lo que se pierde, dicho claro: **las respuestas serán más pobres al
principio**. Sin la tabla de enlaces, «qué commit cerró esta tarea» no se
puede contestar más que por heurística. Esa es exactamente la carencia que
justifica el bloque 2, y conviene que se note antes de construirlo.

Orden nuevo:

| | Bloque | Estado |
|---|---|---|
| 1 | Jerarquía y vueltas de navegación | pendiente, no bloquea |
| **5a** | **Puerta MCP, solo lectura** | **empieza aquí** |
| 2 | Nodos, enlaces y registro de actividad | después, con consumidor |
| 3 | Tejido determinista | |
| 5b | MCP que escribe dentro de DevUP | |
| 4 | Hearth como superficie (sustituye al Panel) | |
| 5c | MCP que actúa fuera (PR, despliegue) | al final, con aprobación |
| 6 | Terminar los instrumentos | |

---

## 2. Lo que ya está construido y no hay que volver a hacer

Esto sale de leer el código, y cambia el tamaño del trabajo.

**La API ya acepta `Authorization: Bearer`.** El hook de identidad
(`apps/api/src/auth/plugin.ts`) prueba primero la cabecera y luego la cookie,
y su comentario dice literalmente que es «para el WebSocket y para clientes
que no son navegadores (la CLI y los agentes de más adelante)». La puerta
estaba prevista.

**RLS ya es la frontera, y no hay que inventar otra.** Toda consulta en nombre
de alguien pasa por `withUser` (`apps/api/src/db/pool.ts`), que fija
`app.user_id` como variable **LOCAL** de la transacción. Las políticas la leen
por `public.current_user_id()`. El rol `devup_app` no es dueño de nada y no
salta RLS. Consecuencia para el diseño de abajo: si el servidor MCP habla con
las credenciales de quien lo conecta, el aislamiento sale gratis.

**Las sesiones ya tienen alta, revocación y listado.** Tabla `sessions` con
`session_open`, `session_consume` y `session_revoke`, más `GET /auth/sessions`.
Un token de refresco dura 30 días y se cambia por uno de acceso de 15 minutos
en `POST /auth/refresh`.

**`global_search` ya existe** (migración 0014), así que el buscador que
necesita la primera herramienta MCP no se escribe de cero.

**Corrección a la documentación:** `LO-QUE-HAY-Y-LO-QUE-FALTA.md` decía que
`user_tokens` es «una tabla muerta, sin política y sin una sola referencia en
el código», y proponía borrarla. **Es falso, y borrarla rompería producción**:
`account.ts` la usa para verificar el correo y para restablecer la contraseña,
a través de `issue_user_token` y `consume_user_token`, que son `security
definer`. No tiene política porque nadie la consulta directamente **a
propósito**: solo la tocan esas funciones. Está bien como está.

---

## 3. Arquitectura de la puerta

Cuatro decisiones, y el porqué de cada una.

### El servidor MCP habla con la API por HTTP, no con Postgres

Es la decisión que más consecuencias tiene. La tentación es conectar el
servidor MCP a la base y ahorrarse un salto.

No, por tres razones. **RLS deja de ser la única frontera** en cuanto hay dos
caminos a los datos, y nodos y enlaces tocan todos los dominios a la vez: un
fallo ahí no filtra un dominio, filtra el producto entero. **Las reglas de
negocio se escribirían dos veces** — «una tarea no se mueve a una columna de
otro espacio» vive hoy en la ruta, no en la tabla. Y **el registro de quién
pidió qué queda en un solo sitio**, que es la condición para poder auditar al
agente.

El precio es una petición HTTP por herramienta. A cambio, el servidor MCP es
un traductor sin lógica propia, y eso lo vuelve casi imposible de romper.

### La identidad es una sesión, no un token nuevo

El agente necesita credenciales de larga vida; el token de acceso dura 15
minutos. Lo que **no** hay que hacer es inventar un tipo de token nuevo.

La sesión ya es exactamente eso: un token de refresco de 30 días, guardado
como hash, que se cambia por accesos cortos. Y ya trae lo que a un token de
agente suele faltarle: **se puede listar y revocar** desde `/auth/sessions`.

Entonces: en Ajustes se crea una «conexión de agente», que es una sesión con
una etiqueta. El servidor MCP guarda ese token de refresco en el disco de la
persona, pide un acceso cuando le hace falta y lo renueva solo. Revocarla es
revocar una sesión, y eso ya funciona.

Lo único que hay que añadir es la etiqueta —para distinguir en la lista
«Chrome en el portátil» de «Claude de Juan»— y que el listado la enseñe.

### Actualización: el transporte remoto ya está

"Remoto después" está hecho, en dos piezas:

**El servidor de autorización** — `apps/api/src/routes/oauth.ts` +
`db/migrations/0032_oauth_clientes.sql`: OAuth 2.1 con PKCE y registro
dinámico de clientes (RFC 7591), reusando `sessions` tal cual —
`/oauth/token` termina llamando a `session_open`, la misma función de
siempre, así que un token de un cliente OAuth es indistinguible de una
sesión del navegador y sale en la misma lista de "Conexiones de agente". La
pantalla de consentimiento vive en `apps/web` (`/app/autorizar-agente`), no
en la API: la API solo devuelve JSON o redirecciones, igual que con Google.

**La puerta** — `apps/api/src/routes/mcp.ts`, detrás de
`MCP_REMOTE_ENABLED`: transporte Streamable HTTP **sin estado**
(`sessionIdGenerator: undefined`), un servidor y un transporte nuevos por
petición. El modo con sesión guarda estado en memoria del proceso, y aquí se
rompería solo: la API son dos servicios y se reinicia en cada despliegue.

Tres decisiones que conviene no deshacer sin leer esto:

- **Las herramientas son las mismas, no una copia.** `apps/mcp/src/registro.ts`
  las registra, y lo llaman los dos transportes. Si se duplicaran, lo primero
  que divergiría son las descripciones — que son la documentación que el
  modelo lee para decidir si usa una herramienta, o sea lo que más importa.
- **Las herramientas hablan con la API por HTTP aunque el MCP viva DENTRO de
  la API**, por el bucle local (`127.0.0.1`). Es la decisión de §3: un solo
  camino a los datos, las mismas reglas de negocio, el mismo RLS. El precio es
  una petición local por herramienta.
- **`ClienteApi` es una interfaz y no la clase.** Los dos transportes se
  autentican distinto (disco con rotación vs. acceso ya verificado en la
  petición) y las herramientas no tienen por qué saber cuál las llama.

Lo que queda: encenderlo en producción —aplicar la 0032 y poner
`MCP_REMOTE_ENABLED=true` en el servicio `api`— y probarlo con un Claude de
verdad.

### El transporte es stdio, y remoto después

MCP admite stdio (un proceso local que Claude arranca) y remoto por HTTP. El
remoto obliga a montar OAuth: servidor de autorización, consentimiento y
registro de clientes. Es el camino bueno a la larga y es semanas de trabajo.

Stdio es un paquete que se ejecuta con `npx`, se configura pegando unas líneas
de JSON, y el token vive en el disco de quien lo usa. Se puede tener andando
en días. Y no se tira después: cuando exista el remoto, el mismo conjunto de
herramientas se sirve por los dos transportes.

### El código vive en `apps/mcp`

Un workspace más, hermano de `apps/api` y `apps/web`. No dentro de la API: es
un **cliente** de la API, y meterlo dentro invita a que alguien importe el
pool de conexiones «para ir más rápido» y se lleve por delante la primera
decisión.

---

## 4. El primer entregable: solo lectura

**`buscar` ya está**, en `apps/mcp`, probada de punta a punta contra la API
local: tres arranques seguidos con el token rotando, la organización resuelta
sin pedir uuid, y la comprobación que más importa —una sesión de una
organización no ve por el agente ni una fila de otra—. 23 comprobaciones
propias de esta capa, más las 188 de aislamiento que siguen en verde.

Lo que falta para poder usarla de verdad es la **pantalla que emite el token**:
«conexiones de agente» en Ajustes, que son sesiones con etiqueta. Hoy el token
hay que sacarlo a mano.

Seis herramientas en total. Todas leen, ninguna escribe, así que el peor fallo posible
es una respuesta pobre.

| Herramienta | Contra qué | Contesta |
|---|---|---|
| `buscar` | `GET /search` (`global_search`) | «¿dónde se habló de este cliente?» |
| `ver_tablero` | el tablero del espacio | «¿qué hay en curso y de quién?» |
| `ver_tarea` | `GET /tasks/:id` + `/tasks/:id/files` | detalle, responsable, vencimiento y adjuntos |
| `ver_cliente` | las rutas de `sales.ts` | ventas, servicios y balance de un cliente |
| `ver_canal` | los mensajes de un canal | el hilo de una conversación |
| `que_me_espera` | `GET /notifications` y tareas asignadas | la lista de «te toca» de esa persona |

Dos cosas que parecen detalles y no lo son:

**Las herramientas se nombran y describen para un modelo, no para un
programador.** La descripción es la documentación que el modelo lee para
decidir si la usa. `buscar_nodos_por_termino_y_tipo` con un texto de una línea
se usa mal; `buscar` con tres frases que expliquen cuándo sirve y cuándo no,
se usa bien. Este es el trabajo de verdad de exponer un MCP, y es de escribir,
no de programar.

**Los identificadores no se le exigen.** A un modelo al que se le pide un uuid
se lo inventa. Las herramientas aceptan nombres («el tablero de Marketing») y
resuelven por dentro; los uuid van en la respuesta para que pueda encadenar,
nunca como requisito de entrada.

### Cómo se prueba

- **Aislamiento primero.** Un caso en `apps/api/src/db/isolation.test.ts` por
  cada ruta nueva, en el mismo commit. Hoy son 188 comprobaciones y pasan.
- **El servidor MCP se prueba contra la API local**, con dos organizaciones y
  una sesión de cada una. La prueba que importa es que la sesión de una no vea
  nada de la otra **a través del agente**.
- **Con el inspector de MCP** antes de conectar un Claude de verdad: enseña la
  lista de herramientas y deja llamarlas a mano.

---

## 5. Después de lo de arriba

**Escribir dentro (5b).** `crear_nota`, `crear_tarea`, `mover_tarea`,
`enlazar`. Aquí entra la procedencia: todo lo que escriba el agente queda
marcado como tal, y por eso se puede filtrar de la vista y deshacer en bloque.
Sin procedencia, el enlace automático no es aceptable — no es un adorno del
diseño, es la condición.

**Actuar fuera (5c).** Abrir una petición de cambio, desplegar, tocar código.
Va al final, detrás de la aprobación **del responsable del área**, no de
cualquiera con permiso de administración. Eso pide un rol por área que hoy no
existe: hoy solo hay dueño, administrador y miembro. Es poco trabajo, y es la
condición para que este nivel sea aceptable.

**El grafo debajo (bloque 2).** Dos tablas, `nodos` y `enlaces`, con RLS y su
caso de aislamiento en el mismo commit. Lo importante del orden nuevo: las
herramientas MCP **no cambian de firma** cuando el grafo aparece. `buscar`
sigue siendo `buscar`; lo que mejora es lo que devuelve.

---

## 5b. El asistente de dentro tambien habla con Gemini

No solo con Anthropic. Gemini 2.5 Flash tiene una capa gratuita real —sin
cobrar tokens, con cuota diaria de sobra para uso normal (referencia:
~1.500 peticiones/dia)—, y quien no quiera gastar nada puede traer esa clave
en vez de una de pago. Google usa el contenido de la capa gratuita para
mejorar sus productos; con datos reales de clientes pasando por las
herramientas, la pantalla lo dice y no solo este documento.

Mismo enum de siempre (0031, igual que 0030): un valor mas en
`connection_provider`, no una tabla nueva. Si alguien tiene las dos claves
puestas, gana Gemini — es la gratuita.

`apps/api/src/routes/asistente.ts` tiene dos bucles, uno por proveedor, y
comparten el mismo `ejecutar()`: el proveedor decide como se piden y se
devuelven las llamadas a herramienta, no que hace cada una.

Trampa que costo tres verificaciones antes de escribir una linea: buscar
"Gemini function calling Node.js" trajo la API de AGENTES de Google —un
producto aparte, con su propio sandbox, no la generacion de texto normal— y
la habria dado por buena si no se hubiera contrastado contra los tipos reales
del paquete instalado. El metodo correcto es `ai.models.generateContent`, no
la superficie que describia esa documentacion.

## 6. Entorno local, de cero a verde

```bash
npm install
npm run db:up
npm run db:migrate
npm run test:rls
npm run dev
```

`db:up` levanta postgres, minio, coturn y mailpit en Docker. `db:migrate` crea
el rol `devup_app` y aplica las migraciones. `dev` deja la API en el 4000 y la
web en el 3000. Los correos de prueba se leen en Mailpit, en el 8025.

**No lanzar `npm run build` con `npm run dev` corriendo**: le pisa `.next` y la
web responde 500 a todo, con un error que no menciona la causa.

---

## 7. Trampa: el token de agente rota, así que la variable de entorno no manda

Salió construyendo `buscar`, y es de las que solo se ven probando dos veces.

`/auth/refresh` **consume** el token de refresco que se le presenta y emite
otro. Eso es lo correcto —un token robado deja de valer en cuanto el dueño
renueva— pero significa que el token vivo no es el que se configuró: es el
último que se guardó en el disco.

Lo natural es escribir «la variable de entorno pisa al archivo», que es lo que
hace todo el mundo. Con rotación eso está mal: cada arranque presentaría el
token con el que se sembró la conexión, ya consumido, y la conexión moriría
después del primer uso con un mensaje que dice «caducó o alguien la revocó» —
verdad, y sin señalar la causa.

Así que el archivo manda y `DEVUP_TOKEN` **siembra**. Para no perder la
capacidad de cambiar de sesión a mano, se guarda de qué semilla salió: si la
variable trae otra distinta, se entiende que es deliberado y se adopta. Hay
prueba de las cuatro combinaciones en `buscar.test.ts`.

---

## 8. Trampa: los finales de línea rompen las migraciones

Encontrada montando este entorno, y va a volver a pasar en cualquier portátil
nuevo.

`migrate.ts` guarda un sha256 del **contenido literal** de cada archivo. Git
convierte los finales de línea al sacar los archivos al disco, y esa
conversión no es igual en todos los clones ni en todos los momentos.
Resultado: una migración que nadie ha tocado da un checksum distinto, el
runner para —hace bien— y el mensaje dice «su contenido ha cambiado», que es
verdad en bytes y mentira en SQL.

Cómo se distingue de un cambio real, y es concluyente: si al volver a poner
CRLF en el archivo de hoy sale **exactamente** el checksum guardado, entonces
el SQL es idéntico y lo único que cambió fue cómo git lo escribió. Cualquier
descuadre que no pase esa prueba **sí** es un cambio de SQL, y no se toca.

Así se reconciliaron la 0010 y la 0011 en local, y la 0010 en producción.

**El arreglo de raíz es normalizar los finales de línea antes de calcular el
hash** en `migrate.ts`. No está hecho porque cambia los 28 checksums de golpe
y obliga a reconciliar la tabla entera en cada entorno, producción incluida.
Es una decisión, no una tarea: mientras no se tome, esto reaparece.
