import { escaparHtml } from '@/lib/html'
import { SITE_NAME, appUrlFor } from '@/lib/site'
import { encolarEmail } from '@/modules/jobs/emisiones'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · correo de invitación al portal del
 * proveedor (dueño) y a su personal. Se manda FUERA de la transacción que
 * dejó la invitación: si aquella se deshace, no sale ningún correo.
 */

const DIAS_VALIDEZ = 7

export async function mandarCorreoDeInvitacion(d: { email: string; companyName: string; token: string; dueno: boolean }): Promise<void> {
  const nombreSeguro = escaparHtml(d.companyName)
  const url = appUrlFor(`/invitacion/${d.token}`)
  const titulo = d.dueno ? `Activa el portal de proveedor de ${d.companyName} en ${SITE_NAME}` : `Te invitaron al equipo de ${d.companyName} en ${SITE_NAME}`
  const intro = d.dueno
    ? `${SITE_NAME} compra productos y servicios a ${nombreSeguro}. Activa tu cuenta para ver lo contratado, escanear los QR de los clientes y registrar tus entregas y ventas adicionales.`
    : `${nombreSeguro} te invitó a su equipo de proveedor en ${SITE_NAME}. Crea tu cuenta para empezar.`
  await encolarEmail({
    to: d.email,
    subject: titulo,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 8px">${d.dueno ? 'Tu portal de proveedor' : 'Únete al equipo'}</h1>
        <p style="font-size:15px;line-height:1.5;color:#334155;margin:0 0 24px">${intro}</p>
        <a href="${url}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">Activar mi cuenta</a>
        <p style="font-size:12px;color:#94a3b8;margin:24px 0 0">La invitación expira en ${DIAS_VALIDEZ} días. Si no la esperabas, ignora este correo.</p>
      </div>`,
    text: `${intro.replace(/<[^>]+>/g, '')} Activa aquí: ${url}`,
  })
}

