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

| Sesión | Rama |
|---|---|
| Interfaz y flujo | `claude/interfaz-y-flujo` (o la que ya esté usando, pero **suya**) |
| Funcionalidades | `claude/plan-desarrollo-interfaz-j9fr0o` |

Las dos salen del tronco (`claude/sales-control-workspace-platform-i99syv`) y
vuelven a él por PR. Compartir rama fue la causa directa de los tres conflictos
de hoy: dos sesiones empujando al mismo sitio se sobrescriben sin verse.

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

## 6. Pedido a funcionalidades (escribir aquí)

*(vacío — la sesión de interfaz apunta aquí lo que necesite de la API, con la
pregunta que hay que poder contestar)*

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

**2. Tejer enlaces desde donde ya pasan las cosas.** Al adjuntar un archivo a
una tarea, al enlazarle una rama, al mencionarla en un mensaje. Un grafo que hay
que rellenar a mano se queda vacío; uno que se teje solo crece. Es la diferencia
entre una función que existe y una que sirve.

**3. Renovar el código corto de invitación.** Falta `set_invitation_code`: hoy
el botón de la pantalla de ajustes está **desactivado** porque no hay ruta
detrás. Canjear por código ya funciona; lo único que no se puede es dar otro a
una invitación que ya existe, y la salida actual —reinvitar— sirve pero no es
lo que la pantalla promete.

**4. El diario del proyecto, cronológico.** Agrupar el registro por semana. La
versión en prosa necesita al agente y va después.

**5. Reconstruir el contexto de una tarea en un botón.** El PR, los mensajes, la
pizarra y la grabación, juntos. Es la tesis del producto en un clic, y **depende
de 1 y 2**: sin enlaces tejidos no hay nada que reconstruir.

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
