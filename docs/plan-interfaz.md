# Plan de interfaz · La capa que nunca se construyó

Complementa `plan-lo-que-falta.md`, que ordena los bloques A–H. Ese plan cuenta
qué falta del producto. Este cuenta qué le falta a la **interfaz**, que es una
pregunta distinta y que ese plan no toca en ninguno de sus ocho bloques.

Fecha: 27 de agosto de 2026 · ~28 puntos · escrito leyendo las 17 pantallas y
los 30 componentes, no la documentación.

---

## 1. El diagnóstico, en una frase

**El sistema visual está bien hecho. Lo que no existe es la capa de encima: el
armazón, el marco de página y la navegación entre pantallas.**

Esto importa porque cambia qué hay que hacer. La reacción instintiva ante «la
interfaz está hecha a trozos» es rehacer el estilo. Aquí sería tirar lo único
que sí se pensó de una vez.

`globals.css` tiene cuatro niveles de superficie, tres familias tipográficas,
curvas y duraciones nombradas, tres materiales (`cristal`, `panel`,
`panel-vivo`), y tres reglas escritas que explican el resto —el cristal es
cromo, el brillo señala estado, nada pasa de 300 ms—. Hay `prefers-reduced-motion`
y `prefers-reduced-transparency` atendidos. Eso es más sistema visual del que
tiene la mayoría de productos con financiación.

El problema está justo un piso más arriba. Cada funcionalidad llegó como una
**pantalla completa e independiente**, y ninguna llegó como una pieza dentro de
un marco, porque el marco nunca se escribió. Diecisiete veces seguidas.

---

## 2. La evidencia

Números del código de hoy, no impresiones.

### 2.1 Las primitivas existen y se esquivan

| Primitiva | Se usa | Se rehace a mano |
|---|---|---|
| `Tarjeta` | 23 veces | **88** `border border-line` sueltos |
| `Boton` | 97 veces | **55** `<button>` crudos |
| `Entrada` / `Field` | 26 veces | **15** `<input>` crudos |
| *(no existe)* | — | **12** `<select>` y `<textarea>` en 7 archivos |
| `Dialogo` | 6 veces | **8** `window.confirm()` nativos |

La carpeta `components/ui/` tiene cuatro archivos: `Boton`, `Field`,
`Superficies`, `Logo`. No hay `Select`, ni `Textarea`, ni `Menu`, ni `Tabs`, ni
`Tabla`, ni `Confirmar`. Cuando una pantalla nueva necesita un desplegable, no
hay nada que importar: se escribe ahí mismo. Doce veces, doce desplegables
ligeramente distintos.

Los ocho `confirm()` merecen mención aparte, porque no son un problema estético:
son las **ocho acciones irreversibles** del producto —borrar una tarea, un
archivo, un mensaje, una noticia, un cliente, quitar a alguien de la
organización, desconectar GitHub, cerrar Spotify— y las ocho se deciden en un
cuadro gris del sistema operativo, sin el nombre del producto, sin el peligro
marcado en rojo, y con el botón de confirmar donde el navegador quiera ponerlo.
Todo el trabajo de materiales de `globals.css` se apaga exactamente en el
momento en que más se juega el usuario.

### 2.2 La misma cabecera, escrita cinco veces, con deriva

Las cinco pantallas de organización repiten el mismo bloque: `filo-luz` +
rejilla + enlace de vuelta + chapa con icono + `h1` + `Rotulo`. Copiado, no
compartido. Y como está copiado, ha derivado:

| | Enlace de vuelta | Ancho | Titular | Relleno |
|---|---|---|---|---|
| `ventas` | «Workspaces» | sin límite | `text-lg` | `pt-4 pb-5` |
| `github` | «Organizaciones» | `max-w-4xl` | `text-xl` | `pt-5 pb-7` |
| `buscar` | «Organizaciones» | `max-w-2xl` | `text-2xl` | `pt-5 pb-9` |
| `noticias` | «Organizaciones» | `max-w-2xl` | `text-xl` | `pt-5 pb-7` |
| `ajustes` | «Organizaciones» | `max-w-3xl` | `text-xl` | `pt-5 pb-7` |

Todas apuntan a `/app`. Cuatro lo llaman «Organizaciones» y una «Workspaces».
El mismo enlace, al mismo sitio, con dos nombres — y ninguno de los dos es
mentira, porque `/app` es las dos cosas a la vez. Eso no es un descuido de
redacción: es la señal de que **nadie ha decidido nunca qué es `/app`**.

### 2.3 No hay armazón de organización

No existe `app/o/[orgId]/layout.tsx`. Seis pantallas —ventas, github, buscar,
noticias, ajustes, dev— viven **sin ninguna barra**.

La consecuencia práctica: para ir de Ventas a GitHub hay que volver a `/app` y
volver a entrar. Las dos son de la misma organización, se usan el mismo día, y
están a tres clics una de otra pasando por una pantalla intermedia.

Y el contraste dentro del propio producto es el argumento más fuerte: el
workspace **sí** tiene armazón, y está bien hecho —barra fija, canto de luz,
esqueleto con la silueta real, escalonado con tope, listón de acento en el
activo, pie con sesión y campana—. El nivel de organización tiene el mismo
derecho a uno y no lo tiene, por ningún motivo salvo el orden en que se
construyeron las cosas.

### 2.4 No hay capa de datos, así que cada pantalla se la inventa

**88** llamadas a `api.*` y **71** `useEffect` directamente en archivos `.tsx`.
Cada pantalla vuelve a escribir lo mismo: `loading`, `error`, `load()`,
`useEffect(() => void load(), [load])`, y el refresco a mano después de cada
mutación. No hay caché, así que volver a una pantalla la vuelve a cargar entera
desde cero, y dos pantallas que necesitan la misma lista de miembros la piden
dos veces.

### 2.5 Dos idiomas para decir lo mismo

`sonner` está instalado, el `Toaster` está montado en el layout raíz y hay 66
usos. A la vez, **19 archivos** llevan su propio `setError` y hay **52** avisos
en `text-danger` pintados a mano en el sitio.

Así que un fallo aparece a veces arriba a la derecha y a veces empotrado bajo un
campo, y no hay ninguna regla que diga cuál toca. La regla existe y es fácil
—**el error de un campo va junto al campo; el de una acción va en un toast**—
pero no está escrita en ninguna parte, y lo que no está escrito, deriva.

### 2.6 Solo hay una pantalla, y mide 1280 px

**33** usos de breakpoint (`sm:` `md:` `lg:`) en toda la aplicación. Diecisiete
pantallas, treinta y tres breakpoints.

El armazón del workspace es `w-64` fijo y `pl-64` fijo: por debajo de unos
900 px el contenido se estruja contra una barra que no se puede cerrar. No hay
menú, ni cajón, ni punto de ruptura. El producto no es que se vea mal en un
móvil: **no está construido para que exista un móvil.**

Esto puede ser una decisión legítima —es una herramienta de escritorio para
jornada de trabajo—. Pero entonces conviene que sea una decisión escrita, porque
el bloque G del plan es *abrir a gente de fuera*, y quien recibe una invitación
por correo la abre en el teléfono. La abre para nada.

### 2.7 Las pantallas crecieron sin dividirse

`ventas/page.tsx`: **1273 líneas**. `github`: 678. `ajustes`: 535. `/app`: 713.
Son archivos que contienen la pantalla, sus seis subcomponentes, sus formularios
y su estado, todo junto. Nada de eso se puede reutilizar en otra pantalla ni
probar por separado, y cada uno es un archivo que dos personas no pueden tocar
la misma semana.

---

## 3. Lluvia de ideas

Todo lo que apareció leyendo el código. Sin filtrar y sin comprometerse: la
selección viene en el §4.

### Armazón y navegación

- **Un solo armazón para toda la aplicación**, con la organización siempre
  presente y el workspace anidado dentro. Hoy son dos mundos que se comunican
  por una pantalla intermedia.
- **Decidir qué es `/app`.** O es el conmutador de organizaciones, o es el hogar
  del producto. Ahora mismo hace de las dos y por eso su enlace tiene dos
  nombres.
- **Barra de organización** con Buscar, Ventas, GitHub, Noticias, Dev y Ajustes,
  y debajo los workspaces. Es la barra que ya sabemos hacer, un nivel más
  arriba.
- **Paleta de comandos (⌘K)**: ir a cualquier canal, workspace, cliente o
  pantalla escribiendo. En un producto con 17 pantallas y navegación en dos
  niveles, es lo que hace que la navegación deje de doler antes de que la
  arreglemos del todo. Y `/buscar` ya tiene el backend hecho.
- **Migas o conmutador de organización** en la cabecera, para quien esté en más
  de una.
- **Cajón en móvil**: la misma barra, sobre un velo, con el mismo contenido.
- **Recordar la última pantalla por workspace**, como ya se recuerda el modo
  inmersivo.
- **Atajos de teclado**: `⌘K` paleta, `⌘/` atajos, `g` + letra para saltar,
  `Esc` cierra lo de encima. La aplicación ya tiene Escape en `Dialogo`; falta
  el resto y falta que se puedan ver.

### Marco de página

- **`<Pagina>`**: un componente que recibe título, rótulo, icono, acciones y
  ancho, y pinta la cabecera. Mata las cinco copias y la deriva de la §2.2.
- **Tres anchos con nombre** (`lectura`, `trabajo`, `ancho`) en vez de
  `max-w-2xl/3xl/4xl` elegidos pantalla a pantalla.
- **`<Cargando>` / `<Fallo>` / `EstadoVacio`**: los tres finales posibles de una
  carga, obligatorios y con la misma cara. `EstadoVacio` ya existe y ya obliga a
  decir cuál es —falta que sus dos hermanos existan.
- **Esqueletos con la silueta real**, como el de la barra del workspace, que ya
  está bien hecho y es el modelo a copiar.

### Primitivas que faltan

- `Select`, `Textarea`, `Menu`, `Tabs`, `Tabla`, `Interruptor`, `Casilla`.
- **`Confirmar`**: diálogo de confirmación con tono de peligro, sobre el
  `Dialogo` que ya existe. Mata los ocho `confirm()`.
- **`useAccionPeligrosa`**: confirmar, ejecutar, deshabilitar, avisar. Las ocho
  acciones destructivas hacen hoy lo mismo escrito ocho veces.
- **Ampliar `Boton`** con `icono a la derecha` y estado `exito` momentáneo.
- **Página de muestrario** (`/dev/ui`, solo en desarrollo): todas las
  primitivas en todos sus estados, en una pantalla. Es donde se ve que dos
  componentes han derivado antes de que lo vea un usuario.

### Datos

- **Un `useRecurso(clave, cargador)`** propio, pequeño: caché en memoria,
  deduplicación, `refrescar()`. No hace falta traer una librería para esto, y
  sí hace falta dejar de escribir el mismo `useEffect` 71 veces.
- **Invalidación por clave** después de mutar, en vez de `await load()` a mano.
- **`useMutacion`**: ocupado, error, éxito y toast, con una sola forma.
- **Regla escrita de errores**: campo → junto al campo; acción → toast; pantalla
  → `<Fallo>` con reintentar.

### Oficio

- **Optimismo donde ya hay socket** (mensajes, tareas): el eco del servidor
  llega igual y la interfaz deja de esperarlo.
- **Foco atrapado en `Dialogo`** y devuelto al cerrar. Hoy cierra con Escape y
  con velo, que es la mitad del trabajo.
- **Revisar contraste de `--color-faint`** (#5b6678 sobre #070910) contra
  AA en los tamaños de 10–11 px, que son muchos.
- **Densidad**: `text-[10px]` y `text-[11px]` aparecen por todas partes. O es
  una escala con nombre, o cada pantalla elige.
- **Estados de carga de las acciones**: `Boton cargando` ya existe y no se usa
  en todas las que llaman al servidor.

### Ideas grandes, para discutir

- **Vista de foco**: ocultar el armazón entero con una tecla, para leer o
  escribir sin cromo.
- **Panel personal como portada real** en vez de una pantalla más: ya se guarda
  por persona y ya se arrastra.
- **Tema claro.** El sistema tiene los cuatro niveles nombrados; un tema claro
  es redefinir tokens, no rehacer pantallas. Barato ahora, carísimo dentro de
  seis pantallas más.
- **La cabecera de página como el sitio donde S7 encaja**, en lugar de como la
  sexta copia.

---

## 4. El plan

Cinco fases. La regla de orden es la misma que usa el plan A–H: **primero lo que
abarata lo siguiente**.

### I1 · El armazón de organización · ~6 pts

`app/o/[orgId]/layout.tsx`, con la misma factura que el del workspace: barra
fija, canto de luz, esqueleto con silueta, pie con sesión y campana. Dentro,
las seis pantallas de organización; debajo, los workspaces de esa organización.

Cierra la §2.3 y decide de paso qué es `/app` (§2.2). Dev sigue entrando por
navegación dura `<a>` — está anotado en `ESTADO-DEL-PRODUCTO.md` §2 y es
exactamente el tipo de cosa que un armazón nuevo rompe sin avisar.

Va primero porque es lo que más se nota usándolo y porque es el marco donde
entra todo lo demás.

### I2 · El marco de página y las tres primitivas que faltan · ~7 pts

`<Pagina>`, `<Cargando>`, `<Fallo>`, `Confirmar`, `Select`, `Textarea`.
Migrar las cinco cabeceras copiadas y los ocho `confirm()`.

Los ocho `confirm()` son el punto con mejor relación entre esfuerzo y lo que se
gana de todo este plan: es un componente y ocho sustituciones, y arregla los
ocho momentos en que el producto pide algo irreversible.

### I3 · La capa de datos · ~7 pts

`useRecurso` y `useMutacion`, y migrar las pantallas de mayor tráfico —canal,
biblioteca, tablero, ventas—. Las demás pueden convivir con lo viejo: no hace
falta un día de parón, hace falta que lo nuevo tenga dónde escribirse.

Aquí se escribe también la regla de errores de la §2.5 y se aplica a lo migrado.

### I4 · Partir las pantallas grandes · ~5 pts

`ventas` (1273 líneas) en cabecera, embudo, clientes, cotizaciones. `github` y
`ajustes` detrás. Sin cambiar comportamiento: es mover código a archivos, con
los guiones de `e2e/` como red.

Después de I3 y no antes: partir una pantalla que aún tiene su estado a mano
solo reparte el enredo entre más archivos.

### I5 · Muestrario, teclado y decidir el móvil · ~3 pts

`/dev/ui` con todas las primitivas en todos sus estados. `⌘K` sobre el
`/buscar` que ya existe. Y la decisión del móvil escrita: o cajón, o «esto es
una herramienta de escritorio» en el README.

---

## 5. Dónde encaja en el plan A–H

No lo sustituye. Se mete entre C y D:

| | Bloque | Por qué ahí |
|---|---|---|
| 1 | **A** · Que nada se pierda | Sin discusión. Copias de seguridad primero |
| 2 | **B** · Cerrar lo a medias | Deuda que cuesta más abierta |
| 3 | **C** · Pruebas de navegador | La red que hace segura toda migración de interfaz |
| 4 | **I1–I3** · Armazón, marco y datos | ~20 pts |
| 5 | **D** · S7 infraestructura | Ahora encaja en un marco en vez de ser la sexta copia |
| 6 | **I4–I5** | ~8 pts, mientras D corre |
| 7 | **E, F, G, H** | Igual que en el plan original |

El argumento de por qué **antes de D** y no después: D es la pantalla nueva más
grande que queda. Construida hoy, sale con su séptima cabecera copiada, su
propio `useEffect` de carga, su propio desplegable y su propio aviso de error —y
después habrá que migrarla igual, con la diferencia de que entonces será una
pantalla en producción y no un archivo vacío.

I1–I3 no son un desvío antes de D. Son la mitad de D, escrita una vez en vez de
siete.

Y hay una razón de calendario para no dejarlo para el final: **el bloque G abre
el producto a gente de fuera**. Todo lo de este plan es más barato de hacer
mientras los cinco usuarios están en la misma oficina.

---

## 6. Lo que no se toca

- `components/world/**`, `lib/world/**`, las rutas de `devverse` y
  `lib/view-mode.tsx`. Zona restringida, instrucción expresa. El armazón de I1
  es del nivel de organización; el workspace y DevVerse se quedan como están.
- **El sistema visual de `globals.css`.** Ninguna fase cambia un token, un
  material ni una curva. Todo este plan es sobre construir encima de él, que es
  justo lo que le falta.
- **La entrada dura a `/dev`.** `<a>`, no `<Link>`, o el aislamiento
  cross-origin deja de aplicarse y el entorno embebido deja de arrancar.
- **Ningún cambio de comportamiento sin prueba delante.** De ahí que C vaya
  antes: cinco pruebas de navegador estables valen más que revisar a ojo
  diecisiete pantallas migradas.

---

## 7. Lo que necesito que decidas

1. **¿Qué es `/app`?** ¿El conmutador de organizaciones, o el hogar del
   producto? Es la decisión que ordena I1 entero, y es la que hoy hace que un
   enlace tenga dos nombres.
2. **¿Móvil, sí o no?** No pido que se haga: pido que se decida y se escriba.
   Si la respuesta es no, el bloque G necesita al menos que el correo de
   invitación y el acceso funcionen en un teléfono.
3. **¿Va antes o después de D?** Propongo antes, por el argumento del §5. Si hay
   demo con fecha, puede tener sentido lo contrario — pero que sea una decisión.
4. **¿Tema claro ahora o nunca?** Ahora son tokens. Dentro de seis pantallas
   más, son seis pantallas.
5. **¿Empiezo por I1 o por los ocho `confirm()`?** I1 es lo que más se nota;
   los `confirm()` son media tarde y arreglan los ocho momentos en que el
   producto da más miedo.
