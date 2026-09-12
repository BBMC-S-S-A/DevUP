"use client";

import { useAvisosDelEspacio } from "../workspace-feed";

/**
 * Avisos de cambios en la biblioteca del workspace.
 *
 * Sustituye a la suscripción de Realtime sobre la tabla `files`. La mecánica
 * —el socket del espacio y su reintento— vive en `useAvisosDelEspacio`, que la
 * comparte con el tablero: ver allí por qué es una sola y no dos.
 */
export function useFileFeed(workspaceId: string, onChange: () => void): void {
  useAvisosDelEspacio(workspaceId, "file-change", onChange);
}
