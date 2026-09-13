/**
 * Qué se le cuenta a quien llega, y por dónde le decimos que empiece.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO HAY TRECE RECORRIDOS, Y NO ES PEREZA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La 0052 guarda trece roles. Escribir trece recorridos distintos sería escribir
 * trece veces lo mismo con el nombre cambiado: lo que hay que explicar —qué es
 * un espacio, qué es una rama, quién responde de qué, cómo se cierra una tarea—
 * no depende de si programas el frontal o el servidor. Un recorrido «de
 * backend» que cuenta lo mismo que el «de frontend» con otro título no enseña
 * nada y sí promete algo que no cumple.
 *
 * Lo que SÍ cambia con el rol es **por dónde conviene empezar**, y eso son tres
 * familias, no trece:
 *
 *  · Quien REPARTE trabajo (producto, gestión, dirección) empieza por el
 *    tablero y las ramas, porque su primer gesto es mirar qué hay sin repartir.
 *  · Quien lo HACE (todos los perfiles técnicos) empieza por sus tareas.
 *  · Quien DISEÑA empieza por la biblioteca, porque su trabajo entra y sale de
 *    ahí antes de ser una tarea.
 *
 * Decir tres cosas verdaderas es mejor que trece falsas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE CUENTA, Y POR QUÉ ESTAS CINCO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Son las que este producto NO explica en ninguna otra parte y con las que
 * alguien se equivoca el primer día: que una tarea vive en una sola rama, que
 * archivar en una rama no asigna a nadie, y que cerrar es contar cómo se hizo.
 * Lo que sí se explica solo —que hay canales, que hay un tablero— no se repite:
 * un recorrido que cuenta lo evidente enseña a saltarse los recorridos.
 */

export type PasoDelRecorrido = {
  titulo: string;
  cuerpo: string;
  /** Lo que se suele hacer mal, dicho como se dice en voz alta. */
  ojo?: string;
};

export const PASOS: PasoDelRecorrido[] = [
  {
    titulo: "Un espacio es un proyecto",
    cuerpo:
      "Dentro de un espacio están sus canales, su tablero, sus archivos y su repositorio. " +
      "Una organización puede tener varios, y cada uno es un mundo aparte.",
    ojo: "Un espacio personal solo lo ves tú, aunque el resto administre la organización.",
  },
  {
    titulo: "Cada tarea cuelga de UNA rama",
    cuerpo:
      "Las ramas son de dónde cuelga el trabajo: «Frontend», «Infraestructura», «Ventas». " +
      "Una tarea vive en una sola. Para lo que cruza —«urgente», «cliente X»— están las etiquetas, " +
      "y de esas puede tener las que haga falta.",
    ojo: "Si una tarea pudiera estar en dos ramas, «lo que hay en Frontend» dejaría de ser una lista y pasaría a ser una opinión.",
  },
  {
    titulo: "El gerente reparte; el delegado lo hace",
    cuerpo:
      "De cada rama responde su gerente —pueden ser varios— y su trabajo es que avance, no hacerla. " +
      "Quien hace una tarea concreta es su delegado.",
    ojo: "Archivar una tarea en una rama NO se la asigna a nadie. Lo que cae sin delegado aparece en «por repartir», y esa lista es lo que el gerente viene a mirar.",
  },
  {
    titulo: "Cerrar es contar cómo se hizo",
    cuerpo:
      "Al cerrar una tarea puedes dejar la prueba: el enlace al cambio, la nota de qué se decidió. " +
      "Eso es lo que hace que dentro de tres meses se sepa por qué algo está como está.",
    ojo: "No es obligatorio, a propósito: un campo obligatorio se rellena con «ok» y eso no es documentación. Lo que sí pasa es que se ve quién cerró sin decir cómo.",
  },
  {
    titulo: "Se habla en DevCall, y se está en DevVerse",
    cuerpo:
      "DevCall es la llamada: voz, pantalla y grabación. DevVerse es la oficina, donde se ve quién " +
      "anda por dónde y te acercas a hablar sin convocar una reunión.",
    ojo: "Antes de tu primera llamada, prueba el micrófono en Mi cuenta. Descubrirlo dentro cuesta la reunión de todos.",
  },
];

/** Las tres familias, y lo que cada una hace primero. */
export type Familia = "reparte" | "hace" | "disena";

const POR_ROL: Record<string, Familia> = {
  producto: "reparte",
  gestion: "reparte",
  direccion: "reparte",
  diseno: "disena",
  frontend: "hace",
  backend: "hace",
  fullstack: "hace",
  movil: "hace",
  qa: "hace",
  datos: "hace",
  ia: "hace",
  plataforma: "hace",
  seguridad: "hace",
};

export type PorDondeEmpezar = {
  titulo: string;
  cuerpo: string;
  /** A dónde lleva el botón, relativo al espacio en el que se está. */
  destino: "board" | "panel" | "archivos" | "categorias";
  etiqueta: string;
};

const EMPIEZA: Record<Familia, PorDondeEmpezar> = {
  reparte: {
    titulo: "Empieza por las ramas",
    cuerpo:
      "Ahí se ve de un vistazo qué está esperando a que alguien lo reparta, y quién ha andado por cada sitio.",
    destino: "categorias",
    etiqueta: "Ver las ramas",
  },
  hace: {
    titulo: "Empieza por el tablero",
    cuerpo:
      "Lo que tienes asignado está ahí. Al cerrar algo, deja escrito cómo lo hiciste: es lo que se agradece en tres meses.",
    destino: "board",
    etiqueta: "Ver el tablero",
  },
  disena: {
    titulo: "Empieza por la biblioteca",
    cuerpo:
      "Todo lo que se pega en un mensaje acaba ahí. Con carpetas se encuentra; sin ellas, en una semana son treinta «image.png».",
    destino: "archivos",
    etiqueta: "Ver la biblioteca",
  },
};

/**
 * Por dónde empezar, según el rol.
 *
 * SIN ROL SE OFRECE EL DEL TABLERO, y no es un descarte: elegir rol es
 * opcional a propósito —un formulario en la puerta es la forma más rápida de
 * que alguien cierre la pestaña— así que la mayoría llegará aquí sin haberlo
 * puesto. El tablero es lo que todo el mundo usa, tenga el papel que tenga.
 */
export function porDondeEmpezar(rol: string | null | undefined): PorDondeEmpezar {
  const familia = rol ? POR_ROL[rol] : undefined;
  return EMPIEZA[familia ?? "hace"];
}
