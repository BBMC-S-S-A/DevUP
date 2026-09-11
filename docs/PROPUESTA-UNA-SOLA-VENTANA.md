# Propuesta · Una sola ventana

11 de septiembre de 2026. Sobre la organización de la interfaz: qué está mal,
qué haría, y en qué orden.

Nace de usar la aplicación, no de leerla. Las quejas eran tres: *ventana sobre
ventana sobre ventana*, *no se usa la pantalla*, y *la búsqueda no cruza las
organizaciones*. Las tres son ciertas y las tres tienen la misma causa.

---

## 0. Lo primero: la identidad no es el problema. No la toquemos otra vez

Antes de proponer nada fui a comprobar si los colores estaban descuadrados. **No
lo están, y está demostrado por escrito en el propio código.** `landing.css` lo
dice en su cabecera:

> `#000B21` para el cuerpo de la D —29.859 píxeles, el dominante con
> diferencia— y `#0400AA` para el arco superior, un azul casi puro.
> **Y EL AZUL Y EL MORADO SON EL MISMO COLOR.** `#0400AA` es `hsl(242, 100%, 33%)`.

El acento del producto y el azul del logo son el mismo tono con dos decimales de
diferencia. La landing y la aplicación comparten los mismos tokens: no hay dos
marcas conviviendo.

**Esto importa porque la exploración de color ya se hizo dos veces**, y volver a
abrirla ahora gastaría la semana en lo único que ya está resuelto. La sensación
de que «no hay identidad» es real, pero no viene del color: **viene de que la
misma pantalla se dibuja tres veces distintas según por dónde entres.**

---

## 1. El diagnóstico: hay tres aplicaciones, no una

Contado en el código. Hay **tres armazones** bajo `(privado)`:

| Armazón | Ruta | Qué pinta |
|---|---|---|
| Centro de mando | `/app` | Sin barra lateral. Una lista de organizaciones |
| Organización | `/app/o/[orgId]/…` | Barra lateral de organización |
| Workspace | `/app/w/[workspaceId]/…` | Barra lateral de espacio de trabajo |

Cada uno **repinta la pantalla entera**. Ir de un canal a Ventas no es cambiar de
panel: es cambiar de aplicación. Eso es exactamente la «ventana sobre ventana», y
no es una impresión: son tres `layout.tsx` distintos.

### Y el Centro de mando no es un sitio donde se trabaja

Son **798 líneas** para dibujar, por cada organización, los mismos seis botones:
Buscar, Ventas, GitHub, Entorno de dev, Noticias, Ajustes. Con tres
organizaciones eso son **dieciocho botones con seis nombres distintos**, uno
debajo de otro.

No es un centro de mando: es un **menú de menús**. Lo primero que ve alguien al
entrar es una lista de sitios a los que ir, en vez de su trabajo. Y el nombre
promete lo contrario de lo que hace.

### La pantalla no se usa, y es un número

Todas las pantallas reales se pintan con `ancho="lg"`, que es `max-w-4xl`: **896
píxeles**. En un monitor de 1900 eso deja **más de la mitad vacía**.

Y lo peor es dónde muerde: el tablero, el embudo de ventas y la auditoría —las
tres que más agradecerían el ancho— están todas capadas al mismo tubo. Además
`TaskBoard` y la Mesa tienen **cero puntos de ruptura**: no reaccionan al ancho
en absoluto, ni para aprovecharlo ni para encogerse.

### La búsqueda no puede cruzar lo que tú cruzas

El endpoint es `/organizations/:orgId/search`, y la función de base es
`global_search(_organization_id, _query, _limit)`. Está atada a **una**
organización.

La pantalla dice «Todo lo de la organización». Tú tienes **tres**. La única
función que existe para encontrar cualquier cosa no puede cruzar la frontera que
tú cruzas todos los días — y para usarla hay que saber de antemano en cuál de las
tres está lo que buscas, que es justo lo que no sabes cuando buscas.

---

## 2. La propuesta: un solo armazón que nunca se repinta

> **Una ventana. Tres zonas. Navegar cambia el contenido, nunca el marco.**

```
┌────┬──────────────┬────────────────────────────────────────┐
│ █  │  Gestek      │                                        │
│ ○  │              │                                        │
│ ○  │  Panel       │        Contenido, a pantalla completa  │
│    │  Canales     │                                        │
│ ―  │  Tablero     │                                        │
│ +  │  Ventas      │                                        │
│    │  Auditoría   │                                        │
└────┴──────────────┴────────────────────────────────────────┘
  56px     240px                    todo lo demás
```

- **El riel (56 px).** Las organizaciones, siempre visibles. Cambiar de
  organización es un clic que **no repinta el marco**, igual que hoy cambiar de
  canal no repinta la barra.
- **La columna de contexto (240 px).** El espacio de trabajo actual y sus
  herramientas. Plegable, porque el tablero y el entorno de desarrollo quieren la
  pantalla entera.
- **El contenido.** Todo lo que sobra. Sin tubo de 896 píxeles.

### Lo mejor de esto es que es sobre todo borrar

No hay que inventar una arquitectura nueva. Hay que **quitar dos armazones**:

1. **`/app/o/[orgId]/…` ya casi no existe.** Solo le quedan cuatro pantallas
   —Ventas, Noticias, Mi cuenta, Ajustes— y **tres de ellas ya están montadas
   también bajo el workspace, reexportando el mismo componente**. El trabajo ya
   está hecho: falta rematarlo y dejar `/app/o/…` como redirección.
2. **`/app` deja de ser una pantalla de aterrizaje.** Entrar te lleva a donde
   estabas, no a un directorio. La lista de organizaciones vive en el riel, que
   es donde una lista de contextos tiene sentido; crear workspace e invitar se
   van a Ajustes, que es donde se buscan.

Con esas dos, **quedan un armazón y una sola ventana.** Es la pieza estructural
de mayor retorno del proyecto, y es en su mayor parte supresión de código.

### El ancho, al revés de como está

Hoy hay que pedir la pantalla completa y casi nadie la pide. **Que el valor por
defecto sea la pantalla completa**, y que la columna estrecha se pida — porque la
columna estrecha es correcta para leer, y solo Noticias es texto para leer. El
tablero, el embudo, la auditoría y GitHub la quieren entera.

### Y la búsqueda, en todas las organizaciones

Dos cambios pequeños que enderezan la función más importante:

- `global_search` acepta que no le pasen organización, y entonces busca en
  **todas las de quien pregunta**. El aislamiento no cambia ni una línea: lo
  siguen poniendo las políticas, como ahora.
- Vive en el **⌘K**, no en una pantalla a la que hay que llegar. La paleta de
  comandos ya existe. Buscar deja de ser un sitio y pasa a ser un gesto.

Y el resultado dice de qué organización viene cada cosa, que es la mitad de la
respuesta cuando tienes tres.

---

## 3. La identidad, ahora que hay dónde ponerla

Con un solo marco, la identidad se puede afirmar en vez de repetirse. Lo que ya
está y merece convertirse en regla, porque en las capturas es lo que mejor
funciona:

- **Los rótulos en versalitas** —`ORGANIZACIÓN`, `WORKSPACES`— como único
  separador de secciones. Nada de títulos grandes compitiendo.
- **Las cifras en monoespaciada tabular** (`03`, `05`). Es el detalle que hace
  que esto parezca una herramienta y no una web.
- **Una sola superficie elevada por nivel.** Hoy hay tarjeta dentro de tarjeta
  dentro de panel, y por eso «se ve todo apilado»: tres sombras contando la misma
  jerarquía tres veces.
- **El acento se reserva.** Si todo es morado, nada destaca. El acento marca
  dónde estás y qué es la acción principal; el resto vive en grises.

Nada de esto pide colores nuevos. Pide **usar menos los que hay**.

---

## 4. En qué orden, porque hay que priorizar

Con el criterio que ya usamos: **(cuántas veces al día se toca × cuánto molesta) ÷
cuánto cuesta.**

| | Qué | Coste | Por qué ahí |
|---|---|---|---|
| **1** | **Un solo armazón**: `/app/o/…` a redirección y `/app` a entrar donde estabas | Días. **Es sobre todo borrar** | Es la queja entera. Sin esto, lo demás es maquillaje |
| **2** | **Ancho completo por defecto**, columna estrecha bajo petición | Horas | Medio monitor vacío, en todas las pantallas, todo el día |
| **3** | **Buscar en todas las organizaciones, desde ⌘K** | Días | La función que promete encontrar todo no cruza donde tú cruzas |
| **4** | **Una superficie por nivel** y el acento reservado | Días | Es lo que hace que «se vea apilado» |
| **5** | **El riel de organizaciones** con su estado plegado | Días | Va encima del 1; sin el 1 no tiene dónde vivir |
| — | Responsive de verdad en tablero y mesa | Semanas | **Espera a la decisión de móvil**, que sigue sin contestarse y es gratis |

### Lo que NO haría ahora

- **Volver a tocar colores o tipografía.** Ya está resuelto y demostrado. Sería
  gastar la única semana que hay en lo que ya funciona.
- **Hacer el panel «editable» o configurable.** Ya fue una rejilla configurable y
  se quitó a propósito. Un panel que cada cual coloca a su gusto es un panel que
  nadie puede explicar por teléfono, y multiplica por dos los estados que hay que
  probar. La flexibilidad que de verdad hace falta aquí es **plegar la columna de
  contexto**, no mover cajas.
- **Empezar esto durante la semana del cliente.** Un armazón a medio cambiar es
  peor que el actual, y la demo se enseña sobre lo que haya.

---

## 5. En una frase

No hay tres problemas: hay uno. **Hay tres aplicaciones donde debería haber una**,
y de ahí salen la sensación de ventanas anidadas, el menú de menús que se llama
Centro de mando, y una búsqueda que no puede cruzar lo que tú cruzas. La
identidad ya existe y está bien resuelta; lo que le falta es **un solo sitio
donde ocurrir**. Y la buena noticia es que llegar ahí es, sobre todo, borrar dos
armazones que ya casi no se usan.
