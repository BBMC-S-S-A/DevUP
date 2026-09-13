import { useEffect } from "react";

/**
 * Apaga la atmósfera de fondo (los dos focos difusos de `globals.css`)
 * mientras el componente que la llama está montado.
 *
 * PARA DÓNDE SE MIRA UNA IMAGEN O UN DIAGRAMA DE VERDAD. Los focos se
 * desvanecen hacia las esquinas opuestas, y ahí quedan más oscuros — al lado
 * de una imagen o un diagrama eso se lee como un borde oscuro alrededor de lo
 * que se está mirando, y se reportó justo así con la previsualización de un
 * archivo. En el resto de la app el efecto es ambiente, no compite con nada.
 */
export function useSinAtmosfera(): void {
  useEffect(() => {
    document.body.classList.add("sin-atmosfera");
    return () => document.body.classList.remove("sin-atmosfera");
  }, []);
}
