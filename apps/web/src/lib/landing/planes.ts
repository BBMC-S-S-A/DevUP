/**
 * Los planes, en un solo sitio.
 *
 * LA PÁGINA NO LLEVA NI UN PRECIO ESCRITO A MANO. Cerrar la tarifa es editar
 * este archivo y no repasar la maquetación — que importa, porque hoy los
 * importes son BANDAS RECOMENDADAS y no tarifa cerrada.
 *
 * De dónde salen las bandas (ver `docs/plan-planes-y-precios.md`):
 *   · 22 entrevistas con la técnica de Van Westendorp situaron el óptimo para
 *     equipos técnicos entre 10 y 14 USD, y el 68 % de los decisores aceptó
 *     24 USD sin negociar.
 *   · La suma de lo que DevUP sustituye está entre 27 y 34 USD por persona y
 *     mes: Jira 7,91 + Slack 7,25 + Kumospace 12,80.
 *   · La regla es que cada plan quede por debajo de esa suma, porque es la
 *     única comparación que hace un comprador de verdad.
 *
 * El día que haya precio para Colombia —paridad de poder adquisitivo, en torno
 * al 0,34— es un campo más en este objeto, no otro diseño.
 */

export type Plan = {
  id: string;
  nombre: string;
  para: string;
  /** Texto tal cual se pinta. Es texto y no número porque hoy son rangos. */
  mensual: string;
  anual: string;
  unidad: string;
  /** Cuando el precio esté cerrado, se pone a `false` y desaparece el aviso. */
  banda: boolean;
  accion: string;
  /** Adónde lleva la acción. Casi siempre, al alta. */
  destino: string;
  marcada?: boolean;
  incluye: { texto: string; clave?: boolean; fuera?: boolean }[];
};

/**
 * El alta y el acceso son la misma pantalla con dos pestañas, y ya existía.
 * La landing no monta un formulario propio: enlaza al que ya funciona —con
 * Google, con invitaciones y con la política de registro— y solo le dice en
 * qué pestaña abrirse.
 */
export const RUTA_REGISTRO = "/login?modo=registro";
export const RUTA_ACCESO = "/login";

export const CICLOS = [
  { id: "mes", etiqueta: "Mensual" },
  { id: "ano", etiqueta: "Anual −2 meses" },
] as const;

export type Ciclo = (typeof CICLOS)[number]["id"];

export const PLANES: Plan[] = [
  {
    id: "individual",
    nombre: "Individual",
    para: "Trabaja solo",
    mensual: "0",
    anual: "0",
    unidad: "USD · siempre gratis",
    banda: false,
    accion: "Empezar gratis",
    destino: RUTA_REGISTRO,
    incluye: [
      { texto: "Espacio de trabajo completo", clave: true },
      { texto: "Tareas, archivos y búsqueda" },
      { texto: "Control de ventas" },
      { texto: "1 conector · 90 días de historial" },
      { texto: "Sin llamadas ni DevVerse", fuera: true },
    ],
  },
  {
    id: "grupo",
    nombre: "Grupo de desarrolladores",
    para: "Hasta 4",
    mensual: "8–10",
    anual: "80–100",
    unidad: "USD · persona / mes",
    banda: true,
    accion: "Probar 14 días",
    destino: RUTA_REGISTRO,
    incluye: [
      { texto: "Todo lo del plan individual" },
      { texto: "Llamadas y DevVerse, hasta 4", clave: true },
      { texto: "Bóveda de credenciales" },
      { texto: "Entornos e integraciones guiadas" },
      { texto: "3 conectores · 1 año de historial" },
    ],
  },
  {
    id: "startups",
    nombre: "Startups y pymes",
    para: "Recomendado",
    mensual: "12–14",
    anual: "120–140",
    unidad: "USD · persona / mes",
    banda: true,
    accion: "Probar 14 días",
    destino: RUTA_REGISTRO,
    marcada: true,
    incluye: [
      { texto: "Todo lo anterior" },
      { texto: "Llamadas y DevVerse sin tope", clave: true },
      { texto: "Grabación con consentimiento" },
      { texto: "Base de datos como código" },
      { texto: "Conectores sin límite · 3 organizaciones" },
    ],
  },
  {
    id: "empresarial",
    nombre: "Empresarial",
    para: "Sin tope",
    mensual: "22–26",
    anual: "220–260",
    unidad: "USD · persona / mes",
    banda: true,
    accion: "Hablar con ventas",
    destino: "mailto:hola@devup.app?subject=Plan%20empresarial",
    incluye: [
      { texto: "Todo lo anterior, sin topes" },
      { texto: "Roles, permisos y auditoría", clave: true },
      { texto: "Inicio de sesión corporativo", clave: true },
      { texto: "Acuerdo de nivel de servicio" },
      { texto: "Soporte con persona asignada" },
    ],
  },
];

/**
 * La comparativa. Va plegada detrás de un `<details>`: quien compara de verdad
 * la abre, y quien no, no tiene que pasarla por encima.
 *
 * El salto del plan 3 al 4 NO ES PRODUCTO, ES GOBIERNO — roles, auditoría,
 * sesión corporativa y una persona al teléfono. Tal como se dictaron, los dos
 * recibían «todos los beneficios», y dos planes idénticos hacen que nadie
 * compre el caro.
 */
export const COMPARATIVA: { grupo: string; filas: [string, string, string, string, string][] }[] = [
  {
    grupo: "Tamaño",
    filas: [
      ["Personas", "1", "4", "25", "Sin tope"],
      ["Organizaciones", "1", "1", "3", "Sin tope"],
      ["Retención de historial", "90 días", "1 año", "2 años", "Sin límite"],
    ],
  },
  {
    grupo: "Espacio de trabajo",
    filas: [
      ["Canales y mensajería", "sí", "sí", "sí", "sí"],
      ["Tablero de tareas", "sí", "sí", "sí", "sí"],
      ["Biblioteca de archivos y búsqueda", "sí", "sí", "sí", "sí"],
      ["Control de ventas", "sí", "sí", "sí", "sí"],
    ],
  },
  {
    grupo: "Voz, vídeo y DevVerse",
    filas: [
      ["Llamadas de voz y vídeo", "no", "4", "Sin tope", "Sin tope"],
      ["DevVerse", "no", "4", "Sin tope", "Sin tope"],
      ["Grabación con consentimiento", "no", "no", "sí", "sí"],
    ],
  },
  {
    grupo: "Infraestructura",
    filas: [
      ["Conectores", "1", "3", "Sin tope", "Sin tope"],
      ["Bóveda de credenciales", "no", "sí", "sí", "sí"],
      ["Entornos y despliegues", "no", "sí", "sí", "sí"],
      ["Base de datos como código", "no", "no", "sí", "sí"],
      ["Servidor MCP para agentes", "no", "sí", "sí", "sí"],
    ],
  },
  {
    grupo: "Gobierno y soporte",
    filas: [
      ["Roles y permisos", "no", "no", "no", "sí"],
      ["Registro de auditoría", "no", "no", "no", "sí"],
      ["Inicio de sesión corporativo", "no", "no", "no", "sí"],
      ["Acuerdo de nivel de servicio", "no", "no", "no", "sí"],
      ["Soporte", "Comunidad", "Comunidad", "Correo", "Persona asignada"],
    ],
  },
];
