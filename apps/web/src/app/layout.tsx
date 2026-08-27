import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/session";
import { GUION_TEMA, TemaProvider } from "@/lib/tema";
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
    <html
      lang="es"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* El tema se aplica ANTES del primer pintado.
            Con React no llega: para cuando monta, el navegador ya pintó un
            fotograma, y ese fotograma sería un fogonazo blanco en la cara de
            quien trabaja de noche. Por eso va como script en el head y no como
            efecto — es el único sitio que corre antes de pintar.
            `suppressHydrationWarning` en el <html> porque este script le añade
            un atributo que el servidor no puso, y React lo señalaría como
            discrepancia sin serlo. */}
        <script dangerouslySetInnerHTML={{ __html: GUION_TEMA }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <TemaProvider>
          <SessionProvider>{children}</SessionProvider>
        </TemaProvider>
        {/* Los avisos siguen al tema en vez de quedarse oscuros: un toast negro
            sobre una interfaz clara se lee como un error del navegador. */}
        <Toaster
          theme="system"
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
