# DevUP — Contexto completo para reconstruir desde cero

Documento autosuficiente. Si lo único que tienes es este archivo y el
repositorio, alcanza para entender el proyecto entero: visión, alcance,
decisiones de arquitectura con su razón, y lo que falta por construir.

Escrito para que lo lea una persona o un agente que arranca en frío.

> **Cambio importante frente a versiones anteriores de este documento.** El
> proyecto empezó sobre Supabase y ya no se apoya en él. La decisión que
> importaba —que el aislamiento entre organizaciones viva en la base de datos y
> no en la aplicación— sigue intacta; lo que cambió es quién provee el motor.
> Ver §4 y §5.1.

---

## 0. Cómo usar este documento

1. Lee las secciones 1 a 5 antes de escribir código. Son las decisiones y sus
   motivos; saltárselas lleva a rehacer trabajo.
2. El esquema vive en `db/migrations/`, en orden, con el porqué de cada
   decisión en la cabecera de cada archivo. **Ya se ha aplicado contra un
   Postgres real y la prueba de aislamiento pasa** (§6).
3. La sección 7 dice qué falta y en qué orden.
4. La sección 9 son las trampas concretas, todas encontradas ejecutando el
   sistema, no imaginándolo. Vale la pena leerla antes de depurar, no después.

Cuando algo de aquí choque con lo que parezca razonable en el momento, gana lo
de aquí salvo que haya una razón nueva. Estas decisiones ya se discutieron.

---

## 1. Qué es DevUP

Un **centro de mando unificado** para la operación comercial y la
infraestructura técnica de un equipo de desarrollo.

El problema que resuelve: hoy sacar adelante un producto pequeño obliga a
repartir el trabajo entre cinco o seis herramientas que no se hablan. El código
en GitHub, el frontend en Vercel, el backend en Render, la base de datos en un
cuarto proveedor, las tareas en un quinto y la conversación en un sexto. Cada
salto rompe el contexto.

Tres promesas, en este orden de construcción:

| Capa | Qué incluye |
|---|---|
| **Espacio de trabajo** | Workspaces, canales, mensajería en tiempo real, llamadas de voz, gestión documental con etiquetas y búsqueda. Donde el equipo vive a diario. |
| **Control de ventas** | Catálogo de servicios etiquetados, clientes, oportunidades, cotizaciones, objetivos. Una venta ganada se convierte en proyecto con tareas y el objetivo avanza solo. |
| **Infraestructura sin alojamiento** | Modelado de esquema, migraciones versionadas, explorador de datos y vista unificada de repos y despliegues — sobre las cuentas del cliente. Encima, agentes (Codex, Claude Code) etiquetados y asignables a tareas. |

### El modelo: BYOI — *Bring Your Own Infrastructure*

La diferencia con Supabase, Render o Vercel es de rol. Ellos venden capacidad
de cómputo y almacenamiento; **DevUP vende coordinación**. No competimos con el
proveedor del cliente, nos montamos encima. El cliente conecta sus cuentas con
credenciales que quedan cifradas en nuestra bóveda; DevUP orquesta, propone,
versiona y audita, pero nunca aloja la base productiva ni ejecuta su servicio.

Consecuencia buena: coste marginal por cliente casi plano, sin guardias de
disponibilidad sobre sistemas ajenos, superficie regulatoria pequeña.

Consecuencia mala: dependemos de las APIs de terceros, y **custodiamos llaves
de sistemas productivos ajenos**. Esa bóveda es el activo más sensible del
producto.

> **Matiz que conviene no confundir.** BYOI habla de la infraestructura *del
> cliente*. El plano de control de DevUP —su Postgres, su API, su almacén— es
> nuestro y lo operamos nosotros. No hay contradicción en que DevUP tenga
> servidores; la habría en que alojara la base productiva de un cliente.

---

## 2. Alcance: qué es y qué no es

**Sí**

- Workspaces, canales y mensajería en tiempo real
- Llamadas de voz con cifrado y (según el modo) grabación
- Almacenamiento, versionado, etiquetado y búsqueda de archivos
- Control de ventas y objetivos con progreso calculado
- Modelado visual de esquema y generación de migraciones
- Explorador de datos sobre la base del cliente, con guardas
- Vista unificada de repositorios, entornos y despliegues
- Orquestación de agentes con aprobación humana
- Identidad propia (DevUP ID), auditoría y control de acceso

**No**

- No alojamos bases de datos de clientes ni las operamos
- No ejecutamos el cómputo del cliente
- No revendemos servicios de terceros de pago
- No somos CDN, ni registrador de dominios, ni pasarela de pagos
- No almacenamos copias de los datos productivos del cliente
- No garantizamos disponibilidad de sistemas que no controlamos
- No sustituimos el control de versiones: GitHub sigue siendo la fuente de
  verdad del código

### Regla permanente de producto

> Si una funcionalidad exige que DevUP mantenga un proceso corriendo, un puerto
> abierto o un disco montado **en nombre del cliente**, está fuera de alcance
> por definición y hay que rediseñarla como orquestación sobre la cuenta del
> cliente.

No admite excepciones tácticas. Cada una nos acerca a ser un proveedor de
alojamiento, con todos sus costes y ninguna de sus ventajas.

---

## 3. La iteración actual

**Objetivo: llamadas de voz y un lugar donde alojar imágenes y archivos.**

Corresponde a las semanas 1 a 3 del plan de 12 semanas, recortadas a lo mínimo
que se sostiene en pie. Concretamente:

1. Autenticación y multi-tenencia (organizaciones, miembros, roles) — **hecho**
2. Workspaces y canales — **hecho**
3. Sala de voz funcional entre varios participantes — **hecho**
4. Biblioteca de archivos con etiquetas, previsualización y búsqueda — **hecho**
5. Vídeo, pantalla compartida y duración de llamada — **hecho**
6. Grabación en el cliente con consentimiento unánime — **hecho**
7. Workspaces personales frente a compartidos — **hecho**
8. Tablero de tareas por workspace — **hecho**
9. Mensajería de texto en tiempo real, con hilos y no leídos — **hecho**

Con esto queda cerrada la capa de **espacio de trabajo** completa. Lo que
**no** entra todavía: control de ventas, conectores, agentes, identidad propia.

---

## 4. Pila tecnológica

| Pieza | Elección | Por qué |
|---|---|---|
| Frontend | Next.js 15 (App Router), TypeScript estricto, Tailwind 4 | Estándar, sin sorpresas |
| API | Fastify 5, TypeScript | Backend separado: el plano de control queda desacoplado del frontend desde el día uno, y otros clientes (CLI, agentes de la S10) consumen la misma API |
| Datos | Postgres 17, acceso directo con `pg` | Sin ORM: el esquema depende de RLS y de funciones `SECURITY DEFINER`, que es justo lo que un ORM tapa |
| Sesiones | scrypt de Node + JWT con `jose` | Sin dependencias nativas; semilla de DevUP ID (S11) |
| Archivos | Almacén compatible con S3 | MinIO en local, R2 o S3 en producción, o el bucket del cliente. Un solo código |
| Tiempo real | WebSocket propio (`@fastify/websocket`) | Señalización y presencia; ver §5.3 |
| Voz | WebRTC en malla, sin servidor de medios | Ver §5.2 |

### Por qué ya no hay Supabase

Supabase resolvía cuatro problemas con una dependencia: datos, auth,
almacenamiento y tiempo real. Salir de ahí cuesta código propio en las cuatro
áreas, y el motivo para pagarlo es de posición, no técnico: DevUP se vende como
la capa que coordina infraestructura ajena. Depender de un único proveedor para
su propio plano de control contradice el discurso, y ata el producto a las
decisiones de otro justo en la parte que menos se puede mover después.

Lo que **no** cambió al salir: el aislamiento sigue viviendo en Postgres, con
las mismas políticas y la misma disciplina. Lo que cambió: `auth.uid()` pasó a
ser `public.current_user_id()` sobre una variable de sesión, y las políticas de
`storage.objects` se sustituyeron por comprobaciones en la API antes de firmar
cada URL.

### Variables de entorno

Están todas documentadas en `.env.example`, con los valores por defecto listos
para `docker compose up -d`. Las dos que más daño hacen si se equivocan:

- `DATABASE_URL` — conexión de la API. **Tiene que ser el rol `devup_app`**, no
  el propietario del esquema. Ver §5.1.
- `NEXT_PUBLIC_TURN_URL` — vacío vale en desarrollo, en producción no. Ver §5.2.

---

## 5. Decisiones de arquitectura

### 5.1 Multi-tenencia con RLS

El aislamiento entre organizaciones vive **en la base de datos**, no en la
aplicación. Motivo: con multi-tenencia, un solo `WHERE organization_id = ?`
olvidado filtra datos entre clientes. Poniendo el aislamiento en Postgres, un
error de la aplicación devuelve cero filas en vez de las filas de otro.

El coste es disciplina: **cada tabla nueva necesita su política y su caso en
`npm run test:rls`**.

Tres detalles que hay que entender sí o sí:

**La identidad viaja en una variable de sesión.** La API abre una transacción
por petición y fija `app.user_id` con alcance **local**:

```sql
begin;
select set_config('app.user_id', $1, true);   -- true = local a la transacción
...
commit;
```

Local es la palabra importante. Con alcance de sesión, la conexión volvería al
pool arrastrando la identidad del último usuario y la siguiente petición —de
otra persona— heredaría sus permisos. Está implementado una sola vez, en
`withUser()` de `apps/api/src/db/pool.ts`, y ninguna consulta debería saltárselo.

**El rol de la API no es propietario de las tablas.** Postgres salta RLS para el
propietario. Si `DATABASE_URL` apuntara al rol que ejecuta las migraciones,
todas las políticas dejarían de aplicarse **sin un solo error**: las consultas
seguirían funcionando y devolverían de más. De ahí que exista `devup_app`, con
sus privilegios en `db/grants.sql`.

**Las funciones de pertenencia son `SECURITY DEFINER` a propósito.** Sin eso,
una política sobre `organization_members` que consulta `organization_members`
entra en **recursión infinita** y Postgres aborta la consulta. `SECURITY
DEFINER` salta RLS en la consulta interna y corta el ciclo. Si alguien las
"limpia" quitando ese modificador, la aplicación deja de arrancar de una forma
difícil de diagnosticar.

**Y una consecuencia que costó una tarde entera:** `INSERT ... RETURNING`
evalúa también la política de `SELECT` sobre la fila recién insertada. Al crear
una organización, quien la crea todavía no es miembro —el trigger que lo hace
socio corre después—, así que la política de SELECT deniega su propia fila y el
INSERT entero se cae. Sin `RETURNING` funciona; con `RETURNING`, no. Por eso
crear organización y crear canal pasan por `create_organization()` y
`create_channel()`, que además mete al creador de un canal privado dentro del
canal.

### 5.2 Voz: malla WebRTC, sin servidor de medios

**No se usa SFU** (LiveKit, mediasoup) en esta iteración. Cada participante se
conecta directamente con cada otro y la señalización va por WebSocket.

Razones:

- Un SFU es un servidor más que alojar, operar y pagar.
- Para 3 a 6 personas por sala, una malla funciona sin él.
- Encaja con la tesis del producto: proveedor de coordinación, no de
  alojamiento de medios.

**Límite honesto:** por encima de ~6 participantes la malla se cae de bruces —
cada cliente sube su audio N−1 veces. Ahí se migra a SFU, y esa migración solo
toca `apps/web/src/lib/voice/useVoiceRoom.ts` si se mantiene aislado.

Decisiones concretas:

- **Señalización** por `/ws/voice?channelId=...`. El servidor mantiene la
  presencia en memoria y reparte SDP y candidatos ICE sin mirarlos.
- **Identidad de par:** un `peerId` aleatorio **que asigna el servidor**, no el
  `userId`. Que lo asigne el servidor resuelve dos cosas: nadie puede suplantar
  el identificador de otro par, y una misma persona en dos pestañas obtiene dos
  identidades distintas, que es lo que hace falta para que se oigan en vez de
  pisarse.
- **Negociación perfecta** para resolver colisiones de oferta. El «cortés» es
  el del `peerId` mayor: determinista y simétrico, los dos extremos calculan lo
  mismo sin ponerse de acuerdo.
- **Crear el `RTCPeerConnection` también al recibir una señal** de un par
  desconocido, no solo al ver que entra. La SDP puede llegar antes que el aviso
  de que ese par existe.
- **TURN es opcional en desarrollo y obligatorio en producción.** Sin él la
  señalización conecta pero no llega el audio en NAT simétrico y en buena parte
  de las redes móviles. Es el fallo número uno de este tipo de sistema, y por
  eso la interfaz lo avisa en pantalla cuando no está configurado.
- **El estado en vivo no se guarda en la base de datos.** La presencia en
  memoria se limpia sola cuando el socket se cierra; una tabla no. Las tablas de
  `0003_calls.sql` son historial, y `left_at` es mejor-esfuerzo por diseño.
- **Latido cada 30 s.** Un portátil que se duerme deja el socket abierto pero
  al otro extremo muerto; sin latido, ese participante se queda «dentro» hasta
  que caduque el TCP.

Resto de piezas:

- **Indicador de quién habla:** `AudioContext` + `AnalyserNode`, RMS en un bucle
  de `requestAnimationFrame`, con **histéresis**: el umbral para empezar a
  hablar es más alto que el de dejar de hablar. Con un solo umbral, una voz que
  ronda el límite hace parpadear el indicador varias veces por segundo.
- **Silenciar:** `track.enabled = false` y avisar por el socket. No se cierra la
  pista: reabrirla pide permiso otra vez en algunos navegadores.
- **Cambiar de micrófono:** `getUserMedia({ audio: { deviceId } })` y luego
  `sender.replaceTrack(newTrack)` en cada conexión. **No hace falta renegociar.**
- **Limpieza al salir:** parar las pistas, cerrar todas las conexiones y cerrar
  el socket. Olvidarlo deja el micrófono encendido y pares fantasma en la sala.

### 5.3 Tiempo real propio

Dos endpoints sobre el mismo mecanismo de salas en memoria:

- `/ws/voice?channelId=` — presencia y señalización.
- `/ws/files?workspaceId=` — avisos de cambios en la biblioteca, para que subir
  algo en una pestaña aparezca en la otra.

El navegador no deja fijar cabeceras en `new WebSocket()`, así que la sesión no
puede ir en `Authorization`. Se usa un **ticket efímero** de un minuto
(`GET /auth/ws-ticket`) que viaja en la URL y solo sirve para el apretón de
manos. La alternativa —mandar el token de sesión en la URL— lo dejaría escrito
en los registros del servidor y del proxy.

**Contrapartida honesta:** la presencia vive en el proceso. Con dos instancias
de la API detrás de un balanceador, dos personas en la misma sala pero en
instancias distintas no se ven. Mientras haya una sola instancia es correcto;
cuando haya dos, `apps/api/src/realtime/hub.ts` es el único archivo que hay que
respaldar con Redis pub/sub.

### 5.4 Archivos y almacenamiento

- Bucket **privado**, clave `{organization_id}/{workspace_id}/{uuid}.{ext}`.
- **La primera carpeta de la clave sigue siendo la frontera de seguridad**, pero
  ahora se verifica en la API al firmar cada URL, no en políticas del almacén.
  Consecuencia directa: **firmar una URL sin comprobar antes la pertenencia es
  una fuga entre clientes**. Toda clave se compone en un único sitio,
  `apps/api/src/storage/s3.ts`.
- Acceso siempre por **URL firmada con caducidad**. Nunca bucket público.
- **Orden de la subida: primero la fila, después el objeto.** Esto es lo
  contrario de lo que decía el plan original, y el motivo es nuevo: con subida
  directa del navegador al almacén, la API nunca se entera de si el cliente
  terminó. Con el orden antiguo, quien cierra la pestaña a mitad deja un objeto
  que ninguna fila referencia — invisible, inenumerable y facturable. Reservando
  la fila primero en estado `pending`, todo objeto tiene fila y la basura es
  exactamente el conjunto de filas `pending` caducadas, que el barrendero
  recorre cada quince minutos.
- **El tamaño y el tipo se leen del objeto real** con `HEAD` al confirmar, no de
  lo que declaró el cliente al reservar: quien firma la subida puede mentir
  sobre ambos.

### 5.5 Cifrado frente a grabación — **decidido**

> Decisión completa, con lo descartado y su motivo, en
> [`decisiones/0001-cifrado-de-salas.md`](decisiones/0001-cifrado-de-salas.md).
>
> **Todas las salas van cifradas extremo a extremo, siempre. La grabación
> ocurre en el navegador de un participante y requiere que todos los presentes
> den su permiso.** No hay modos de sala: una sola promesa, la misma en toda la
> aplicación.
>
> Se descartó la «sala grabable» sin cifrado extremo a extremo porque para que
> un servidor grabe, el audio tiene que pasar por él — y eso obliga a un SFU,
> que es justo lo que la regla permanente del producto (§2) prohíbe.

**El cifrado extremo a extremo y la grabación en servidor se excluyen
mutuamente.** Si el audio va cifrado de punta a punta, el servidor solo ve
paquetes opacos y no puede grabar; si puede grabar es porque tiene la clave, y
entonces no es extremo a extremo por mucho que se le llame así.

En una malla WebRTC el audio va cifrado entre pares con DTLS-SRTP y **no pasa
por ningún servidor nuestro**. Es decir: la iteración actual es de hecho
extremo a extremo, y por eso mismo **no es grabable desde el servidor**.

Las tres salidas, cuando toque grabar:

1. **Grabar en el cliente** — un participante designado graba localmente y sube
   el archivo re-cifrado. Preserva el cifrado, pero depende de su conexión y de
   que no cierre la pestaña.
2. **Sala sin cifrado extremo a extremo** — cifrado en tránsito y en reposo,
   con el servidor capaz de grabar. Es lo que hacen Zoom y Meet por defecto, y
   es defendible mientras se diga.
3. **Participante grabador con clave** — se entrega la clave de sala a un
   grabador del lado servidor. Conserva la arquitectura, rompe la promesa
   estricta.

Se eligió la **1**. Prometer las dos cosas a la vez es una promesa de seguridad
falsa, y en este terreno una promesa falsa cuesta más que una funcionalidad
ausente.

Consecuencias que hay que contarle al usuario, no esconder: la grabación
depende de que quien graba no cierre la pestaña, es lo que esa persona oyó, y
de momento es solo audio. Un solo «no» cancela la grabación para todos —en una
malla, quien graba recibe el audio de todos, así que «grabo solo a los que
dijeron que sí» no se puede cumplir—.

---

## 6. Esquema de base de datos

Vive en `db/migrations/`, se aplica en orden, y cada archivo lleva en su
cabecera el porqué de lo que hace:

| Archivo | Qué trae |
|---|---|
| `0001_core.sql` | Usuarios, perfiles, sesiones, organizaciones, miembros, workspaces, canales. Funciones de pertenencia y de autenticación. RLS en todo. |
| `0002_files.sql` | Etiquetas polimórficas, archivos, búsqueda de texto completo, barrendero de subidas abandonadas. |
| `0003_calls.sql` | Historial de llamadas y las funciones transaccionales `join_call` / `leave_call` / `reap_call_peer`. |
| `0004_workspaces_tasks_recordings.sql` | Visibilidad de workspace (compartido/personal), tablero de tareas y grabaciones con consentimiento. |
| `0005_messages.sql` | Mensajes con hilos y adjuntos, marcas de lectura y recuento de no leídos. |
| `db/grants.sql` | Privilegios de `devup_app`. Se reaplica en cada migración, es idempotente. |

Dos separaciones que parecen redundantes y no lo son:

- **`users` y `profiles` son tablas distintas.** RLS es por fila, no por
  columna: si el hash de la contraseña viviera junto al nombre visible,
  cualquier política que deje ver el perfil de un compañero dejaría ver también
  su hash. `users` solo lo ve su dueño; `profiles` es lo que se comparte.
- **`sessions` guarda el hash del token de refresco, nunca el token.** Quien lea
  la tabla no puede suplantar a nadie con lo que encuentre.

### Estado de verificación

Las migraciones **se han aplicado contra un Postgres real** y `npm run test:rls`
pasa con 45 comprobaciones: lectura cruzada entre organizaciones, escritura
cruzada, canales privados dentro de la misma organización, visibilidad de
perfiles, credenciales, workspaces personales, y el ciclo
completo de una llamada.

Un aviso que costó entenderlo la primera vez: **añadir «personal» a workspaces
no fue añadir una columna.** `can_access_channel` y la política de `files`
miraban la organización, no el workspace, así que los canales y los archivos de
un workspace personal habrían seguido siendo visibles para todo el equipo. La
prueba de aislamiento cubre ahora ese caso exacto.

Es la mitad barata de la disciplina que impone elegir RLS. La otra mitad es
acordarse de escribir la política.

---

## 7. Qué falta, y en qué orden

Lo construido está en `apps/api` y `apps/web`; el README tiene el mapa. Lo
siguiente, por orden de dependencia:

1. **Credenciales temporales de TURN.** El `coturn` de desarrollo ya está en
   `docker-compose.yml`, pero usa una credencial fija. En producción eso es un
   relé abierto para cualquiera que lea el bundle de JavaScript: hay que emitir
   credenciales firmadas con caducidad. Ver [`TURN.md`](TURN.md), que tiene el
   cálculo del HMAC listo para copiar.
2. **Invitaciones por correo.** Hoy `add_member_by_email` exige que la cuenta ya
   exista. Hace falta un token de invitación y, con él, SMTP.
3. **Notificaciones y búsqueda global** (semana 6 del plan). Es el hito que
   decide si el equipo abandona sus herramientas actuales.
4. **Semana 4 en adelante** del plan: servicios, clientes y embudo de ventas.

Antes de empezar cualquiera de ellas, `npm run test:rls` tiene que estar en
verde. Es el único freno automático que hay contra una fuga entre clientes.

---

## 8. Puesta en marcha

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 y MinIO
npm run db:migrate
npm run dev
```

Detalles del entorno de desarrollo:

- El runner de migraciones crea el rol `devup_app` y anota un checksum de cada
  archivo aplicado. Editar una migración ya aplicada hace que pare en vez de
  dejar dos entornos con el mismo número de versión y distinto esquema.
- `npm run db:reset` borra el esquema y lo reconstruye. Está bloqueado con
  `NODE_ENV=production`.
- El bucket se crea solo al arrancar la API, con su política CORS. Si el bucket
  ya existía no se toca su configuración: puede ser el de un cliente.

---

## 9. Trampas conocidas

Todas encontradas ejecutando el sistema, no revisándolo a ojo.

| Síntoma | Causa | Salida |
|---|---|---|
| `infinite recursion detected in policy` | Una política sobre `organization_members` consulta `organization_members` | Las funciones de pertenencia tienen que ser `SECURITY DEFINER` |
| `new row violates row-level security policy` al crear una organización | `INSERT ... RETURNING` evalúa también la política de SELECT, y el creador aún no es miembro | Usar `create_organization()` / `create_channel()` |
| Las políticas no filtran nada y nada falla | La API se conectó con el rol propietario de las tablas | `DATABASE_URL` tiene que ser `devup_app` |
| Un usuario ve datos de otro tras varias peticiones | `app.user_id` fijado con alcance de sesión en vez de local | `set_config(..., true)`; siempre a través de `withUser()` |
| La llamada conecta pero no se oye nada | Sin TURN, y los extremos no logran camino directo | Configurar TURN. Es lo primero que hay que descartar |
| Los dos extremos se quedan en `have-local-offer` | Colisión de ofertas sin negociación perfecta | Implementar el patrón cortés/descortés de §5.2 |
| Al recibir una SDP «no existe el par» | La señal llegó antes que el aviso de presencia | Crear el `RTCPeerConnection` también al recibir señal |
| Un participante se queda dentro para siempre | El navegador se cerró de golpe y el socket quedó abierto | Latido del servidor más `reap_call_peer` |
| Dos personas entran a la vez y no se oyen | Dos sesiones de llamada paralelas | Usar `join_call`, que es transaccional |
| La subida da 403 y con curl funciona | El SDK de AWS mete parámetros de checksum en la URL firmada; el navegador no manda esas cabeceras | `requestChecksumCalculation: "WHEN_REQUIRED"` |
| La subida falla sin llegar al almacén | Falta la política CORS del bucket; se queda en el preflight | `ensureBucket()` la aplica al crear el bucket |
| Se acumulan objetos que nadie referencia | Se subió el objeto antes de crear la fila | Reservar la fila primero, en `pending` (§5.4) |
| La misma persona en dos pestañas se pisa | Se usó `userId` como identidad de par | Un `peerId` por conexión, asignado por el servidor |
| El micrófono queda encendido tras colgar | Faltó parar las pistas al desmontar | Limpieza completa: pistas, conexiones y socket |
| Un workspace personal filtra sus canales o archivos | Las funciones de acceso miraban la organización, no el workspace | `can_access_channel` y `files_select` tienen que colgar de `can_access_workspace` |
| Al encender la cámara el otro no ve nada | `ontrack` vuelve a saltar con el mismo stream y no se reasignó | Escuchar `addtrack`/`removetrack` en el stream remoto |
| Un canal de texto no reparte en tiempo real | Se reutilizó la sala de voz para los mensajes | Son salas distintas: se lee un canal sin estar en su llamada |
| coturn no arranca y los argumentos salen raros | Se pusieron comentarios `#` dentro de un `command: >` de YAML | En un escalar plegado no hay comentarios: cada palabra es un argumento |
| Una etiqueta de color sale en gris | Se compuso la clase con una plantilla, `bg-${color}` | Tailwind analiza clases literales; escribirlas una a una |

---

## 10. Hoja de ruta de 12 semanas

Resumen. El detalle —94 tareas con criterio de aceptación y estimación— está en
`docs/DevUP-Plan-de-Desarrollo.pdf`, cuyo fuente es `docs/plan-desarrollo.html`
y se regenera con WeasyPrint.

| Semana | Foco | Entregable |
|---|---|---|
| S1 | Cimientos, identidad y canales | Dos usuarios chatean en un canal privado de su organización |
| S2 | Voz: llamada, cifrado y grabación | Llamada cifrada y archivada con consentimiento registrado |
| S3 | Archivos, taxonomía y búsqueda | Archivo subido, cifrado, etiquetado y encontrado por búsqueda |
| S4 | Servicios, clientes y pipeline | Cotización con servicios etiquetados avanzando por el embudo |
| S5 | Objetivos, entrega y seguimiento | Objetivo trimestral que avanza solo al cerrarse una venta |
| S6 | Notificaciones y búsqueda global | El equipo migra su operación diaria a DevUP |
| S7 | Bóveda y conectores externos | Repo, despliegues y base de datos de un proyecto real, en una pantalla |
| S8 | Base de datos como código | Tabla modelada en la interfaz y datos explorados con guardas |
| S9 | Migraciones y sincronía con el repo | Cambio de esquema → migración → PR en GitHub → aplicado con plan previo |
| S10 | Orquestación de agentes | Tarea asignada a un agente, ejecutada, aprobada y fusionada |
| S11 | DevUP ID e identidad propia | Inicio de sesión con identidad propia, MFA y auditoría |
| S12 | Métricas, endurecimiento y beta | Beta cerrada con equipos externos |

Supuesto de capacidad: 2 personas full-stack, 1 punto ≈ 3 horas efectivas,
22 puntos por semana. El plan suma 257 puntos sobre 264 de capacidad — 97 % de
ocupación, sin apenas colchón.

**El hito que decide todo es el final de la semana 6.** Si el propio equipo no
quiere abandonar sus herramientas actuales para usar DevUP, ningún cliente lo
hará tampoco. Ese es el momento de parar y arreglar la base, antes de gastar
seis semanas más construyendo la capa de infraestructura encima.

### Decisiones aún abiertas

- SFU autoalojado o gestionado, cuando la malla se quede corta. **Ojo:** meter
  un SFU pierde el cifrado extremo a extremo por la puerta de atrás, aunque
  nadie lo decida explícitamente. Hay que decirlo antes de desplegarlo
- Grabación con vídeo, que hoy es solo audio a propósito (§5.5)
- Presencia distribuida (Redis) cuando haya más de una instancia de la API
- Modelo de precios: por asiento, por conexión o por consumo de agentes
- Residencia de datos: dónde viven grabaciones y archivos

### Decisiones ya cerradas

- **Aislamiento por RLS**, no por esquema por organización. Cambiarlo después de
  la semana 3 era carísimo; ya está tomado y probado.
- **Sin Supabase.** El plano de control es propio (§4).
- **Cifrado extremo a extremo siempre, grabación en el cliente** con
  consentimiento unánime (§5.5 y `decisiones/0001-cifrado-de-salas.md`).
