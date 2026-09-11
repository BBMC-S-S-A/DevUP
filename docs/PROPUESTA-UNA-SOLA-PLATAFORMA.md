# Propuesta · Que esto sea una sola plataforma

11 de septiembre de 2026.

El encargo, en tus palabras: *«hemos ido implementando funciones, pero no hemos
tratado de unirlas, de conjugarlas, de que se sienta como una sola página»*. Y
después: ir función por función, dejando cada una **bien terminada**, para que se
sienta premium.

Esto propone **qué es esa unión**, en qué orden se hace, y qué significa
«terminada» para que no se discuta cada vez.

Complementa [PROPUESTA-UNA-SOLA-VENTANA.md](PROPUESTA-UNA-SOLA-VENTANA.md), que
es la parte visual. Aquí está la otra mitad, que es la que de verdad falta.

---

## 1. El ejemplo que lo explica todo: una tarea no puede estar hecha

Dijiste que marcaste una tarea como hecha y siguió sin marcarse. Fui a mirarlo.
**No es un fallo. Es que «hecha» no existe.**

En la migración 0004:

```sql
create table public.tasks (
  column_id  uuid not null references public.task_columns(id),
  ...
);

create table public.task_columns (
  name      text not null,    -- y ya está
  position  double precision not null
);
```

Una tarea tiene **columna**, y una columna tiene **nombre**. Nada más. No hay un
estado terminal, ni una marca de completada, ni un tipo de columna. «Hecho» es
una palabra que alguien escribió una vez.

### Lo que eso rompe, comprobado

- **`mis_tareas` del MCP te devuelve también las hechas.** Filtra por
  `assigneeId` y reporta `columna: c.name` — un texto. Cuando le preguntas a tu
  Claude «¿qué tengo pendiente?», te lista lo terminado igual.
- **Nada puede contar bien.** El panel no puede decir «te quedan 3» sin adivinar
  qué columna significa terminar.
- **El grafo no podrá cerrar nada.** «Este commit cierra esta tarea» necesita que
  cerrar exista. Hoy no existe.
- **No se puede notificar.** «Tu tarea se completó» no se puede emitir.

**Un campo que falta rompe cuatro funciones distintas.** Y ninguna de las cuatro
parece rota por su lado: el tablero funciona, el MCP responde, el panel pinta.

> **Esa es exactamente la enfermedad.** No es que las funciones estén a medias:
> es que **no comparten vocabulario**, así que no pueden hablar entre ellas. Y
> cuando las piezas no se hablan, el producto se siente como piezas.

---

## 2. Qué es «una sola plataforma», en concreto

Tres uniones. En este orden, porque cada una necesita la anterior.

### Unión 1 · Un solo marco — lo que se ve

Es la propuesta de la otra página: quitar dos armazones de tres, ancho completo
por defecto, buscar en todas las organizaciones desde ⌘K.

Va primera porque es **lo que se nota el primer minuto**, porque es sobre todo
borrar, y porque sin ella cualquier función nueva nace dentro de una ventana
dentro de otra.

### Unión 2 · Un solo vocabulario — lo que hace que se hablen

Lo que el §1 demuestra que falta. Tres piezas pequeñas y una grande:

- **Estado terminal en las columnas.** Una columna dice si terminar ahí cuenta
  como terminar. Es una columna nueva en una tabla, y arregla las cuatro cosas de
  arriba a la vez.
- **Los eventos, en una tabla.** Que las cosas que pasan queden escritas: una
  tarea movida, un push, un despliegue, un mensaje. Hoy solo queda el estado
  final, así que nadie puede preguntar «¿qué ha pasado desde ayer?».
- **Los enlaces**, con su procedencia —humano, regla, agente—: esta tarea con
  este commit, este despliegue con esta migración. Es el grafo, y su aislamiento
  hay que cerrarlo antes de crear la tabla.
- **Y la regla que los ordena:** los eventos son la fuente y solo se añaden; los
  enlaces son un índice que se recalcula desde ellos. Nunca al revés. Eso permite
  rehacer el grafo entero si una regla estaba mal.

**Sin esta unión, DevUP es una carpeta de herramientas que comparten barra
lateral.** Con ella, es un producto.

### Unión 3 · Un solo contexto — lo que hace posible «la locura»

Tu idea: varias personas desarrollando a la vez, cada una con su IA, **con el
contexto de las demás**. Estoy de acuerdo en que es lo más valioso de todo esto
y en que nadie lo tiene.

Y quiero ser concreto con lo que preguntaste —*skills del MCP, o que el agente de
cada persona esté cada cierto tiempo enviando cosas a DevUP*—, porque de las dos
opciones **la segunda es la trampa**:

> Un agente mandando su contexto cada pocos minutos es ruido caro y desordenado:
> escribe mucho, lo lee poco alguien, y el volumen crece sin que la utilidad
> crezca con él. Además hace falta decidir qué se manda, y ahí es donde se
> filtran cosas que nadie quería compartir.

**Lo que propongo en su lugar, y es más barato y más potente:**

1. **Los eventos ya son el contexto.** Con la unión 2, DevUP ya sabe qué ha
   pasado, porque lo escribe cuando pasa — no porque alguien lo cuente. No hace
   falta que los agentes emitan nada: hace falta **una herramienta que pregunte**.
   Una sola: *«¿qué ha pasado en este espacio desde tal momento?»*. Eso es
   contexto compartido de verdad, con cero tráfico de fondo.
2. **Skills de la casa, servidas por el MCP.** Esto sí, y es de lo más barato que
   hay: son texto. Las convenciones del equipo —cómo se escribe un commit, qué
   pide una migración, qué no se toca— servidas a **todos** los Claude del
   equipo. Hoy cada persona se las explica a la suya, y cada una entiende algo
   distinto. Servirlas desde DevUP es que el equipo entero trabaje igual sin que
   nadie lo repita.
3. **Marcar lo que hace un agente.** Ya se hace en el tablero y hay que
   mantenerlo en todo: es lo que permite revisar y deshacer, y es la diferencia
   entre confiar en esto y no dejarlo entrar.

Con esas tres, «desarrollar en grupo con el contexto de los demás» deja de ser
una integración complicada y pasa a ser la consecuencia de haber escrito los
eventos.

---

## 3. DevVerse y las organizaciones públicas

Lo pones como el *plus*, y creo que es el sitio correcto: llamadas, trabajo en
grupo, agenda, y entrevistas para entrar a una organización — con organizaciones
públicas y privadas, y las públicas pidiendo entrevista.

**Es una buena idea de producto y es la única parte que no tiene competencia
obvia.** Pero va después de las tres uniones, por un motivo concreto:

> Una entrevista para entrar es un **flujo de solicitud y aprobación**: alguien
> pide, alguien agenda, alguien decide, y queda registrado. Eso es exactamente
> eventos y estados — la unión 2. Construirlo antes significa inventar un
> segundo sistema de estados al lado del de tareas, que es cómo se llegó aquí.

Con la unión 2 hecha, una solicitud de ingreso es una entidad más con su estado y
sus eventos, y la agenda cuelga de lo mismo. Sin ella, es otra isla.

Y una cosa que sí conviene decidir pronto porque cambia el modelo de datos:
**«organización pública» es una palabra con dos significados muy distintos** —que
cualquiera pueda *ver* que existe, o que cualquiera pueda *pedir* entrar. Son dos
banderas, no una, y confundirlas se paga en aislamiento.

---

## 4. Qué significa «terminada», para que sea premium

Pediste ir función por función dejándolas bien. Para eso hace falta que
«terminada» no se decida cada vez. Propongo esta lista, y que nada se dé por
hecho sin ella:

1. **Se descubre sola.** Si hay que enseñarla, no está terminada. El tablero
   tenía asignar y arrastrar desde hacía meses y nadie lo encontró.
2. **Se puede deshacer, o avisa antes.** Nada destructivo silencioso.
3. **Falla en voz alta.** Cero `catch {}`. Hoy hay 44.
4. **Tiene estado vacío honesto.** «Conecta un repositorio para ver esto» no es
   una pantalla rota; una en blanco sí.
5. **Habla el vocabulario común.** Si inventa un estado propio que nadie más
   entiende, es una isla nueva.
6. **Se puede usar desde el MCP**, si tiene sentido fuera de la pantalla.
7. **Aprovecha el ancho.** No es decoración: el tablero y el embudo son
   inservibles en un tubo de 896 píxeles.

**Sugerencia concreta:** que esta lista viva en el repositorio y que un cambio
que añade función diga cuáles cumple. No es burocracia — es lo que impide que se
vuelvan a acumular veinte funciones a medias.

---

## 5. El orden

| | Qué | Por qué ahí |
|---|---|---|
| **0** | La semana del cliente, con lo que hay | Fecha comprometida. Nada de esto entra |
| **1** | **Un solo marco** (la otra propuesta) | Lo que se nota el primer minuto, y es borrar |
| **2** | **Estado terminal en las columnas** | Un campo. Arregla cuatro funciones. **El mejor retorno del proyecto** |
| **3** | **Los eventos** | Es el contexto compartido, y es requisito de todo lo demás |
| **4** | **Alojar el repositorio** | El push se convierte en evento; la auditoría deja de ver una muestra |
| **5** | **Enlaces y grafo**, con su aislamiento cerrado antes | Aquí ya hay de qué tejer |
| **6** | **Skills de la casa y «qué ha pasado»** por MCP | Sobre el 3. Es texto y una herramienta |
| **7** | **DevVerse: agenda, solicitudes, entrevistas** | El plus, sobre vocabulario común |
| **8** | Orquestar Railway, Vercel y compañía | El producto del que hablamos ayer |

El **2** es el que yo haría primero después del marco. Es una columna en una
tabla, y hace que el tablero, el panel, el MCP y las notificaciones digan por fin
lo mismo. **No hay nada en todo el proyecto con esa relación entre coste y
efecto.**

---

## 6. En una frase

Las funciones no están a medias: **están solas**. Una tarea no puede estar hecha,
un despliegue no sabe de qué commit salió, y una arquitectura no puede apuntar a
un canal — y por eso esto se siente como muchas ventanas en vez de un producto,
aunque cada ventana funcione. Unirlo no es rediseñar: es **darles un vocabulario
común y escribir lo que pasa**. Y cuando lo que pasa está escrito, lo que querías
al final —gente desarrollando a la vez con el contexto de los demás— deja de ser
una función que hay que construir y pasa a ser algo que ya se puede preguntar.
