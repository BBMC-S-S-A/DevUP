/**
 * Cómo se lee el estado de la instalación.
 *
 * ESTO ESTÁ APARTE DE LA PANTALLA porque es lo único de ahí que se puede
 * equivocar de verdad. Pintar una lista no falla; decidir que «sin TURN» es un
 * aviso y «sin Spotify» no lo es sí — y es exactamente la decisión de la que
 * depende que alguien mire esta pantalla o aprenda a ignorarla. Con la regla
 * suelta se puede comprobar sin montar un navegador.
 *
 * CUATRO GRAVEDADES Y NO DOS:
 *
 *  · **mal** — algo que hoy no funciona, o una puerta abierta. Rojo, arriba.
 *  · **atención** — funciona hasta que deja de hacerlo, y ese día no avisa.
 *  · **bien** — configurado.
 *  · **apagado** — opcional y sin poner. No es un fallo y no debe parecerlo.
 *
 * Juntar las dos últimas —pintar «sin Spotify» del mismo color que «el almacén
 * no responde»— enseña a no mirar el color, y entonces sobra la pantalla.
 */

export type Salud = {
  entorno: { nodeEnv: string; altas: "invite" | "open"; verificaCorreo: boolean };
  migraciones: { aplicadas: number; ultima: { nombre: string; cuando: string } | null };
  almacen: { responde: boolean };
  correo: { via: "smtp" | "api" | "sin configurar" };
  llamadas: { turn: "propio" | "metered" | "sin configurar" };
  boveda: { conClaveDeEjemplo: boolean };
  entrar: { google: boolean };
  integraciones: { spotify: boolean; youtube: boolean };
};

export type Gravedad = "mal" | "atencion" | "bien" | "apagado";

export type Fila = {
  /** Qué se mira. Es la clave de la fila: no se repite. */
  que: string;
  estado: string;
  gravedad: Gravedad;
  /** Qué pasa si se deja así. Solo cuando hay algo que hacer. */
  consecuencia?: string;
};

const ORDEN: Record<Gravedad, number> = { mal: 0, atencion: 1, bien: 2, apagado: 3 };

/**
 * Las filas, ya ordenadas: lo que está mal arriba.
 *
 * El orden lo pone esta función y no la pantalla porque es parte de la regla:
 * una lista donde todo se pinta igual obliga a leerla entera para saber si hay
 * algo que hacer, y una pantalla que hay que leer entera cada vez se deja de
 * abrir. El caso normal —todo en orden— tiene que despacharse de un vistazo.
 *
 * Dentro de la misma gravedad se conserva el orden en que están escritas, que
 * va de lo más grave a lo más accesorio. `sort` en JavaScript es estable desde
 * ES2019, así que esto es una garantía y no una casualidad.
 */
export function filasDe(s: Salud): Fila[] {
  const filas: Fila[] = [
    {
      que: "Bóveda de credenciales",
      estado: s.boveda.conClaveDeEjemplo ? "con la clave de ejemplo" : "con clave propia",
      // Lo más grave que puede decir esta pantalla: esa clave está en el
      // `.env.example` del repositorio, así que quien lo lea descifra todos los
      // tokens de GitHub y Spotify guardados.
      gravedad: s.boveda.conClaveDeEjemplo ? "mal" : "bien",
      consecuencia: s.boveda.conClaveDeEjemplo
        ? "Esa clave está publicada en el repositorio: quien lo lea puede descifrar los tokens guardados. Hay que cambiarla y volver a conectar las integraciones."
        : undefined,
    },
    {
      que: "Almacén de archivos",
      estado: s.almacen.responde ? "responde" : "no responde",
      gravedad: s.almacen.responde ? "bien" : "mal",
      consecuencia: s.almacen.responde
        ? undefined
        : "Nadie puede subir ni abrir un archivo. Suele ser la dirección o las credenciales del almacén.",
    },
    {
      que: "Correo saliente",
      estado:
        s.correo.via === "sin configurar" ? "sin configurar" : `por ${s.correo.via.toUpperCase()}`,
      // Aquí «sin configurar» SÍ es un fallo, y por eso no todo lo opcional se
      // pinta igual: sin correo nadie recupera su cuenta solo.
      gravedad: s.correo.via === "sin configurar" ? "mal" : "bien",
      consecuencia:
        s.correo.via === "sin configurar"
          ? "Las invitaciones y los enlaces de recuperar contraseña no salen. Se puede invitar dictando el código corto, pero nadie recupera su cuenta solo."
          : undefined,
    },
    {
      que: "TURN para las llamadas",
      estado:
        s.llamadas.turn === "sin configurar" ? "sin configurar" : `configurado (${s.llamadas.turn})`,
      // «Atención» y no «mal»: las llamadas funcionan dentro de una misma red.
      // Se rompen entre dos redes con NAT estricto, y ahí se quedan
      // «conectando» sin decir nada — el fallo más caro de diagnosticar.
      gravedad: s.llamadas.turn === "sin configurar" ? "atencion" : "bien",
      consecuencia:
        s.llamadas.turn === "sin configurar"
          ? "Las llamadas entre dos redes distintas pueden quedarse en «conectando» para siempre, sin error."
          : undefined,
    },
    {
      que: "Entrar con Google",
      estado: s.entrar.google ? "configurado" : "sin configurar",
      gravedad: s.entrar.google ? "bien" : "apagado",
    },
    {
      que: "Spotify",
      estado: s.integraciones.spotify ? "configurado" : "sin configurar",
      gravedad: s.integraciones.spotify ? "bien" : "apagado",
    },
    {
      que: "YouTube",
      estado: s.integraciones.youtube ? "configurado" : "sin configurar",
      gravedad: s.integraciones.youtube ? "bien" : "apagado",
    },
  ];

  return filas.sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad]);
}

/** Cuántas piden que alguien haga algo. Cero es el titular «todo en orden». */
export function cuantasPidenAlgo(filas: Fila[]): number {
  return filas.filter((f) => f.gravedad === "mal" || f.gravedad === "atencion").length;
}
