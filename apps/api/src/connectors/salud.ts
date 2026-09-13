/**
 * Comprobar si una conexión responde de verdad, no solo si existe.
 *
 * UNA LLAMADA BARATA POR PROVEEDOR. No se reutiliza ninguna operación de
 * negocio (listar repos, listar tablas) porque cada una compromete a hacer
 * más de lo necesario para solo preguntar «¿sigues ahí?». Se busca el
 * endpoint más barato de cada proveedor que exija la credencial de verdad —
 * `/user` en GitHub, `{ me }` en Railway, un `select 1` en Postgres.
 *
 * SOLO LOS CUATRO PROVEEDORES DE WORKSPACE. `spotify`, `anthropic` y `gemini`
 * son conexiones personales (por `user_id`, no `workspace_id`) y no aparecen
 * nunca en `GET /workspaces/:id/connections` — no hace falta un caso para
 * ellos aquí.
 */
import pg from "pg";
import { opcionesTls } from "../db/conexion.js";
import { railwayGraphql } from "./proveedores.js";

export type ResultadoSalud = { ok: boolean; detalle: string };

async function verificarGithub(token: string): Promise<ResultadoSalud> {
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "user-agent": "DevUP" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { ok: false, detalle: `GitHub respondió ${response.status}` };
  const body = (await response.json()) as { login: string };
  return { ok: true, detalle: `conectado como ${body.login}` };
}

async function verificarRailway(token: string): Promise<ResultadoSalud> {
  const data = await railwayGraphql<{ me: { email: string | null } | null }>(
    token,
    `query { me { email } }`,
    {},
  );
  return { ok: true, detalle: data.me?.email ?? "conectado" };
}

async function verificarPostgres(connectionString: string): Promise<ResultadoSalud> {
  const client = new pg.Client({
    connectionString,
    ssl: opcionesTls(connectionString),
    connectionTimeoutMillis: 8_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true, detalle: "responde" };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function verificarConexion(provider: string, secret: string): Promise<ResultadoSalud> {
  try {
    if (provider === "github") return await verificarGithub(secret);
    if (provider === "railway") return await verificarRailway(secret);
    if (provider === "postgres") return await verificarPostgres(secret);
    if (provider === "aws") {
      // Simulacro (0063): no hay cuenta real detrás, así que no hay nada que
      // comprobar de verdad — decirlo así en vez de fingir un chequeo.
      await new Promise((resuelve) => setTimeout(resuelve, 300));
      return { ok: true, detalle: "simulacro: no hay cuenta real detrás" };
    }
    return { ok: false, detalle: "no hay una comprobación para este proveedor" };
  } catch (error) {
    return { ok: false, detalle: error instanceof Error ? error.message : "no se pudo comprobar" };
  }
}
