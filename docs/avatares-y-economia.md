# Avatares, atuendos y economía

Continúa `direccion-de-arte.md` con lo que fijan las referencias del 27 de
agosto, y responde la pregunta que las acompañaba: cómo se evita que dos amigos
se monten un servidor y se granjeen monedas hasta comprarlo todo.

---

## 1. Lo que fijan las referencias

Las tres imágenes dicen lo mismo y confirman la recomendación del documento
anterior: **pixel art, no formas suaves.**

Lo que se lee en ellas:

- **Contorno oscuro y cerrado** alrededor de cada figura. Es lo que las separa
  del fondo y lo que ahora mismo no tienen los personajes de DevUP.
- **Volumen pintado a mano**, tres o cuatro tonos por prenda: base, sombra,
  luz. Confirma la instrucción de dibujar las piezas teñibles en escala de
  grises.
- **Paleta corta y saturada sobre fondo oscuro** — verdes ácidos, violetas,
  cian. Encaja de casualidad con la paleta de `globals.css`, que ya es acento
  azul + cian + violeta sobre navy. **La plataforma y DevVerse pueden compartir
  paleta**, que era la preocupación que dejé abierta.
- **La cara son cuatro píxeles y funciona.** Ojos, poco más. Cuanto menos
  detalle, mejor lee.
- **Los accesorios son capas evidentes**: gorro, gafas, pelo, prenda superior,
  prenda inferior, zapatos — cada uno recortado y superpuesto. Es exactamente
  el modelo de capas que la base de datos ya tiene.
- **Las «skins» enteras existen** y no son ropa: el personaje del barril o el
  del casco no son un cuerpo vestido, son otra cosa. Eso pide una ranura
  aparte — §2.

**Tamaño propuesto para confirmar: 40 × 64 px** el cuerpo base, con la casilla
del suelo en 32. Es un poco más alto que Habbo, y ese poco es lo que da sitio a
que un anillo o un reloj se vean. Si algo no se lee a ese tamaño, no se leerá a
ninguno.

---

## 2. Las ranuras del personaje

Hoy el catálogo son ocho piezas. Lo que pides —anillos, relojes, zapatillas,
suéter, chompa, gorra— es ampliarlo, y conviene fijar la lista antes de dibujar
nada, porque el orden de dibujo depende de ella.

```
skin        ← reemplaza el cuerpo entero (alien, robot, disfraz)
cuerpo      ← complexión y tono de piel
zapatos
pantalón
camiseta        capa interior
chaqueta        capa exterior — suéter, chompa, abrigo
manos       ← anillos, reloj, guantes
barba
pelo
cara        ← gafas, máscara, pintura
cabeza      ← gorra, gorro, casco, auriculares
espalda     ← mochila, alas, capa
mano        ← lo que se lleva: café, portátil, mando
```

Tres decisiones metidas ahí que conviene ver:

**Camiseta y chaqueta separadas.** Es lo que permite que un suéter encima de una
camisa se lea como dos prendas. Con una sola ranura, cada combinación es un
dibujo nuevo y la tienda se multiplica.

**La skin no es ropa: sustituye al cuerpo.** Al ponerse una skin entera, las
ranuras de cuerpo y prendas se apagan o se restringen — un barril no lleva
pantalones. Esa regla hay que escribirla en el catálogo, pieza por pieza, o
saldrán combinaciones rotas.

**«Mano» y «espalda» valen doble**, porque son las ranuras donde la recompensa
puede contar algo: el portátil con pegatinas ganadas, la mochila del proyecto
entregado. Es donde el trabajo se convierte en decoración, que es la mejor idea
de toda la gamificación.

---

## 3. Atuendos por organización

Tu idea de perfiles —uno de trabajo, uno para el servidor con amigos, y que
cargue solo— es sencilla de montar y es lo que resuelve la mitad de la tensión
del §6.

Cómo queda:

- **Un atuendo es un conjunto guardado** con nombre. Cada persona tiene los que
  quiera.
- **Cada organización puede tener uno asignado.** Al entrar, se pone ese. Sin
  asignar, el predeterminado.
- **El vestuario es siempre global** — lo que has ganado es tuyo en todas
  partes. Un vestuario por servidor sería el peor resultado posible: comprar un
  gorro y no poder ponértelo donde te apetece.
- **Cambiar de atuendo es gratis y sin límite.** Lo que cuesta es conseguir las
  piezas.

Un aviso que sale barato ahora y caro después: **el atuendo se elige por
organización, no por sala.** Un atuendo por canal suena flexible y en la
práctica significa vestirse cuarenta veces.

---

## 4. La cartelera sobre el personaje

Pides nombre arriba, rol abajo y si está ocupado. `drawNameplate` ya existe, así
que es ampliarlo. Queda así:

```
        ┌─────────────────┐
        │   Juan Medina   │   nombre
        │ ● Backend       │   punto de estado + rol
        └─────────────────┘
              [ 🧍 ]
```

**Los estados**, y el tercero es el bueno:

| Estado | Qué significa | Qué ofrece el menú al acercarse |
|---|---|---|
| **Disponible** | Se puede | Saludar · Llamar |
| **Ocupado, abierto a llamadas** | Está a algo, pero se le puede sacar | Saludar · Llamar |
| **Concentrado** | No interrumpir | Saludar · Dejar recado |
| **Ausente** | No está | Dejar recado |

El segundo estado es el que ninguna herramienta de trabajo tiene y el que más
falta hace. Hoy la elección es «disponible» o «no molestar», y la mayor parte
del tiempo la verdad es la de en medio: *estoy liado pero si me necesitas,
llámame*. Que eso se pueda decir sin tener que decirlo a cada uno es, por sí
solo, un motivo para que exista un espacio con avatares.

**Y la tarea en curso**, que es lo que pedías al final: no en la cartelera —ahí
no cabe y no se lee de lejos— sino **en la tarjeta que aparece al acercarse**,
junto a las acciones:

```
┌──────────────────────────────┐
│  Juan Medina · Backend       │
│  ● Ocupado, abierto a llamadas│
│  ↳ Arreglando el 415 del túnel│
│  ─────────────────────────── │
│  👋 Saludar    📞 Llamar      │
└──────────────────────────────┘
```

Eso convierte acercarse en algo útil y no solo simpático: **ves en qué anda
antes de interrumpir**, que es la mitad de la cortesía en un equipo.

**Una trampa que hay que anotar antes de construirlo.** La tarea en curso puede
venir de un canal privado. El mundo tiene que filtrar por acceso **antes** de
enviar el título, no en el cliente. Es exactamente el tipo de fuga silenciosa
contra la que avisa `ESTADO-DEL-PRODUCTO.md`: la política de aislamiento no
falla con un error, devuelve cero filas y sigue. Toda tabla nueva de aquí
necesita su política y su caso en `isolation.test.ts`.

---

## 5. Cofres: que todo sea suerte, sin que frustre

Quieres que nada se compre directo: cofres por categoría, y las skins caras.
Se puede, y funciona — pero hay tres piezas que separan un sistema de cofres
que engancha de uno que la gente abandona.

**1. Contador de consuelo.** Un cofre que puede no dar nunca lo bueno acaba en
alguien abriendo cuarenta y dejándolo. La solución de todo el sector es una
garantía: *a los N sin nada raro, el siguiente lo lleva*. El contador es
invisible, pero cambia por completo cómo se siente.

**2. Los repetidos valen algo.** Que un repetido se convierta en fragmentos, y
que con fragmentos suficientes se compre una pieza concreta. Esto es lo que
mantiene la promesa —**abrir cofres sigue siendo la única forma de conseguir
cosas**— y a la vez le da a quien lleva meses detrás de un gorro una manera de
llegar. La suerte es el camino rápido; los fragmentos, el lento y seguro.

**3. Las probabilidades, escritas.** Que la ficha del cofre diga qué
posibilidad hay de cada cosa. Es buena práctica, es lo que exigen las tiendas de
aplicaciones para lo que se vende, y sobre todo evita la conversación de «esto
está trucado» — que llega siempre, y con números no hay discusión.

**Los cofres**, por categoría como decías: accesorios, prendas superiores,
prendas inferiores, cabeza, y uno de skins mucho más caro. Que los baratos
caigan a menudo y los caros casi nunca es lo que hace que abrir uno sea un
momento.

---

## 5 bis. Cómo entra el dinero, si entra

Propuesta sobre la mesa: en vez de vender monedas, **vender las cajas
directamente**, para esquivar el asunto de la moneda propia.

**Hay que decirlo claro: eso va en la dirección contraria.** No es una crítica a
la idea de monetizar —que es legítima y llegará— sino a cuál de las dos puertas
es la delicada.

Lo que está regulado en varios países no es «tener una moneda virtual». Es
**pagar dinero real por un resultado aleatorio**. Vender monedas y que las
monedas abran cajas es eso mismo con un paso en medio; **vender la caja
directamente es eso mismo sin el paso en medio.** Bélgica es el caso más
conocido de un regulador europeo tratando las cajas de pago como juego de azar,
y no ha sido el único país en moverse. Además, las tiendas de aplicaciones
—donde acabaría la versión móvil— exigen publicar las probabilidades de
cualquier caja que se venda.

No soy quien para darte asesoría legal y no la estoy dando: lo que digo es que
esa opción concreta te mete en una conversación con abogados, y las otras no.

Y hay un segundo motivo, que en este producto pesa igual: **DevUP es una
herramienta de trabajo.** Vender tiradas de suerte a alguien cuya moneda se gana
trabajando mezcla dos cosas que conviene tener separadas.

### La salida, que además es mejor diseño

**El dinero compra certeza. El trabajo compra suerte.**

| | Cómo se consigue | Qué da |
|---|---|---|
| **Cajas** | **Solo con monedas ganadas trabajando.** Nunca con dinero | Aleatorio |
| **Tienda** | **Dinero real** | Lo que ves, exactamente eso |
| **Pase de temporada** | **Dinero real** | Una lista de recompensas conocida de antemano, que se desbloquea usando la plataforma |

Es la inversión de lo habitual y funciona mejor por tres razones:

1. **Esquiva el problema entero.** Nada aleatorio se vende. No hay
   probabilidades que publicar ni jurisdicción que mirar.
2. **Las cajas siguen valiendo algo.** Si se pudieran comprar, dejan de ser un
   premio por trabajar y pasan a ser un artículo. Lo que hace especial abrir una
   caja es que te la ganaste.
3. **Quien paga sabe qué se lleva**, que es lo que la gente quiere de verdad
   cuando saca la tarjeta. La frustración de pagar y que no salga es la que
   genera las reseñas malas y, últimamente, los reguladores.

Y deja las dos economías sin tocarse: **el dinero nunca acelera lo que se gana
trabajando**, así que la moneda del §6 sigue significando lo mismo y el granjeo
sigue sin tener premio.

**Si aun así quieres vender aleatoriedad**, la versión menos mala es: nunca a
menores, probabilidades publicadas en la ficha, contador de consuelo visible —no
oculto—, y consultarlo con alguien que sepa de la normativa de los países donde
vayáis a cobrar. Es una decisión que se puede tomar; solo no conviene tomarla
sin saber que es esa.

---

## 6. El granjeo: la pregunta importante

Tu miedo: un servidor de amigos, tareas falsas, marcadas como hechas, monedas
infinitas, se lo compran todo y se van.

**Es un miedo correcto y el problema es real.** Pero la solución no está donde lo
estabas buscando.

### Por qué el nivel por servidor no lo arregla

Separar el progreso por servidor reparte el granjeo, no lo impide: los mismos
dos amigos granjean en su servidor y se compran todo **ahí**. Y si el vestuario
es global —que debe serlo, §3— la ropa cruza igual. Si el vestuario no es
global, el sistema se vuelve odioso para todos los demás para no arreglar el
caso que preocupa.

### Dónde está la solución: en qué acuña moneda

El agujero no es *dónde* se cuenta. Es **qué** se cuenta.

Si una moneda se acuña porque alguien marcó una tarea como hecha, entonces
marcar tareas es imprimir dinero, y no hay estructura de niveles que lo
arregle. **La regla que lo cierra es una sola:**

> **Solo acuña moneda un hecho que DevUP puede verificar contra un sistema
> externo que la persona no controla.**

Y esto ya estaba medio resuelto, porque los ritos de calidad que propuse en
`lluvia-de-ideas.md` §3.5 son justo eso:

| Rito | Contra qué se verifica | ¿Se puede falsear? |
|---|---|---|
| Migración con política y caso de aislamiento | El repositorio y la prueba, que corre en CI | No sin escribir la migración de verdad |
| PR revisada con comentarios de fondo | GitHub, **y por otra persona** | No a solas |
| Fallo con prueba de regresión | Una prueba que antes fallaba y ahora pasa | No sin arreglar el fallo |
| CI devuelta a verde | Una ejecución real de CI | **No.** Punto |

**No se puede falsificar una CI en verde sobre un repositorio real.** Ese es el
cimiento. Marcar una tarea como hecha no acuña nada — ni una moneda. Las tareas
siguen sirviendo para organizarse; simplemente no son dinero.

### Tres cierres más, por si acaso

Una sola defensa nunca basta, y estas tres son baratas:

1. **Solo acuñan las organizaciones con un repositorio conectado.** Un servidor
   de amigos sin GitHub detrás no imprime nada. Esto solo ya elimina el
   escenario que describes, y es una comprobación de una línea.
2. **Techo por persona y semana.** Aunque quedara un hueco, el granjeo va al
   ritmo de un trabajo normal. Y tiene un efecto secundario bueno: nadie se
   siente obligado a echar horas por monedas, porque a partir del techo no
   suman.
3. **Los ritos de dos exigen dos personas distintas.** Nadie se revisa su PR
   para cobrar. Un círculo de dos que se revisan mutuamente sigue teniendo que
   escribir código de verdad, y ya está bajo el techo.

Y sobre todo lo anterior, **libro de cuentas**: cada moneda acuñada deja una
fila con el hecho que la originó. Igual que las transferencias del apéndice de
`direccion-de-arte.md`. Si un saldo raro aparece, se puede mirar; y si algo se
coló, se puede deshacer sin tocar lo demás.

### Lo que esto significa para el diseño

Hay una consecuencia que conviene aceptar de frente: **el progreso va a ser
lento**, porque está atado a trabajo real y verificable. Eso es una virtud, no
un defecto — una moneda que se gana rápido no se siente como nada— pero obliga
a que la primera tanda de recompensas sea **generosa y barata**, o los primeros
quince días se sienten vacíos. Ahí es donde entran los cofres baratos que caen a
menudo.

---

## 7. Global y por organización: el reparto

Con lo anterior en la mano, la pregunta se contesta sola y con las dos cosas que
te gustaban:

| | Alcance | Por qué |
|---|---|---|
| **Monedas** | **Global** | Acuñadas por hechos verificados, así que da igual dónde se ganen |
| **Vestuario** (lo que posees) | **Global** | Es tuyo. Un vestuario por servidor es el peor resultado |
| **Atuendo** (cómo apareces) | **Por organización** | Es tu idea de perfiles, y es lo que de verdad querías que fuera por servidor |
| **Reputación** | **Por organización** | Lo que has aportado *aquí*. Visible, no transferible, **no es dinero** |

El reparto interesante es el de las dos últimas filas: **lo que se ve cambia
según dónde estés; lo que tienes, no.** Eso da el «perfil por servidor» que
decías que usan todas las plataformas, sin partir la economía en pedazos ni
crear una moneda por cada sitio.

Y la reputación por organización resuelve lo que el nivel por servidor
pretendía: en el trabajo se ve lo que has aportado en el trabajo, y en el
servidor de amigos se ve lo de allí. Pero como no compra nada, granjearla no
sirve de nada.

---

## 8. Lo que arrastra a la base de datos

Para dimensionar. Todas nuevas, todas con su política de aislamiento y su caso
en `isolation.test.ts` — sin excepción, que es la regla dura del proyecto:

- **catálogo** — las piezas, su ranura, su rareza, y qué apaga cada skin.
- **posesiones** — quién tiene qué, y desde cuándo.
- **atuendos** — conjuntos guardados con nombre.
- **atuendo por organización** — qué se pone al entrar dónde.
- **libro de monedas** — cada acuñación con el hecho que la originó, y cada
  transferencia con origen y destino. Solo se añaden filas; el saldo es la suma.
- **aperturas de cofre** — qué salió, con el contador de consuelo.
- **presencia extendida** — estado y tarea en curso. Puede vivir en memoria como
  la presencia de hoy.

El libro de monedas de solo añadir es la pieza que hay que hacer bien a la
primera: un saldo guardado como número se descuadra el primer día que algo falle
a medias, y entonces no hay forma de saber cuál era el bueno.

---

## 9. Lo que queda por decidir

1. **¿40 × 64 px?** Es una propuesta, no un hecho. Un boceto del cuerpo base a
   ese tamaño lo confirma o lo tira en diez minutos.
2. **¿Cuántas skins enteras de salida?** Cada una es un personaje entero
   redibujado, no una prenda. Con dos o tres al principio basta para que se
   entienda que existen.
3. **Los tres ritos que acuñan al empezar.** Sigue pendiente desde
   `vision-y-mvp.md`, y ahora se ve que es la decisión que sostiene toda la
   economía.
4. **El techo semanal.** Un número. Conviene que salga de mirar una semana real
   del equipo, no de inventarlo.
5. **¿La reputación por organización entra ya, o después?** No es necesaria para
   que la economía funcione. Es lo que hace que el perfil signifique algo.
