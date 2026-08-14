import { createTransport, type Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Envío de correo.
 *
 * Sin `SMTP_URL` configurado no falla: escribe el correo en el registro, con
 * su enlace bien visible. Es lo que permite probar el ciclo entero de
 * invitación y de recuperación en desarrollo sin montar un servidor de correo,
 * y en producción `env.ts` ya avisa al arrancar de que no hay SMTP.
 *
 * Los enlaces son credenciales de un solo uso. Que aparezcan en el registro es
 * aceptable en una máquina de desarrollo y no lo es en producción — otra razón
 * por la que ese aviso está donde está.
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

export async function enviarCorreo(correo: Correo): Promise<void> {
  const transporte = obtenerTransporte();

  if (!transporte) {
    console.info(
      [
        "",
        "┌─ correo sin enviar (no hay SMTP configurado) ──────────────────────",
        `│ Para:    ${correo.to}`,
        `│ Asunto:  ${correo.subject}`,
        "│",
        ...correo.text.split("\n").map((l) => `│ ${l}`),
        "└───────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  try {
    await transporte.sendMail({
      from: env.MAIL_FROM,
      to: correo.to,
      subject: correo.subject,
      text: correo.text,
    });
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
