"use client";

import { Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { AreaTexto, Desplegable, Entrada, Field } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { SelectorPresencia } from "@/components/ui/SelectorPresencia";
import { SelectorTema } from "@/components/ui/SelectorTema";
import {
  Chip,
  Dialogo,
  EstadoVacio,
  Rotulo,
  Tarjeta,
} from "@/components/ui/Superficies";

/**
 * El muestrario.
 *
 * PARA QUÉ SIRVE, que no es para lucir componentes: es donde se ve que dos
 * piezas han derivado ANTES de que lo vea alguien usando el producto. Un
 * desplegable que quedó dos píxeles más bajo que un campo, un botón de peligro
 * que ya no es del mismo rojo que el aviso de error — eso, repartido por
 * dieciocho pantallas, no lo encuentra nadie. Puestos uno encima de otro salta
 * a la vista en un segundo.
 *
 * TODOS LOS ESTADOS, no solo el bonito. Vacío, cargando, con error, con texto
 * largo, deshabilitado. Casi todo lo que se rompe en una interfaz se rompe en
 * un estado que nadie miró al construirla, y el sitio para mirarlos todos a la
 * vez es este.
 *
 * SE MIRA EN LOS DOS TEMAS. El conmutador está arriba a propósito: la mitad de
 * las cosas que se ven mal en claro se escribieron mirando el oscuro.
 *
 * No está enlazada desde ningún sitio de la aplicación: se llega escribiendo
 * /dev/ui. Es una herramienta de quien construye, no una pantalla del producto.
 */

export default function MuestrarioPage() {
  const confirmar = useConfirmar();
  const [dialogo, setDialogo] = useState(false);
  const [texto, setTexto] = useState("");
  const [area, setArea] = useState("");
  const [seleccion, setSeleccion] = useState("uno");

  return (
    <Pagina
      titulo="Muestrario"
      rotulo="Todas las primitivas, en todos sus estados"
      icono={<Wrench size={20} />}
      ancho="lg"
      acciones={
        <div className="flex items-center gap-2">
          <SelectorPresencia />
          <SelectorTema />
        </div>
      }
    >
      <div className="space-y-8">
        <Seccion titulo="Botones">
          <Fila>
            <Boton variante="primario">Primario</Boton>
            <Boton variante="secundario">Secundario</Boton>
            <Boton variante="fantasma">Fantasma</Boton>
            <Boton variante="peligro">Peligro</Boton>
          </Fila>
          <Fila>
            <Boton variante="primario" tamano="sm" icono={<Plus size={12} />}>
              Pequeño con icono
            </Boton>
            <Boton variante="primario" cargando>
              Cargando
            </Boton>
            <Boton variante="primario" disabled>
              Deshabilitado
            </Boton>
            <BotonIcono etiqueta="Borrar">
              <Trash2 size={14} />
            </BotonIcono>
          </Fila>
        </Seccion>

        <Seccion titulo="Campos">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Con etiqueta" value={texto} onChange={setTexto} placeholder="Escribe…" />
            <Field
              label="Con pista"
              value=""
              onChange={() => {}}
              hint="Una línea que explica qué se espera."
              placeholder="Escribe…"
            />
            <label className="block">
              <Rotulo className="mb-1.5 block">Entrada suelta</Rotulo>
              <Entrada placeholder="Sin etiqueta encima" />
            </label>
            <label className="block">
              <Rotulo className="mb-1.5 block">Deshabilitada</Rotulo>
              <Entrada placeholder="No se puede escribir" disabled />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <Rotulo className="mb-1.5 block">Desplegable (md)</Rotulo>
              <Desplegable
                contenedor="w-full"
                value={seleccion}
                onChange={(e) => setSeleccion(e.target.value)}
              >
                <option className="bg-surface" value="uno">
                  Una opción
                </option>
                <option className="bg-surface" value="dos">
                  Otra opción, más larga de lo normal
                </option>
              </Desplegable>
            </label>
            <div>
              <Rotulo className="mb-1.5 block">Desplegable (sm) y deshabilitado</Rotulo>
              <div className="flex items-center gap-2">
                <Desplegable tamano="sm" defaultValue="a">
                  <option className="bg-surface" value="a">
                    Pequeño
                  </option>
                </Desplegable>
                <Desplegable tamano="sm" disabled defaultValue="a">
                  <option className="bg-surface" value="a">
                    Apagado
                  </option>
                </Desplegable>
              </div>
            </div>
          </div>

          <label className="block">
            <Rotulo className="mb-1.5 block">Área de texto</Rotulo>
            <AreaTexto
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Varias líneas…"
            />
          </label>
        </Seccion>

        <Seccion titulo="Chips">
          <Fila>
            <Chip>Neutro</Chip>
            <Chip tono="accent">Acento</Chip>
            <Chip tono="live">En pie</Chip>
            <Chip tono="warn">Aviso</Chip>
            <Chip tono="danger">Peligro</Chip>
          </Fila>
        </Seccion>

        <Seccion titulo="Superficies">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tarjeta className="p-4">
              <Rotulo>Normal</Rotulo>
              <p className="mt-1.5 text-xs text-muted">Una tarjeta corriente.</p>
            </Tarjeta>
            <Tarjeta viva className="p-4">
              <Rotulo>Viva</Rotulo>
              <p className="mt-1.5 text-xs text-muted">Está pasando algo dentro.</p>
            </Tarjeta>
            <Tarjeta elevable className="p-4">
              <Rotulo>Elevable</Rotulo>
              <p className="mt-1.5 text-xs text-muted">Se levanta al pasar el puntero.</p>
            </Tarjeta>
          </div>
        </Seccion>

        <Seccion titulo="Los tres finales de una carga">
          <div className="grid gap-3 lg:grid-cols-3">
            <Tarjeta className="p-2">
              <Cargando etiqueta="Ejemplo de carga" className="!py-10" />
            </Tarjeta>
            <Tarjeta className="grid place-items-center p-4">
              <Fallo onReintentar={() => {}}>No se pudo cargar la lista.</Fallo>
            </Tarjeta>
            <Tarjeta>
              <EstadoVacio
                icono={<Wrench size={18} />}
                titulo="No hay nada"
                pista="Y se dice, en vez de dejar un hueco en blanco."
              />
            </Tarjeta>
          </div>
        </Seccion>

        <Seccion titulo="Diálogos">
          <Fila>
            <Boton onClick={() => setDialogo(true)}>Abrir un diálogo</Boton>
            <Boton
              variante="peligro"
              onClick={() =>
                void confirmar({
                  titulo: "¿Borrar «ejemplo»?",
                  descripcion: "Así se ve una confirmación destructiva.",
                  accion: "Borrar",
                  peligro: true,
                })
              }
            >
              Confirmar algo irreversible
            </Boton>
            <Boton
              variante="secundario"
              onClick={() =>
                void confirmar({
                  titulo: "¿Seguimos?",
                  descripcion: "Y así una que no lo es: sin rojo y con el foco en la acción.",
                  accion: "Seguir",
                })
              }
            >
              Confirmar algo reversible
            </Boton>
          </Fila>
        </Seccion>

        <Seccion titulo="Texto">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">Título de pantalla</h1>
            <h2 className="text-sm font-semibold">Título de sección</h2>
            <Rotulo>Rótulo de instrumento</Rotulo>
            <p className="text-sm text-ink">Texto normal, del color de la tinta.</p>
            <p className="text-sm text-muted">Texto apagado, para lo secundario.</p>
            <p className="text-xs text-faint">Texto tenue, para lo que casi no se lee.</p>
            <p className="font-mono text-xs tabular-nums text-muted">1.234,56 · monoespaciado</p>
          </div>
        </Seccion>
      </div>

      {dialogo && (
        <Dialogo
          titulo="Un diálogo"
          descripcion="Cierra con Escape y con clic en el velo."
          onCerrar={() => setDialogo(false)}
        >
          <p className="text-xs leading-relaxed text-muted">
            El velo va difuminado y no solo oscuro: empujar el fondo hacia atrás enfoca la tarea sin
            apagar del todo el contexto.
          </p>
        </Dialogo>
      )}
    </Pagina>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <Rotulo>{titulo}</Rotulo>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}

function Fila({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
