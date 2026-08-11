import { requireRole } from '@/lib/auth/guards'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ConfettiCelebration } from '@/components/growth/ConfettiCelebration'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'

/**
 * Growth Engine 3.0 · Pantalla de celebración tras registrarse por invitación
 * (req #4). Muestra confeti y el beneficio recién desbloqueado.
 */
export default async function CelebracionPage() {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  // Una cuenta de Membego que todavía no es cliente de ningún negocio. No
  // es un error ni una falta de permiso: es el primer día. Ver
  // `SinEmpresaTodavia`.
  if (!clienteId) {
    return <SinEmpresaTodavia que="nada que celebrar todavía" />
  }

  // Beneficio recién otorgado: la compra ACTIVA más reciente del cliente.
  let beneficio: string | null = null
  let compraId: string | null = null
  if (clienteId) {
    const compra = await conEmpresaOTodas(
      user.metadata.companyId,
      'celebración: el beneficio recién otorgado es del cliente que acaba de entrar',
      (tx) =>
        tx.productoCompra.findFirst({
          where: { clienteId, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, promocion: { select: { titulo: true } } },
        })
    ).catch(() => null)
    beneficio = compra?.promocion?.titulo ?? null
    compraId = compra?.id ?? null
  }

  // CTA directo a RECLAMAR: el detalle del beneficio tiene el canje (QR) listo
  // para usar en el mostrador — el recién llegado no tiene que buscar nada.
  return (
    <ConfettiCelebration
      beneficio={beneficio}
      href={
        compraId
          ? `/cliente/mis-promociones/${compraId}`
          : beneficio
            ? '/cliente/mis-promociones'
            : '/cliente/membresia'
      }
      ctaLabel={beneficio ? `Reclamar mi ${beneficio} ahora` : 'Ir a mi cuenta'}
    />
  )
}
