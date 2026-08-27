# Dirección de arte de DevVerse

Qué se ve y cómo se dibuja. Escrito el 27 de agosto de 2026, antes de que
lleguen las referencias, para que cuando lleguen se sepa dónde encajan.

Va con `lluvia-de-ideas.md` y `vision-y-mvp.md`.

---

## 1. Esto ya estaba previsto

Antes de proponer nada conviene leer lo que dice la cabecera de
`lib/world/atlas.ts`, que es el archivo que dibuja todo:

> «La capa de dibujo — y **el único archivo que hay que cambiar el día que
> lleguen sprites de verdad**. Hoy todo son formas geométricas, por decisión
> […] Sustituir esto por sprites es reemplazar el cuerpo de estas funciones por
> `ctx.drawImage(atlas, sx, sy, …)`. **Ni el renderizador ni la red se
> enteran.**»

Es decir: **que los personajes sean provisionales no es un descuido, es una
decisión tomada, y la puerta de salida está construida.** No hay que rehacer el
mundo para cambiar cómo se ve. Hay que rellenar un archivo.

Eso cambia el tamaño de esta conversación. No estamos hablando de reescribir
DevVerse; estamos hablando de arte y de un archivo.

---

## 2. Por qué se ven «suaves», exactamente

No es cuestión de gusto ni de haberlo hecho mal. `drawAvatar` dibuja con
`ellipse()` y `roundRect()`: **elipses y rectángulos redondeados sobre un lienzo
con suavizado de bordes.** Esa técnica produce, siempre, formas blandas y bordes
difuminados. Es exactamente lo que describes.

El pixel art es lo contrario en las tres cosas:

| | Hoy | Pixel art |
|---|---|---|
| Bordes | Suavizados por el navegador | Duros, un píxel es un píxel |
| Formas | Curvas continuas | Rejilla, escalones deliberados |
| Color | Un tono por pieza | Paleta corta, con luz y sombra dibujadas |

La tercera es la que más se nota y la que nadie espera. Lo que hace que un
sprite de Habbo se lea a 32 píxeles no es el dibujo: es que **la sombra y el
brillo están pintados a mano** en tres o cuatro tonos. Una figura de un solo
color plano se ve blanda por muy bien recortada que esté.

Y hay un detalle de implementación que hay que cambiar sí o sí el día que
lleguen los sprites, o se verán borrosos igual: **desactivar el suavizado al
escalar** (`imageSmoothingEnabled = false`). Es una línea, y sin ella todo el
trabajo de arte se pierde en el zoom.

---

## 3. La bifurcación que hay que nombrar: proyección y arte no son lo mismo

Dices dos cosas que conviene separar, porque una es barata y la otra no.

**«El entorno está bien.»** Bien, porque el entorno **ya hace lo de Habbo**. En
`scene.ts` está escrito, y cita a Habbo por su nombre: no hay techo, las paredes
del fondo y del lateral se levantan, y **la del frente es un zócalo bajo** para
no tapar lo que hay dentro. Eso es exactamente la vista que describes, y ya
está.

**«Como si fuera Habbo, tal cual.»** Aquí hay una diferencia real que conviene
saber antes de decidir. Habbo es **isométrico de verdad**: casillas en rombo,
girado 45°. Lo de DevUP es otra cosa, y también está escrito en el archivo:
rejilla alineada con los ejes, y todo lo que se levanta del suelo dibujado con
altura en tres cuartos. La razón está anotada: *«da la densidad y la profundidad
de un Habbo sin pagar lo que cuesta el isométrico de verdad: aquí la profundidad
se ordena por Y y cada mueble se dibuja una vez, no en cuatro orientaciones.»*

**Lo que costaría pasar a isométrico de verdad:** reescribir la conversión de
coordenadas, la colisión y el orden de dibujo, y sobre todo **dibujar los 55
muebles en cuatro orientaciones en vez de una**. Son 220 dibujos en vez de 55.

**Mi recomendación: no toques la proyección.** Y el argumento es tuyo, no mío —
dijiste que el entorno está bien y que lo que está maluco son los personajes.
**Tu queja es de arte, no de proyección.** Sprites de pixel art sobre la
proyección que ya hay arreglan lo que te molesta, y cuestan una fracción.

Si más adelante quieres el isométrico de verdad, es una decisión aparte y con su
propio presupuesto. No hace falta tomarla ahora, y tomarla ahora encarecería el
arte por cuatro antes de haber visto un solo personaje terminado.

---

## 4. El cuerpo base y sus derivaciones

Tu instinto —un cuerpo principal y derivar el resto— es exactamente cómo se hace,
y **la base de datos ya está montada así**. El avatar no guarda colores: guarda
índices de catálogo, en capas separadas.

```
body 3 · hair 6 · top 5 · bottom 4 · hat 4 · glasses 3 · beard 4 · shoes 3
```

Así que lo que hay que dibujar no es «personajes»: es **un cuerpo base y una
pila de capas que encajan encima**. Eso es lo que hace Habbo, y es lo que
permite que la tienda de ropa sea barata.

### Lo que hay que entregar

**El cuerpo base**, en:

- **4 direcciones** — norte, sur, este, oeste. Ya son las que guarda la base
  (`facing: n/s/e/o`), así que no hay nada que cambiar en el código.
- **1 fotograma quieto + 2 a 4 de andar** por dirección. Cuatro es suficiente
  para que se lea el paso; más es trabajo que casi nadie va a mirar.
- **Lienzo de tamaño fijo** y **un punto de anclaje declarado**: el centro de
  los pies. Todo lo demás se alinea contra eso. Si el ancla baila entre
  fotogramas, el personaje tiembla al andar y no hay forma de arreglarlo desde
  el código.

**Cada pieza del catálogo** como una capa aparte, en el mismo lienzo y con el
mismo ancla, para las mismas direcciones y fotogramas. El orden de dibujo:

```
cuerpo → zapatos → pantalón → camiseta → barba → pelo → gafas → sombrero
```

### El truco que hay que conocer antes de empezar a dibujar

Hay **16 tonos de piel, 16 de pelo y 16 de ropa** ya definidos. Si se dibuja un
sprite por combinación de tono, el atlas explota: son cientos de imágenes para
una sola camiseta.

**La forma correcta: dibujar las piezas teñibles en gris**, con la luz y la
sombra puestas pero sin color, y **teñirlas en tiempo de ejecución** con una
operación de composición del lienzo. El resultado es que los 16×16×16 salen
gratis, y añadir un tono nuevo es una línea, no una tanda de dibujos.

Consecuencia para quien dibuje: **el volumen se pinta en escala de grises**. Es
la única instrucción de esta página que, si se pasa por alto, obliga a
redibujarlo todo.

Lo que **no** se tiñe —piel con detalle, gafas, un logo— se dibuja ya en color y
se marca como tal.

### Cuántas piezas son, en realidad

Con 4 direcciones y 4 fotogramas, el cuerpo base son 16 imágenes. Cada prenda,
otras 16. Las 32 entradas del catálogo actual son unas 500 imágenes pequeñas —
que suena a mucho y no lo es: la mayoría de las prendas cambian poco entre
fotogramas, y un sombrero o unas gafas son casi los mismos píxeles movidos.

**Sugerencia de orden:** empieza por **una dirección y un fotograma quieto** del
cuerpo base y de dos prendas. Con eso ya se ve en pantalla si la dirección de
arte funciona, y se decide con algo delante en vez de con una descripción.

---

## 5. Día y noche por la hora de cada uno

Dices que se vea de día o de noche según la hora local de la persona. Se puede,
es barato, y solo tiene una consecuencia que conviene decir en voz alta.

**Dos personas en la misma sala verán la luz distinta.** Si tú estás en Colombia
y alguien en España, tú ves tarde y esa persona ve noche, en la misma habitación,
a la vez.

**Y creo que así está bien**, por dos motivos. Primero, porque es **tu** ventana:
lo que se ve fuera es lo que hay fuera de donde tú estás. Segundo, porque no
necesita sincronizarse con nada — es un cálculo del reloj del navegador, sin
servidor, sin estado, sin migración.

Y tiene un efecto secundario que vale la pena: **la ventana te dice que es de
noche.** En un producto de trabajo donde la gente se pasa de hora, una señal
periférica y silenciosa que dice «aquí ya es tarde» es mejor que cualquier
aviso.

Técnicamente son dos cosas, ninguna grande: una **pasada de tinte** sobre la
escena —fría y baja de noche, cálida al amanecer y al atardecer, neutra al
mediodía— y el contenido de la ventana del §6. Las luces de los muebles pueden
encenderse de noche, que es el detalle que hace que se note sin que nadie lo
mire.

---

## 6. La ventana, que es la mejor idea de este apartado

*«Nunca se ve toda la calle, solo el pedacito de la ventana.»*

Eso es, además de lo que quieres, **la forma más barata que existe de tener
exterior**. No hay que modelar una ciudad, ni dibujarla, ni decidir dónde está
cada edificio. Solo hay que dibujar lo que cabe en un hueco de unos pocos
píxeles.

Cómo se hace: detrás de la abertura de la ventana, **dos o tres capas** que se
mueven a distinta velocidad al desplazar la cámara —cielo al fondo, siluetas de
edificios en medio, algo cerca—. Recortadas al hueco. Eso da profundidad de
verdad con tres dibujos por momento del día.

Y encima de eso:

- **El cielo por gradiente**, no por dibujo: amanecer, día, atardecer, noche
  interpolados por la hora. Cuatro paradas de color y una interpolación.
- **Ventanas encendidas** en las siluetas de enfrente, de noche. Unas cuantas,
  no todas, y siempre las mismas, porque una ciudad que parpadea al azar se lee
  como un error.
- **Algo que pasa de vez en cuando** — una luz de coche, un pájaro. Muy de
  cuando en cuando: la gracia de mirar por la ventana es que casi nunca pasa
  nada.
- **Lluvia**, si alguna vez apetece. Encaja con la idea de la ventana que enseña
  el estado de la CI.

Merece la pena decir por qué esto importa más de lo que parece: **es lo único
que va a decir que estás dentro de un edificio.** Sin ventana, una sala sin
techo es una planta flotando en negro. Con ella, es un piso.

---

## 7. Edificios

Que haya edificios, y que por fuera se vea la hora, es un salto de alcance
mayor que el resto de esta página: es **una escena nueva** —la vista exterior—
además de la de dentro, con su propio dibujo, su propia navegación y la
pregunta de qué pasa cuando alguien entra.

No es para el MVP, y no hace falta decidirlo ahora. Lo que sí conviene desde ya,
porque cuesta cero y ahorra un rehacer:

- **Que la hora del día sea un valor de la escena** y no algo que calcula la
  ventana por su cuenta. El día que exista el exterior, ya está compartido.
- **Que una organización pueda tener más de una planta.** Hoy la escena es una
  sola. No hace falta construirlo; hace falta que el modelo no lo impida.

---

## 8. Lo que no cambia

El contrato del §1 es el que hace que todo esto sea barato, así que conviene
protegerlo:

- **La red no se entera.** Las posiciones, las zonas y la presencia siguen
  igual. Nada de esto es una migración.
- **La escena y la colisión no se enteran.** `scene.ts` seguirá diciendo qué
  casilla es suelo y cuál es muro.
- **El catálogo es de índices, no de imágenes.** Un avatar guardado hoy seguirá
  siendo válido cuando el arte cambie — se verá mejor, pero será la misma
  persona. Eso no es un detalle: es lo que permite cambiar el arte sin pedirle a
  nadie que se vuelva a hacer el muñeco.
- **Y la zona restringida sigue siendo zona restringida:** esto se toca cuando
  se pida y con las referencias delante, no de camino a otra cosa.

---

## 9. Qué me hace falta cuando envíes las referencias

Para no adivinar:

1. **El tamaño del personaje en píxeles.** Es la decisión que condiciona todas
   las demás. Habbo anda por unos 32 de ancho y 50 de alto.
2. **La paleta**, o al menos tres o cuatro imágenes de las que sacarla. Conviene
   que hable con la de `globals.css`, o DevVerse y la plataforma parecerán dos
   productos.
3. **Una referencia de la cara**, que es donde se decide si un personaje cae
   bien. A este tamaño es cuestión de tres o cuatro píxeles, y no hay término
   medio.
4. **Si el cuerpo es uno o son varios.** Hoy el catálogo dice `body: 3`. Si al
   final es un único cuerpo con complexiones distintas, cambia cómo se organizan
   las capas y es mejor saberlo antes.
5. **Andar sí o no.** Un personaje que se desliza sin mover las piernas se lee
   como inacabado, pero cuadruplica el arte. Es una decisión legítima empezar
   sin andar.

---

## Apéndice · Dos decisiones que quedan cerradas

**Monedas por favores: decidido, entra.** Queda como intercambio libre entre
personas. El razonamiento es que la moneda solo compra cosmética y no aporta
nada más, así que lo que alguien decida hacer con la suya es asunto suyo.
Levanto el reparo que puse en `lluvia-de-ideas.md` §4 y lo dejo anotado como
decisión tomada, no como riesgo abierto.

Lo único que arrastra al código es de ingeniería y es pequeño: **toda
transferencia deja registro** —quién, a quién, cuánto, cuándo—. No por
desconfianza, sino porque una moneda que se mueve sin rastro es imposible de
cuadrar el día que un saldo no salga, y porque el proyecto ya tiene auditoría
para otras cosas.

**Nativa: escritorio y móvil, y sale del mismo sitio.** Aclaras que nativa es
las dos, ordenador y teléfono. La buena noticia es que no son dos proyectos:
**Tauri 2 compila a escritorio y a móvil desde el mismo código**, así que la
plataforma web bien hecha es el 90 % de las tres.

El orden que propongo, y el motivo de cada paso:

1. **Web adaptable** (I1 del plan de interfaz). Es requisito de todo lo demás.
2. **Escritorio con Tauri.** Es donde está el motivo de verdad: abrir tus
   repositorios en tu disco y ejecutar procesos de verdad, en vez del entorno
   embebido que corre dentro del navegador con sus límites.
3. **Móvil con el mismo Tauri**, o instalable desde el navegador si con eso
   basta. Merece la pena saber que **el móvil de Tauri es bastante más joven que
   el de escritorio**, así que conviene probarlo con algo pequeño antes de
   apostar el calendario.

Y el motivo por el que esto va después y no antes sigue siendo el mismo: la
separación en dos mundos es lo que permite que la aplicación cargue la
plataforma sin arrastrar DevVerse. Sin esa separación, la nativa lo hereda todo.
