import { escaparHtml } from '@/lib/html'
import type { AvisoDeIdentidad } from '@/modules/identidad/avisosCore'

/**
 * EL CORREO del aviso de identidad: HTML con estilos en línea y su versión en texto
 * plano. Está aparte de `avisosCore.ts` por la misma razón que `correoAvisoRenovacion.ts`:
 * en un correo las variables de diseño de la app no existen y los colores van en
 * hexadecimal (el nombre del archivo lleva «correo»: el auditor de diseño no lo cuenta).
 *
 * No lleva ningún dato personal: ni el nombre (el saludo es genérico), ni el documento.
 */
export function armarCorreoDeIdentidad(aviso: AvisoDeIdentidad, contexto: { urlBase?: string | null }): { html: string; text: string } {
  const enlace = contexto.urlBase ? `${contexto.urlBase.replace(/\/$/, '')}${aviso.href}` : null
  const color = aviso.tono === 'exito' ? '#059669' : aviso.tono === 'aviso' ? '#b45309' : '#0e7490'
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
      <div style="background:${color};padding:26px 24px;text-align:center;color:#ffffff;">
        <p style="margin:0;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">Verificación de identidad</p>
        <h1 style="margin:8px 0 0;font-size:22px;">${escaparHtml(aviso.titulo)}</h1>
      </div>
      <div style="padding:24px;">
        ${cuerpo}
        ${boton}
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#9ca3af;">Enviado por MembeGo</p>
  </div>
</div>`
  const text = `${aviso.titulo}\n\n${aviso.parrafos.join('\n\n')}${enlace ? `\n\n${aviso.boton}: ${enlace}` : ''}`
  return { html, text }
}
