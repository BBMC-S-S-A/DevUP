import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Configuración mínima a propósito.
 *
 * Sin caché incremental (R2) porque no lo pedimos: la web no depende de ISR
 * para nada crítico hoy, y añadir un bucket de R2 solo para esto es meter una
 * pieza de infraestructura de más antes de que haga falta. El día que sí haga
 * falta —una pantalla con revalidación real—, se añade aquí.
 */
export default defineCloudflareConfig({});
