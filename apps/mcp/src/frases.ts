/**
 * Qué dice el muñeco de DevVerse por cada herramienta.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN LA API. Estas frases describen herramientas, y las
 * herramientas se definen en este paquete. Tenerlas al lado es lo que permite
 * que una prueba compruebe que no falta ninguna (`registro.test.ts`): si
 * alguien añade una herramienta y se olvida de su frase, el muñeco se quedaría
 * mudo justo cuando el agente trabaja, que es el único momento en que a nadie
 * se le ocurriría mirar. La prueba lo caza en su lugar.
 *
 * ESTÁN EN PRIMERA PERSONA porque las dice el personaje, no el sistema. Y
 * hablan de la herramienta, no de la tarea: «anotando una tarea» es todo lo
 * que el nombre `crear_tarea` puede sostener honestamente. La frase buena
 * —«estoy migrando la base de datos»— solo puede venir del propio agente,
 * declarándola con `estoy_haciendo`; esto es la red por si no lo hace.
 */
export const FRASES_POR_HERRAMIENTA: Record<string, string> = {
  buscar: "buscando en el proyecto",
  mis_tareas: "revisando lo que hay pendiente",
  ver_tablero: "mirando el tablero",
  ver_tarea: "leyendo una tarea",
  ver_arquitectura: "mirando la arquitectura",
  crear_tarea: "anotando una tarea nueva",
  crear_area: "ordenando el tablero por áreas",
  que_ha_pasado: "poniéndose al día de lo que pasó",
  diario: "repasando cómo ha ido el proyecto",
  enlazar_rama: "apuntando en qué rama va esto",
  // La única que AFIRMA algo, y por eso su frase lo dice: quien pase por la
  // sala y la lea tiene que poder ir a mirar si de verdad estaba hecha.
  marcar_hecha: "dando una tarea por terminada",
  crear_columna: "añadiendo una columna al tablero",
  mover_tarea: "moviendo una tarjeta",
  actualizar_tarea: "actualizando una tarea",
  dibujar_arquitectura: "dibujando la arquitectura",
  ver_entornos: "mirando dónde está desplegado",
  sincronizar_entornos: "preguntándole a GitHub por los despliegues",
  crear_entorno: "montando un entorno nuevo",
};

/**
 * `estoy_haciendo` no está en el mapa a propósito: su frase la trae ella
 * misma. Esta lista existe para que la prueba de cobertura sepa a quién no
 * exigirle entrada.
 */
export const SIN_FRASE_PROPIA = new Set(["estoy_haciendo"]);
