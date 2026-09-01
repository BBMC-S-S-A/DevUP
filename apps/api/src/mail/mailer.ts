import { createTransport, type Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Envío de correo, por tres vías y en este orden: API HTTP, SMTP, y el
 * registro.
 *
 * POR QUÉ LA API HTTP VA PRIMERA Y ES LA DE PRODUCCIÓN. Las plataformas
 * gestionadas gratuitas —Render, entre otras— bloquean los puertos 25, 465 y
 * 587 de salida. SMTP allí no da un error de configuración: la conexión se
 * queda esperando hasta agotar el tiempo. Como este módulo se traga los fallos
 * a propósito (ver abajo), el resultado sería que las invitaciones se crean,
 * nadie las recibe, y en pantalla todo parece correcto.
 *
 * SMTP se queda porque es lo que usa el buzón de mentira de desarrollo, donde
 * el ciclo entero de invitación y recuperación se prueba sin dar de alta nada.
 *
 * Sin ninguna de las dos, el correo se escribe en el registro con su enlace
 * visible. Los enlaces son credenciales de un solo uso: eso es aceptable en una
 * máquina de desarrollo y no lo es en producción, y por eso `env.ts` avisa al
 * arrancar.
 */
type Correo = {
  to: string;
  subject: string;
  text: string;
};

let transporte: Transporter | null = null;

function obtenerTransporte(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transporte ??= createTransport(env.SMTP_URL);
  return transporte;
}

/**
 * Envío por API HTTP. El cuerpo es el de Resend, que es también el que aceptan
 * varios proveedores; cambiar de uno a otro debería ser cambiar `MAIL_API_URL`.
 */
async function enviarPorApi(correo: Correo): Promise<void> {
  const respuesta = await fetch(env.MAIL_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.MAIL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [correo.to],
      subject: correo.subject,
      text: correo.text,
    }),
    // Sin esto, un proveedor que no responde deja la petición del usuario
    // colgada tanto como quiera: `fetch` no tiene tiempo límite por defecto.
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    // El cuerpo importa más que el código. El fallo típico al empezar es «el
    // dominio del remitente no está verificado», y eso solo lo dice el cuerpo:
    // el código a secas es un 403 que no orienta a nadie.
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`${respuesta.status} ${respuesta.statusText} · ${detalle.slice(0, 300)}`);
  }
}

function alRegistro(correo: Correo): void {
  console.info(
    [
      "",
      "┌─ correo sin enviar (no hay correo configurado) ────────────────────",
      `│ Para:    ${correo.to}`,
      `│ Asunto:  ${correo.subject}`,
      "│",
      ...correo.text.split("\n").map((l) => `│ ${l}`),
      "└───────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

export async function enviarCorreo(correo: Correo): Promise<void> {
  try {
    if (env.MAIL_API_KEY) {
      await enviarPorApi(correo);
      return;
    }

    const transporte = obtenerTransporte();
    if (transporte) {
      await transporte.sendMail({
        from: env.MAIL_FROM,
        to: correo.to,
        subject: correo.subject,
        text: correo.text,
      });
      return;
    }

    alRegistro(correo);
  } catch (error) {
    // Un correo que no sale no debe tumbar la petición: la invitación ya está
    // creada y se puede reenviar. Pero tiene que verse en el registro, porque
    // desde fuera parece que todo fue bien.
    console.error(
      `[correo] no se pudo enviar a ${correo.to}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const pie = "\n\n—\nDevUP";

type Plantilla = { subject: string; text: string };

export const plantillas = {
  invitacion: (organizacion: string, quien: string, enlace: string): Plantilla => ({
    subject: `${quien} te ha invitado a ${organizacion} en DevUP`,
    text:
      `${quien} te ha invitado a unirte a ${organizacion}.\n\n` +
      `Entra aquí para aceptar:\n${enlace}\n\n` +
      `El enlace caduca en 7 días. Si no esperabas esto, ignóralo: sin abrirlo ` +
      `no pasa nada.${pie}`,
  }),

  verificacion: (enlace: string): Plantilla => ({
    subject: "Confirma tu correo en DevUP",
    text:
      `Confirma que este correo es tuyo:\n${enlace}\n\n` +
      `El enlace caduca en 24 horas.${pie}`,
  }),

  recuperacion: (enlace: string): Plantilla => ({
    subject: "Recuperar tu contraseña de DevUP",
    text:
      `Alguien ha pedido restablecer la contraseña de esta cuenta.\n\n` +
      `Si has sido tú:\n${enlace}\n\n` +
      `El enlace caduca en 1 hora y solo sirve una vez. Al usarlo se cerrarán ` +
      `todas las sesiones abiertas de la cuenta.\n\n` +
      `Si no has sido tú, no hace falta que hagas nada: sin abrir el enlace, la ` +
      `contraseña no cambia.${pie}`,
  }),
};
