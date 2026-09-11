/**
 * Fechas de calendario. Las que no llevan hora.
 *
 * EL FALLO QUE ESTO ARREGLA, Y NO SE VE MIRANDO LA PANTALLA. Postgres devuelve
 * una columna `date` como «2026-09-11», sin hora y sin zona. `new Date("2026-09-11")`
 * NO lo interpreta como el once de septiembre: lo interpreta como
 * **medianoche UTC** del once. Al pintarlo con `toLocaleDateString`, el
 * navegador lo traduce a la hora local — y al oeste de Greenwich esa medianoche
 * cae el día ANTERIOR.
 *
 * En Colombia, UTC−5, «2026-09-11» se pinta como «10 sept». No falla, no avisa,
 * y solo se nota si alguien compara la pantalla con lo que escribió.
 *
 * `TaskBoard` ya lo tenía resuelto y lo dejó escrito en un comentario. El
 * embudo de ventas no: pintaba así el cierre previsto de cada oportunidad y el
 * fin de cada objetivo. Que la solución viviera dentro de un componente y no en
 * un sitio del que se pueda tirar es justo por lo que el segundo sitio volvió a
 * caer.
 *
 * LA REGLA: una fecha de calendario **no se convierte a `Date`**. Se parte el
 * texto y se lee el trozo que interesa. No hay nada que ajustar ni zona que
 * compensar, porque nunca llega a ser un instante.
 *
 * Ver `fechas.test.ts`.
 */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Hoy en calendario local, en el mismo formato en que lo guarda el servidor. */
export function hoyLocal(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * «17 ago», y con el año detrás si no es el que corre.
 *
 * El año se calla cuando es el actual porque en una tarjeta lo que se lee es
 * cuánto falta, y «17 ago 26» en 2026 gasta sitio para no decir nada.
 */
export function fechaCorta(iso: string, anioActual: string = String(new Date().getFullYear())): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  const nombre = MESES[Number(mes) - 1];
  // Si llega algo que no tiene esta forma se devuelve tal cual: inventar una
  // fecha a partir de un texto que no se entiende es peor que enseñar el texto.
  if (!nombre || !dia || !anio) return iso;
  return `${Number(dia)} ${nombre}${anio === anioActual ? "" : ` ${anio.slice(2)}`}`;
}

/** «11 de septiembre», para donde hay sitio y se lee como una frase. */
export function fechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  const nombre = MESES_LARGOS[Number(mes) - 1];
  if (!nombre || !dia || !anio) return iso;
  return `${Number(dia)} de ${nombre}`;
}

/**
 * Cuántos días de calendario faltan. Negativo si ya pasó.
 *
 * Se cuenta con `Date.UTC` sobre los tres números ya partidos, que es la forma
 * de restar días sin que el horario de verano meta una hora de más o de menos
 * en la resta — el error clásico de restar dos instantes locales.
 */
export function diasHasta(iso: string, desde: string = hoyLocal()): number {
  const a = desde.slice(0, 10).split("-").map(Number);
  const b = iso.slice(0, 10).split("-").map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return 0;
  const uno = Date.UTC(a[0]!, a[1]! - 1, a[2]!);
  const otro = Date.UTC(b[0]!, b[1]! - 1, b[2]!);
  return Math.round((otro - uno) / 86_400_000);
}

/** Dos letras de un nombre, para la chapa redonda. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "?";
}
