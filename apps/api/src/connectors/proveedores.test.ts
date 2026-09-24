/**
 * Dónde viven los identificadores de Railway de un entorno.
 *
 * QUÉ FALLO FIJA ESTO. Había dos formas de guardarlos y cada lector esperaba
 * una: desplegar los buscaba en la raíz de `provider_config`, la base de datos
 * dentro de `provider_config.railway`. Y desplegar mandaba el objeto ENTERO a
 * Railway como entrada de GraphQL —`migracion` incluida—, que Railway rechaza
 * por llevar un campo que su tipo no declara. O sea: configurar la migración
 * de un entorno rompía su botón de desplegar.
 *
 *   npm run test:proveedores --workspace apps/api
 */
import { configRailwayDe } from "./proveedores.js";

let total = 0;
let fallos = 0;
function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

const IDS = { projectId: "p", environmentId: "e", serviceId: "s" };
const soloIds = (c: unknown) =>
  JSON.stringify(c) === JSON.stringify({ projectId: "p", environmentId: "e", serviceId: "s" });

console.log("\nLas dos formas valen");
check("en la raíz, como lo guarda desplegar", soloIds(configRailwayDe(IDS)));
check("dentro de «railway», como lo guarda la base de datos", soloIds(configRailwayDe({ railway: IDS })));
check(
  "si están las dos, gana la de dentro, que es la explícita",
  configRailwayDe({ ...IDS, projectId: "raiz", railway: IDS })?.projectId === "p",
);

console.log("\nA Railway solo le llegan los tres campos que su tipo declara");
const conMigracion = configRailwayDe({ ...IDS, migracion: { repo: "acme/web", workflow: "migrar.yml" } });
check("la migración no viaja en la entrada de GraphQL", soloIds(conMigracion));
check("ni nada que alguien haya pegado de más", soloIds(configRailwayDe({ ...IDS, notas: "x", token: "y" })));

console.log("\nLo que no es una configuración de Railway");
check("vacío", configRailwayDe({}) === null);
check("nulo", configRailwayDe(null) === null);
check("un texto", configRailwayDe("projectId") === null);
check("le falta uno", configRailwayDe({ projectId: "p", environmentId: "e" }) === null);
check("uno que no es texto", configRailwayDe({ ...IDS, serviceId: 3 }) === null);
check("«railway» a medias no se rellena con la raíz", configRailwayDe({ railway: { projectId: "p" } }) === null);

console.log(`\n${total - fallos} de ${total} comprobaciones\n`);
process.exit(fallos > 0 ? 1 : 0);
