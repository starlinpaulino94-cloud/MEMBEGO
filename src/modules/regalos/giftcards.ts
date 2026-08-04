import { conEmpresa, sinEmpresa } from '@/lib/tenant'

/**
 * Gift cards de monto abierto (Regalos P2P · extensión de R4) — consultas.
 *
 * Ciclo de vida: el comprador la crea (PENDIENTE_PAGO) y paga citando el
 * código GC-XXXXXX; el negocio confirma (ACTIVA, entra la venta) y el
 * destinatario consume el saldo mostrando el código (AGOTADA al llegar a 0).
 * No expiran: son dinero pagado.
 */

export const ESTADO_GIFTCARD_LABEL: Record<string, string> = {
  PENDIENTE_PAGO: 'Por pagar',
  ACTIVA: 'Activa',
  AGOTADA: 'Agotada',
  CANCELADA: 'Cancelada',
}

function enmascarar(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[1][0]?.toUpperCase() ?? ''}.`
}

export interface GiftCardItem {
  id: string
  codigo: string
  estado: string
  monto: number
  saldo: number
  /** 'RECIBIDA' (soy el destinatario) o 'COMPRADA' (yo la pagué). */
  rol: 'RECIBIDA' | 'COMPRADA'
  /** La otra parte, enmascarada (o el contacto si aún no tiene cuenta). */
  contraparte: string
  mensaje: string | null
  createdAt: Date
  activadaAt: Date | null
}

export async function getGiftCardsCliente(clienteId: string): Promise<{
  recibidas: GiftCardItem[]
  compradas: GiftCardItem[]
}> {
  const cards = await sinEmpresa(
    'giftcards: panel del cliente por clienteId (empresa no conocida de entrada)',
    (tx) =>
      tx.giftCard.findMany({
        where: {
          OR: [{ compradorClienteId: clienteId }, { destinatarioClienteId: clienteId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      })
  )
  if (cards.length === 0) return { recibidas: [], compradas: [] }

  // Nombres de las contrapartes (ids planos → lookup en bloque).
  const ids = new Set<string>()
  for (const c of cards) {
    ids.add(c.compradorClienteId)
    if (c.destinatarioClienteId) ids.add(c.destinatarioClienteId)
  }
  const clientes = await sinEmpresa('giftcards: nombres de contrapartes por id (cross-tenant)', (tx) =>
    tx.cliente.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, nombre: true },
    })
  )
  const nombre = (id: string | null) =>
    id ? (clientes.find((c) => c.id === id)?.nombre ?? null) : null

  const items = cards.map((c) => {
    const rol: GiftCardItem['rol'] =
      c.destinatarioClienteId === clienteId ? 'RECIBIDA' : 'COMPRADA'
    const otra =
      rol === 'RECIBIDA'
        ? (nombre(c.compradorClienteId) ?? 'Alguien')
        : (nombre(c.destinatarioClienteId) ?? c.destinatarioContacto ?? '—')
    return {
      id: c.id,
      codigo: c.codigo,
      estado: c.estado,
      monto: Number(c.monto),
      saldo: Number(c.saldo),
      rol,
      contraparte: rol === 'RECIBIDA' || nombre(c.destinatarioClienteId) ? enmascarar(otra) : otra,
      mensaje: c.mensaje,
      createdAt: c.createdAt,
      activadaAt: c.activadaAt,
    } satisfies GiftCardItem
  })

  return {
    recibidas: items.filter((i) => i.rol === 'RECIBIDA'),
    compradas: items.filter((i) => i.rol === 'COMPRADA'),
  }
}

export interface GiftCardAdminItem {
  id: string
  codigo: string
  estado: string
  monto: number
  saldo: number
  comprador: string
  destinatario: string
  sinCuenta: boolean
  mensaje: string | null
  metodoCobro: string | null
  createdAt: Date
  activadaAt: Date | null
}

export interface GiftCardsAdminData {
  items: GiftCardAdminItem[]
  kpis: {
    porCobrar: number
    activas: number
    /** Suma del saldo pendiente de consumir (pasivo del negocio). */
    saldoVigente: number
  }
}

export async function getGiftCardsAdmin(companyId: string): Promise<GiftCardsAdminData> {
  const { cards, agregadoActivas, porCobrar, clientes } = await conEmpresa(companyId, async (tx) => {
    const [cards, agregadoActivas, porCobrar] = await Promise.all([
      tx.giftCard.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      tx.giftCard.aggregate({
        where: { companyId, estado: 'ACTIVA' },
        _count: { _all: true },
        _sum: { saldo: true },
      }),
      tx.giftCard.count({ where: { companyId, estado: 'PENDIENTE_PAGO' } }),
    ])

    const ids = new Set<string>()
    for (const c of cards) {
      ids.add(c.compradorClienteId)
      if (c.destinatarioClienteId) ids.add(c.destinatarioClienteId)
    }
    const clientes = ids.size
      ? await tx.cliente.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, nombre: true },
        })
      : []
    return { cards, agregadoActivas, porCobrar, clientes }
  })
  const nombre = (id: string | null) =>
    id ? (clientes.find((c) => c.id === id)?.nombre ?? '—') : null

  return {
    items: cards.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      estado: c.estado,
      monto: Number(c.monto),
      saldo: Number(c.saldo),
      comprador: nombre(c.compradorClienteId) ?? '—',
      destinatario: nombre(c.destinatarioClienteId) ?? c.destinatarioContacto ?? '—',
      sinCuenta: !c.destinatarioClienteId,
      mensaje: c.mensaje,
      metodoCobro: c.metodoCobro,
      createdAt: c.createdAt,
      activadaAt: c.activadaAt,
    })),
    kpis: {
      porCobrar,
      activas: agregadoActivas._count._all,
      saldoVigente: Number(agregadoActivas._sum.saldo ?? 0),
    },
  }
}
