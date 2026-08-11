import { headers } from 'next/headers'
import { sinEmpresa } from '@/lib/tenant'
import type { getCampanaBySlug } from '@/modules/invitaciones/queries'
import { registrarEventoCampana } from '@/modules/invitaciones/clienteActions'
import { esBotDeVistaPrevia } from '@/lib/share/bots'
import { normalizeInvitaContenido } from '@/lib/invitaContenido'
import { CampanaLanding } from '@/components/invitaciones/CampanaLanding'

export type CampanaConEmpresa = NonNullable<Awaited<ReturnType<typeof getCampanaBySlug>>>

/**
 * Cuerpo servidor de la landing de campaña, compartido por sus dos rutas:
 * /invita/[slug] (canónica) y /invitar/[code] (enlace corto personal).
 * Registra los eventos del embudo, personaliza con el nombre del invitante
 * y delega la UI en el componente cliente CampanaLanding.
 */
export async function CampanaLandingScreen({
  campana,
  refCode,
}: {
  campana: CampanaConEmpresa
  refCode: string
}) {
  const expirada = campana.estado === 'FINALIZADA' || new Date(campana.fechaFin) < new Date()
  const abierta = campana.estado === 'ACTIVA' && !expirada

  // Robots de vista previa (WhatsApp/Facebook/…): tienen ~5 s para leer la
  // tarjeta, así que se les sirve la página SIN lookups extra ni registros de
  // eventos (que además contaminarían el embudo con visitas no humanas).
  const hdrs = await headers()
  const userAgent = hdrs.get('user-agent') ?? ''
  const esBot = esBotDeVistaPrevia(userAgent)

  // Personalización: "Juan quiere regalarte..." — nombre del invitante a
  // partir del código de referido (corto o largo). Nunca bloquea la landing.
  let invitanteNombre: string | null = null
  if (refCode && !esBot) {
    // Landing PÚBLICA: quien llega no tiene sesión, y el código de referido
    // puede ser de un cliente de cualquier empresa — es un enlace que se
    // comparte por WhatsApp. Se lee solo el nombre de pila para el saludo.
    const invitante = await sinEmpresa(
      'landing de campaña: pública, y el código de referido puede ser de cualquier empresa',
      (tx) =>
        tx.cliente.findFirst({
          where: {
            OR: [{ codigoCorto: refCode.toUpperCase() }, { codigoReferido: refCode }],
          },
          select: { nombre: true },
        })
    ).catch(() => null)
    // Solo el primer nombre: suficiente para personalizar sin exponer datos.
    invitanteNombre = invitante?.nombre?.split(' ')[0] ?? null
  }

  // Contexto de auditoría de eventos: origen y dispositivo (spec Growth Engine).
  const contexto = {
    slug: campana.slug,
    ...(refCode ? { refCode } : {}),
    origen: hdrs.get('referer') ?? 'directo',
    dispositivo: /mobile|android|iphone|ipad/i.test(userAgent) ? 'movil' : 'escritorio',
    userAgent: userAgent.slice(0, 150),
  }

  // Embudo: la llegada con ref es el clic sobre un enlace compartido;
  // la vista de landing se registra siempre (con o sin atribución). Los
  // robots no cuentan y no esperan la escritura.
  if (!esBot) {
    if (refCode) {
      await registrarEventoCampana(campana.id, 'ENLACE_ABIERTO', contexto)
    }
    await registrarEventoCampana(campana.id, 'LANDING_VISTA', contexto)
  }

  const beneficioInvitado = campana.beneficioInvitado as {
    tipo?: string
    valor?: string
    descripcion?: string
    vigenciaDias?: number
  } | null

  return (
    <CampanaLanding
      campana={{
        id: campana.id,
        slug: campana.slug,
        titulo: campana.titulo,
        descripcion: campana.descripcion,
        textoLanding: campana.textoLanding,
        imagenUrl: campana.imagenUrl,
        bannerUrl: campana.bannerUrl,
        fechaFin: campana.fechaFin.toISOString(),
        colorPrimario: campana.colorPrimario,
        colorSecundario: campana.colorSecundario,
        usarBanner: campana.usarBanner,
        cta: normalizeInvitaContenido(campana.contenido).landingCta,
        abierta,
        expirada,
        beneficioInvitado: beneficioInvitado ?? null,
        empresa: {
          name: campana.company.name,
          slug: campana.company.slug,
          logoUrl: campana.company.logoUrl,
        },
      }}
      refCode={refCode}
      invitanteNombre={invitanteNombre}
    />
  )
}
