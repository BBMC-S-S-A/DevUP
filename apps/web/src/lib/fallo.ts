/**
 * Tragarse un fallo, pero dejando rastro.
 *
 * EL PROBLEMA QUE RESUELVE. Había cuarenta y dos `.catch(() => {})` repartidos
 * por la aplicación. Algunos son correctos —hay cosas que de verdad no importa
 * que fallen— pero escritos así son indistinguibles de los que sí importan, y
 * ninguno deja rastro. Eso es lo que hace que un producto se sienta «raro» sin
 * que nadie sepa señalar dónde: las cosas no fallan, simplemente no pasan.
 *
 * LA REGLA, EN UNA LÍNEA: si quien lo usa no se entera, tiene que enterarse
 * quien lo mantiene. Un fallo que nadie ve y nadie anota es indistinguible de
 * que no haya ocurrido.
 *
 * CUÁNDO USAR ESTO Y CUÁNDO NO:
 *
 *   · `ignorar` — el fallo no cambia lo que la persona puede hacer. Un logo que
 *     no carga y deja la chapa con la inicial; marcar un canal como leído al
 *     entrar. Se anota en la consola y se sigue.
 *   · Un aviso de verdad —`toast.error`— cuando la persona ACABA de pedir algo
 *     y no ha pasado. Guardar la disposición de la mesa, marcar todo como
 *     leído. Ahí callarse es mentir.
 *   · Y si el fallo deja la pantalla inservible, no es ninguno de los dos: es
 *     un estado de error con su botón de reintentar.
 *
 * El motivo es obligatorio a propósito. Escribirlo obliga a contestar «¿y si
 * esto falla, qué?», que es justo la pregunta que no se hizo las cuarenta y dos
 * veces.
 */
export function ignorar(motivo: string): (error: unknown) => void {
  return (error: unknown) => {
    // `warn` y no `error`: esto es algo que decidimos tolerar. Ponerlo como
    // error enseñaría a ignorar la consola, que es la forma más rápida de que
    // un error de verdad pase desapercibido — el mismo criterio que usa el
    // analizador de migraciones para no poner un aviso al lado de un fallo.
    console.warn(`[devup] ${motivo}`, error);
  };
}
