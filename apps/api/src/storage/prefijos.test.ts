/**
 * Qué prefijos del almacén se pueden borrar de golpe.
 *
 * ES LA ÚNICA LÍNEA ENTRE «BORRAR UN ESPACIO» Y «BORRAR EL BUCKET». Un prefijo
 * vacío en `ListObjectsV2` lista todo, y lo que se lista se borra. Nada más en
 * la cadena lo impediría, así que aquí se prueban sobre todo los rechazos.
 *
 * Sin base, sin almacén y sin configuración: es una expresión regular.
 *
 *   npm run test:prefijos --workspace apps/api
 */
import { prefijoBorrable, prefijoDeEspacio, prefijoDeOrganizacion } from "./prefijos.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}`);
  }
}

const ORG = "f2719672-88cf-4c62-af8d-ed93299296fe";
const ESPACIO = "11111111-2222-3333-4444-555555555555";

console.log("\nLo que sí se puede borrar");
check("todo lo de una organización", prefijoBorrable(`${ORG}/`));
check("todo lo de un espacio", prefijoBorrable(`${ORG}/${ESPACIO}/`));
check("los que construye el propio módulo, de organización", prefijoBorrable(prefijoDeOrganizacion(ORG)));
check("y de espacio", prefijoBorrable(prefijoDeEspacio(ORG, ESPACIO)));
check(
  "un uuid en mayúsculas se normaliza al construirlo, que es como lo escribe Postgres",
  prefijoDeOrganizacion(ORG.toUpperCase()) === `${ORG}/`,
);

console.log("\nLo que borraría demasiado");
check("vacío es el bucket entero", !prefijoBorrable(""));
check("una barra sola", !prefijoBorrable("/"));
check("las fotos de las personas no son de ninguna organización", !prefijoBorrable("users/"));
check("ni las de una persona concreta", !prefijoBorrable(`users/${ORG}/`));
check("un uuid sin la barra final casaría con más claves", !prefijoBorrable(ORG));
check("un uuid a medias", !prefijoBorrable(`${ORG.slice(0, 8)}/`));
check("un comodín no es un prefijo", !prefijoBorrable("*/"));

console.log("\nLo que no es un prefijo nuestro");
check("una travesía", !prefijoBorrable(`${ORG}/../`));
check("tres niveles, que ya apunta a un archivo", !prefijoBorrable(`${ORG}/${ESPACIO}/${ORG}/`));
check("la carpeta de activos sola no es un espacio", !prefijoBorrable(`${ORG}/org-assets/`));
check("un salto de línea escondido", !prefijoBorrable(`${ORG}/\n`));
check("un espacio delante", !prefijoBorrable(` ${ORG}/`));

console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
if (fallos.length > 0) {
  console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
