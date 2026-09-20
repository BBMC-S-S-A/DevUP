/**
 * Cuándo dos nombres son «el mismo» para una persona, aunque no lo sean para la
 * base de datos.
 *
 * POR QUÉ HACE FALTA. La unicidad de una rama es `(espacio, nombre)` exacta, así
 * que «Frontend», «frontend» y «Frontend » conviven como tres ramas distintas.
 * Con etiquetas eso ensucia el tablero; con ramas **miente**, porque una tarea
 * vive en una sola: el trabajo de frontend queda partido en montones que nadie
 * suma, y cada rama enseña una cuenta que parece completa.
 *
 * Es el mismo mecanismo de la docena de etiquetas casi iguales que reportó
 * GESTEK, un piso más abajo.
 *
 * QUÉ SE IGNORA AL COMPARAR: mayúsculas, tildes, espacios de más y los guiones
 * o barras bajas que se usan para separar. Un nombre normalizado no se guarda
 * nunca: solo se usa para preguntar «¿no será esta misma?».
 *
 * NO DECIDE, AVISA. Puede haber un motivo para tener «API» y «api»; lo que no
 * puede es pasar sin que nadie lo vea.
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    // Quita los signos diacríticos que la descomposición acaba de separar: así
    // «Diseño» y «Diseno» se comparan iguales sin tocar lo que se guarda.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function seParecen(uno: string, otro: string): boolean {
  const a = normalizarNombre(uno);
  const b = normalizarNombre(otro);
  return a.length > 0 && a === b;
}
