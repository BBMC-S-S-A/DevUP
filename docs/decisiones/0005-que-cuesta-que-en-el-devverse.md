# 0005 · Qué cuesta qué en el DevVerse

16 de septiembre de 2026. **Propuesta, no acuerdo**: los números de aquí abajo
están puestos en la base (migración 0069) para que se puedan probar, y se
cambian con un `update` de una fila. La tarjeta que pedía esta decisión es de
Carlos; esto es el borrador que la desbloquea.

---

## Lo que ya estaba decidido y no se toca

**Cuánto vale cerrar una tarea.** 10 puntos al cerrarla y 5 más al dejar prueba
de cómo se hizo (migración 0055). Es fijo a propósito y no depende de la
prioridad ni de ningún campo que ponga quien gana el punto: **si el precio lo
pone quien cobra, el precio es infinito.** La palanca para calibrar es el
**precio de las cosas**, nunca el valor del trabajo.

**Nada caduca ni se pierde.** La 0055 tampoco quita puntos al reabrir una tarea.
Desandar lo ganado rompe la confianza en el marcador entero, y un marcador en el
que no se confía deja de mirarse.

---

## El suelo: qué suelta una semana normal

| Ritmo | Tareas/semana | Con prueba | Puntos/semana |
|---|---|---|---|
| Flojo | 2 | a veces | 20–25 |
| **Normal** | **4** | **casi siempre** | **40–60** |
| Fuerte | 7 | siempre | 105 |

De aquí sale todo lo demás. Una semana normal son **50 puntos**, y esa es la
unidad con la que hay que pensar los precios: no en puntos, en semanas.

---

## Los precios propuestos

| Pieza | Precio | Cuánto tarda alguien normal |
|---|---|---|
| Bandana | 60 | **Una semana.** La primera compra. |
| Visor | 60 | Una semana. |
| Sombrero de ala | 180 | **Un mes largo.** |
| Corona | 500 | **Un trimestre.** Es la pieza que se enseña. |

Tres tramos y no cinco, a propósito: con dos piezas baratas hay algo que comprar
la primera semana —si no, nadie vuelve a mirar el marcador—, con una intermedia
hay a dónde ir después del primer mes, y con una cara hay algo que solo se ve en
quien lleva mucho tiempo cerrando cosas.

### Por qué 60 y no 50

Una semana normal (50) deja la primera compra **a punto de conseguirse pero no
conseguida**. Ponerla justo en el suelo la convierte en un trámite; ponerla a
seis semanas la convierte en nada. 60 es la semana buena, o la semana y media
normal.

---

## Lo que NO se compra, y por qué

**Nada de lo que hoy es gratis.** Las piezas que el editor ya ofrecía —las
cuatro gorras, las tres gafas, el pelo, la ropa— siguen siendo gratis para
siempre. Cobrar por algo que alguien ya lleva puesto es exactamente el mismo
daño que quitarle puntos. Por eso la tienda vende **piezas nuevas**, dibujadas
para ella, y el corte entre lo gratis y lo de pago es un número
(`PRIMERA_DE_PAGO` en `atlas.ts`) que se mueve solo hacia delante.

**El edificio del equipo tampoco.** Es de todos y los puntos son de cada uno:
comprarlo con el saldo de una persona haría que el edificio del equipo lo
pagara quien más cierra, y eso es una discusión, no un premio. Propuesta: el
edificio se desbloquea por **hitos del equipo** —tantas tareas cerradas entre
todos, tantas semanas seguidas con el tablero al día— y no cuesta puntos a
nadie. Queda fuera de la 0069 y necesita su propia tarjeta.

---

## Cómo se corrige si sale mal

Los precios son **filas**, no constantes:

```sql
update public.tienda_articulos set precio = 90 where clave = 'hat:4';
```

La señal de que está mal calibrado es una de estas dos, y se miran al mes:

- **Nadie ha comprado nada** → los precios están altos, o las piezas no
  apetecen. Bajar el primer tramo antes de tocar nada más.
- **Todo el mundo lo tiene todo** → falta techo. Se añaden piezas caras; no se
  suben los precios de lo ya comprado, que sería desandar.

---

## Lo que se construyó con esto (0069)

- `tienda_articulos`: el catálogo, con el precio como dato.
- `compras`: qué tiene cada quien, con el precio que pagó copiado.
- `comprar_articulo()`: la única puerta. Comprueba que exista, que no lo tengas
  ya y que no te deje en negativo, con un cerrojo por persona para que dos
  pestañas no gasten el mismo saldo dos veces.
- El gasto es un **asiento negativo** en `puntos`, no una columna «saldo»
  aparte: dos números que cuentan lo mismo acaban discrepando, y entonces no hay
  forma de saber cuál es el bueno.
- La tienda vive **dentro del editor de personaje**: la pieza bloqueada está en
  su sitio con su precio, y comprarla es pulsarla.
