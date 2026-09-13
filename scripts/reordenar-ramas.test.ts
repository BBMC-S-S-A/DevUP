/**
 * El clasificador de ramas, contra los títulos REALES del tablero.
 *
 * POR QUÉ ESTO MERECE UNA PRUEBA. El guion va a mover sesenta y una tarjetas de
 * verdad, y se equivoca sin hacer ruido: una tarea mal clasificada no falla, se
 * queda en la rama de otro y ahí la busca quien no la puso. Lo que hace peligroso
 * a un clasificador no es acertar poco — es acertar bastante, porque entonces
 * nadie revisa el resto.
 *
 * LOS TÍTULOS DE ABAJO NO SON INVENTADOS: están copiados del tablero
 * `Hytrex / devup` tal y como estaban el 13 de septiembre de 2026. Probar un
 * clasificador contra ejemplos que uno mismo se inventa es probar que uno se
 * entiende a sí mismo.
 *
 * Y SE COMPRUEBA TAMBIÉN LO QUE **NO** DEBE CLASIFICAR. Que `Decidir ·` caiga a
 * «no sé» es tan importante como que `Flujo ·` caiga en Workflow: son decisiones
 * de producto de las tres ramas, y repartirlas a ojo es justo el daño que esta
 * lista de comprobaciones existe para evitar.
 *
 *   npx tsx scripts/reordenar-ramas.test.ts
 */
import { ramaDe } from "./reordenar-ramas.js";

let total = 0;
const fallos: string[] = [];

function check(titulo: string, esperado: string | null): void {
  total += 1;
  const salio = ramaDe(titulo)?.nombre ?? null;
  if (salio === esperado) {
    console.log(`  ✓ ${esperado ?? "sin clasificar"}  ←  ${titulo.slice(0, 62)}`);
  } else {
    fallos.push(`${titulo}\n      esperaba ${esperado ?? "sin clasificar"}, salió ${salio ?? "sin clasificar"}`);
    console.log(`  ✗ ${titulo.slice(0, 62)}  →  ${salio ?? "sin clasificar"} (esperaba ${esperado ?? "sin clasificar"})`);
  }
}

console.log("\nPor prefijo, que es lo que alguien escribió a mano");

check("Flujo · /recuperar no valida el enlace al abrirlo", "Workflow");
check("Flujo · Un fallo en una sola organización tira la pantalla /app entera", "Workflow");
check("Flujo · Las rutas de enlaces del grafo: nadie escribe todavía en graph_links", "Workflow");
check("Base · Reuniones con hora: la tabla que hoy no existe", "Funcionalidades");
check("Base · Terminar el código corto: faltan las dos funciones que lo canjean", "Funcionalidades");
check("Infra · El almacén de archivos no tiene respaldo", "Funcionalidades");
check("DevVerse · Crear el canal agente-ia y ver la sala pintada", "DevVerse");
check("DevVerse · Ver quién hay en una sala de voz SIN entrar en ella", "DevVerse");

// LA QUE MÁS IMPORTA DEL MAPA. «Flujo · las rutas del grafo» lleva las palabras
// «grafo» y «rutas», que son de Funcionalidades — pero el prefijo dice Flujo, y
// el prefijo gana. Si las palabras mandaran, esa tarjeta se iría a otra rama sin
// que nada fallara.
console.log("\nEl prefijo gana a las palabras");
check("Flujo · Tejer los enlaces solos, desde donde ya pasan las cosas", "Workflow");
check("Base · «¿Qué ha pasado aquí desde…?» — la herramienta del trabajo en remoto", "Funcionalidades");

// Lo visual es interfaz, y la interfaz es de Workflow. Que hoy estén asignadas a
// otra persona no cambia de qué rama son: son dos cosas distintas.
console.log("\nLo visual es interfaz");
check("Visual · El tablero no se arrastra: mover una tarjeta se hace por menú", "Workflow");
check("Visual · El embudo y el tablero están pensados para un monitor", "Workflow");
check("Visual · El acento se usa demasiado (lo de «una superficie por nivel» era falso)", "Workflow");

console.log("\nSin prefijo: ahí sí se adivina, y con cuidado");

check("Realizar animación central de edificio con devvers + agregar botón de regresar", "DevVerse");
check("Mejora del modelo", "DevVerse");
check("Cambio de  la barra de temas", "Workflow");
check("Rework barra de tareas,", "Workflow");
check("Arreglo visual del panel de notificaciones", "Workflow");
check("Update and delete organizaciones", null);
check("Delete border", null);

console.log("\nLo que NO se clasifica, y está bien que no");

// Decisiones de producto: las hay de las tres ramas. Repartirlas a ojo es el
// daño que esta prueba existe para evitar.
check("Decidir · La carpeta lienzo/ sigue ahí: se retoma o se borra", null);
check("Decidir · Dos modelos de «categoría» conviven: tags y task_categories", null);

/**
 * Y esta va a Workflow, que es una decisión y no un accidente: un menú es
 * interfaz, y la regla dice que la interfaz es de Workflow — aunque el menú sea
 * el del DevVerse y hoy la lleve Carlos. Se deja escrita aquí porque es de las
 * pocas del tablero que se pueden discutir, y conviene que se discuta mirando
 * esta línea y no adivinando qué hizo el guion.
 */
check("Mejora visual menu devvers y en vista profesional", "Workflow");

console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
if (fallos.length > 0) {
  console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
