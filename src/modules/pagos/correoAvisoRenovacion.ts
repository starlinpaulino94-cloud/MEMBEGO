import { escaparHtml } from '@/lib/html'
import type { AvisoRedactado } from '@/modules/pagos/avisosRenovacionCore'

/**
 * EL CORREO de los avisos de renovación: HTML con estilos en línea y su versión
 * en texto plano.
 *
 * Está aparte de `avisosRenovacionCore.ts` por la misma razón que
 * `correoConfirmacion.ts`: en un correo las variables CSS de la app no existen
 * y los colores van en hexadecimal. Aquí no cuentan como deuda de diseño; en el
 * núcleo, que son textos, sí contarían.
 *
 * Sin Prisma ni Next: se prueba con valores (`tests/avisos-renovacion.test.ts`).
 */

/**
 * Arma el correo: HTML con estilos en línea (los clientes de correo no leen las
 * variables de diseño de la app) y su versión en texto plano.
 *
 * `urlBase` puede faltar; sin ella el botón no se pinta y el texto plano omite el
 * enlace en vez de dejar uno roto.
 */
export function armarCorreo(
  aviso: AvisoRedactado,
  contexto: { empresa: string; logoUrl?: string | null; urlBase?: string | null }
): { html: string; text: string } {
  const empresa = escaparHtml(contexto.empresa)
  const enlace = contexto.urlBase ? `${contexto.urlBase.replace(/\/$/, '')}${aviso.href}` : null
  const degradado =
    aviso.tono === 'alerta'
      ? 'linear-gradient(135deg,#b45309,#d97706)'
      : 'linear-gradient(135deg,#059669,#10b981)'
  const color = aviso.tono === 'alerta' ? '#b45309' : '#059669'
  const logo = contexto.logoUrl
    ? `<img src="${escaparHtml(contexto.logoUrl)}" alt="${empresa}" width="56" height="56" style="border-radius:12px;display:block;margin:0 auto 12px;object-fit:cover;" />`
    : ''
  const cuerpo = aviso.parrafos
    .map(
      (p, i) =>
        `<p style="margin:0 0 ${i === 0 ? 16 : 14}px;font-size:${i === 0 ? 15 : 14}px;color:${i === 0 ? '#1f2937' : '#4b5563'};line-height:1.6;">${escaparHtml(p)}</p>`
    )
    .join('\n        ')
  const boton = enlace
    ? `<p style="margin:22px 0 0;"><a href="${escaparHtml(enlace)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px;">${escaparHtml(aviso.boton)}</a></p>`
    : ''

  const html = `
<div style="margin:0;padding:24px;background:#f4f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9ee;">
      <div style="background:${degradado};padding:28px 24px;text-align:center;color:#ffffff;">
        ${logo}
        <p style="margin:0;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">${empresa}</p>
        <h1 style="margin:8px 0 0;font-size:22px;">${escaparHtml(aviso.titulo)}</h1>
      </div>
      <div style="padding:24px;">
        ${cuerpo}
        ${boton}
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9ca3af;">
      ${empresa} · Enviado por MembeGo
    </p>
  </div>
</div>`

  const text = `${aviso.titulo} — ${contexto.empresa}\n\n${aviso.parrafos.join('\n\n')}${enlace ? `\n\n${aviso.boton}: ${enlace}` : ''}`
  return { html, text }
}
