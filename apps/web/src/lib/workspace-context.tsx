"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "next/navigation";
import type { Workspace } from "./api";

/**
 * A qué organización pertenece la pantalla actual, venga por donde venga.
 *
 * POR QUÉ EXISTE. Ventas, GitHub, Noticias, Infraestructura, Base de datos,
 * Integraciones y Ajustes vivían solo bajo `/app/o/[orgId]/...`, con `orgId`
 * en la propia URL. Para que esas mismas pantallas se pudieran abrir también
 * desde dentro de un workspace —`/app/w/[workspaceId]/ventas`, sin cambiar de
 * barra lateral— hacía falta una segunda forma de saber la organización, esta
 * vez sin tenerla en la URL.
 *
 * `WorkspaceLayout` ya pide el workspace entero para pintar su propia barra
 * -incluido `organizationId`- así que lo lógico es que lo comparta con lo que
 * hay debajo en vez de que cada pantalla lo vuelva a pedir. Cuando no hay
 * workspace de por medio (rutas `/app/o/[orgId]/...`), el contexto no está
 * presente y `useOrgId` cae directo al parámetro de la URL.
 */
const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

/**
 * La organización de la pantalla actual.
 *
 * Sincrónico a propósito, sin estado de carga: bajo `/app/o/[orgId]/...` el id
 * ya está en la URL, y bajo `/app/w/[workspaceId]/...` el layout no llega a
 * pintar `children` hasta tener el workspace cargado (ver el `if (loading)` de
 * `WorkspaceLayout`) — así que en los dos casos, para cuando una pantalla hija
 * llama a esto, la respuesta ya existe.
 */
export function useOrgId(): string {
  const params = useParams<{ orgId?: string }>();
  const workspace = useContext(WorkspaceContext);
  const orgId = params.orgId ?? workspace?.organizationId;
  if (!orgId) {
    throw new Error("useOrgId: ni la ruta trae orgId ni hay un WorkspaceProvider por encima");
  }
  return orgId;
}

/**
 * El workspace de la pantalla actual.
 *
 * GitHub, Base de datos, Infraestructura y Arquitectura preguntan por esto y
 * no por la organización (migración 0035): cada proyecto tiene su git, su base
 * y su infraestructura, y antes los tres workspaces de una empresa veían lo
 * mismo porque la pantalla resolvía la organización aunque la URL dijera
 * `/app/w/…`.
 *
 * Falla en vez de caer a la organización a propósito. Caer sería reproducir
 * exactamente el fallo que esto viene a arreglar, y además en silencio.
 */
/**
 * El workspace actual, o `null` si esta pantalla no está dentro de ninguno.
 *
 * La versión que no falla, para quien pregunta desde un sitio que se pinta en
 * los dos armazones — la campana de notificaciones, por ejemplo, que vive en
 * la barra de arriba y necesita saber si hay workspace para decidir a dónde
 * lleva un enlace, no para exigir que lo haya.
 *
 * `useWorkspaceId` sigue fallando, y debe seguir haciéndolo: son dos preguntas
 * distintas. «Estoy en un workspace, ¿cuál?» es un error si no lo estás; «¿hay
 * workspace?» es una pregunta legítima con dos respuestas válidas.
 */
export function useWorkspaceIdOpcional(): string | null {
  const params = useParams<{ workspaceId?: string }>();
  const workspace = useContext(WorkspaceContext);
  return params.workspaceId ?? workspace?.id ?? null;
}

export function useWorkspaceId(): string {
  const params = useParams<{ workspaceId?: string }>();
  const workspace = useContext(WorkspaceContext);
  const workspaceId = params.workspaceId ?? workspace?.id;
  if (!workspaceId) {
    throw new Error(
      "useWorkspaceId: esta pantalla es de un workspace y se abrió fuera de uno. " +
        "Debe vivir bajo /app/w/[workspaceId]/…",
    );
  }
  return workspaceId;
}
