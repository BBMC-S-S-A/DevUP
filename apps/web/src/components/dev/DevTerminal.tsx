"use client";

import type { WebContainer } from "@webcontainer/api";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

type Proceso = Awaited<ReturnType<WebContainer["spawn"]>>;

/**
 * Terminal real: `jsh` (la shell propia del WebContainer) corriendo dentro
 * del navegador, con xterm.js como pantalla. Nada de esto toca los
 * servidores de DevUP — `npm install`, `node`, lo que sea, corre en el
 * WebAssembly de la propia pestaña.
 */
export function DevTerminal({ webcontainer }: { webcontainer: WebContainer | null }) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const procesoRef = useRef<Proceso | null>(null);

  useEffect(() => {
    if (!webcontainer || !contenedorRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: "#00000000" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(contenedorRef.current);
    fit.fit();

    let cancelado = false;

    void (async () => {
      const proceso = await webcontainer.spawn("jsh", {
        terminal: { cols: terminal.cols, rows: terminal.rows },
      });

      // El WebContainer pudo tardar en arrancar la shell y, mientras tanto,
      // este componente se desmontó (cambio de archivo, navegación) — matar
      // el proceso recién nacido en vez de dejarlo huérfano.
      if (cancelado) {
        void proceso.kill();
        return;
      }
      procesoRef.current = proceso;

      void proceso.output.pipeTo(
        new WritableStream({
          write(data) {
            terminal.write(data);
          },
        }),
      );

      const writer = proceso.input.getWriter();
      terminal.onData((data) => {
        void writer.write(data);
      });
    })();

    const alRedimensionar = () => fit.fit();
    window.addEventListener("resize", alRedimensionar);

    return () => {
      cancelado = true;
      window.removeEventListener("resize", alRedimensionar);
      void procesoRef.current?.kill();
      terminal.dispose();
    };
    // Nueva shell solo si cambia la instancia del WebContainer en sí — no en
    // cada render, o cada pulsación reabriría el proceso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcontainer]);

  return <div ref={contenedorRef} className="h-full w-full [&_.xterm]:h-full" />;
}
