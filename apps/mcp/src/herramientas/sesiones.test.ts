import type { ClienteApi } from "../api.js";
import { registrarSesion, verSesiones } from "./sesiones.js";

/**
 * Sesiones por el MCP: lo que se manda al registrar y lo que se enseña al
 * recoger el contexto.
 *
 * LAS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · Registrar tiene que ir marcado como AGENTE. Sin eso, un resumen que
 *     escribió Claude aparece como escrito a mano por la persona.
 *   · Una sesión de OTRO espacio no se cuela solo porque RLS la deje leer:
 *     quien preguntó por este espacio no debe recibirla sin enterarse.
 *   · Sin sesiones, hay que decir cómo se crean, no devolver un vacío mudo.
 *
 *   npm run test:mcp
 */

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const ORG = { id: "org-1", name: "Hytrex", slug: "hytrex" };
const WS = { id: "ws-1", name: "Lazaro" };
const ID_PROPIA = "11111111-1111-4111-8111-111111111111";
const ID_AJENA = "22222222-2222-4222-8222-222222222222";

const SESION = {
  id: ID_PROPIA,
  espacioId: WS.id,
  titulo: "Módulo 8 v2",
  resumen: "Se unificaron las cuatro propuestas.",
  decisiones: [".NET 10, porque el Edge ya lo usa"],
  pendientes: ["Subir los PDFs"],
  prs: [{ repo: "BBMC-S-S-A/DevUP", numero: 98, estado: "abierto" }],
  archivos: ["Lazaro_Plan_Tecnico_M8_Soporte_v2.pdf"],
  procedencia: "agente" as const,
  inicio: "2026-09-24T09:00:00.000Z",
  fin: "2026-09-24T12:00:00.000Z",
  autorNombre: "Juan Medina",
};

function clienteCon(sesiones: unknown[]): { cliente: ClienteApi; enviados: unknown[] } {
  const enviados: unknown[] = [];
  const cliente: ClienteApi = {
    apiUrl: "http://127.0.0.1:4000",
    get: (async (ruta: string) => {
      if (ruta === "/organizations") return { organizations: [ORG] };
      if (ruta === `/organizations/${ORG.id}/workspaces`) return { workspaces: [WS] };
      if (ruta.startsWith(`/workspaces/${WS.id}/sesiones`)) return { sesiones };
      if (ruta === `/sesiones/${ID_PROPIA}`) {
        return {
          sesion: {
            ...SESION,
            hechos: [{ verbo: "movio", sujeto: "tarea", sujetoNombre: "Plan M8", cuando: "2026-09-24T10:00:00Z" }],
            archivosSubidos: [{ nombre: "Lazaro_Modulo8_Soporte_Agentizado_v2.pdf", cuando: "2026-09-24T11:00:00Z" }],
          },
        };
      }
      if (ruta === `/sesiones/${ID_AJENA}`) {
        return { sesion: { ...SESION, id: ID_AJENA, espacioId: "ws-otro", hechos: [], archivosSubidos: [] } };
      }
      throw new Error(`ruta GET no prevista en la prueba: ${ruta}`);
    }) as ClienteApi["get"],
    post: (async (ruta: string, cuerpo: unknown) => {
      enviados.push(cuerpo);
      if (ruta === `/workspaces/${WS.id}/sesiones`) return { sesion: { ...SESION, ...(cuerpo as object) } };
      throw new Error(`ruta POST no prevista en la prueba: ${ruta}`);
    }) as ClienteApi["post"],
    patch: (async () => ({})) as ClienteApi["patch"],
    delete: (async () => undefined) as ClienteApi["delete"],
  };
  return { cliente, enviados };
}

async function main(): Promise<void> {
  console.log("\nregistrar_sesion");

  const { cliente: c1, enviados } = clienteCon([]);
  const r1 = await registrarSesion(c1, {
    titulo: "Módulo 8 v2",
    decisiones: [".NET 10, porque el Edge ya lo usa"],
    prs: [{ repo: "BBMC-S-S-A/DevUP", numero: 98 }],
    inicio: "2026-09-24T09:00-05:00",
  });
  const cuerpo = enviados[0] as { procedencia: string; pendientes: unknown[] };
  check("va marcada como de agente", cuerpo.procedencia === "agente");
  check("lo que no se dio va como lista vacía, no ausente", Array.isArray(cuerpo.pendientes));
  check("confirma con el título y el identificador", r1.includes("Módulo 8 v2") && r1.includes(ID_PROPIA), r1);
  check("dice cuántas decisiones y PRs guardó", r1.includes("1 decisión(es)") && r1.includes("1 PR(s)"), r1);

  console.log("\nver_sesiones: las últimas");

  const { cliente: c2 } = clienteCon([SESION]);
  const r2 = await verSesiones(c2, {});
  check("trae el título y el resumen", r2.includes("## Módulo 8 v2") && r2.includes("Se unificaron"), r2);
  check("las decisiones con su porqué", r2.includes("porque el Edge ya lo usa"));
  check("el PR con repo y número", r2.includes("BBMC-S-S-A/DevUP#98"));
  check("dice que la escribió un agente", r2.includes("por agente"));

  const { cliente: c3 } = clienteCon([]);
  const r3 = await verSesiones(c3, {});
  check("sin sesiones, dice cómo se crean", r3.includes("registrar_sesion"));

  console.log("\nver_sesiones: una entera");

  const r4 = await verSesiones(c2, { sesion: ID_PROPIA });
  check("junta lo que hizo en DevUP", r4.includes("movio tarea «Plan M8»"), r4);
  check("y lo que subió a la biblioteca", r4.includes("Lazaro_Modulo8_Soporte_Agentizado_v2.pdf"));

  const r5 = await verSesiones(c2, { sesion: ID_AJENA });
  check("una de otro espacio no se cuela", r5.includes("no es de Lazaro") && !r5.includes("## "), r5);

  const r6 = await verSesiones(c2, { sesion: "no-es-un-id" });
  check("un identificador inválido se explica sin llamar a la API", r6.includes("no es válido"));

  console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
  if (fallos > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
