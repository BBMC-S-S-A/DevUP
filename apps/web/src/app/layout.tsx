import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
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

/**
 * Outfit y no Sora, que es lo que había.
 *
 * Sora tiene un contraste alto y unas terminaciones marcadas que sostenían
 * bien la estética de panel de instrumentos. La dirección nueva apoya el
 * carácter en el MATERIAL —el vidrio sobre la atmósfera— y no en la letra, así
 * que una sans más neutra y de formas redondas deja de competir con él. En
 * párrafos largos además se lee con menos esfuerzo.
 *
 * Se cambia SOLO esta. `--fuente-display` (Chakra Petch, los rótulos en
 * mayúsculas) y `--fuente-mono` (las cifras) se quedan: ahí la letra hace un
 * trabajo de información, no de estilo, y cambiarlas sería mover algo que la
 * dirección no pedía.
 */
const sans = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--fuente-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--fuente-mono",
  display: "swap",
});

/**
 * Solo lo que comparten TODAS las rutas. El título y la descripción de verdad
 * los pone cada grupo: la landing habla al que todavía no conoce el producto y
 * `/app` habla al que ya está dentro, y son dos mensajes distintos.
 */
export const metadata: Metadata = {
  title: { default: "DevUP", template: "%s · DevUP" },
  description: "El gestor del desarrollo del proyecto.",
  icons: { icon: "/icon.png" },
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
      <body className="min-h-[100svh] bg-canvas text-ink antialiased">
        <TemaProvider>{children}</TemaProvider>
      </body>
    </html>
  );
}
