import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./landing.css";

/**
 * El grupo público. No lleva `SessionProvider`: la landing es un componente de
 * servidor puro y no pregunta por la sesión, así que una visita anónima —o la
 * de un rastreador— no dispara una petición a la API para recibir un 401.
 *
 * UNA SOLA TIPOGRAFÍA. Manrope hace de titular, de cuerpo, de dato y de
 * etiqueta; sus cifras tabulares alinean la tabla de precios sin necesitar una
 * monoespaciada de apoyo. Las tres familias del producto no se cargan aquí, así
 * que la landing pesa una fuente en vez de tres.
 */
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "800"],
  variable: "--fuente-landing",
  display: "swap",
});

const SITIO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://devup.app";

const TITULO = "DevUP · El gestor del desarrollo del proyecto";
const DESCRIPCION =
  "El repositorio, la base de datos, el despliegue, el agente y la conversación en un solo sitio. " +
  "El estado se deduce de lo que pasó, no de lo que alguien anotó.";

export const metadata: Metadata = {
  metadataBase: new URL(SITIO),
  // `absolute` porque el título ya dice «DevUP»: con la plantilla del layout
  // raíz saldría «DevUP · … · DevUP» en la pestaña y en cada enlace compartido.
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: "/",
    siteName: "DevUP",
    title: TITULO,
    description: DESCRIPCION,
  },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION },
};

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return <div className={`landing ${manrope.variable}`}>{children}</div>;
}
