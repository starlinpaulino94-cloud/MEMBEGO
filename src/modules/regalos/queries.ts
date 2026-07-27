import { prisma } from '@/lib/prisma'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Regalos P2P · Fase R2 — consultas del módulo /cliente/regalos.
 *
 * Expiración PEREZOSA: no hay cron. Cada vez que se listan o se responden
 * regalos, los PENDIENTES vencidos se marcan EXPIRADO y se devuelven los usos
 * al remitente. Así el sistema es correcto sin infraestructura extra.
 */

export interface RegaloItem {
  id: string
  tipo: string
  estado: string
  usos: number
  mensaje: string | null
  beneficio: string
  /** Nombre enmascarado de la otra parte. */
  contraparte: string
  expiraAt: Date
  createdAt: Date
  resueltoAt: Date | null
}

function enmascarar(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[1][0]?.toUpperCase() ?? ''}.`
}

/** Devuelve usos reservados al remitente de un regalo que no prosperó. */
export async function devolverUsos(regalo: {
  compraOrigenId: string | null
  membershipOrigenId: string | null
  usos: number
}) {
  if (regalo.compraOrigenId) {
    await prisma.productoCompra.update({
      where: { id: regalo.compraOrigenId },
      data: { usosRestantes: { increment: regalo.usos }, consumidaAt: null, estado: 'ACTIVA' },
    })
  } else if (regalo.membershipOrigenId) {
    await prisma.membership.update({
      where: { id: regalo.membershipOrigenId },
      data: { lavadosRestantes: { increment: regalo.usos } },
    })
  }
}

/** Marca EXPIRADO todo pendiente vencido del cliente (como remitente o receptor) y devuelve usos. */
export async function expirarPendientesVencidos(clienteId: string) {
  const vencidos = await prisma.regalo.findMany({
    where: {
      estado: 'PENDIENTE',
      expiraAt: { lt: new Date() },
      OR: [{ remitenteId: clienteId }, { destinatarioId: clienteId }],
    },
    select: { id: true, compraOrigenId: true, membershipOrigenId: true, usos: true },
  })
  for (const r of vencidos) {
    // Guard atómico: solo el primero en marcarlo devuelve los usos.
    const upd = await prisma.regalo.updateMany({
      where: { id: r.id, estado: 'PENDIENTE' },
      data: { estado: 'EXPIRADO', resueltoAt: new Date() },
    })
    if (upd.count > 0) await devolverUsos(r).catch((e) => console.error('[regalos] refund exp', e))
  }
}

/** Nombre legible del contenido de un regalo (promo, plan o lavados del plan). */
async function etiquetaBeneficio(r: {
  compraOrigenId: string | null
  membershipOrigenId: string | null
  promocionId: string | null
  planId?: string | null
  usos: number
}): Promise<string> {
  if (r.promocionId) {
    const p = await prisma.promocion.findUnique({
      where: { id: r.promocionId },
      select: { titulo: true },
    })
    if (p) return p.titulo
  }
  if (r.planId) {
    const p = await prisma.plan.findUnique({
      where: { id: r.planId },
      select: { nombre: true },
    })
    if (p) return `Membresía ${p.nombre}`
  }
  if (r.membershipOrigenId) return `${r.usos} lavado${r.usos !== 1 ? 's' : ''} del plan`
  return 'Beneficio'
}

export async function getRegalosCliente(clienteId: string): Promise<{
  recibidos: RegaloItem[]
  enviados: RegaloItem[]
  pendientesRecibidos: number
}> {
  await expirarPendientesVencidos(clienteId).catch(anotarFallo('regalos:expirar-pendientes'))

  const regalos = await prisma.regalo.findMany({
    where: { OR: [{ remitenteId: clienteId }, { destinatarioId: clienteId }] },
    include: {
      remitente: { select: { nombre: true } },
      destinatario: { select: { nombre: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

  const items = await Promise.all(
    regalos.map(async (r) => ({
      raw: r,
      item: {
        id: r.id,
        tipo: r.tipo,
        estado: r.estado,
        usos: r.usos,
        mensaje: r.mensaje,
        beneficio: await etiquetaBeneficio(r),
        contraparte:
          r.remitenteId === clienteId
            ? r.destinatario
              ? enmascarar(r.destinatario.nombre)
              : (r.destinatarioContacto ?? '—')
            : enmascarar(r.remitente.nombre),
        expiraAt: r.expiraAt,
        createdAt: r.createdAt,
        resueltoAt: r.resueltoAt,
      } satisfies RegaloItem,
    }))
  )

  const recibidos = items.filter((x) => x.raw.destinatarioId === clienteId).map((x) => x.item)
  const enviados = items.filter((x) => x.raw.remitenteId === clienteId).map((x) => x.item)
  return {
    recibidos,
    enviados,
    pendientesRecibidos: recibidos.filter((i) => i.estado === 'PENDIENTE').length,
  }
}

export interface OpcionRegalo {
  tipo: 'PROMOCION' | 'PLAN'
  id: string
  titulo: string
  precio: number
  detalle: string | null
}

/**
 * Qué se puede REGALAR (pagado): promociones vigentes con precio real y
 * planes activos de la empresa (R3).
 */
export async function getOpcionesRegalo(companyId: string): Promise<OpcionRegalo[]> {
  const now = new Date()
  const [promos, planes] = await Promise.all([
    prisma.promocion.findMany({
      where: {
        companyId,
        activo: true,
        archivada: false,
        precio: { gt: 0 },
        vigenciaDesde: { lte: now },
        OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
      },
      select: { id: true, titulo: true, precio: true, usosPorCompra: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.plan.findMany({
      where: { companyId, activo: true },
      select: { id: true, nombre: true, precio: true, lavadosIncluidos: true, vigenciaDias: true },
      orderBy: { orden: 'asc' },
      take: 12,
    }),
  ])
  return [
    ...promos.map((p) => ({
      tipo: 'PROMOCION' as const,
      id: p.id,
      titulo: p.titulo,
      precio: Number(p.precio ?? 0),
      detalle: `${p.usosPorCompra} uso${p.usosPorCompra !== 1 ? 's' : ''}`,
    })),
    ...planes.map((p) => ({
      tipo: 'PLAN' as const,
      id: p.id,
      titulo: `Membresía ${p.nombre}`,
      precio: Number(p.precio),
      detalle: `${p.lavadosIncluidos} lavado${p.lavadosIncluidos !== 1 ? 's' : ''} · ${p.vigenciaDias} días`,
    })),
  ]
}

export interface FuenteTransferencia {
  /** 'COMPRA' (wallet) o 'MEMBRESIA' (lavados del plan). */
  origen: 'COMPRA' | 'MEMBRESIA'
  id: string
  titulo: string
  disponibles: number
}

/**
 * De dónde puede transferir el cliente: compras ACTIVAS pagadas con usos
 * (anti-farmeo: los beneficios gratis de campaña/ruleta/bienvenida nacen con
 * precio 0 y NO son transferibles) + su membresía activa con lavados.
 */
export async function getFuentesTransferencia(
  clienteId: string
): Promise<FuenteTransferencia[]> {
  const [compras, membresia] = await Promise.all([
    prisma.productoCompra.findMany({
      where: {
        clienteId,
        estado: 'ACTIVA',
        usosRestantes: { gt: 0 },
        promocionId: { not: null },
        precioCongelado: { gt: 0 },
      },
      select: {
        id: true,
        usosRestantes: true,
        promocion: { select: { titulo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.membership.findFirst({
      where: {
        cliente: { id: clienteId },
        estado: 'ACTIVA',
        lavadosRestantes: { gt: 0 },
        OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
      },
      select: { id: true, lavadosRestantes: true, plan: { select: { nombre: true } } },
    }),
  ])

  const fuentes: FuenteTransferencia[] = compras.map((c) => ({
    origen: 'COMPRA' as const,
    id: c.id,
    titulo: c.promocion?.titulo ?? 'Promoción',
    disponibles: c.usosRestantes,
  }))
  if (membresia) {
    fuentes.push({
      origen: 'MEMBRESIA',
      id: membresia.id,
      titulo: `Lavados de mi ${membresia.plan.nombre}`,
      disponibles: membresia.lavadosRestantes,
    })
  }
  return fuentes
}

// ── Fase R4 · Vista admin ────────────────────────────────────────────────────

export const TIPO_REGALO_LABEL: Record<string, string> = {
  TRANSFERENCIA_USOS: 'Transferencia de usos',
  REGALO_COMPRA: 'Promoción regalada',
  REGALO_MEMBRESIA: 'Membresía regalada',
}

export const ESTADO_REGALO_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  EXPIRADO: 'Expirado',
  CANCELADO: 'Cancelado',
}

export interface RegaloAdminItem {
  id: string
  tipo: string
  estado: string
  usos: number
  beneficio: string
  /** Nombre COMPLETO del remitente (vista interna del negocio). */
  remitente: string
  /** Nombre completo del destinatario, o su contacto si aún no tiene cuenta. */
  destinatario: string
  /** true si el receptor todavía no tiene cuenta (destinatarioContacto). */
  sinCuenta: boolean
  mensaje: string | null
  createdAt: Date
  expiraAt: Date
  resueltoAt: Date | null
}

export interface RegalosAdminKpis {
  total: number
  pendientes: number
  aceptados: number
  expirados: number
  /** % de regalos resueltos que terminaron aceptados (sin contar cancelados). */
  tasaAceptacion: number | null
}

export interface RegaloAdminFiltro {
  estado?: string
  tipo?: string
}

/**
 * Panel admin de regalos P2P: quién regaló qué a quién, con KPIs del programa.
 * Los KPIs se calculan sobre TODOS los regalos de la empresa; el listado se
 * limita a los 100 más recientes según el filtro.
 */
export async function getRegalosAdmin(
  companyId: string,
  filtro: RegaloAdminFiltro = {}
): Promise<{ items: RegaloAdminItem[]; kpis: RegalosAdminKpis; truncado: boolean }> {
  const estados = ['PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'EXPIRADO', 'CANCELADO']
  const tipos = ['TRANSFERENCIA_USOS', 'REGALO_COMPRA', 'REGALO_MEMBRESIA']

  const where = {
    companyId,
    ...(filtro.estado && estados.includes(filtro.estado)
      ? { estado: filtro.estado as never }
      : {}),
    ...(filtro.tipo && tipos.includes(filtro.tipo) ? { tipo: filtro.tipo as never } : {}),
  }

  const TAKE = 100
  const [regalos, porEstado] = await Promise.all([
    prisma.regalo.findMany({
      where,
      include: {
        remitente: { select: { nombre: true } },
        destinatario: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TAKE + 1,
    }),
    prisma.regalo.groupBy({
      by: ['estado'],
      where: { companyId },
      _count: { _all: true },
    }),
  ])

  const conteo = (estado: string) =>
    porEstado.find((g) => g.estado === estado)?._count._all ?? 0
  const total = porEstado.reduce((acc, g) => acc + g._count._all, 0)
  const aceptados = conteo('ACEPTADO')
  const resueltosSinCancelar = aceptados + conteo('RECHAZADO') + conteo('EXPIRADO')

  const items = await Promise.all(
    regalos.slice(0, TAKE).map(async (r) => ({
      id: r.id,
      tipo: r.tipo,
      estado: r.estado,
      usos: r.usos,
      beneficio: await etiquetaBeneficio(r),
      remitente: r.remitente.nombre,
      destinatario: r.destinatario?.nombre ?? r.destinatarioContacto ?? '—',
      sinCuenta: !r.destinatarioId,
      mensaje: r.mensaje,
      createdAt: r.createdAt,
      expiraAt: r.expiraAt,
      resueltoAt: r.resueltoAt,
    }))
  )

  return {
    items,
    truncado: regalos.length > TAKE,
    kpis: {
      total,
      pendientes: conteo('PENDIENTE'),
      aceptados,
      expirados: conteo('EXPIRADO'),
      tasaAceptacion:
        resueltosSinCancelar > 0
          ? Math.round((aceptados / resueltosSinCancelar) * 100)
          : null,
    },
  }
}
