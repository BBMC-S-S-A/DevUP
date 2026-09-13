/**
 * Quién manda en el borde de abajo de la pantalla.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Tres cosas distintas se pintan pegadas al fondo
 * y centradas: la barra de música, la barra de llamada, y la pista de DevVerse
 * («Muévete con WASD…», y el aviso de «E» para actuar). Las dos primeras son
 * `fixed bottom-4` y la tercera `absolute bottom-0 p-4` — o sea, el mismo sitio
 * exacto. Cuando coinciden, la de arriba tapa a la de abajo.
 *
 * La regla, y es una decisión de producto: **dentro de DevVerse manda el
 * mundo**. Allí la pista es lo único que explica los controles, y las dos
 * barras globales no aportan nada porque DevVerse ya tiene su propio panel de
 * llamada (`PanelLlamada`) y su propia música en la sala. Así que las dos se
 * apartan.
 *
 * Y NO ES UNA COMPROBACIÓN COPIADA EN DOS SITIOS, que es como estaba: cada
 * barra tenía su `pathname.includes("/devverse")` suelto. Dos copias de la misma
 * regla se separan en cuanto alguien cambie la ruta —y entonces una barra se
 * aparta y la otra no, que se ve como un fallo de dibujo y se busca en el CSS.
 */

/**
 * Si la ruta es la vista inmersiva.
 *
 * Se mira con `includes` y no con `===` porque DevVerse vive bajo el espacio de
 * trabajo (`/app/w/<id>/devverse`) y el identificador va en medio.
 */
export function enDevVerse(pathname: string | null | undefined): boolean {
  return pathname?.includes("/devverse") ?? false;
}
