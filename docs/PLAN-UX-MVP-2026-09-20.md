# La interfaz, recortada a un MVP

_20 de septiembre de 2026. Plan de trabajo de UI/UX, escrito midiendo el código
—no ejecutándolo— y mirando una captura de la aplicación en uso._

La pega es de producto, no de estética: **DevUP tiene hoy la superficie de un
producto maduro y el relleno de uno que empieza**. Un MVP no se mejora puliendo
veintidós pantallas; se mejora enseñando cinco que funcionen enteras.

---

## 1. Lo que se midió

| Qué | Cuánto |
|---|---|
| Pantallas en la web | **40** |
| Destinos alcanzables desde el armazón de un espacio | **22**, más la lista de canales |
| Pantallas con el marco común (`Pagina`) | **15** |
| Pantallas con cabecera propia | **15** |
| Convenciones de ancho distintas, a la vez | **5** (`max-w-3xl`, `4xl`, `5xl`, `6xl`, `100rem`) |
| Pantallas que usan todo el ancho | **2 de 25** |

### El hueco de la izquierda no es una impresión

En una pantalla de 1905 px: el riel y la barra ocupan **320 px fijos**
(`md:pl-[20rem]` en `Armazon.tsx`), y lo que queda lo centra `Pagina` en una
columna de 896 px como mucho (`ancho="lg"`, el más usado: 11 pantallas).

    1905 − 320 = 1585 de lienzo
    (1585 − 896) / 2 = 344 px de vacío a cada lado

**El 44 % del ancho útil se deja en blanco**, repartido en dos márgenes que no
contienen nada. Es exactamente lo que se ve en la captura: la barra, un vacío,
y el contenido empezando a media pantalla.

Una columna estrecha es lo correcto para **leer texto**. No lo es para un
tablero, una tabla de miembros, una lista de servicios o un diagrama — que es la
mayoría de lo que DevUP enseña.

### Dos cabeceras distintas en el mismo producto

La mitad de las pantallas usan `Pagina` (título, rótulo, icono en su caja,
acciones a la derecha) y la otra mitad dibujan la suya. `panel` se centra en
`max-w-[100rem]`, `archivos` en `max-w-6xl`, `ventas` no se centra. Cambiar de
pantalla cambia de producto.

## 2. Lo que se ve en la captura

- **La barra pide 22 destinos** repartidos en «Espacio» (8) y «Proyecto» (7),
  más Ventas y Noticias, más los canales. Para el primer día de alguien, eso no
  es un menú: es un inventario.
- **Diagnóstico de instalación en la pantalla de ajustes**: bóveda, almacén,
  TURN, Google, Spotify, YouTube, «0 migraciones aplicadas» y un párrafo que
  explica por qué ese número no significa lo que parece. Es información de
  operador, y está delante de todo el mundo.
- **Textos que explican el producto dentro del producto.** Cuando una pantalla
  necesita un párrafo para explicar su propio número, el número está mal
  elegido.
- El diálogo de «¿Quitar a ronald barrios?» aparece abajo del todo. `Dialogo`
  es `fixed inset-0 … place-items-center`, así que **debería** salir centrado;
  lo más probable es que sea un artefacto de la captura a página completa. Está
  sin confirmar: se comprueba en el navegador antes de tocar nada.

## 3. El criterio para recortar

La tesis del producto está escrita en la propuesta: *«no somos un gestor de
proyectos; somos el gestor del desarrollo del proyecto»*. El MVP es el ciclo
más corto que demuestra eso:

> **una tarea → el código y su PR → lo que pasó → la conversación**, con el
> agente pudiendo leerlo y proponer.

Todo lo que no sirva a ese ciclo **no desaparece: sale de la navegación por
defecto**. La diferencia importa —el trabajo hecho no se tira— y ya hay un
mecanismo para ello: `capacidades` en `/auth/me`, que hoy apaga repositorios
alojados y el MCP remoto para que el menú no lleve a un 404.

Propuesta de navegación del MVP, de 22 a **6 + una sección plegada**:

| Entrada | Por qué |
|---|---|
| **Inicio** | «¿qué tengo?», cruza espacios |
| **Canales** (con DevCall dentro) | donde se habla; es lo que más se abre |
| **Tablero** | el trabajo |
| **Qué ha pasado** | el remote: volver y enterarse |
| **Biblioteca** | los archivos del proyecto |
| **Proyecto** (plegado) | GitHub, Infraestructura, Base de datos, Integraciones, Auditoría, Ramas, Red |
| Fuera del menú por defecto | DevVerse, Mesa, Ventas, Noticias, Asistente (mientras dependa de una clave de cada persona) |

## 4. El plan, por fases

### Fase A · el armazón y el ancho (lo que se nota sin abrir nada)

1. **Una sola convención de ancho, con tres modos en `Pagina`:** `lectura`
   (columna estrecha, para texto y formularios), `trabajo` (usa el ancho, con
   un tope alto para pantallas enormes) y `lienzo` (sin marco: tablero, canal,
   DevVerse). Hoy `ancho` tiene cinco valores y se elige a ojo.
2. **Pasar las 15 pantallas sin marco al marco**, salvo las tres de lienzo.
   Empezar por las que ya tienen cabecera propia parecida: `panel`, `archivos`,
   `ventas`, `ajustes`.
3. **Quitar los 320 px fijos cuando no hacen falta**: el riel solo aporta si hay
   más de una organización.

**Hecho cuando** una captura de cualquier pantalla ancha no tenga dos márgenes
vacíos mayores que el contenido, y todas las cabeceras salgan del mismo sitio.

### Fase B · la navegación del MVP

4. **Bajar la barra a 6 entradas + «Proyecto» plegable**, con el resto detrás
   de un interruptor por instalación (extender `capacidades`).
5. **DevCall deja de ser una entrada aparte** y pasa a ser la cabecera de la
   lista de canales: un canal de voz y uno de texto son el mismo objeto.
6. **Ajustes partido en dos**: «Organización» (nombre, foto, miembros,
   invitaciones) y «Instalación» (el diagnóstico técnico), visible solo para
   quien administra.

**Hecho cuando** alguien que entra por primera vez vea seis sitios y sepa qué
hay en cada uno sin abrirlo.

### Fase C · el primer día

7. **Qué ve una cuenta nueva.** Hoy aterriza en el canal general (decisión 001).
   Falta el paso siguiente: tres cosas que hacer, y que desaparezcan al hacerlas.
8. **Estados vacíos que enseñan el siguiente paso**, no que piden perdón. Ya hay
   un patrón (`EstadoVacio`); falta que todas lo usen y que cada uno lleve la
   acción que corresponde.

### Fase D · densidad y palabras

9. **Sacar la jerga de operador de la pantalla principal.** «0 migraciones
   aplicadas» con su párrafo explicativo va a Instalación.
10. **Una revisión de textos**: rótulos cortos, sin explicar el producto dentro
    del producto.

### Fase E · móvil

11. El armazón ya es cajón por debajo de 768 px. Falta recorrerlo de verdad:
    tablero, canal y DevVerse en un teléfono.

## 5. Lo que NO haría ahora

- **Rediseñar el sistema visual.** Está bien hecho —superficies, tipografías,
  curvas— y no es la pega. La pega es cuánto hay y dónde está.
- **Tocar DevVerse.** Sale del menú por defecto y se queda como está.
- **Partir `TaskBoard.tsx`** (1.525 líneas) dentro de este plan. Es deuda real,
  pero pertenece a la capa de datos y no a la interfaz; mezclarlo haría los dos
  más lentos.

## 6. Lo que hace falta decidir

1. **La lista del MVP.** La tabla del §3 es una propuesta: cuáles son las seis.
2. **DevVerse y Ventas fuera de la navegación por defecto**, con interruptor.
   Es lo que más recorta y lo único que puede doler.
3. **Si el Asistente entra**, sabiendo que necesita que cada persona ponga su
   propia clave.

Sin esas tres respuestas se puede empezar igualmente por la **fase A**: no
depende de qué se recorte, solo de cómo se pinta lo que quede.
