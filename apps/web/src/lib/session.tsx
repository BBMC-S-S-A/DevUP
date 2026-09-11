"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type User, api } from "./api";
import { olvidarUltimoEspacio } from "./ultimo-espacio";

type SessionState = {
  user: User | null;
  loading: boolean;
  /** Devuelve a quién encontró, para que quien acaba de entrar sepa si de
   *  verdad hay sesión antes de navegar — ver el comentario en login/page.tsx. */
  refresh: () => Promise<User | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      setUser(user);
      return user;
    } catch {
      // 401 aquí es lo normal cuando nadie ha entrado todavía: no es un error
      // que haya que enseñar, es el estado «sin sesión».
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    // A propósito, y es importante que siga así: cerrar sesión tiene que
    // funcionar aunque el servidor no conteste. Lo que pasa justo después
    // —borrar el usuario de memoria— es lo que de verdad saca a la persona de
    // la aplicación en este navegador, que suele ser lo que quiere quien cierra
    // sesión en un ordenador prestado.
    await api.post("/auth/logout").catch(() => {});
    // Y se olvida el último espacio. Sin esto, en ese mismo ordenador prestado
    // la siguiente persona que entra aterriza en el espacio de la anterior:
    // `/app` entra al espacio recordado sin validarlo a propósito, así que se
    // come una pantalla de error que no es suya. No se ve nada —eso lo impide
    // RLS— pero es la misma persona la que sobra en la ecuación.
    olvidarUltimoEspacio();
    setUser(null);
    router.push("/login");
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, signOut }),
    [user, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession fuera de SessionProvider");
  return context;
}
