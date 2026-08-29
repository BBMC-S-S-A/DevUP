import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analizarMigracion, migracionesDelArbol } from "./migraciones.js";

/**
 * Pruebas del criterio de migraciones.
 *
 * DOS MITADES, Y LAS DOS HACEN FALTA. La primera son casos escritos a mano: un
 * SQL que rompe cada regla y otro que la cumple, para comprobar que la regla
 * dice lo que cree decir. La segunda es el mejor banco de pruebas que hay a
 * mano — NUESTRAS PROPIAS MIGRACIONES: veinticuatro archivos escritos con este
 * criterio antes de que el criterio fuera código. Si el analizador les pone un
 * error, el equivocado es el analizador.
 *
 *   npm run test:migraciones
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

function reglas(sql: string): string[] {
  return analizarMigracion("prueba.sql", sql).hallazgos.map((h) => `${h.regla}:${h.severidad}`);
}

console.log("\nRegla 1 · solo se añade");

check("un drop table se caza", reglas("drop table clientes;").includes("aditiva:error"));
check("un drop column se caza", reglas("alter table t drop column c;").includes("aditiva:error"));
check("un truncate se caza", reglas("truncate clientes;").includes("aditiva:error"));
check("un rename se caza", reglas("alter table t rename to u;").includes("aditiva:error"));
check(
  "un cambio de tipo se caza",
  reglas("alter table t alter column c type integer;").includes("aditiva:error"),
);

check(
  "drop not null avisa pero no es error: aflojar no pierde datos",
  reglas("alter table t alter column c drop not null;").includes("aditiva:aviso") &&
    !reglas("alter table t alter column c drop not null;").includes("aditiva:error"),
);

// Lo que más se equivoca un analizador de texto: creerse los comentarios.
check(
  "un drop table DENTRO DE UN COMENTARIO no se caza",
  !reglas("-- ojo: nunca hagas drop table aquí\nselect 1;").includes("aditiva:error"),
);
check(
  "un drop table dentro de un comentario de bloque tampoco",
  !reglas("/* histórico:\n   antes hacíamos drop table x;\n*/\nselect 1;").includes("aditiva:error"),
);
check(
  "un drop table dentro de una cadena tampoco",
  !reglas("insert into log (accion) values ('drop table clientes');").includes("aditiva:error"),
);

// Y lo que NO debe cazar, o el criterio se vuelve inservible: borrar una
// política antes de recrearla es justamente lo que pide la regla 2.
check(
  "drop policy if exists no cuenta como destructivo",
  !reglas("drop policy if exists p on t;").includes("aditiva:error"),
);

console.log("\nRegla 2 · se puede aplicar dos veces");

check(
  "create table sin if not exists avisa",
  reglas("create table t (id int);").includes("idempotente:aviso"),
);
check(
  "create table con if not exists no avisa",
  !reglas("create table if not exists t (id int);").includes("idempotente:aviso"),
);
check(
  "add column sin if not exists avisa",
  reglas("alter table t add column c int;").includes("idempotente:aviso"),
);
check(
  "create policy sin drop previo avisa",
  reglas("create policy p on t for select using (true);").includes("idempotente:aviso"),
);
check(
  "create policy con su drop delante no avisa",
  !reglas(
    "drop policy if exists p on t;\ncreate policy p on t for select using (true);",
  ).includes("idempotente:aviso"),
);
check(
  "create type suelto avisa (no admite if not exists)",
  reglas("create type estado as enum ('a');").includes("idempotente:aviso"),
);
check(
  "create type dentro de un bloque que mira pg_type no avisa",
  !reglas(
    "do $$ begin if not exists (select 1 from pg_type where typname = 'estado') then create type estado as enum ('a'); end if; end$$;",
  ).includes("idempotente:aviso"),
);

console.log("\nRegla 3 · el aislamiento va en la misma migración");

check(
  "una tabla sin RLS es un error",
  reglas("create table if not exists public.t (id int);").includes("aislamiento:error"),
);
const sinPolitica =
  "create table if not exists public.t (id int);\nalter table public.t enable row level security;";

check("una tabla con RLS pero sin política avisa", reglas(sinPolitica).includes("aislamiento:aviso"));

// La distinción que justifica que sea aviso y no error: sin RLS la tabla se ve
// entera —falla abierto, y eso es una fuga—; con RLS y sin política no la ve
// nadie —falla cerrado—. Y a veces es deliberado: una tabla que solo escribe
// una función `security definer` se deja así a propósito.
check(
  "y no es un error, porque falla cerrado y no abierto",
  !reglas(sinPolitica).includes("aislamiento:error"),
);
check(
  "una tabla con RLS y su política está bien",
  !reglas(
    "create table if not exists public.t (id int);\n" +
      "alter table public.t enable row level security;\n" +
      "drop policy if exists t_select on public.t;\n" +
      "create policy t_select on public.t for select using (true);",
  ).includes("aislamiento:error"),
);

console.log("\nDetección de la carpeta");

check(
  "encuentra db/migrations",
  migracionesDelArbol(["README.md", "db/migrations/0001_a.sql", "db/migrations/0002_b.sql"]).length === 2,
);
check(
  "ordena por nombre",
  migracionesDelArbol(["db/migrations/0010_j.sql", "db/migrations/0002_b.sql"])[0] ===
    "db/migrations/0002_b.sql",
);
check("ignora lo que no es .sql", migracionesDelArbol(["migrations/leeme.md"]).length === 0);
check("sin carpeta conocida devuelve vacío", migracionesDelArbol(["src/index.ts"]).length === 0);

console.log("\nNuestras propias migraciones, que cumplen el criterio");

const carpeta = join(process.cwd(), "..", "..", "db", "migrations");
const propias = readdirSync(carpeta).filter((f) => f.endsWith(".sql"));

const conError: string[] = [];
for (const archivo of propias) {
  const analisis = analizarMigracion(archivo, readFileSync(join(carpeta, archivo), "utf8"));
  const errores = analisis.hallazgos.filter((h) => h.severidad === "error");
  if (errores.length > 0) {
    conError.push(`${archivo}: ${errores.map((e) => `L${e.linea} ${e.mensaje}`).join(" · ")}`);
  }
}

check(
  `las ${propias.length} migraciones de DevUP pasan sin un solo error`,
  conError.length === 0,
  conError.join("\n      "),
);

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
process.exit(fallos === 0 ? 0 : 1);
