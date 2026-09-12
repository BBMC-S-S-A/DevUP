# Plan de desarrollo · dónde queda DevUP el 12 de septiembre de 2026

_Escrito al cerrar la sesión. No es un resumen de lo hecho: es lo que hace falta
para que quien siga —otra sesión, otra persona— no tenga que reconstruirlo._

El reparto vigente está en [CAMINOS.md](./CAMINOS.md) y **manda sobre este
documento**. Esto es el plan; aquello es el contrato.

---

## 1. La frase que hay que borrar de la cabeza

Hasta hace tres días, el diagnóstico de DevUP era:

> «DevUP guarda en qué estado está todo y no guarda nada de lo que pasó.»

**Ya no es cierto, y seguir repitiéndolo lleva a construir lo que ya está.** Las
migraciones 0038 a 0046 entraron: hay tabla de actividad —inmutable a propósito,
sin política de UPDATE ni de DELETE—, hay `graph_links` con su guardián
`puede_ver_nodo`, hay jefe de rama, hay código corto, y el `is_org_admin` que
devolvía NULL está cerrado.

La API escribe el registro al crear, mover, cerrar, asignar, reclasificar,
priorizar, enlazar rama y dejar evidencia. Y desde el PR #61, la web por fin lo
enseña en tres sitios: dentro de la tarea, en la pantalla del espacio y en la
ficha de la persona.

---

## 2. El reparto, en una línea

| | Lleva | No abre |
|---|---|---|
| **Esta sesión (web)** | `apps/web` de arriba abajo | `db/migrations`, `apps/api`, `apps/mcp` |
| **La otra sesión (datos)** | `db/migrations`, `apps/api`, `apps/mcp` | `apps/web` |

**Por capa y no por tema**, y el motivo está probado: por tema es exactamente
como se construyeron **dos registros de actividad a la vez**. «El registro» es a
la vez tabla, API y pantalla, así que las dos sesiones lo cogieron entero.

Dos reglas que salieron caras:

1. **Nadie empuja a la rama de la otra.** Una rama corta por PR desde el tronco.
2. **Las migraciones las escribe una sola sesión.** Es el único sitio donde un
   conflicto no se arregla fusionando: el migrador va por checksum, y una
   migración ya aplicada que cambie de contenido detiene el despliegue.

---

## 3. Lo que sigue, por orden, en la web

### 3.1 · La capa de datos — **lo siguiente**

**Medido hoy, no heredado de la lista de anteayer:** 142 llamadas `api.*`
sueltas y 136 `useEffect` en toda `apps/web`. Las cifras de CAMINOS.md §2ter
(125 y 119) son de antes de fusionar los dos caminos y se quedaron cortas — el
camino B trajo pantallas nuevas con sus propias lecturas.

Va **antes** de partir pantallas, y no al revés: partir primero obliga a rehacer
el mismo trabajo dos veces, porque al trocear un archivo con lecturas a mano
cada trozo se lleva su propio efecto.

Por dónde empezar, contando llamadas sueltas por archivo:

| Archivo | `api.*` sueltos |
|---|---|
| `o/[orgId]/ventas/page.tsx` | 16 |
| `components/tasks/TaskBoard.tsx` | 12 |
| `w/[workspaceId]/cuenta/page.tsx` | 8 |
| `w/[workspaceId]/github/page.tsx` | 7 |
| `o/[orgId]/ajustes/page.tsx` | 7 |
| `components/arquitectura/Diagrama.tsx` | 6 |

(`w/[workspaceId]/ventas/page.tsx` son seis líneas que reexportan el de
organización: es el mismo archivo montado en dos URLs, no dos pantallas.)

**La trampa, documentada porque ya mordió una vez:** al pasar de estado local a
caché hay que **invalidar aunque la escritura salga bien**. Antes el estado moría
con la pantalla y pintar a mano bastaba; ahora lo pintado vive encima de algo
guardado, y sin marcarlo viejo, volver dentro de la ventana de frescura enseña lo
de antes. No falla nada: simplemente miente, que es peor.

### 3.2 · Partir las pantallas grandes

`TaskBoard.tsx` va por **1.525 líneas** y ha adelantado a Ventas —creció con la
ficha de tarea—. Después de la capa de datos, no antes.

### 3.3 · El armazón con cajón para móvil, y el marco de página

Seis pantallas viven sin barra. Construir el armazón con barra fija y
desmontarlo después es justo lo que hay que evitar. Con el marco vienen los tres
finales de una carga: cargando, fallo, vacío.

### 3.4 · La red del proyecto — **espera a la otra sesión**

`graph_links` tiene tabla y guardián desde la 0043 y **ninguna ruta los usa**.
Hasta que existan, `RedDeTrabajo.tsx` dibuja las tres aristas que hay
—persona↔tarea, tarea↔categoría, tarea↔columna— y no finge saber más.

Cuando lleguen, el orden es: rutas de enlaces → tejerlos solos desde donde ya
pasan las cosas (cerrar con descripción, adjuntar, mencionar) → la red
alimentándose de eso. **Un grafo que hay que rellenar a mano se queda vacío.**

---

## 4. Lo que no es de la web, y quién lo tiene

| Qué | Quién | Por qué no lo hace la web |
|---|---|---|
| Reuniones con hora en DevCall | Juan Bonilla | No hay tabla de eventos ni de asistentes |
| Terminar el código corto | Juan Bonilla | Faltan `set_invitation_code` e `invitation_by_code` |
| Respaldo del almacén de archivos | Juan Bonilla | Infraestructura y variables de entorno |
| Quién hay en una sala sin entrar | Carlos Cáceres | Vive en la memoria del servidor de señalización |
| Rutas de enlaces del grafo | la sesión de datos | Es API |
| `que_ha_pasado` cruzando organizaciones | la sesión de datos | Es la herramienta MCP |

---

## 5. Las dos deudas que hay que mirar antes de construir encima

### 5.1 · Dos modelos de «categoría», y no se portan igual

`tags.owner_id` y `task_categories` **se ven iguales y no se comportan igual**:
la segunda hereda el responsable al crear en ella; a la primera **no la lee nadie
para asignar**. Quien archive en la etiqueta «DevVerse» esperando que caiga en su
jefe de rama se encontrará una tarea sin responsable y **nada se lo explicará**.

La decisión es de producto —¿el área es una etiqueta, transversal y varias por
tarea, o una pertenencia, una sola y con dueño?— y está en el tablero. Mientras
no se tome, **la web no lo tapa con interfaz**: enseñar un delegado que no va a
heredar nada convierte un fallo visible en uno silencioso.

### 5.2 · El backlog huérfano

Doce tareas con captura y **sin responsable**, casi todas vencidas: el rework de
la landing, el fix de la mesa, la corrección de formas y navegación, la barra de
temas, el arreglo visual de las invitaciones. Una tarea vencida y sin dueño no es
trabajo pendiente: es ruido que hace que el tablero deje de leerse. Repartirlas o
cerrarlas cuesta diez minutos y vale más que cualquiera de ellas.

---

## 6. Lo que aprendimos peleándonos, y no conviene volver a aprender

**Un merge limpio no quiere decir un merge correcto.** El PR #57 quitó un import
y el #58 empezó a usarlo; los dos pasaron CI por separado, git no tuvo nada que
resolver y la rama base quedó sin compilar.

**Git no señala el conflicto más caro.** Dos sesiones numeraron `0039`–`0043` por
su cuenta con nombres distintos. Para git eran ficheros distintos: cero marcas de
conflicto, y una fusión que habría tirado la función de invitación que el
producto usa hoy. Lo que zanjó la discusión no fue una preferencia de diseño sino
el **checksum del migrador**, y esa es la razón buena.

**El SQL que TypeScript no mira es donde se esconde el fallo.** Cuatro sitios
seguían leyendo `activity` con los nombres viejos dentro de cadenas de texto. El
compilador no los ve. Uno era la portada global: habría fallado justo al abrir la
aplicación.

**La misma tabla escrita tres veces.** La traducción de verbos estaba en
`lib/actividad.ts`, en la portada global y —antes— en la API. Es la forma exacta
del fallo de `enlaces.ts`: dos copias de una regla que ya habían divergido. Por
eso ahora vive en un módulo con pruebas, y por eso las pruebas no fijan el
formato de un texto sino tres cosas que romperían la confianza en el historial.

**Y la de fondo:** si un dato no está, **no se construye por tu cuenta** — se
escribe en el §6 de CAMINOS.md como pregunta que hay que poder contestar.
Construirlo es literalmente cómo acabamos con dos registros de actividad.
