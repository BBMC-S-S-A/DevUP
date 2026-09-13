# Dos sesiones a la vez: quién hace qué, y cómo no pisarse

12 de septiembre de 2026. Dos sesiones de Claude Code trabajando sobre DevUP al
mismo tiempo, desde equipos distintos. Este documento es el contrato entre las
dos. Lo escribe la sesión de **funcionalidades**; la de **interfaz y flujo** lo
lee al empezar.

Sustituye al reparto anterior de «camino A / camino B», que era por archivos de
`apps/web` y se quedó corto en cuanto las dos sesiones empezaron a tocar la base
de datos.

---

## 0. Lo que pasó hoy, que es de donde sale todo lo demás

Las dos sesiones trabajaron **sobre la misma rama** y **sobre la misma lista de
tareas pendientes**. El resultado, en una tarde:

- **El registro de actividad se construyó dos veces**, con esquemas distintos
  (`verbo`/`ocurrido_en`/`objeto_tipo` contra `verb`/`at`/`subject_type`). Ganó
  uno y hubo que reescribir todo lo que leía del otro.
- **El código corto de invitación, también dos veces**, con dos diseños
  distintos de dónde guardarlo.
- **El mismo agujero de seguridad arreglado dos veces** (`is_org_admin`
  devolvía NULL en vez de `false`), en dos migraciones distintas.
- **La misma función sin `search_path` arreglada dos veces.**
- Migraciones renumeradas de la 0038 a la 0046 para poder juntarlas.
- **Tres conflictos de fusión seguidos**, resolviendo cada uno a mano.

Nada de eso fue un descuido de nadie. Fue el reparto: **estaba hecho por tema**,
y dos sesiones que leen la misma lista de temas eligen lo mismo. Lo que sigue
está hecho para que eso no pueda volver a pasar.

---

## 1. Las dos reglas que no se negocian

### Regla 1 — Cada sesión en su rama. Nunca las dos en la misma.

La sesión de interfaz ya trabaja como hay que trabajar: **una rama corta por
PR**, salida del tronco y de vuelta a él —`fix/riel-legible`,
`feat/barra-por-niveles`, `feat/selector-en-cabecera`—. Que siga así. La de
funcionalidades usa una rama larga, `claude/plan-desarrollo-interfaz-j9fr0o`.

La regla es una sola: **nadie empuja a la rama de la otra sesión.** Ahí estuvo
el fallo de hoy, y no en cómo se llamen las ramas — dos sesiones empujando al
mismo sitio se sobrescriben sin verse, y así aparecieron los tres conflictos.

Las dos salen del tronco, `claude/sales-control-workspace-platform-i99syv`.

**Traer el tronco es responsabilidad de cada una**, al empezar cada tanda:
`git fetch origin && git merge origin/claude/sales-control-workspace-platform-i99syv`.
Hacerlo al empezar cuesta cinco minutos; hacerlo al final de la semana cuesta
una tarde.

### Regla 2 — El reparto es por CAPA, no por tema.

Un reparto por tema falla porque los temas se solapan: «el registro de
actividad» es a la vez una tabla, una API y una pantalla, así que las dos
sesiones lo cogen. Por capa no puede pasar: quien no toca `db/migrations` no
puede escribir la tabla dos veces.

| | **Interfaz y flujo** | **Funcionalidades** |
|---|---|---|
| `db/migrations/**` | nunca | **suyo** |
| `apps/api/**` | nunca | **suyo** |
| `apps/mcp/**` | nunca | **suyo** |
| `apps/web/src/app/**/layout.tsx` | **suyo** | nunca |
| `apps/web/src/components/ui/**` | **suyo** | nunca |
| `apps/web/src/app/**/page.tsx` | **suyo** | nunca |
| `apps/web/src/components/**` (lo demás) | **suyo** | nunca |
| `apps/web/src/lib/api.ts` | lee | **suyo** (los tipos) |
| `apps/web/src/lib/datos.tsx` | **suyo** | nunca |
| `docs/**` | el suyo | el suyo |

**En una frase:** la interfaz es de la sesión de interfaz, de arriba abajo. La
base, la API y el MCP son de la de funcionalidades, de abajo arriba.

---

## 2. Qué significa cada mitad

### Interfaz y flujo

Cómo se ve y cómo se mueve el trabajo por el producto. El menú lateral y su
flujo, el armazón, el marco de página, las primitivas, la navegación, que
ahorre saltos, que se entienda, que se pueda usar en un móvil.

No escribe migraciones ni rutas. **Si necesita un dato que la API no da, lo
pide** (§4) en vez de construirlo: construirlo es exactamente cómo se
construyeron dos registros de actividad.

### Funcionalidades

Que lo que existe llegue hasta el final y que aparezca lo que falta: tablas,
políticas de aislamiento, rutas, el MCP y sus herramientas, el registro, las
integraciones, los agentes.

No toca pantallas. **Si una función nueva necesita interfaz**, la deja pedida
(§4) con el contrato de la API ya escrito y probado, y sigue.

---

## 3. Migraciones: solo las escribe una sesión

Las migraciones son el único sitio donde un conflicto no se arregla fusionando:
dos personas numerando a la vez producen dos `0047` distintas, y renumerar
arrastra todo lo que las nombra. Hoy nos costó renumerar nueve.

**Solo la sesión de funcionalidades escribe en `db/migrations/`.** Sin
excepciones. Si la de interfaz necesita una columna, la pide.

Y **de la 0038 a la 0046 están congeladas**: el PR #60 las llevó al tronco, así
que ya están aplicadas fuera de nuestros portátiles. Editar una aplicada rompe
el `db:migrate` de todo el mundo — el runner comprueba el hash y se niega a
seguir. A partir de aquí, una migración nueva.

---

## 4. Cómo se piden cosas entre sesiones

No hay canal directo entre las dos: se hablan por el repositorio. Quien
necesita algo del otro lado **lo escribe donde el otro lo va a ver**, con el
contrato cerrado, y sigue con lo suyo en vez de bloquearse.

- **De interfaz a funcionalidades** — un apartado en este documento, §6.
  Diciendo qué pregunta hay que poder contestar, no qué consulta escribir.
- **De funcionalidades a interfaz** — §5, con la ruta, su forma exacta y un
  ejemplo. Si la API está hecha y probada, la interfaz se monta encima sin
  preguntar nada.

Y para enterarse de lo que hizo el otro sin leer el diff entero: `que_ha_pasado`
desde el MCP, o `git log --oneline origin/claude/sales-control-workspace-platform-i99syv`.
Los mensajes de commit de este repositorio explican **por qué**, no qué: leerlos
es más rápido que leer el código.

---

## 5. Pedido a interfaz (lo tiene la API, falta la pantalla)

### La entrada «Inicio» en el menú lateral

La portada global está entera: `/app/inicio` y su `GET /me/inicio`. Cruza todos
los espacios y contesta «¿qué tengo?» sin entrar a ninguno. **Solo falta cómo
llegar.**

En `apps/web/src/app/(privado)/app/w/[workspaceId]/layout.tsx`, donde están
«Panel», «Mesa», «Archivos»:

```tsx
<li>
  <ItemNav
    href="/app/inicio"
    icono={<Home size={15} />}
    activo={pathname === "/app/inicio"}
    indice={0}
  >
    Inicio
  </ItemNav>
</li>
```

**VA ENCIMA DE «PANEL», y es lo único que se pide que no se cambie.** Todo lo
demás de esa lista es de un espacio de trabajo concreto. Inicio no: es lo que
contesta «¿qué tengo, en todos?». Ponerlo entre los de un espacio lo convierte
en una pantalla más de ese espacio, que es justo lo que no es.

### El grafo: ya tiene rutas (tu punto 8 queda desbloqueado a medias)

`RedDeTrabajo.tsx` dice en su propio comentario que no dibuja tarea↔commit ni
tarea↔mensaje porque le faltaba el registro. Ya tiene por dónde leerlas:

```
GET    /grafo/:tipo/:id?limite=200   → { tipo, id, vecinos: [...] }
POST   /grafo/enlaces                → { vecinos }   (enlazar a mano)
DELETE /grafo/enlaces/:enlaceId      → 204
```

Cada vecino trae lo que hace falta para pintarlo sin pedir nada más:

```
{ id, etiqueta, procedencia, creadoEn,
  direccion: "sale" | "entra",   // respecto al nodo por el que preguntaste
  tipo, nodoId, nombre }
```

Los tipos son **diez**: `espacio`, `canal`, `mensaje`, `tarea`, `archivo`,
`componente`, `repositorio`, `entorno` y —desde la 0050/0051— `area` y
`persona`. Con esos dos, una rama y quien la trabaja son nodos del grafo y no
solo recuentos del tablero.

**Dos cosas que conviene saber antes de dibujar.** La primera: `vecinos` viene
en **las dos direcciones** —un nodo tiene aristas por donde sale y por donde
entra—, y `direccion` dice cuál es cuál. Dibujarlas todas como salientes pondría
la mitad de las flechas al revés, y seguiría pareciendo un grafo razonable.

La segunda: **una lista vacía no significa que el nodo no tenga enlaces.**
Puede ser eso, o que el nodo no exista, o que no esté a tu alcance — las tres
contestan igual a propósito, porque distinguirlas convertiría la ruta en un
detector de lo que hay en canales privados. No escribas «este nodo no tiene
relaciones»; escribe que no hay nada que enseñar.

**Ya no está a medias: las reglas tejen.** Esto es el aviso que dejé prometido
arriba. Desde `d166601`, una tarea gana aristas sola en tres sitios, sin que
nadie las dibuje a mano:

| Qué pasa | Arista que aparece |
|---|---|
| Se confirma un adjunto con `taskId` | `tarea —lleva pegado→ archivo` |
| Se apunta una rama con repositorio | `tarea —se toca en→ repositorio` |
| Se deja evidencia con URL de un repo **conectado** | `tarea —se probó en→ repositorio` |

Todas salen **de la tarea**, siempre, y llegan con `procedencia: "regla"`. Eso
te da lo que necesitas para pintar: las de `"regla"` son deducidas y se pueden
rehacer, las de `"persona"` las escribió alguien. **Si vas a dejar quitar
aristas desde la pantalla, ofrécelo solo sobre las de `"persona"`** — borrar una
de regla no sirve de nada, porque vuelve sola en el siguiente recálculo, y el
botón parecería roto.

Lo que todavía **no** teje, para que no lo esperes: `tarea↔mensaje` y
`tarea↔commit`. Las menciones de hoy solo resuelven personas, así que no hay de
dónde deducir la primera sin adivinar, y adivinar en un grafo es peor que no
dibujar. Sigue aguantando bien el caso de cero aristas: una tarea recién creada
no tiene ninguna.

### El botón desactivado de ajustes ya tiene ruta detrás

En `o/[orgId]/ajustes/page.tsx` hay un botón «Dar código / Otro código» con
`disabled` y una nota explicando que faltaba `set_invitation_code`. Ya no falta:

```
POST /invitations/:id/codigo   → 201 { codigo: "ABCD2345" }
```

Solo hay que quitarle el `disabled` y el `title`, y enseñar el código igual que
se enseña el que devuelve invitar. **Tres cosas antes de tocarlo:**

**1. El código de antes deja de valer en cuanto se pide otro.** No es un efecto
raro, es el punto —se pide porque el viejo se dictó mal o se quedó escrito en
una pizarra—, pero la pantalla tiene que decirlo **antes**, no después. Si el
botón dice «Otro código» sin avisar, quien solo quería volver a verlo acaba de
invalidar el que la otra persona tenía apuntado.

**2. El enlace NO se rompe.** Es toda la diferencia con la salida de mientras
(reinvitar), y conviene que se note en el texto: se renueva el código, no la
invitación.

**3. El código se enseña una vez y no vuelve.** En la base está su hash, así que
no hay «ver el código» que se pueda ofrecer nunca. Si quien mira cierra el aviso
sin copiarlo, lo único que le queda es pedir otro.

Y dos campos nuevos en `GET /organizations/:orgId/invitations`, que el botón ya
leía sin que existieran —por eso decía siempre «Dar código»—:

```
hasCode: boolean          // si TIENE código, no cuál
codeExpiresAt: string|null // su caducidad, un día; NO uses expiresAt, son siete
```

### Lo que `GET /me/inicio?dias=30` devuelve

```
{
  dias,
  tareas:  [{ id, title, vence, prioridad, tipo, columna,
              espacioId, espacio, organizacionId, organizacion,
              area, evidencias }],   // ya ordenadas: vencidas, urgentes, por fecha
  resumen: [{ verbo, origen, veces }],
  ultimos: [{ verbo, origen, sujetoNombre, sujetoTipo, ocurridoEn,
              espacioId, espacio }]
}
```

El orden de `tareas` lo decide la API a propósito: así el MCP contesta lo mismo
que la pantalla. No reordenar en el cliente.

---

## 5bis. URGENTE — el tronco no arranca

**`claude/sales-control-workspace-platform-i99syv` tiene `actividadRoutes`
registrado dos veces** en `apps/api/src/server.ts` (líneas 163 y 165). Fastify
rechaza declarar dos veces la misma ruta, así que **la API se cae nada más
empezar**. Comprobado, no deducido: `Method 'GET' already declared for route
'/workspaces/:workspaceId/actividad'`.

Es de la fusión de los dos caminos —una línea que entró por cada lado— y lleva
ahí desde entonces. Nada lo cazó porque **nada arrancaba el servidor**: compilar
no lo ve (registrar dos veces el mismo módulo es correcto para TypeScript) y
ninguna prueba levanta el HTTP, todas hablan con Postgres directamente. El único
sitio donde se veía era al desplegar.

Arreglado en mi rama (`d8e0674`), junto con el paso de CI que faltaba:

```
npm run arranca --workspace apps/api
```

Construye el servidor entero y comprueba que se queda escuchando. Nada más.

**Lo que hay que hacer con esto:** si vas a sacar algo a producción antes de que
se fusione mi rama, quita la línea duplicada en la tuya primero. Y quien fusione,
que no dé por bueno un verde de CI anterior a este commit — ese verde no decía
que la API arrancara, porque nadie se lo había preguntado.

---

### La portada de una organización ya tiene datos

`GET /organizations/:orgId/panorama?dias=7` devuelve espacios, gente, lo que está
en marcha y lo que lleva parado, en una petición. Es lo que hoy contesta la
pantalla que solo lista espacios.

**El rediseño entero está en `docs/INTERFAZ-EL-FLUJO.md`**: el orden del menú, los
canales dentro de DevCall, subir de un espacio a su organización, separar la
persona del panel técnico, integraciones en un solo sitio y el login con el
edificio. Con el porqué de cada decisión y con la prioridad si no cabe todo.

**Léete el §0 antes de tocar nada de eso.** El Panel (0019/0020) y la Mesa (0025)
son la misma idea construida dos veces, y hay una decisión pendiente sobre
fusionarlas. Lo que se monte encima de cualquiera de las dos habrá que rehacerlo
si se fusionan.

---

### Los puntos ya se ganan solos, y falta dónde verlos

`GET /organizations/:orgId/puntos?dias=30` → `{ dias, gente: [...] }`
`GET /organizations/:orgId/puntos/:personaId?dias=30&limite=50` → `{ dias, asientos: [...] }`

```
gente:    [{ id, nombre, total, aSolas, tareas, porMotivo: { cerro_tarea, dejo_prueba } }]
asientos: [{ id, tarea, titulo, motivo, cantidad, aSolas, cuando }]
```

No hay ruta para DAR puntos y no la va a haber: se ganan en la base al entrar
una tarea en una columna final (0055). Una ruta que los reparta los convierte en
algo que se puede pedir.

**Lo único que esta pantalla no puede hacer es enseñar el total y callarse
`aSolas`.** Los puntos se ganan cerrando tareas, así que quien quiera inflar su
número puede crear tareas fáciles y cerrárselas. No se prohíbe —alguien puede
montar su proyecto aquí él solo, y eso es lo que atrae—: se dice. `aSolas` es
cuánto de ese total se ganó en tareas por las que no pasó nadie más, y va **en
la misma línea que el total**. Debajo, en una pestaña o en un tooltip es lo
mismo que no tenerlo: nadie abre la segunda vista. Con eso, un número inflado
sigue ahí y se le ve el inflado.

Tres cosas más:

- **Los asientos van con el marcador, no en otro sitio.** Un total sin
  asientos detrás es un número que hay que creerse; con ellos es una afirmación
  que se puede ir a comprobar tarea por tarea.
- **No lo pintes como un ranking de productividad.** Cuenta tareas cerradas, no
  trabajo hecho: quien pasa un mes con una sola tarea difícil sale último. Un
  podio con medallas convierte eso en una acusación.
- **Cuando todo el periodo se ganó a solas, dilo en el conjunto.** Línea a
  línea cada persona se lee normal; lo que solo se ve mirando el total es que
  nadie ha revisado nada de nadie.

En el MCP ya está como herramienta `puntos`, y su redacción vale de referencia:
`apps/mcp/src/herramientas/puntos.ts`.

---

### La pantalla de categorías está mirando la tabla equivocada

Esto es lo más importante de esta tanda, y no se ve desde la pantalla: se ve
comparando dos ficheros.

`/app/w/<espacio>/categorias` se titula «las ramas de trabajo de este espacio» y
por dentro trabaja sobre **`tags`** — las etiquetas de la 0002, las de cruzar —
mientras que las ramas de verdad son **`task_categories`**, que es lo que lleva
el tablero, lo que crea `crear_area` desde el MCP y lo que el script de
reordenar repartió entre Workflow, DevVerse y Funcionalidades. Son dos tablas
distintas con dos listas distintas de nombres.

Y el «Jefe de rama» de esa pantalla escribe en `tags.owner_id`, que la 0050 dejó
marcada como OBSOLETA con un comentario en la propia columna: «no escribir
aquí». Lo que se guarde ahí no lo lee nadie. Elegir un jefe en esa pantalla hoy
no hace nada visible en ninguna otra parte.

**La API para la pantalla correcta ya está entera y probada:**

```
GET    /workspaces/:id/ramas?dias=7        → { dias, ramas: [...] }
GET    /categories/:categoryId/rama?dias=30 → { dias, porRepartir, quienHaTrabajado }
POST   /workspaces/:id/categories          → { category }   { name, color?, ownerId? }
PATCH  /categories/:categoryId             → { category }   { name?, color? }
DELETE /categories/:categoryId             → 204   (las tareas NO caen con ella)
PUT    /categories/:id/gerentes/:userId    → { gerente: true }
DELETE /categories/:id/gerentes/:userId    → { gerente: false }
```

Cada rama de la lista viene así:

```
{ id, nombre, color,
  gerentes: [{ id, nombre }],   // PLURAL: ver abajo
  pendientes, cerradasReciente, porRepartir }
```

Y el detalle que se abre al entrar en una:

```
porRepartir:      [{ id, titulo, prioridad, columna }]
quienHaTrabajado: [{ id, nombre, porVerbo: { creo: 3, movio: 7 }, ultimaVez }]
```

**Cuatro cosas que conviene saber antes de pintarla.**

1. **Los gerentes son varios, y no es un adorno.** Con uno solo, unas vacaciones
   dejan la rama sin nadie que responda. Por eso no hay «campo jefe»: hay un
   `PUT` y un `DELETE` por persona. Si la pantalla manda la lista entera, dos
   personas editando a la vez se borran la una a la otra sin enterarse.

2. **Gerente y delegado son cosas distintas.** El gerente RESPONDE de la rama y
   REPARTE su trabajo: puede no tener ni una tarea suya. El delegado es quien la
   hace. Archivar una tarea en una rama **no asigna a nadie** — lo que cae sin
   delegado es exactamente `porRepartir`, y esa lista es la razón de ser de la
   pantalla del gerente.

3. **`quienHaTrabajado` cuenta las tareas que HOY están en la rama.** Mudar una
   tarea se lleva su historia con ella. Está bien para «¿quién sabe de esto?» y
   está mal para «¿cuánto se trabajó aquí en septiembre?» — y solo contesta la
   primera. No lo pintes como una gráfica de esfuerzo por mes.

4. **Nombrar a alguien puede fallar de dos maneras distintas, y se notan.** Un
   403 es «tú no puedes nombrar aquí»; un 400 es «esa persona no está en este
   espacio». Enseñar el mismo mensaje para los dos hace que invitar a un
   compañero nuevo se lea como falta de permisos propios.

Lo que pidió el §6.1 —«quién ha trabajado» de verdad— está en esa segunda ruta.
La red del grafo ya tiene `area` y `persona` como nodos (son **diez** tipos, no
ocho: los dos nuevos entraron en la 0050/0051), así que la rama entera se puede
dibujar desde el grafo y no solo contar desde el tablero.

---

## 6. Lo que la web necesita de la API y no construye por su cuenta

Esta sección existe por la lección del registro de actividad: **construirlo yo
es literalmente cómo acabamos con dos**. Así que lo que falte se escribe aquí
como pregunta que hay que poder contestar, no como esquema propuesto.

### 6.1 · ~~«¿Quién ha trabajado en esta rama?»~~ — HECHO

**La pregunta:** abierta una categoría (o área), quiénes han tocado sus tareas
últimamente y cuándo fue la última vez.

**Por qué no se puede hoy.** El recuento por persona
(`GET /organizations/:id/activity/summary`) agrupa por actor, verbo y
procedencia, y recorta por organización, espacio y días. **No hay por dónde
entrar la categoría**, y cruzarlo en la pantalla exigiría traerse el tablero
entero y volver a unir a mano lo que la base ya sabe unir. Eso es exactamente
la clase de trabajo que acaba convertido en una segunda fuente de verdad.

**Lo que NO hace falta:** un número por persona. El desglose ya está resuelto
donde tiene sentido, y una cifra única al lado de una rama tendría el mismo
problema que tendría al lado de una cara.

**Ya no espera.** Dos rutas:

```
GET /workspaces/:id/ramas?dias=7
  → { ramas: [{ id, nombre, color, gerentes: [{id,nombre}],
                pendientes, cerradasReciente, porRepartir }] }

GET /categories/:id/rama?dias=30
  → { porRepartir: [{ id, titulo, prioridad, columna }],
      quienHaTrabajado: [{ id, nombre, porVerbo: {...}, ultimaVez }] }
```

Tres cosas al pintarlo:

**`gerentes` es una lista.** Desde la 0050 una rama puede tener varios — con uno
solo, unas vacaciones la dejan sin nadie que responda. `ownerId` sigue en
`/categories` pero está obsoleto: enseña un dueño que ya no es el que manda.

**`porRepartir` va también en la lista, no solo en el detalle.** Es lo único de
ahí que pide una acción, y esconderlo tras un clic por rama obliga a abrir cinco
para descubrir que hay trabajo esperando en la tercera.

**Y el matiz de `quienHaTrabajado`, que la frase corta esconde:** es quién ha
tocado las tareas que **hoy** están en esa rama. Si una tarea se muda, su
historia se va con ella. Correcto para «¿quién sabe de esto?», incorrecto para
«¿cuánto se trabajó aquí en septiembre?» — y esta ruta solo contesta la primera.
No la etiquetes como la segunda.

### 6.2 · ~~Las dos categorías~~ — DECIDIDO (0050)

Tu advertencia era correcta y se tomó la decisión que faltaba. Resumen para que
no haya que leer la migración:

**Una categoría es una rama de trabajo** —frontend, backend, DevVerse— y una
tarea vive en **una sola**. Si viviera en dos, «cómo va DevVerse» contaría la
misma tarea dos veces.

**Quien la lleva es su gerente: responde y REPARTE.** No hereda las tareas — de
hecho su trabajo es delegarlas, así que heredarlas era exactamente lo contrario
de lo que hace falta. Y pueden ser **varios** (`task_category_owners`), porque
con uno solo unas vacaciones dejan la rama sin nadie.

**`tags.owner_id` se retira.** Las etiquetas vuelven a cruzar («urgente»,
«deuda»). Lo que hubiera puesto ahí se migró a la rama del mismo nombre.

**Lo que sí hay que enseñar**, y sustituye a lo que temías: archivar en una rama
**no asigna a nadie**. Lo que cae sin delegado va a una lista de **«por
repartir»** de esa rama, que es lo que el gerente abre. El gesto pasa de
implícito a explícito — que era justo lo que pedías al negarte a disimularlo.

---

## 7. Lo que ya está hecho, para no volver a hacerlo

Todo esto está en el tronco desde el PR #60. Antes de empezar algo de esta
lista, mirar si ya está:

- **Registro de actividad** (0038) — `verb`, `subject_type`, `subject_label`,
  `at`, `source`. `subject_label` guarda cómo se llamaba la cosa entonces; la
  frase la compone quien pinta.
- **Áreas del tablero** (0044) con delegado por defecto, y su filtro en el
  tablero junto al de etiquetas.
- **Ficha de la tarea** (0045): tipo, prioridad, contexto, criterio, ramas y
  evidencia. Y `POST /tasks/:id/hecha`, que cierra con la prueba en la misma
  transacción.
- **Código corto de invitación** (0041), con su caducidad propia más corta.
- **Portada global** — `/app/inicio` y `GET /me/inicio`.
- **Auditoría por persona** — tercera vista de Auditoría, leída del registro.
- **Acceso** — a quien ya entró en este navegador se le saluda por su nombre y
  se le quita la mitad de marca.
- **MCP** — 18 herramientas, entre ellas `que_ha_pasado`, `crear_area`,
  `enlazar_rama` y `marcar_hecha`.
- **Dos agujeros cerrados**: `is_org_admin` devolvía NULL (cualquiera podía
  invitarse a una organización ajena) y los tableros nuevos nacían sin columna
  terminal.

---

## 8. Lo que bloquea poblar el tablero, y no es un token

Las sesiones que corren **en la nube** (Claude Code en la web) tienen la salida
restringida: el gateway contesta `403` al CONNECT contra `api.hytrex.co` y
contra el despliegue de Railway. **La puerta MCP no llega a DevUP desde ahí, con
token o sin él.** Durante días se anotó como «falta el token», que era la
explicación cómoda y la equivocada.

Lo que funciona: `npm run sembrar:caminos -- --ver` **desde el portátil**, con
`DEVUP_TOKEN`. Usa las mismas funciones que el MCP, así que siembra lo mismo que
sembraría el agente, y es repetible.

---

## 9. El trabajo, repartido

Comprobado contra el código el 12 de septiembre, no contra la memoria de nadie.
El criterio es el del §1: **por capa**. Cuando algo necesita las dos mitades, se
parte en dos tareas —la API primero, la pantalla después— y cada mitad va a su
sesión.

### 9.1 Funcionalidades · base, API y MCP

**1. Las rutas de enlaces del grafo.** `graph_links` tiene tabla y tiene
`puede_ver_nodo` desde la 0043, y **no las usa nadie**: no hay una sola ruta que
escriba o lea enlaces. Crear un enlace y leer los de un nodo, comprobando **los
dos extremos** — que es para lo que se escribió esa función: un enlace entre una
tarea y un mensaje de un canal privado no puede revelar que ese canal existe.

*Va primero porque desbloquea a la otra sesión.* Sin esto, la red de trabajo no
puede dibujar más de lo que ya dibuja.

~~**2. Tejer enlaces desde donde ya pasan las cosas.**~~ **Hecho** (`d166601`).
Teje en tres sitios: adjunto confirmado, rama con repositorio, evidencia que
apunta a un repositorio conectado. La cuarta que decía esta línea —al mencionar
la tarea en un mensaje— **no se hizo y no se va a hacer así**: las menciones de
hoy solo resuelven personas, así que deducirla obligaría a adivinar, y una
arista adivinada en un grafo miente con la misma cara con la que las otras
dicen la verdad. Queda para cuando las menciones sepan apuntar a una tarea.

Lo que salió de aquí y no estaba previsto: borrar una fila **no** se lleva sus
enlaces —`graph_links` no puede tener clave ajena, el extremo es polimórfico— y
la política de borrado exige ver los dos extremos, así que una vez ida la fila
sus aristas quedan inalcanzables para siempre. Hay que limpiarlas antes
(`olvidarNodo`). Está en `lib/grafo.ts` con su comprobación al revés.

~~**3. Renovar el código corto de invitación.**~~ **Hecho.** Migración 0047
(`set_invitation_code`) y `POST /invitations/:id/codigo`. Renueva el código sin
tocar el enlace, que era la razón de existir: reinvitar servía, pero le rompía
la URL a quien podía tenerla ya abierta. La mitad de pantalla está en §5.

Dos cosas que salieron de aquí y no estaban en la lista. La primera: el listado
de invitaciones nunca devolvió `hasCode`, y la pantalla ya lo leía — o sea que
el botón llevaba desde siempre diciendo «Dar código» también sobre las que ya
tenían uno. La segunda, peor: CI corría `test:codigo --workspace apps/api`, que
es solo la mitad de lógica pura. La mitad contra Postgres —la que comprueba
quién puede abrir la puerta de una organización— **llevaba desde la fusión sin
ejecutarse**, en verde, sin que nada lo dijera. Ahora corre el script de la raíz,
que encadena las dos.

~~**4. Devolver a `que_ha_pasado` el alcance que perdió en la fusión.**~~
**Hecho** (`d8e0674`). Ruta nueva `GET /me/actividad`, que cruza organizaciones
sin un solo `where organization_id` —va por `withUser`, las políticas deciden—,
más los filtros por persona y por verbo, y acotar a una organización sin tener
que nombrar un espacio.

Resultó ser más que un cambio de ruta: la herramienta **resolvía un espacio
siempre**, así que la pregunta más frecuente era la que peor contestaba —o
adivinaba (si solo había uno) o se plantaba pidiendo elegir entre cinco—. Ahora
solo resuelve si le nombras uno.

De aquí salió el hallazgo del §5bis: al comprobar que la ruta nueva se registra
bien, el servidor no arrancaba. Llevaba así desde la fusión.

~~**5. El diario del proyecto, cronológico.**~~ **Hecho** (`992e397`).
`GET /workspaces/:id/diario?semanas=8&tz=America/Bogota` y la herramienta
`diario` en el MCP. La versión en prosa sigue pendiente y necesita al agente:
esto es la materia prima ordenada, no el relato.

Si vas a pintarlo, dos cosas que la API hace a propósito y que la pantalla
puede deshacer sin darse cuenta:

**Las semanas vacías vienen y hay que enseñarlas.** Filtrar `hechos === 0` al
pintar desharía justo lo que se ganó: dos entradas seguidas parecerían
consecutivas con un mes de silencio entre medias. Un parón es de lo que más se
mira en un diario. En el MCP las seguidas se juntan en una línea («5 semanas sin
movimiento»), que es enseñarlas sin que ocupen la pantalla — vale como patrón.

**El huso hay que mandarlo.** Por defecto agrupa en UTC, y en UTC lo que se
cerró un domingo por la tarde en Bogotá cuenta en la semana siguiente. El hito
aparece, en la casilla equivocada, y la lista se ve perfecta. Manda el del
navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

~~**6. Reconstruir el contexto de una tarea en un botón.**~~ **Hecho**
(`638ff09`). `GET /tasks/:id/contexto` devuelve la ficha, la historia y lo
enlazado en **una** petición, y la herramienta `contexto_de_tarea` lo redacta.

Para el botón, tres cosas que la API hace a propósito:

**La historia viene hacia delante**, al revés que todas las demás vistas del
registro. Allí lo último arriba es lo correcto —se mira para ponerse al día—;
aquí se lee para reconstruir, y eso se cuenta desde el principio. No la
inviertas.

**`procedencia` distingue lo que puso una persona de lo que dedujo una regla.**
Al pintar conviene que se note: lo primero es una afirmación de alguien, lo
segundo se puede volver a deducir. En el MCP se marca con «(a mano)».

**Y lo que falta hay que decirlo.** Un contexto que solo enseña lo que encontró
se lee como completo, y quien lo mire dejará de buscar — justo cuando la pieza
que falta es la que explica la decisión. El MCP cierra con una línea que nombra
lo que no hay («ninguna conversación enlazada»); la pantalla necesita su
equivalente, no un hueco en blanco.

**Lo que todavía no puede traer:** mensajes y grabaciones, salvo que alguien los
haya enlazado a mano. No hay de dónde deducirlos —las menciones solo resuelven
personas y las grabaciones cuelgan de una llamada, no de una tarea— y adivinarlos
sería meter conjeturas entre hechos.

### 9.2 Interfaz y flujo · `apps/web`

**1. La entrada «Inicio» en el menú lateral.** Diez líneas (§5) que desbloquean
una pantalla entera ya escrita y probada. Es lo que mejor relación
esfuerzo/resultado tiene de toda la lista.

**2. «¿Qué ha pasado aquí desde…?» en el espacio.** `GET
/workspaces/:id/actividad?desde=…` **ya existe y pagina por marca de tiempo**,
no por número de página, justo para que «lo que ha pasado desde ayer» no cambie
de significado mientras se lee. Es con lo que alguien vuelve el lunes.

**3. Quién ha trabajado, en la ficha de la persona y en la rama.** `GET
/organizations/:orgId/actividad/:personaId?dias=…` **ya existe** y devuelve los
renglones y un recuento por verbo.

*Las tres se pueden empezar hoy: la API está hecha. No hay que esperar a nadie.*

**4. El armazón de organización, con cajón para móvil desde el principio.** Seis
pantallas siguen sin barra. Construirlo con barra fija y desmontarlo después es
lo que hay que evitar.

**5. Marco de página: una cabecera, no cinco copiadas.** Y con él los tres
finales de una carga: cargando, fallo, vacío.

**6. La capa de datos.** 125 llamadas sueltas y 119 efectos contra 65 sitios que
ya usan `useRecurso`. Pantalla por pantalla. **La trampa, ya cazada una vez:** al
pasar de estado local a caché hay que invalidar *aunque la escritura salga
bien*, o volver dentro de la ventana de frescura enseña lo de antes. No falla
nada — miente.

**7. Partir las pantallas grandes.** `TaskBoard.tsx` va por 1.525 líneas y ya ha
adelantado a Ventas (1.323); `piezas.tsx` de Spotify, 1.090. Después de la capa
de datos, no antes.

**8. La red de trabajo alimentándose del grafo.** Su propio comentario dice que
no dibuja tarea↔commit ni tarea↔mensaje porque le faltaba el registro. **Depende
de 9.1.1 y 9.1.2.**

### 9.3 Ni de una sesión ni de la otra

**Delegado a personas, porque toca variables de entorno o infraestructura** —la
regla no cambia: eso no se hace a medias—. TURN o Metered, correo de verdad,
respaldos fuera de la máquina con restauración probada, custodia de
`VAULT_MASTER_KEY`, Google, Spotify, YouTube, S3 de producción, y el tope de
sala para compartir pantalla.

**Decisiones, no código.** Media hora de conversación cada una, y mezclarlas con
lo de arriba hace que el tablero mienta sobre cuánto queda: qué pantalla es la
portada, qué se cuenta como participación, y el tamaño del sprite y cuántos
cuerpos base.

**Y la más urgente de las tres: ¿el área es una etiqueta o una pertenencia?**
Conviven dos modelos de «categoría», los dos con dueño:

| | `tags.owner_id` (0040, «jefe de rama») | `task_categories.owner_id` (0044, «delegado») |
|---|---|---|
| Cuántas por tarea | varias | una |
| Ámbito | la organización | el espacio |
| **¿Hereda responsable?** | **no, ninguno** | **sí**: crear ahí sin decir a quién la asigna al delegado |

Lo que hace que esto no pueda esperar no es que haya dos: es que **se ven
iguales y no se portan igual**. Las dos son fichas encima del tablero, las dos
enseñan un nombre y una persona al lado, y solo una decide quién acaba haciendo
el trabajo. Alguien que archive en la etiqueta «DevVerse» esperando que caiga en
Carlos se encontrará con una tarea sin responsable, y no habrá nada en pantalla
que se lo explique.

Dos modelos que se distinguen a la vista son una redundancia; dos que no, son
una trampa. La decisión es de producto y va al tablero — pero **mientras no se
tome, el riesgo corre**.

**El backlog huérfano.** Doce tareas con captura y sin responsable, casi todas
vencidas. No son de nadie, y una tarea vencida y sin dueño no es trabajo
pendiente: es ruido que hace que el tablero deje de leerse. **Antes de añadir
nada nuevo, repartirlas o cerrarlas.**

### 9.4 El único punto donde una espera a la otra

Todo lo demás es paralelo. La única dependencia real:

```
9.1.1 rutas de enlaces  ──►  9.1.2 tejer enlaces  ──►  9.2.8 la red
                                                  └──►  9.1.5 el contexto en un botón
```

Por eso las rutas de enlaces van primero en la lista de funcionalidades: es lo
único que tiene a alguien esperando detrás.

---

## 10. Lo que queda, a 13 de septiembre

_Reescrito al final de la tanda de configuración. **Sustituye a lo que decía
antes este mismo apartado**, que se quedó viejo en unas horas: de sus nueve
puntos de interfaz se han cerrado cinco. Se reescribe en vez de tacharse porque
una lista con la mitad tachada se lee peor que una corta, y lo que importa de
un «qué queda» es poder creérselo. Comprobado contra el código y contra el
tablero, no contra la memoria._

### 10.1 Lo que se cerró y por qué no hay que volver a mirarlo

| Qué | Dónde |
|---|---|
| Las rutas de enlaces del grafo, y tejerlos solos | 0043, `lib/grafo.ts` |
| El diario, el contexto de una tarea, `que_ha_pasado` con alcance | `lib/actividad.ts`, MCP |
| Ramas con gerentes **en plural**, «por repartir», «quién ha trabajado» | 0050, 0051, `lib/ramas.ts` |
| Carpetas en la biblioteca, con el ciclo impedido en la base | 0053 |
| Lo cerrado sin justificar, visible en vez de obligatorio | `lib/widgets.ts` |
| Mirar un enlace de recuperación sin gastarlo | 0054 |
| **Los puntos**: se ganan al cerrar, en la base, y se ven | 0055, `lib/puntos.ts`, MCP `puntos` |
| El oficio y el rol por organización, que estaban sin puerta | 0048, 0052 + `/organizations/:id/me` |
| **`/categorias` sobre la tabla de verdad**, con la red dentro | `task_categories`, `RedDeTrabajo` |
| El recorrido de bienvenida, que elige por dónde empezar según el rol | 0059, `lib/recorrido.ts` |
| **Toda la configuración de la persona** (§10.2) | 0056–0060 |
| El estado de la instalación, sin entrar por SSH | `lib/salud.ts` |
| Renombrar, abrir y borrar un espacio de trabajo | `PATCH`/`DELETE /workspaces/:id` |
| Dar otro código a una invitación que ya existe | 0047, y el botón encendido |

### 10.2 La configuración, que era el hueco más grande y ya no está

Se cierra entera y se apunta aquí porque era lo que más se notaba usando la
aplicación: había una pantalla de «Mi cuenta» que solo dejaba cambiar el
nombre.

| Qué | Dónde |
|---|---|
| Micrófono y cámara: elegirlos, probarlos y que se recuerden | `lib/dispositivos.ts`, `Dispositivos.tsx` |
| Foto de perfil **o** el personaje del DevVerse, a elegir | 0057, 0058, `Avatar.tsx`, `CaraDePersonaje.tsx` |
| De qué avisa la campana, y que lo silenciado ni se escriba | 0060, `Avisos.tsx` |
| El huso horario, que hasta ahora era UTC para todo el mundo | 0056, `huso_de()` |
| Qué datos de uno ve el resto, dicho sin adornos | `DatosVisibles.tsx` |
| Quién soy **en esta organización**: oficio y rol | `/organizations/:orgId/me` |

Lo único que quedó fuera a propósito: **el huso no se detecta solo**. Se ofrece
el del navegador como sugerencia y se guarda solo si se pulsa. Adivinarlo
mueve las semanas de alguien que viaja sin que nadie lo haya pedido.

### 10.3 Base, API y MCP — lo que queda

Poco, y ninguna urgente. La capa de abajo sigue por delante de la de arriba.

1. **Gastar los puntos.** Ganarlos ya funciona; no hay dónde gastarlos. Esto es
   la ropa y el edificio del equipo del DevVerse, y **antes de la tabla hace
   falta una decisión de producto**: qué cuesta qué. Escribirla sin eso es
   inventarse una economía, y una economía mal calibrada no se corrige — se
   abandona.
2. **Reuniones con hora en DevCall.** No hay tabla de eventos ni de asistentes.
   Está en el tablero a nombre de Juan Bonilla.
3. **Terminar el código corto**: faltan las dos funciones que lo canjean.
   También de Juan Bonilla.

### 10.4 Interfaz — lo que sigue abierto

De los nueve de la versión anterior quedan cuatro. Cada uno tiene su contrato
ya escrito y probado; ninguno necesita preguntar nada antes de empezar, salvo
el último, que es una decisión disfrazada de botón.

1. **La biblioteca por carpetas, y la vista previa de una imagen.** Hoy es una
   rejilla plana donde doce archivos se llaman `image.png`. La base ya tiene
   `file_folders` (0053) y la API ya las sirve: **falta solo la pantalla**. La
   más rentable de las cuatro.
2. **Las neuronas en el menú.** El grafo tiene rutas desde el §5 y el generador
   ya sigue los `lib/`, así que lo que dibuje será verdad — antes no lo era.
3. **DevCall se queda los canales**, y lo que hoy cuelga suelto del menú entra
   ahí.
4. **El hallazgo #3 en `/verificar` y `/invitacion`.** El patrón está resuelto
   en `/recuperar`, pero ahí el reenvío exige sesión y quien llega a un enlace
   caducado no la tiene. **Es una decisión antes que un botón** — ver §10.6.
   (El #9, la asimetría entre los dos armazones, se cerró al unificar los
   ajustes.)

### 10.5 Personas: lo que no se puede hacer desde una sesión

**Y lo primero bloquea a todo lo demás.**

1. **Aplicar las migraciones 0047–0060 contra Railway, y desplegar.** El
   guardián de despliegue se para solo mientras haya migraciones sin aplicar —
   está haciendo su trabajo—, así que **nada de lo de arriba está vivo en
   producción todavía**: ni la configuración, ni los puntos, ni las ramas.
   Incluye desplegar el MCP, que pasa a 21 herramientas y deja de poner la
   etiqueta «agente» a la fuerza.
2. **Los 75 commits con autor «Claude» en el tronco.** Reescribirlos cambia
   todos los SHA del repositorio: rompe el `git pull` de todo el mundo y deja
   la rama de la otra sesión colgando de una historia que ya no existe. Hay que
   avisar antes. Y ojo con un detalle que no se ve: los 75 llevan «Claude»
   también como *committer*, así que no queda rastro de qué sesión los encargó
   — ponerles un nombre a todos le atribuye a una persona trabajo que pudo
   salir de la sesión de otra.
3. **Variables de entorno e infraestructura**, que no se hacen a medias:
   custodia de `VAULT_MASTER_KEY`, TURN o Metered, correo de verdad, respaldos
   fuera de la máquina con restauración probada, S3 de producción. **Lo que de
   esto esté sin poner ya se ve solo**, sin entrar por SSH: está al final de
   los ajustes de la organización, para quien la administre.

### 10.6 Decisiones, que no son código

Media hora de conversación cada una, y mientras no se tomen, el tablero miente
sobre cuánto queda.

- **Qué cuesta qué en el DevVerse.** Bloquea el 10.3.1.
- **Qué pantalla es la portada** para quien entra por primera vez. Ahora pesa
  menos que antes: el recorrido de bienvenida ya lleva a cada quien a una según
  su rol, así que la portada dejó de ser lo primero que ve alguien nuevo.
- **El tamaño del sprite y cuántos cuerpos base.**
- **El reenvío sin sesión**: ¿se abre, con límite de peticiones, o se manda a
  iniciar sesión primero? Bloquea el 10.4.4.

_La que estaba marcada como «la más urgente de las tres» en el §9.3 —si el área
es una etiqueta o una pertenencia— **ya está decidida**: la 0050 la resolvió.
La rama es la categoría, el gerente responde y reparte, el delegado la hace, y
archivar en una rama no asigna a nadie._
