"use client";

import { AlertTriangle, Check, Database, Mail, Minus, Phone, Server, Shield } from "lucide-react";
import { Cargando, Fallo } from "@/components/ui/Pagina";
import { Chip, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { type Gravedad, type Salud, cuantasPidenAlgo, filasDe } from "@/lib/salud";
import { useRecurso } from "@/lib/datos";

/**
 * El estado de esta instalación.
 *
 * QUÉ PROBLEMA RESUELVE. Saber si el despliegue está al día, si el almacén
 * responde o si el correo sale de verdad exige hoy entrar por SSH. Así que no
 * se mira — y lo que no se mira se descubre el día que alguien intenta subir un
 * archivo, o cuando un correo de invitación no llega y nadie sabe por qué.
 *
 * LAS REGLAS NO ESTÁN AQUÍ, sino en `lib/salud.ts`. Decidir que «sin TURN» es
 * un aviso y «sin Spotify» no lo es es lo único de esta pantalla que se puede
 * equivocar de verdad, y dentro de un componente no se puede comprobar sin
 * montar un navegador. Aquí solo queda pintar, que es lo que no falla.
 */

/** El icono por fila. Aquí y no en la regla: un icono no decide nada. */
const ICONOS: Record<string, typeof Server> = {
  "Bóveda de credenciales": Shield,
  "Almacén de archivos": Database,
  "Correo saliente": Mail,
  "TURN para las llamadas": Phone,
};

const TONO: Record<Gravedad, string> = {
  mal: "text-danger",
  atencion: "text-warn",
  bien: "text-live",
  apagado: "text-faint",
};

export function EstadoTecnico({ orgId }: { orgId: string }) {
  const salud = useRecurso<Salud>(`/organizations/${orgId}/salud`);

  if (salud.error) {
    return <Fallo onReintentar={() => void salud.recargar()}>{salud.error}</Fallo>;
  }
  if (salud.cargando || !salud.datos) return <Cargando etiqueta="Mirando cómo está esto" />;

  const s = salud.datos;
  const filas = filasDe(s);
  const problemas = cuantasPidenAlgo(filas);

  return (
    <div className="space-y-4">
      <Tarjeta className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Rotulo>Cómo está esta instalación</Rotulo>
          {problemas === 0 ? (
            <Chip tono="live">
              <Check size={10} />
              todo en orden
            </Chip>
          ) : (
            <Chip tono="warn">
              {problemas} cosa{problemas === 1 ? "" : "s"} que mirar
            </Chip>
          )}
        </div>

        <ul className="mt-4 space-y-2.5">
          {filas.map((fila) => {
            const Icono = ICONOS[fila.que] ?? Server;
            return (
              <li key={fila.que} className="flex items-start gap-2.5">
                <Icono size={13} className={`mt-0.5 shrink-0 ${TONO[fila.gravedad]}`} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink">
                    {fila.que}
                    <span className={`text-[11px] ${TONO[fila.gravedad]}`}>{fila.estado}</span>
                  </p>
                  {fila.consecuencia && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                      {fila.consecuencia}
                    </p>
                  )}
                </div>
                {fila.gravedad === "mal" && (
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-danger" />
                )}
                {fila.gravedad === "apagado" && (
                  <Minus size={12} className="mt-0.5 shrink-0 text-line-strong" />
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-faint">
          «Sin configurar» no siempre es un problema: Spotify, YouTube y Google
          son opcionales y la aplicación va perfectamente sin ellos. Lo que sí hay
          que mirar va arriba.
        </p>
      </Tarjeta>

      <Tarjeta className="p-4">
        <Rotulo>Base de datos</Rotulo>
        <p className="mt-2 text-xs text-ink">
          {s.migraciones.aplicadas} migraciones aplicadas
          {s.migraciones.ultima && (
            <>
              {" · "}
              <span className="font-mono text-[11px] text-muted">
                {s.migraciones.ultima.nombre.replace(/\.sql$/, "")}
              </span>
            </>
          )}
        </p>

        {/* LO QUE ESTA PANTALLA NO PUEDE SABER, DICHO. La imagen de la API no
            lleva `db/migrations` —copia `dist`, no el repositorio— así que el
            servidor no tiene contra qué comparar. Callarlo dejaría a alguien
            leyendo «60 aplicadas» como si fuera «al día», que es justo lo que
            no se puede afirmar desde aquí. */}
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Esto dice cuántas se han aplicado, no cuántas faltan: el servidor no
          lleva el repositorio dentro, así que no tiene con qué compararlas.
          Quien sí lo sabe es el flujo de despliegue, que se para solo si hay
          alguna sin aplicar.
        </p>
      </Tarjeta>

      <Tarjeta className="p-4">
        <Rotulo>Cómo se entra</Rotulo>
        <ul className="mt-2 space-y-1.5 text-xs text-muted">
          <li>
            Altas:{" "}
            <span className="text-ink">
              {s.entorno.altas === "open" ? "abiertas a cualquiera" : "solo con invitación"}
            </span>
          </li>
          <li>
            Verificar el correo:{" "}
            <span className="text-ink">{s.entorno.verificaCorreo ? "obligatorio" : "no"}</span>
          </li>
          <li>
            Entorno: <span className="font-mono text-ink">{s.entorno.nodeEnv}</span>
          </li>
        </ul>
      </Tarjeta>
    </div>
  );
}
