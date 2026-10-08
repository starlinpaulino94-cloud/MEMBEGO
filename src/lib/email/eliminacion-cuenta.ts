import { SITE_NAME } from '@/lib/site'

/**
 * Correo de «confirma la eliminación de tu cuenta».
 *
 * Vive en `lib/email` por la misma razón que el resto de plantillas: en un correo
 * no existen las variables CSS del tema, así que los colores van escritos. El
 * ámbar/rojo del botón es el `destructive` del tema en claro, en hexadecimal.
 */
export function correoEliminacionDeCuenta(confirmationUrl: string): { subject: string; text: string; html: string } {
  return {
    subject: `Confirma la eliminación de tu cuenta · ${SITE_NAME}`,
    text: `Para continuar con la eliminación de tu cuenta MembeGo, confirma tu identidad aquí: ${confirmationUrl}. Si no lo solicitaste, ignora este mensaje.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827">` +
      `<h1>Confirma la eliminación de tu cuenta</h1>` +
      `<p>Usa este enlace para confirmar que controlas este correo y continuar con la eliminación de tu cuenta MembeGo.</p>` +
      `<p><a href="${confirmationUrl}" style="display:inline-block;padding:12px 20px;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px">Continuar con la eliminación</a></p>` +
      `<p>Si no solicitaste este cambio, ignora este correo. No se eliminará ninguna cuenta.</p>` +
      `</div>`,
  }
}
