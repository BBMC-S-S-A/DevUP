/**
 * Convierte la lista plana que devuelve la API de árboles de Git
 * (`path`/`type` por entrada, sin jerarquía) en nodos anidados para el
 * componente de árbol de archivos. GitHub no distingue "carpeta creada
 * explícitamente" de "carpeta que existe porque algún archivo vive dentro" —
 * aquí tampoco hace falta: toda carpeta se infiere de las rutas de sus hijos.
 */
export type ArbolNodo = {
  nombre: string;
  ruta: string;
  tipo: "archivo" | "carpeta";
  hijos?: ArbolNodo[];
};

export function construirArbol(entradas: { path: string; type: "blob" | "tree" }[]): ArbolNodo[] {
  const raiz: ArbolNodo[] = [];
  const indice = new Map<string, ArbolNodo>();

  // Orden alfabético antes de construir: así carpetas y archivos salen
  // agrupados dentro de cada nivel sin tener que reordenar después.
  const ordenadas = [...entradas].sort((a, b) => a.path.localeCompare(b.path));

  for (const entrada of ordenadas) {
    const partes = entrada.path.split("/");
    let nivelActual = raiz;
    let rutaAcumulada = "";

    partes.forEach((parte, i) => {
      rutaAcumulada = rutaAcumulada ? `${rutaAcumulada}/${parte}` : parte;
      const esUltimaParte = i === partes.length - 1;

      let nodo = indice.get(rutaAcumulada);
      if (!nodo) {
        const esCarpeta = !esUltimaParte || entrada.type === "tree";
        nodo = {
          nombre: parte,
          ruta: rutaAcumulada,
          tipo: esCarpeta ? "carpeta" : "archivo",
          hijos: esCarpeta ? [] : undefined,
        };
        indice.set(rutaAcumulada, nodo);
        nivelActual.push(nodo);
      }

      if (nodo.hijos) nivelActual = nodo.hijos;
    });
  }

  return raiz;
}
