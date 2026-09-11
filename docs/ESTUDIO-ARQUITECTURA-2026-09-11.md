# Estudio de arquitectura · 11 de septiembre de 2026

Contrasta `DevUP-Propuesta-de-Arquitectura.pdf` **contra el código**, y añade lo
que esa propuesta no prioriza: la interfaz.

Este documento **sustituye a `PROPUESTAS-CONTEXTO-Y-FUNCIONES.md`**, que se
retira. Aquel proponía por su cuenta un «asunto» que ata tarea, PR, mensaje y
despliegue, y una puerta MCP: la propuesta de arquitectura llega a lo mismo con
mejor modelo —nodo y enlace con procedencia— y además lo ordena. Tener los dos
documentos vivos sería repetir la enfermedad que la consolidación de veintiocho
a dos vino a curar.

---

## 1. Verificación: las cifras del PDF son ciertas

Toda propuesta que descansa en números merece que alguien los recuente. Lo hice
contra las migraciones y el código, no contra la documentación.

| Afirmación del PDF | Comprobado | Resultado |
|---|---|---|
| 27 migraciones | `ls db/migrations/*.sql` | **Exacto** |
| 46 tablas de dominio | `create table` únicos | **Exacto** |
| Cuatro disparadores en total | `create trigger` | **Exacto** |
| Cero llamadas a un modelo en el repositorio | búsqueda de `anthropic`, `openai`, `gpt`, `completions` en `apps/*/src` | **Exacto. Ni una** |
| Cuatro tipos de notificación emitidos de cinco declarados | `notifications.kind` permite `mention, task_assigned, invitation, recording, announcement`; se emiten cuatro | **Exacto — `recording` está declarado y nunca se emite** |
| Cero columnas relacionales en tareas fuera de tareas | `tasks` solo referencia `task_columns`; `task_tags` solo a `tags` | **Exacto** |
| Un despliegue no sabe de qué commit salió | `deployments` solo referencia `environments`. No hay ni una clave hacia `github_repos` | **Exacto, y es el hallazgo más elocuente** |

### La única discrepancia: no son seis cruces, son once

El PDF dice «seis claves foráneas que cruzan dominios». Contando las 93
referencias del esquema y separando las verticales de las que unen dominios
distintos, salen **once**:

`files→channels` · `messages→files` · `call_sessions→channels` ·
`call_recordings→files` · `world_zones→channels` · `github_repos→connections` ·
`environments→connections` · `channel_listening_sessions→channels` ·
`channel_queue_tracks→channels` · y las dos de taxonomía (`file_tags→tags`,
`task_tags→tags`).

**La diferencia no debilita el diagnóstico, lo agrava.** Porque el dato que
importa no es el número de cruces, sino su reparto:

- **63 de 93 referencias (68 %) son verticales**: apuntan a `users`,
  `organizations` o `workspaces`. Son contenedor e identidad, no relación.
- De las 30 restantes, **19 son intra-dominio** (`opportunity_items→opportunities`,
  `github_repo_stats→github_repos`, `deployments→environments`…).
- Quedan **once cruces reales, y siete de ellos van al mismo sitio**: canales o
  archivos. Canales y archivos son el único tejido conectivo que existe.

Dicho de otro modo: **Ventas, GitHub, Infraestructura y Tareas no tienen ni una
sola clave foránea hacia ningún otro dominio.** Ni una. Son cuatro islas
completas, y son exactamente las cuatro pantallas que el uso real señaló como
flojas o rotas.

Esa es la prueba dura de la frase del PDF —«lo que funciona es lo que no
necesita hablar con nada más»— y creo que es el párrafo más importante de todo
el diagnóstico.

---

## 2. La columna vertebral: de acuerdo, con tres reservas

Nodo + enlace es la decisión correcta, por tres motivos que conviene dejar
escritos: no duplica el dato (el nodo da dirección, no copia), el tipo de
relación va en el enlace (que es donde está la lectura), y la procedencia
—humano, regla, agente— es lo que hace que enlazar solo sea aceptable en vez de
temerario. Esa última idea es la mejor del documento.

Tres cosas que yo cerraría **antes** de crear las tablas, no después.

### 2.1 · Actividad y enlaces se solapan, y van a divergir

El PDF propone dos tablas nuevas: el registro de actividad (§6) y los enlaces
(§4). Pero **un evento es una relación**: «Ana movió la tarea T a Hecho el
martes» es a la vez una entrada de actividad y un enlace entre una persona y
una tarea. Sin una frontera escrita, el mismo hecho acaba en los dos sitios y
dentro de tres meses no coinciden.

**La frontera que propongo, en una línea:** la actividad es la fuente, de solo
añadir y nunca editar; los enlaces son un índice derivado. Las reglas leen
actividad y escriben enlaces. **Nunca al revés.** Eso hace que el grafo se
pueda reconstruir entero desde cero si una regla estaba mal — que es justo lo
que el propio PDF promete en su tabla de procedencia («se corrige y se
recalcula») y que no se puede cumplir si los enlaces también son fuente.

### 2.2 · El aislamiento de un enlace no es el de una fila normal

Este es el riesgo grande, y el PDF lo nombra (§23) pero lo trata como «poner la
política en el mismo commit». Es más difícil que eso.

Una fila normal se protege preguntando si el que mira pertenece a la
organización. **Un enlace no**: un enlace toca dos nodos, y quien puede ver uno
puede no poder ver el otro. Un enlace entre un mensaje de un canal privado y
una oportunidad de ventas lo vería cualquiera con acceso a ventas — y con él,
**la existencia del canal privado**.

Eso no es hipotético: es la misma clase de fuga que el producto ya se cuidó de
evitar en las menciones, donde está escrito que notificar a quien no está en el
canal «revelaría que ese canal existe, que es media filtración».

**Lo que hace falta:** que la política de `enlaces` compruebe la visibilidad de
**los dos extremos**, no la organización. Eso pide una función que despache por
tipo de nodo —`puede_ver_nodo(tipo, id)`— y es trabajo real, no una línea.
Merece decisión propia en `decisiones/`, al lado de las otras.

### 2.3 · El título dentro del nodo se queda viejo

§4 dice que el nodo guarda «tipo, id de origen, título, organización». Guardar
el título significa que renombrar una tarea deja el nodo mintiendo. O se acepta
y se refresca desde la actividad, o no se guarda y se une por consulta. Es
pequeño, pero es de los que se deciden ahora o se arrastran.

---

## 3. Lo que el PDF no prioriza: la interfaz

Aquí está el hueco que motivó este encargo. El plan de seis bloques es un plan
**de arquitectura**: su bloque 1 —reordenar la barra en tres niveles y arreglar
la vuelta de Noticias— es lo único de interfaz, y es correcto pero corto.

Y hay un problema de secuencia: **todo lo que de verdad se siente roto hoy no
necesita el grafo.** Si el grafo tarda semanas, el producto se sigue sintiendo
igual de superficial durante esas semanas, aunque por dentro esté mejorando.

### Cómo priorizar interfaz, ya que no había criterio

Una fórmula, para que la discusión deje de ser de gustos:

> **(cuántas veces al día se toca × cuánto cuesta la fricción) ÷ cuánto cuesta arreglarlo**

Aplicada a lo que el uso real del 9 de septiembre encontró:

| Arreglo | Se toca | Fricción hoy | Coste | Prioridad |
|---|---|---|---|---|
| **Tablero: hacer visible lo que ya existe** | A diario | Alta — se cree que falta una función que está construida | Horas | **1** |
| **Desatascar GitHub** | A diario | Máxima — tumba cuatro pantallas | Días | **2** |
| **Presencia → notificaciones** | Continuo | Media — el tercer estado no gobierna nada | Horas | **3** |
| **Perfil de usuario** | Una vez, pero al principio | Alta — es lo primero que se busca y no existe | Días | **4** |
| **La vuelta de Noticias** | Ocasional | Alta cuando pasa — te saca del espacio | Días | **5** |
| Jerarquía de tres niveles | Continuo | Media | Días | 6 |

### El tablero es el caso que mejor explica el problema

Verificado en `TaskBoard.tsx`: **la asignación y el arrastre entre columnas
están escritos y desplegados.** Hay `draggable` en cada tarjeta, persistencia de
la posición al soltar, un desplegable de «Responsable» y el nombre e iniciales
de quien la tiene.

La evaluación de uso dijo que el tablero «solo agrega tareas» y que falta
asignar. **Las dos funciones existen y nadie las encontró.** Eso es peor que si
faltaran: cuestan mantenimiento y no le sirven a nadie.

Las causas son de descubribilidad pura: asignar vive dentro de un diálogo al que
solo se llega haciendo clic en una tarjeta que no parece clicable, y arrastrar
no tiene ni cursor `grab` ni agarradera. Arreglarlo son horas y **recupera dos
funciones ya pagadas**. No hay nada con mejor retorno en todo el proyecto.

### Bloque 0

Lo anterior forma un bloque que **va antes del bloque 1 del PDF**, no compite
con él: no toca la base de datos, no espera al grafo, y se despliega en días.
Su tesis: *antes de construir lo que falta, hacer visible lo que ya está*.

Si además hay presión comercial sobre las cuatro pantallas que se venden —el
bloque 6 del PDF— desatascar GitHub pertenece a este bloque 0 por derecho
propio: no las termina, pero las enciende.

---

## 4. Sobre el orden del PDF, estoy de acuerdo salvo en un punto

El argumento de §22 para dejar los instrumentos al final —«terminarlos antes del
grafo significa escribirlos dos veces, porque lo que los vuelve valiosos es
estar conectados»— es correcto y es el tipo de razonamiento que evita trabajo
tirado.

**La excepción es GitHub, y no por lo comercial.** GitHub no es una pantalla
más: es la **fuente principal del grafo determinista** del bloque 3. Las reglas
que el PDF propone —commit a tarea por el número, despliegue a commit— leen de
GitHub. Con el conector atascado, el bloque 3 no tiene de dónde tejer.

Así que GitHub no es parte del bloque 6: **es requisito del bloque 3**, y por
eso sube al principio.

---

## 5. Las decisiones, con mi recomendación

El PDF deja cuatro (§24). Las contesto porque para eso las dejó abiertas.

| Decisión | Mi recomendación |
|---|---|
| **Orden del bloque 6** | Mantenerlo al final **excepto GitHub**, que sube por ser fuente del grafo. El resto se escribiría dos veces |
| **Qué es un «responsable de área»** | Un rol por área con una persona que responde. Hace falta sí o sí antes del nivel «actúa fuera», y no antes |
| **Entorno de desarrollo fuera del navegador** | No, todavía. Es la única pieza que cuesta servidor, y choca con «nada de servicios de pago». Termínese dentro del navegador y revísese cuando haya ingresos |
| **Qué se promete al cliente** | No es técnica, pero el dato técnico que la informa es este: con el bloque 0, tres de las cuatro pantallas vendidas pasan de «no funciona» a «funciona a medias» en días, porque su problema no era propio sino del conector |

Y añado una quinta que el PDF no lista y que el §2.2 obliga a tomar: **cómo se
aísla un enlace cuyos dos extremos tienen visibilidad distinta.** Es la
condición para que el grafo no sea una fuga.

---

## 6. En una frase

El diagnóstico del PDF es correcto y sus números son ciertos —lo recontré—; la
columna vertebral es la decisión adecuada y la procedencia es lo que la hace
segura. Lo que le falta es **un bloque 0 de interfaz que no depende de nada**,
y cerrar el aislamiento de los enlaces antes de crear la tabla, no después.
