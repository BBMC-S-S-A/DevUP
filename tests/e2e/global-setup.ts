import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { request } from "@playwright/test";
import { API, CLAVE, SEMILLA, estadoSemilla } from "./ayudantes";

/**
 * Prepara la cuenta sembradora.
 *
 * Hace falta porque la instancia solo admite altas por invitación: **únicamente
 * la primera cuenta puede crearse sin invitación**. Sin esto, la primera prueba
 * pasaba y todas las demás fallaban al intentar registrarse — que es
 * exactamente el comportamiento correcto del producto, mal entendido por la
 * suite.
 *
 * A partir de aquí, cada prueba que necesita una cuenta nueva pasa por una
 * invitación de verdad, como haría una persona. Sale más lento y prueba lo que
 * de verdad ocurre.
 */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({
    baseURL: API,
    // Su propia dirección, como cada contexto de la suite: ver `direccionUnica`.
    extraHTTPHeaders: { "X-Forwarded-For": "10.255.255.1" },
  });

  const politica = (await (await api.get("/auth/signup-policy")).json()) as {
    mode: string;
    bootstrap: boolean;
  };

  if (politica.bootstrap) {
    const alta = await api.post("/auth/register", {
      data: { email: SEMILLA.email, password: CLAVE, displayName: SEMILLA.nombre },
    });
    if (!alta.ok()) {
      throw new Error(`no se pudo crear la cuenta sembradora: ${alta.status()}`);
    }
  } else {
    const acceso = await api.post("/auth/login", {
      data: { email: SEMILLA.email, password: CLAVE },
      failOnStatusCode: false,
    });
    if (!acceso.ok()) {
      throw new Error(
        `La instancia ya tiene cuentas pero ${SEMILLA.email} no existe o cambió su ` +
          "contraseña. Vacía la base de datos de pruebas y vuelve a lanzarlas, o " +
          "usa una instancia limpia.",
      );
    }
  }

  // Una organización de la que colgar las invitaciones. Quien entra por ella
  // queda como miembro y después crea las suyas.
  const organizaciones = (await (await api.get("/organizations")).json()) as {
    organizations: { id: string; slug: string }[];
  };

  let semillero = organizaciones.organizations.find((o) => o.slug === SEMILLA.slug)?.id;
  if (!semillero) {
    const creada = await api.post("/organizations", {
      data: { name: "Semillero", slug: SEMILLA.slug },
    });
    if (!creada.ok()) throw new Error(`no se pudo crear el semillero: ${creada.status()}`);
    semillero = ((await creada.json()) as { organization: { id: string } }).organization.id;
  }

  const estado = await api.storageState();
  await mkdir(dirname(estadoSemilla), { recursive: true });
  await writeFile(estadoSemilla, JSON.stringify({ ...estado, semillero }, null, 2));

  await api.dispose();
}
