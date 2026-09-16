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

/**
 * Lo que sabe hacer ESTA instalación, tal y como lo cuenta `/auth/me`.
 *
 * No es un permiso de la persona: es si el servidor sirve esa parte. Los
 * repositorios alojados vienen apagados —su contenido vive en disco y hace
 * falta un volumen de verdad, ver `env.ts` en la API— y donde están apagados
 * la entrada del menú no debe aparecer, porque llevaría a un 404.
 */
export type Capacidades = { reposAlojados: boolean };

/** Apagado mientras no conste lo contrario: un menú que falta se nota y se
 *  arregla; uno que aparece y no lleva a ninguna parte parece una avería. */
const NINGUNA: Capacidades = { reposAlojados: false };

type SessionState = {
  user: User | null;
  capacidades: Capacidades;
  loading: boolean;
  /** Devuelve a quién encontró, para que quien acaba de entrar sepa si de
   *  verdad hay sesión antes de navegar — ver el comentario en login/page.tsx. */
  refresh: () => Promise<User | null>;
  /**
   * Cierra la sesión y lleva a `destino`, o a /login si no se dice otro.
   *
   * El parámetro existe por la pantalla de invitación: quien abre un enlace
   * dirigido a otro correo tiene que cerrar sesión **y volver a este mismo
   * enlace**, y mandarle a /login le hace buscar otra vez el correo. Es el
   * único caso donde salir no significa «me voy».
   */
  signOut: (destino?: string) => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capacidades, setCapacidades] = useState<Capacidades>(NINGUNA);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const { user, capacidades } = await api.get<{
        user: User;
        capacidades?: Capacidades;
      }>("/auth/me");
      setUser(user);
      // Opcional a propósito: durante un despliegue conviven la API de antes y
      // la web de ahora, y una respuesta sin `capacidades` no puede dejar la
      // barra a medias.
      setCapacidades(capacidades ?? NINGUNA);
      return user;
    } catch {
      // 401 aquí es lo normal cuando nadie ha entrado todavía: no es un error
      // que haya que enseñar, es el estado «sin sesión».
      setUser(null);
      setCapacidades(NINGUNA);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async (destino?: string) => {
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
    setCapacidades(NINGUNA);
    router.push(destino ?? "/login");
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, capacidades, loading, refresh, signOut }),
    [user, capacidades, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession fuera de SessionProvider");
  return context;
}
