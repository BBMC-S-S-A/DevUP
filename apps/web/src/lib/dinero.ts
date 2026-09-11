/**
 * El dinero, en un solo sitio.
 *
 * ESTABA ESCRITO DOS VECES Y NO IGUAL. El embudo de ventas y el panel tenían
 * cada uno su formateador: el primero enseña los céntimos cuando no son
 * redondos y el segundo no los enseña nunca. Dos reglas distintas para la misma
 * cifra hacen que la misma venta se lea de dos maneras según la pantalla, que
 * es peor que cualquiera de las dos por separado.
 *
 * ---
 *
 * LA MONEDA ESTÁ FIJADA AQUÍ, Y ESO HAY QUE DECIDIRLO.
 *
 * Lo que hay hoy en la base, contado:
 *
 *   · `services.currency` existe —`char(3)`, por defecto `'EUR'`— y la API la
 *     devuelve con el catálogo.
 *   · `opportunity_items` copia del servicio el nombre y el precio, **pero no
 *     la moneda**.
 *   · `goals.target_cents` tampoco la tiene.
 *   · `opportunity_amount_cents` suma las líneas sin mirar ninguna moneda.
 *   · Y el endpoint del embudo devuelve `amountCents` sin decir de qué moneda
 *     es, así que la pantalla no puede saberlo ni queriendo.
 *
 * O sea: el modelo soporta monedas a medias y la interfaz no soporta ninguna.
 * Todo se guarda en céntimos de una moneda implícita, y esa moneda se decidió
 * escribiendo `"EUR"` en dos componentes.
 *
 * **Esto no se cambia adivinando.** Si la organización factura en otra moneda,
 * lo que hay que decidir es si DevUP es de una sola moneda —y entonces es un
 * ajuste de la organización, no una constante— o de varias, y entonces
 * `opportunity_items` tiene que llevarla y sumar líneas de monedas distintas
 * deja de ser una suma.
 *
 * Mientras se decide, al menos está en **una** línea y no en dos componentes.
 */
export const MONEDA = "EUR";

/** La configuración regional del formato: separadores y colocación del símbolo. */
const LOCAL = "es-ES";

/**
 * Céntimos a texto.
 *
 * Los decimales se enseñan solo cuando los hay, que es la regla que ya usaba el
 * embudo: «1.200 €» se lee de un vistazo y «1.200,00 €» obliga a comprobar que
 * esos ceros no son otra cosa. Cuando no son redondos sí se enseñan, porque
 * entonces redondear cambiaría la cifra.
 */
export function dinero(cents: number): string {
  return new Intl.NumberFormat(LOCAL, {
    style: "currency",
    currency: MONEDA,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Igual, pero sin decimales nunca. Para cifras de cabecera.
 *
 * En un panel lo que se lee es el orden de magnitud, y ahí los céntimos son
 * ruido que además descuadra la alineación de una columna de cifras.
 */
export function dineroRedondo(cents: number): string {
  return new Intl.NumberFormat(LOCAL, {
    style: "currency",
    currency: MONEDA,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
