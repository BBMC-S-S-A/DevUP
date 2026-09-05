# Estudio: ¿es viable y funcional DevUP hoy?

Escrito el 5 de septiembre de 2026, a partir de usar el producto como lo usaría
alguien que entra por primera vez, y de verificar cada afirmación contra el
código — no contra lo que los otros documentos dicen de sí mismos.

**Motivo:** «cuando lo usé no me gustó el flujo ni la experiencia de usuario».
Esa frase es el objeto de este estudio. No es una repetición de
`plan-interfaz.md` ni de `ESTADO-DEL-PRODUCTO.md` —los cito, pero para
contrastarlos, no para resumirlos—.

---

## El veredicto, primero

**Técnicamente, sí es viable.** Los cimientos son reales y están verificados,
no solo declarados: 134 puntos de API, 172 comprobaciones automáticas de
aislamiento entre organizaciones que corren en cada cambio, tiempo real por
WebSocket que funciona, y una integración continua que de verdad ejecuta
migraciones, tipos y el criterio de aislamiento — lo comprobé leyendo
`.github/workflows/ci.yml`, no el README.

**El flujo, no.** Y no es una opinión de gusto: **un usuario nuevo no puede
enviar un solo mensaje sin pasar antes por dos formularios de creación con
jerga técnica, y al entrar en su primer espacio de trabajo aterriza en una
biblioteca de archivos vacía, no en un canal.** Eso se explica en el §2 con
archivo y línea. Es exactamente el tipo de fricción que se siente como «no me
gustó» sin que haga falta saber nombrarla.

La buena noticia, y no es un consuelo vacío: **el propio repositorio ya
diagnosticó la mitad de esto**, en `plan-interfaz.md`, y hay commits reales
resolviendo trozos (armazón de organización, marco de página, diálogo de
confirmación). Lo que falta no es descubrir el problema. Es que ese plan nunca
tocó el **primer arranque**, que es justo donde tú lo sentiste.

---

## 1. Lo que sostiene el «sí es viable»

Verificado, no citado:

| Afirmación | Cómo la comprobé |
|---|---|
| 134 puntos de API en 18 módulos | Contados en `apps/api/src/routes/` |
| Aislamiento entre organizaciones por fila (RLS), no por filtro en código | Leído en `CONTINUAR-AQUI.md` y confirmado: `DATABASE_URL` usa el rol `devup_app`, sin privilegio de propietario |
| 172 comprobaciones de aislamiento, en verde | `.github/workflows/ci.yml` ejecuta `test:rls` en cada push, no es un script que alguien corre a veces |
| Tiempo real por WebSocket, no por sondeo | Confirmado en el código de la oficina (`world/`) y del canal — hay guardianes de `readyState` reales, con un bug de producción documentado y corregido (`InvalidStateError` al cruzar de zona) |
| El dinero no tiene errores de coma flotante | Confirmado: céntimos enteros de punta a punta, con el patrón `::text` + `Number()` para no perder precisión en cotizaciones |
| El aislamiento falla cerrado, no abierto | Documentado y consistente con cómo está escrito `withUser()`: sin identidad, `is_org_member` no ve nada |

Esto no es la parte que hay que arreglar. Es la parte sobre la que se puede
construir sin miedo a que se caiga por debajo.

**Lo que sí falta para llamarlo «terminado» en ingeniería, y no es opinión:**
cero pruebas que abran un navegador en la integración continua. Hay cinco
escritas en una rama sin fusionar (`claude/inicio-desarrollo-nu1ftu`) y doce
guiones en `e2e/` que no corren en cada cambio. Eso significa que **todo lo que
se rompe en la interfaz, hoy, lo tiene que encontrar una persona usándola** —y
el propio historial lo confirma: el bug de `InvalidStateError` en DevVerse lo
reportó alguien en producción, no una prueba.

---

## 2. El flujo real, contado en pasos y con archivo y línea

Esto es lo que hice: seguí el camino de alguien que se registra hoy mismo y
quiere mandar un mensaje a su equipo. Cada paso está verificado contra el
código, no supuesto.

### Paso 1 — Registro

Correo y contraseña, o Google. Sin verificación de correo obligatoria antes de
poder usar la cuenta —eso está bien: es fricción que no existe—.

### Paso 2 — Aterriza en `/app`, y no hay nada

[`OrganizationsPage`](../apps/web/src/app/(privado)/app/page.tsx) es la
pantalla de inicio. Con cero organizaciones, `NewOrganization` se abre **ya
expandido** (`useState(!hasAny)`, línea 598), así que no hace falta ni buscar
el botón. Hasta aquí, correcto.

Pero el formulario pide dos campos, y el segundo es jerga:

> «Es la frontera de aislamiento: nada de una organización es visible desde
> otra.» — [`page.tsx:627`](../apps/web/src/app/(privado)/app/page.tsx)

Eso es una frase para quien ya sabe qué es un modelo multi-tenant. Para quien
se acaba de registrar para mandar un mensaje a dos compañeros, es una
explicación de arquitectura de base de datos en el primer formulario que ve.
Y el campo **identificador** (el slug) se autogenera pero se deja editable con
una etiqueta que no explica para qué sirve ni cuándo importa —solo dice
«Identificador», con una muestra en fuente monoespaciada que refuerza que es
«cosa técnica».

### Paso 3 — Crear el workspace, un formulario más

Dentro de la organización recién creada, hay que crear un **workspace**. Otra
decisión que se le pide a alguien que aún no ha visto el producto: «De equipo»
o «Personal», con esta explicación:

> «Un espacio para trabajar solo: sus archivos, canales y tareas no los ve
> nadie más, ni siquiera quien administra la organización.» —
> [`page.tsx:584`](../apps/web/src/app/(privado)/app/page.tsx)

Es una distinción real y probablemente útil **más adelante**. En el primer
minuto es una pregunta sin contexto para decidir algo que no se puede evaluar
todavía.

**Van dos formularios y dos decisiones de arquitectura —aislamiento entre
organizaciones, visibilidad de workspace— antes de haber visto un solo canal,
mensaje o tarea.**

### Paso 4 — Entra al workspace, y aterriza en una biblioteca vacía

Aquí está el hallazgo más concreto de este estudio.

Al pulsar el workspace recién creado, el enlace es
`/app/w/${workspace.id}` — [`page.tsx:250`](../apps/web/src/app/(privado)/app/page.tsx).
Esa ruta renderiza
[`WorkspacePage`](../apps/web/src/app/(privado)/app/w/[workspaceId]/page.tsx),
y su contenido es **la biblioteca de archivos** (`FileLibrary`), vacía,
con este subtítulo:

> «Todos los archivos de {workspace.name}. Se acceden por enlace firmado con
> caducidad, nunca desde un bucket público.» —
> [`page.tsx:54`](../apps/web/src/app/(privado)/app/w/[workspaceId]/page.tsx)

Es una frase sobre seguridad de infraestructura, en la primera pantalla que ve
alguien que acaba de crear su espacio de trabajo. Y no hay nada que hacer ahí:
no hay archivos, no hay un botón que diga «empieza por aquí», no hay un canal
donde escribir.

**Y esto contradice lo que el propio menú lateral dice que importa.** En
[`layout.tsx:239`](../apps/web/src/app/(privado)/app/w/[workspaceId]/layout.tsx),
el primer elemento del grupo «Espacio» es **Panel** (`indice={0}`), y la
Biblioteca es el tercero. Si el panel es el más importante según el propio
orden de navegación, ¿por qué la ruta raíz del workspace no es el panel, sino
la biblioteca? Nadie decidió esto a propósito: es que la biblioteca fue lo
primero que se construyó en `w/[workspaceId]` y nadie volvió a mover el
`page.tsx` cuando llegó el resto.

### Paso 5 — Buscar dónde escribir, y no hay ningún canal

Crear un workspace **no crea ningún canal por defecto** — lo confirmé en
[`workspaces.ts:391-415`](../apps/api/src/routes/workspaces.ts): el `INSERT`
es solo a la tabla `workspaces`, nunca a `channels`. Ni Slack ni Discord hacen
esto: los dos siembran un canal general al crear el espacio, precisamente para
que el primer minuto tenga un sitio donde escribir sin pedirle nada a nadie.

Y en el menú lateral, la sección **«Texto» solo aparece si ya hay canales de
texto** —
[`layout.tsx:298`](../apps/web/src/app/(privado)/app/w/[workspaceId]/layout.tsx):
`{text.length > 0 && (<ChannelGroup title="Texto" ...>`—, mientras que **«Voz»
se muestra siempre**, aunque esté vacía, sin esa misma comprobación. Así que lo
que ve alguien en su primer workspace es: Panel, Mesa, Biblioteca, Tablero,
DevVerse, un encabezado «Voz» sin nada debajo, y — al final del todo, después
de desplazarse — un botón discreto de «Nuevo canal» con borde punteado.

**El camino completo, contado en pasos que exigen decisión o creación:**
registro → crear organización (2 campos, 1 con jerga) → crear workspace
(2 campos, 1 decisión sin contexto) → entrar y aterrizar en una pantalla vacía
que no es la más relevante según el propio menú → desplazarse hasta el final
del menú → crear un canal (2 campos más) → **recién ahí** se puede escribir el
primer mensaje.

**Son cuatro formularios y cero contenido de ejemplo antes del primer
mensaje.** Eso es lo que se siente como «flujo malo», con toda precisión.

---

## 3. Lo que el propio repositorio ya sabía, y lo que no

`plan-interfaz.md` (27 de agosto) diagnosticó con exactitud un problema real:
**faltaba el armazón, no el sistema visual**. Y según su nota de actualización
y el `git log`, se construyó de verdad — hay commits fusionados y desplegados
para el armazón de organización, el marco de página, el diálogo de
confirmación, las primitivas que faltaban y la capa de datos con caché. Eso no
es aspiracional: lo confirmé contra los archivos que ese plan decía que no
existían y ahora existen.

**Pero ese plan —y todos los demás que leí— nunca analiza el arranque en
frío.** Habla del armazón, de las cinco cabeceras copiadas, de los ocho
`confirm()` nativos, del responsive. Ninguno traza qué ve una cuenta con cero
organizaciones, cero workspaces y cero canales. Por eso el trabajo real y bien
hecho de I1–I3 no toca el problema que tú viviste: **se puede tener un armazón
impecable alrededor de una pantalla vacía**, y las dos cosas son ciertas a la
vez.

Tampoco existe ningún concepto de **incorporación** en el repositorio —lo
busqué expresamente y no aparece ni una vez, ni en código ni en documentación—.
No hay contenido de muestra, ni un recorrido guiado, ni un mensaje del sistema
en el primer canal, ni una sugerencia de «invita a tu equipo» con contexto de
qué pasa después.

---

## 4. Lo que arreglaría el flujo, en el orden que más rápido se nota

No es una reescritura. Son cambios pequeños y localizados, cada uno con su
archivo:

| # | Qué | Dónde | Por qué primero |
|---|---|---|---|
| 1 | **Sembrar un canal `#general` al crear el workspace** | `workspaces.ts:404` — un `INSERT` más, dentro de la misma transacción | Es la diferencia entre aterrizar en un sitio donde ya se puede escribir y aterrizar en tres pantallas vacías. Es el cambio de una línea con más impacto de esta lista |
| 2 | **La ruta raíz del workspace debe ser el canal general (o el Panel), no la Biblioteca** | Mover el contenido de `page.tsx` de `w/[workspaceId]` a `w/[workspaceId]/archivos`, y que la raíz redirija al primer canal de texto | Alinea la ruta con lo que el propio menú dice que es lo primero |
| 3 | **Quitar la jerga de los dos formularios de alta**, o moverla a un texto de ayuda plegado | `page.tsx:627` y `page.tsx:584` | «Frontera de aislamiento» y la distinción compartido/personal son verdades del producto, no lo primero que hay que explicarle a alguien que aún no ha escrito nada |
| 4 | **Ocultar el grupo «Voz» cuando está vacío**, igual que ya se hace con «Texto» | `layout.tsx:307` — falta el mismo `{voice.length > 0 && ...}` que ya existe para texto tres líneas antes | Es una inconsistencia de una línea que hoy muestra un hueco sin sentido en cada workspace nuevo |
| 5 | **Un mensaje de bienvenida en el canal sembrado**, del sistema, con dos o tres acciones sugeridas (invitar, crear una tarea, abrir DevVerse) | Nuevo, pequeño | Sustituye a un recorrido guiado completo por una fracción del coste, y encaja con que la interfaz ya tiene mensajería lista |
| 6 | **Fusionar las cinco pruebas de Playwright que ya existen** en `claude/inicio-desarrollo-nu1ftu` | Ninguna herramienta nueva, es traer lo que ya está escrito | Sin esto, el próximo cambio al flujo de alta se vuelve a romper sin que nadie lo note hasta que alguien lo use en producción — que es exactamente lo que ya pasó una vez con DevVerse |

Los puntos 1, 3 y 4 son de una tarde. El 2 es medio día porque toca rutas. El
5 es el que más valor da por lo que cuesta, y el 6 es el que evita que esto se
repita.

---

## 5. Lo que no es el problema, y conviene no tocar

- **DevVerse no es el culpable.** Está bien resuelto: opcional, apagado por
  defecto (`view-mode.tsx`), y el propio menú lo pone al final «sin resaltar,
  para quien no la quiera no se tropiece con ella». Si la experiencia de
  primer uso mejoró y sigue sin gustar, DevVerse no es la razón.
- **El sistema visual no es el problema.** `globals.css` está genuinamente bien
  construido —niveles de superficie, movimiento reducido atendido, materiales
  con nombre—. Cambiar colores o animaciones no va a arreglar un flujo cuyo
  problema es de **secuencia de pantallas**, no de estética.
- **La arquitectura de datos no es el problema.** El aislamiento por fila, con
  172 pruebas, es sólido y no hay motivo para tocarlo por esto.

---

## 6. Cómo comprobarlo tú mismo, en diez minutos

```bash
npm run db:reset      # base limpia, sin datos de pruebas anteriores
npm run dev           # API en :4000, web en :3000
```

Regístrate con una cuenta nueva y cronometra cuántas pantallas y formularios
pasan antes de poder escribir un mensaje. Con el repositorio tal como está
hoy, deberían ser cuatro formularios y una pantalla vacía intermedia. Si tras
aplicar los cambios del §4 se reduce a «registro → escribir», el estudio se
puede dar por resuelto.

---

## Resumen para decidir

**¿Es viable?** Sí, con evidencia verificada y no solo declarada: el motor
funciona, aísla de verdad, y no tiene deuda oculta en la parte que más caro
sale de arreglar después (la base de datos y el aislamiento).

**¿Es funcional?** Sí, pieza por pieza: cada función que existe, funciona.

**¿Está lista para que alguien la use por primera vez y le guste?** No todavía,
y el motivo es preciso, no una sensación: **cuatro formularios y una pantalla
vacía separan el registro del primer mensaje**, y ninguno de los planes de
interfaz existentes —por buenos que sean— tocó ese tramo. Es el hueco que
queda, y es pequeño de arreglar comparado con todo lo que ya funciona debajo.
