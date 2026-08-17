import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

/**
 * Tres familias, cada una con un trabajo.
 *
 * `next/font` las descarga en el `build` y las sirve desde nuestro propio
 * dominio: ni una petición del navegador a Google en tiempo de ejecución, que
 * además de rápido evita filtrar quién usa la aplicación y desde dónde.
 *
 * `display: "swap"` a propósito: con `block`, el texto queda invisible hasta
 * que llega la fuente, y en una herramienta de trabajo es peor no poder leer
 * nada que leer medio segundo con la fuente del sistema.
 */
const display = Chakra_Petch({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--fuente-display",
  display: "swap",
});

const sans = Sora({
  subsets: ["latin", "latin-ext"],
  variable: "--fuente-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--fuente-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DevUP",
  description: "Centro de mando para la operación comercial y la infraestructura técnica",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <SessionProvider>{children}</SessionProvider>
        {/* La interfaz es siempre oscura, sin alternancia de tema — theme
            fijo en vez de "system", que aquí no tendría con qué alternar. */}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!bg-elevated/90 !backdrop-blur-xl !border-line-strong !text-ink !font-sans",
              description: "!text-muted",
              actionButton: "!bg-accent !text-canvas",
            },
          }}
        />
      </body>
    </html>
  );
}
