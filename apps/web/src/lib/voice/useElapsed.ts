"use client";

import { useEffect, useState } from "react";

/** Duración de la llamada, contada desde que se abrió la sesión en el servidor. */
export function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;

  // Quien entra a los diez minutos ve diez minutos, no cero: es la duración de
  // la llamada, no la suya.
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
