import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

/**
 * CORREO DE CONFIRMACIÓN DE PAGO al cliente.
 *
 * Se envía desde el punto único de activación (todas las vías: tarjeta,
 * transferencia aprobada, pago en sucursal) y desde la renovación automática.
 * Es best-effort: un fallo del correo NUNCA rompe la activación — el pago ya
 * ocurrió y eso es lo que manda. `sendEmail` ya bloquea las empresas demo.
 */

const TZ = 'America/Santo_Domingo'

function formatoRD(monto: number): string {
  return `RD$${monto.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface ConfirmacionPagoInput {
  companyId: string
  clienteId: string
  planNombre: string
  monto: number
  /** 'activacion' = primera compra/reactivación · 'renovacion' = cobro automático. */
  motivo: 'activacion' | 'renovacion'
  /** Hasta cuándo queda vigente, si se conoce. */
  vigenteHasta?: Date | null
}

/** Arma y envía el recibo. Devuelve si salió (para bitácora), nunca lanza. */
export async function enviarConfirmacionPago(input: ConfirmacionPagoInput): Promise<boolean> {
  try {
    const [cliente, company] = await Promise.all([
      prisma.cliente.findUnique({
        where: { id: input.clienteId },
        select: { nombre: true, email: true },
      }),
      prisma.company.findUnique({
        where: { id: input.companyId },
        select: { name: true, logoUrl: true },
      }),
    ])
    if (!cliente?.email || !company) return false

    const fecha = new Intl.DateTimeFormat('es-DO', {
      timeZone: TZ,
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date())
    const montoTexto = formatoRD(input.monto)
    const titulo =
      input.motivo === 'renovacion' ? 'Tu membresía se renovó' : '¡Pago confirmado!'
    const intro =
      input.motivo === 'renovacion'
        ? `Renovamos tu membresía automáticamente y todo quedó listo.`
        : `Recibimos tu pago y tu membresía quedó activa.`
    const vigencia = input.vigenteHasta
      ? new Intl.DateTimeFormat('es-DO', { timeZone: TZ, dateStyle: 'long' }).format(
          input.vigenteHasta
        )
      : null

    const logo = company.logoUrl
      ? `<img src="${company.logoUrl}" alt="${company.name}" width="56" height="56" style="border-radius:12px;display:block;margin:0 auto 12px;object-fit:cover;" />`
      : ''

    const html = `
<div style="margin:0;padding:24px;background:#f4f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9ee;">
      <div style="background:linear-gradient(135deg,#059669,#10b981);padding:28px 24px;text-align:center;color:#ffffff;">
        ${logo}
        <p style="margin:0;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">${company.name}</p>
        <h1 style="margin:8px 0 0;font-size:22px;">${titulo}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;font-size:15px;color:#1f2937;">Hola ${cliente.nombre},</p>
        <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6;">${intro}</p>
        <div style="border:1px solid #e6e9ee;border-radius:12px;padding:16px 18px;">
          <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;color:#1f2937;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Plan</td>
              <td style="padding:6px 0;text-align:right;font-weight:600;">${input.planNombre}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Monto pagado</td>
              <td style="padding:6px 0;text-align:right;font-weight:700;font-size:16px;">${montoTexto}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">Fecha</td>
              <td style="padding:6px 0;text-align:right;">${fecha}</td>
            </tr>
            ${
              vigencia
                ? `<tr><td style="padding:6px 0;color:#6b7280;">Vigente hasta</td><td style="padding:6px 0;text-align:right;">${vigencia}</td></tr>`
                : ''
            }
          </table>
        </div>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;line-height:1.6;">
          Este correo es tu comprobante de pago. Puedes ver tu membresía y tu
          historial entrando a tu cuenta. Si no reconoces este cargo, contáctanos.
        </p>
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9ca3af;">
      ${company.name} · Enviado por MembeGo
    </p>
  </div>
</div>`

    const texto = `${titulo} — ${company.name}
Hola ${cliente.nombre}, ${intro}
Plan: ${input.planNombre}
Monto pagado: ${montoTexto}
Fecha: ${fecha}${vigencia ? `\nVigente hasta: ${vigencia}` : ''}
Este correo es tu comprobante de pago.`

    const res = await sendEmail({
      to: cliente.email,
      subject:
        input.motivo === 'renovacion'
          ? `Tu membresía en ${company.name} se renovó — ${montoTexto}`
          : `Pago confirmado en ${company.name} — ${montoTexto}`,
      html,
      text: texto,
      companyId: input.companyId,
    })
    return res.sent
  } catch (e) {
    console.error('[pagos] correo de confirmación:', e)
    return false
  }
}
