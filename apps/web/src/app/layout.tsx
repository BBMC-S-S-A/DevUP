import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "DevUP",
  description: "Centro de mando para la operación comercial y la infraestructura técnica",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <SessionProvider>{children}</SessionProvider>
        {/* La interfaz es siempre oscura, sin alternancia de tema — theme
            fijo en vez de "system", que aquí no tendría con qué alternar. */}
        <Toaster theme="dark" richColors position="bottom-right" />
      </body>
    </html>
  );
}
