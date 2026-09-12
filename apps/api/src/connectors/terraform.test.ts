import { leerTerraform, recursosDe, terraformDelArbol, tipoDeRecurso } from "./terraform.js";

/**
 * Pruebas del lector de Terraform.
 *
 * LO QUE MÁS IMPORTA AQUÍ ES LO QUE **NO** DEBE LEER. Un analizador de texto
 * que se cree listo es peor que no tenerlo: un comentario que menciona un
 * recurso no es una dependencia, y un script de arranque dentro de un heredoc
 * lleva llaves que descuadran el conteo de bloques y harían que el resto del
 * archivo desapareciera sin que nada se quejara.
 *
 *   npm run test:terraform
 */

let fallos = 0;
let total = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total++;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const uno = (tf: string) => leerTerraform([{ ruta: "main.tf", contenido: tf }]);

console.log("\nDe qué tipo es cada recurso");

check("una base de datos de AWS", tipoDeRecurso("aws_db_instance") === "base_datos");
check("y la de Google, que se llama distinto", tipoDeRecurso("google_sql_database_instance") === "base_datos");
check("y la de Azure", tipoDeRecurso("azurerm_postgresql_server") === "base_datos");
check("una cola", tipoDeRecurso("aws_sqs_queue") === "cola");
check("un bucket es almacenamiento", tipoDeRecurso("aws_s3_bucket") === "almacenamiento");
check("una función es un servicio", tipoDeRecurso("aws_lambda_function") === "servicio");
// El orden de las reglas importa: «elasticache» contiene «cache» y también
// podría sonar a base de datos. Gana la caché.
check("elasticache es caché, no base de datos", tipoDeRecurso("aws_elasticache_cluster") === "cache");
check("lo que no se reconoce cae en «otro», que no es un fallo", tipoDeRecurso("aws_iam_role") === "otro");

console.log("\nLeer recursos y sus dependencias");

{
  const { componentes, conexiones } = uno(`
    resource "aws_lambda_function" "api" {
      role = aws_iam_role.ejecucion.arn
      environment {
        variables = {
          DB = aws_db_instance.principal.address
        }
      }
    }
    resource "aws_db_instance" "principal" {
      engine = "postgres"
    }
    resource "aws_iam_role" "ejecucion" {}
  `);
  check("encuentra los tres recursos", componentes.length === 3);
  check(
    "y les pone el tipo que toca",
    componentes.find((c) => c.nombre === "principal")?.tipo === "base_datos" &&
      componentes.find((c) => c.nombre === "api")?.tipo === "servicio",
  );
  // La flecha va de quien nombra a quien es nombrado: el que depende, primero.
  check(
    "la flecha va del servicio a la base de datos",
    conexiones.some((c) => c.de === "api" && c.a === "principal"),
  );
  check(
    "y encuentra la dependencia anidada dentro de un bloque",
    conexiones.some((c) => c.de === "api" && c.a === "ejecucion"),
  );
  check("la base de datos no depende de nadie", !conexiones.some((c) => c.de === "principal"));
}

console.log("\nLo que NO debe leer, que es lo que importa");

{
  const { conexiones } = uno(`
    resource "aws_lambda_function" "api" {
      # ojo: algún día esto usará aws_db_instance.principal
    }
    resource "aws_db_instance" "principal" {}
  `);
  check("un recurso citado en un comentario no es una dependencia", conexiones.length === 0);
}

{
  const { conexiones } = uno(`
    resource "aws_lambda_function" "api" {
      // tampoco con comentario de dos barras: aws_db_instance.principal
      /* ni en bloque: aws_db_instance.principal */
    }
    resource "aws_db_instance" "principal" {}
  `);
  check("ni con las otras dos formas de comentar", conexiones.length === 0);
}

{
  // El caso que rompe un contador de llaves ingenuo: el script lleva `{` y `}`
  // dentro. Si el heredoc no se salta, el bloque «se cierra» donde no debe y
  // el resto del archivo se lee mal.
  const { componentes, conexiones } = uno(`
    resource "aws_instance" "web" {
      user_data = <<-EOF
        #!/bin/bash
        if [ -f x ]; then { echo "{"; } fi
        echo "aws_db_instance.principal"
      EOF
      subnet_id = aws_subnet.publica.id
    }
    resource "aws_subnet" "publica" {}
    resource "aws_db_instance" "principal" {}
  `);
  check("un heredoc con llaves dentro no descuadra el bloque", componentes.length === 3);
  check(
    "lo citado dentro del heredoc no cuenta como dependencia",
    !conexiones.some((c) => c.a === "principal"),
  );
  check(
    "y lo de después del heredoc sí se sigue leyendo",
    conexiones.some((c) => c.de === "web" && c.a === "publica"),
  );
}

{
  const { componentes } = uno(`
    data "aws_ami" "ubuntu" {}
    variable "entorno" {}
    output "url" {}
    module "red" { source = "./red" }
    resource "aws_s3_bucket" "estatico" {}
  `);
  check(
    "data, variable, output y module no son cajas del diagrama",
    componentes.length === 1 && componentes[0]!.nombre === "estatico",
  );
}

console.log("\nDetalles que se ven con datos de verdad");

{
  // Dos recursos distintos pueden llamarse igual. Sin desambiguar serían una
  // sola caja, y las flechas de uno acabarían en el otro.
  const { componentes } = uno(`
    resource "aws_s3_bucket" "principal" {}
    resource "aws_db_instance" "principal" {}
  `);
  check(
    "dos recursos con el mismo nombre no se funden en uno",
    componentes.length === 2 &&
      componentes.every((c) => c.nombre.includes(".")) &&
      new Set(componentes.map((c) => c.nombre)).size === 2,
  );
}

{
  const { conexiones } = uno(`
    resource "aws_lambda_function" "api" {
      a = aws_db_instance.principal.address
      b = aws_db_instance.principal.arn
      c = aws_db_instance.principal.id
    }
    resource "aws_db_instance" "principal" {}
  `);
  check("citar tres veces al mismo no dibuja tres flechas", conexiones.length === 1);
}

{
  const { componentes, conexiones } = leerTerraform([
    { ruta: "infra/red.tf", contenido: `resource "aws_subnet" "publica" {}` },
    {
      ruta: "infra/app.tf",
      contenido: `resource "aws_instance" "web" { subnet_id = aws_subnet.publica.id }`,
    },
  ]);
  check(
    "una dependencia entre dos archivos distintos se ve igual",
    componentes.length === 2 && conexiones.some((c) => c.de === "web" && c.a === "publica"),
  );
}

{
  const { componentes } = uno(`resource "aws_s3_bucket" "estatico" {}`);
  check(
    "la descripción dice el recurso de Terraform del que salió",
    componentes[0]!.descripcion === "aws_s3_bucket",
  );
}

console.log("\nEncontrar los archivos en el árbol");

check(
  "coge los .tf estén donde estén",
  terraformDelArbol(["README.md", "infra/main.tf", "terraform/red.tf"]).length === 2,
);
check("y nada más", terraformDelArbol(["main.tfvars", "x.tfstate", "notas.txt"]).length === 0);
check("un repositorio sin Terraform devuelve vacío", terraformDelArbol(["src/index.ts"]).length === 0);

console.log("\nUn archivo que no es Terraform no revienta");
check("texto cualquiera da cero recursos", recursosDe("esto no es terraform { { {").length === 0);
check("archivo vacío tampoco", recursosDe("").length === 0);

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
