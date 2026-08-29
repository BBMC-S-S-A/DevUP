"use client";

import { AlertTriangle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Boton } from "./Boton";
import { Dialogo } from "./Superficies";

/**
 * El diálogo de confirmación del producto.
 *
 * SUSTITUYE A OCHO `confirm()` DEL SISTEMA OPERATIVO. Las ocho acciones
 * irreversibles de DevUP —borrar un cliente, quitar a alguien de la
 * organización, desconectar una cuenta— se decidían en el cuadro gris del
 * navegador: sin el nombre del producto, sin distinguir la acción peligrosa de
 * la inocente, con los botones en el orden que decida el sistema, y bloqueando
 * el hilo entero mientras está abierto. En el peor momento posible el producto
 * dejaba de parecer el producto.
 *
 * ES UN HOOK Y NO UN COMPONENTE a propósito. La forma que sustituye es
 *
 *     if (!confirm("¿Borrar?")) return;
 *
 * y cualquier diseño con estado propio en cada pantalla —abierto, qué se está
 * borrando, qué hacer al aceptar— convierte una línea en quince, repetidas
 * ocho veces. Con una promesa, la sustitución es línea por línea:
 *
 *     if (!(await confirmar({ titulo: "¿Borrar?" }))) return;
 *
 * Que sea barato de adoptar es lo que hace que se adopte.
 */

type Peticion = {
  titulo: string;
  descripcion?: string;
  /** Lo que dice el botón que hace la cosa. Un verbo, no «Aceptar». */
  accion?: string;
  cancelar?: string;
  /** Irreversible: se tiñe de rojo y el foco arranca en Cancelar. */
  peligro?: boolean;
};

const Contexto = createContext<((peticion: Peticion) => Promise<boolean>) | null>(null);

export function ProveedorConfirmar({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState<Peticion | null>(null);
  // La promesa se resuelve desde los botones, así que su `resolve` tiene que
  // sobrevivir a los renderizados sin provocarlos: una ref, no estado.
  const resolver = useRef<((valor: boolean) => void) | null>(null);

  const confirmar = useCallback((peticion: Peticion) => {
    setAbierto(peticion);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const cerrar = useCallback((respuesta: boolean) => {
    setAbierto(null);
    resolver.current?.(respuesta);
    resolver.current = null;
  }, []);

  // Si el proveedor se desmonta con un diálogo abierto, la promesa quedaría
  // colgada para siempre y con ella el `await` de quien preguntó. Se responde
  // que no, que es la respuesta segura.
  useEffect(() => () => resolver.current?.(false), []);

  const valor = useMemo(() => confirmar, [confirmar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {abierto && <CuadroConfirmar peticion={abierto} onResponder={cerrar} />}
    </Contexto.Provider>
  );
}

export function useConfirmar(): (peticion: Peticion) => Promise<boolean> {
  const confirmar = useContext(Contexto);
  if (!confirmar) {
    throw new Error("useConfirmar necesita <ProveedorConfirmar> por encima");
  }
  return confirmar;
}

function CuadroConfirmar({
  peticion,
  onResponder,
}: {
  peticion: Peticion;
  onResponder: (respuesta: boolean) => void;
}) {
  const cancelar = useRef<HTMLButtonElement>(null);
  const aceptar = useRef<HTMLButtonElement>(null);

  // EL FOCO ARRANCA EN CANCELAR CUANDO ES PELIGROSO. Quien llega aquí con la
  // mano en el teclado suele venir de pulsar Intro, y un diálogo destructivo
  // con el foco en «Borrar» convierte esa inercia en un borrado. Cuando no es
  // destructivo, el foco va en la acción, que es lo que se viene a hacer.
  useEffect(() => {
    const objetivo = peticion.peligro ? cancelar.current : aceptar.current;
    objetivo?.focus();
  }, [peticion.peligro]);

  return (
    <Dialogo
      titulo={peticion.titulo}
      descripcion={peticion.descripcion}
      onCerrar={() => onResponder(false)}
      ancho="sm"
    >
      {peticion.peligro && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3">
          <AlertTriangle size={15} className="mt-px shrink-0 text-danger" />
          <p className="text-xs leading-relaxed text-muted">Esto no se puede deshacer.</p>
        </div>
      )}

      {/* La acción a la derecha y separada de Cancelar. Pegados, la distancia
          que recorre el ratón es la misma para las dos, y la acción que no
          tiene vuelta atrás no debería costar lo mismo que la que sí. */}
      <div className="flex justify-end gap-2">
        <Boton ref={cancelar} variante="fantasma" onClick={() => onResponder(false)}>
          {peticion.cancelar ?? "Cancelar"}
        </Boton>
        <Boton
          ref={aceptar}
          variante={peticion.peligro ? "peligro" : "primario"}
          onClick={() => onResponder(true)}
        >
          {peticion.accion ?? "Aceptar"}
        </Boton>
      </div>
    </Dialogo>
  );
}
