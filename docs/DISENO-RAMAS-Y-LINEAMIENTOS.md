# Ramas de trabajo: el flujo entero, y lineamientos en vez de subcategorías

_19 de septiembre de 2026. Análisis del flujo de las categorías, leído en el
código (no ejecutado), y una propuesta para lo que se pidió: poder crear,
borrar y organizar ramas, y dar a cada una requisitos o lineamientos que se
sigan al hacer sus tareas._

---

## 1. Qué hay hoy

### Dos ejes, que no son lo mismo

| | **Rama** (la pantalla la llama «Categorías») | **Etiqueta** |
|---|---|---|
| Tabla | `task_categories` (0044) | `tags` (0002) |
| Alcance | un espacio | toda la organización |
| Por tarea | **una sola** | varias |
| Responde de ella | **gerentes**, varios (`task_category_owners`, 0050) | nadie |
| Para qué | «de quién es este frente y cómo va» | cruzar: «todo lo de FESTECH» |

La 0050 dejó escrito qué es una rama: una tarea vive en **una sola**; quien la
lleva es su **gerente**, que **reparte y no carga** con las tareas; y **archivar
en una rama no asigna a nadie**: lo que no tiene responsable aparece en «por
repartir».

### Qué se puede hacer, y desde dónde

| Gesto | Base | API | Pantalla | MCP (agente) |
|---|---|---|---|---|
| Crear rama | ✓ | ✓ | ✓ | ✓ `crear_area` |
| Renombrar, cambiar color | ✓ | ✓ | renombrar ✓, color ✗ | ✗ |
| Borrar rama | ✓ (las tareas quedan sin rama) | ✓ | ✓ con confirmación | ✗ |
| Poner y quitar gerentes | ✓ | ✓ | ✓ | ✗ |
| Ordenar ramas | columna `position` | ✗ | ✗ | ✗ |
| Archivar una tarea en una rama | ✓ | ✓ | ✓ ficha de tarea | ✓ `area` en `crear_tarea` |
| Filtrar el tablero por rama | | | ✓ «Área» | |
| Borrar o fusionar etiquetas | ✓ | borrar ✓, fusionar ✗ | | ✗ |

**Crear y borrar ramas ya existe.** Lo que falta está en los bordes, y en cuatro
fallos que salieron al recorrerlo.

## 2. Cuatro fallos del flujo

### 2.1 · Archivar en una rama todavía asigna, pero solo en las ramas viejas — **grave**

`crearTareaEnDb` (`apps/api/src/routes/tasks.ts`) todavía hace esto: si la tarea
entra en una rama y nadie dijo a quién va, se la asigna al `owner_id` de la
rama. La 0050 marcó esa columna como obsoleta («ya no se usa para asignar, no
escribir aquí») y **nadie la escribe desde entonces**.

El resultado es que el comportamiento depende de la edad de la rama:

- las creadas **antes** de la 0050 conservan su `owner_id` y **siguen asignando
  solas**;
- las creadas **después** no asignan nunca.

Si «DevVerse» tenía a Carlos como dueño, **las tareas nuevas de esa rama se le
asignan a alguien que ya no está en el equipo**. No se pudo comprobar en la base
de producción desde aquí; está verificado en el código.

**Arreglo:** quitar la herencia de `crearTareaEnDb`, que es lo que la 0050
decidió. Y limpiar `owner_id` en una migración, para que nada lo pueda volver a
leer.

### 2.2 · El agente recibe instrucciones que ya no son verdad

Las descripciones de `crear_area` y del campo `area` de `crear_tarea`, que son
la documentación que el modelo lee para decidir, dicen: «las tareas que se
archiven en un área **se asignan solas** a quien la lleva». Eso contradice la
0050. Un agente que se fíe creará tareas creyendo que alguien las recibe y se
quedarán sin responsable.

Además, el campo `categorias` de `crear_tarea` crea **etiquetas** pero se
describe como «de qué **áreas** es». Dos palabras para dos cosas distintas en la
misma herramienta. Y crea etiquetas nuevas por nombre sin mirar si ya hay una
parecida: es exactamente el mecanismo de la docena de etiquetas casi iguales que
reportó GESTEK (TAB-01/02, ya en el tablero).

### 2.3 · Borrar una rama sin permiso parece que funciona

`DELETE /categories/:id` devuelve `204` aunque la política no deje borrar. Borra
cero filas en silencio y no mira el recuento. El botón de la papelera se enseña a
todo el mundo, así que un miembro raso lo pulsa, confirma el aviso, la pantalla
se refresca y **la rama vuelve a aparecer sin ninguna explicación**. Renombrar sí
comprueba el resultado; borrar no.

### 2.4 · Dos ramas que se llaman casi igual

La unicidad es `(workspace_id, name)` exacta: «Frontend», «frontend» y
«Frontend » (con espacio) son tres ramas distintas. Ni la pantalla ni el MCP
avisan. Con ramas pesa más que con etiquetas, porque una tarea solo puede estar
en una: las tareas de «Frontend» quedan partidas entre dos ramas y la cuenta de
cada una miente.

## 3. Subcategorías o lineamientos

### Por qué no subcategorías

GESTEK pidió «área → subárea» (TAB-01). Pesa en contra lo que ya vimos:

- **Multiplica el problema que ya tenemos.** Si hoy cuesta no duplicar ramas en
  un nivel, dos niveles lo duplican por dos, y ninguna validación lo evita del
  todo.
- **Rompe lo que hace útil una rama.** «Una tarea vive en una sola» es lo que
  hace que «cómo va frontend» sume bien. Con subáreas hay que decidir si una
  tarea de «Frontend › Formularios» cuenta en las dos, quién es su gerente y qué
  enseña el filtro. Cada respuesta es una regla más que la pantalla tiene que
  explicar.
- **El segundo eje ya existe.** Lo que una subcategoría resuelve —agrupar dentro
  de un frente— ya lo hacen las etiquetas, que se cruzan libremente sin tocar a
  quién pertenece la tarea.

### Por qué lineamientos

Lo que se pidió es otra cosa, y más valiosa: que cada rama diga **cómo se trabaja
en ella**. Por ejemplo, en «Infraestructura»: «toda migración es aditiva», «se
prueba con `test:rls`», «las variables nuevas van en `.env.example`».

Encaja con la tesis del producto. Un **lineamiento es contexto que no se pierde**:
la persona lo ve al abrir la tarea, y **el agente lo lee antes de empezar**, sin
que nadie se lo tenga que repetir. Es la regla de la rama escrita una vez, en vez
de copiada a mano en el criterio de cada tarea.

## 4. La propuesta

### Fase 1 · arreglar lo que miente (sin decisión pendiente)

1. **Quitar la herencia de `owner_id`** al crear tareas. Migración que lo deja a
   `null` y, si nada lo lee, la columna fuera.
2. **Corregir las descripciones del MCP**: archivar no asigna; y el campo de
   etiquetas se llama y se describe como etiquetas.
3. **`DELETE /categories/:id` dice que no** cuando no borra (`403`). El botón de
   borrar y el de nuevo gerente solo se enseñan a quien puede gestionar el
   espacio.
4. **Nombres de rama sin duplicados de caja ni de espacios**: unicidad sobre
   `lower(btrim(name))`, y aviso al crear si ya hay una parecida.
5. **Quitar a Carlos como gerente** de las ramas donde esté. Va en la tarea de
   retirarlo.

### Fase 2 · lineamientos por rama

**Qué son.** Una lista corta y ordenada de requisitos de la rama. Cada uno es una
frase y puede marcarse como **obligatorio**. Los escriben los gerentes y quien
gestiona el espacio.

**Dónde viven.** Una tabla nueva, `task_category_guidelines` (rama, texto,
obligatorio, posición, quién y cuándo), con su política RLS y su caso en
`isolation.test.ts`. En tabla y no en un campo de texto, para poder ordenarlos,
marcar cuáles son obligatorios y, más adelante, comprobarlos uno a uno.

**Dónde se ven:**

- En la pantalla de ramas, para escribirlos.
- En la ficha de la tarea, junto al criterio: «Lineamientos de la rama
  Infraestructura».
- En el MCP: `ver_tarea` y `contexto_de_tarea` los devuelven con la tarea. Y al
  crear una tarea en una rama, la respuesta se los recuerda al agente. Van
  marcados como dato, igual que el resto del texto (SEG-07).

**Lo que no se hace en esta fase:** marcar cada lineamiento como cumplido por
tarea, ni bloquear el cierre si falta uno. Eso es la fase 3, y conviene ver
primero si los lineamientos se usan de verdad.

### Fase 3 · comprobarlos al cerrar (a decidir con el uso)

Al mover una tarea a una columna terminal, enseñar los lineamientos obligatorios
de su rama como lista de comprobación. Guardar cuáles se marcaron como evidencia
de la tarea (ya existe `task_evidence`). Primero avisar; bloquear solo si el
equipo lo pide.

### MCP, además

`crear_area` ya existe. Faltan `renombrar_area`, `borrar_area` (nivel N2, como
crear) y `lineamientos_de_area`. Todas pasan por la decisión de niveles del
agente.

## 5. Qué hace falta decidir

1. **Lineamientos en vez de subcategorías**, como propone este documento. Si se
   quiere un segundo nivel de verdad, que sean las etiquetas.
2. **Si un lineamiento obligatorio llega a bloquear el cierre** de una tarea
   algún día, o solo avisa. No hace falta para la fase 2.
