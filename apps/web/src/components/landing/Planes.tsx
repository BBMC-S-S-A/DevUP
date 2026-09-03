"use client";

import Link from "next/link";
import { useState } from "react";
import { CICLOS, COMPARATIVA, PLANES, type Ciclo } from "@/lib/landing/planes";

/**
 * La tabla de planes.
 *
 * CUATRO COLUMNAS SIN CAJAS: divididas por una línea de un píxel y separadas
 * por aire, no cuatro tarjetas con sombra en fila —que es la maqueta por
 * defecto de todo SaaS—. La recomendada se marca con un velo del acento, sin
 * borde ni cinta.
 *
 * Es cliente solo por el conmutador de ciclo. Todo lo demás llega pintado desde
 * el servidor: las cifras están en el HTML inicial, así que sin JavaScript se
 * ven los precios mensuales y los enlaces funcionan.
 *
 * El conmutador es un grupo de dos botones con `aria-pressed` y no un
 * interruptor: son dos opciones excluyentes, no un encendido.
 */
export function Planes() {
  const [ciclo, setCiclo] = useState<Ciclo>("mes");

  return (
    <>
      <div className="ciclo" role="group" aria-label="Ciclo de facturación">
        {CICLOS.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            aria-pressed={ciclo === opcion.id}
            onClick={() => setCiclo(opcion.id)}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>

      {/* Al cambiar de ciclo cambian cuatro precios a la vez. Sin esto, quien
          navega con lector de pantalla pulsa el botón y no se entera de nada. */}
      <div className="planes" aria-live="polite">
        {PLANES.map((plan) => (
          <div className={`col${plan.marcada ? " colMarcada" : ""}`} key={plan.id}>
            <span className={`eti${plan.marcada ? " etiAcento" : ""}`}>{plan.para}</span>
            <h3>{plan.nombre}</h3>

            <div className="precio">
              <span className="cifra">{ciclo === "ano" ? plan.anual : plan.mensual}</span>
              <span className="unidad">
                {plan.id === "individual"
                  ? plan.unidad
                  : ciclo === "ano"
                    ? "USD · persona / año"
                    : "USD · persona / mes"}
              </span>
              {plan.banda && <span className="aviso">banda sin cerrar</span>}
            </div>

            <Link
              className={`btn btnFull ${plan.marcada ? "btnSolido" : "btnLinea"}`}
              href={plan.destino}
            >
              {plan.accion}
            </Link>

            <ul className="lista">
              {plan.incluye.map((linea) => (
                <li key={linea.texto} data-clave={linea.clave ? "si" : undefined}>
                  {linea.fuera ? <i aria-hidden="true">×</i> : <b aria-hidden="true">→</b>}
                  <span>{linea.texto}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <details className="detalleTabla">
        <summary>Ver todas las diferencias</summary>
        <div className="desliza">
          <table>
            <thead>
              <tr>
                <th scope="col">Qué incluye</th>
                {PLANES.map((plan) => (
                  <th scope="col" key={plan.id}>
                    {plan.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARATIVA.map((bloque) => (
                <Bloque key={bloque.grupo} grupo={bloque.grupo} filas={bloque.filas} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Bloque({
  grupo,
  filas,
}: {
  grupo: string;
  filas: [string, string, string, string, string][];
}) {
  return (
    <>
      <tr data-grupo="si">
        <td colSpan={5}>{grupo}</td>
      </tr>
      {filas.map(([nombre, ...celdas]) => (
        <tr key={nombre}>
          <th scope="row">{nombre}</th>
          {celdas.map((celda, indice) => (
            <Celda key={indice} valor={celda} />
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * «sí» y «no» se pintan como símbolo pero se leen como palabra: un ✓ suelto en
 * una tabla de veintitrés filas es incomprensible en un lector de pantalla.
 */
function Celda({ valor }: { valor: string }) {
  if (valor === "sí") {
    return (
      <td className="si">
        <span aria-hidden="true">✓</span>
        <span className="soloLectores"> Incluido</span>
      </td>
    );
  }
  if (valor === "no") {
    return (
      <td className="no">
        <span aria-hidden="true">—</span>
        <span className="soloLectores"> No incluido</span>
      </td>
    );
  }
  return <td>{valor}</td>;
}
