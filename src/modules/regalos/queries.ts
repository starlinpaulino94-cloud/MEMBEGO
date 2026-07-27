import { prisma } from '@/lib/prisma'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Regalos P2P · Fase R2 — consultas del módulo /cliente/regalos.
 *
 * Expiración PEREZOSA: no hay cron. Cada vez que se listan o se responden
 * regalos, los PENDIENTES vencidos se marcan EXPIRADO y se devuelven los usos
 * al remitente. Así el sistema es correcto sin infraestructura extra.
 */

/**
 * PENDIENTE significa DOS COSAS DISTINTAS, y confundirlas es lo que hacía
 * incomprensible el módulo:
 *
 *  · 'RESPUESTA' — el regalo ya está pagado (o no cuesta nada: son usos que el
 *    remitente ya tenía) y solo falta que el destinatario lo acepte o lo
 *    rechace. Aquí sí hay botones de Aceptar / Rechazar.
 *
 *  · 'PAGO' — el regalo lo está PAGANDO el remitente. El destinatario no tiene
 *    nada que decidir: cuando el pago se confirme, el beneficio le llega solo.
 *    Mostrarle "Aceptar" aquí no solo confunde: `responderRegalo` no sabe
 *    entregar este tipo y devolvía "contenido no válido".
 *
 * De ahí salía el "solo me aparece Cancelar": el remitente veía su propio
 * regalo pendiente sin ninguna pista de que lo pendiente era SU pago.
 */
export type EsperaRegalo = 'RESPUESTA' | 'PAGO'

/** Cómo completar el pago de un regalo que lo requiere. */
export interface PagoDelRegalo {
  /** Referencia para cobrar en caja o citar en la transferencia. */
  referencia: string | null
  /** A dónde va el REMITENTE a completar el pago. */
  href: string | null
  /** Estado del pago en el flujo normal (PENDIENTE_PAGO, EN_VALIDACION…). */
  estado: string | null
  /** true = el pago ya se confirmó y el beneficio se entregó. */
  pagado: boolean
}

export interface RegaloItem {
  id: string
  tipo: string
  estado: string
  usos: number
  mensaje: string | null
  beneficio: string
  /** Nombre enmascarado de la otra parte. */
  contraparte: string
  /** Qué falta para que el regalo se complete. Solo con estado PENDIENTE. */
  espera: EsperaRegalo | null
  /** Solo cuando `espera === 'PAGO'`. */
  pago: PagoDelRegalo | null
  expiraAt: Date
  createdAt: Date
  resueltoAt: Date | null
}

/** Los regalos que el remitente paga; el destinatario no decide nada. */
const TIPOS_CON_PAGO = new Set(['REGALO_COMPRA', 'REGALO_MEMBRESIA'])

export function esperaDe(tipo: string, estado: string): EsperaRegalo | null {
  if (estado !== 'PENDIENTE') return null
  return TIPOS_CON_PAGO.has(tipo) ? 'PAGO' : 'RESPUESTA'
}

/**
 * Resuelve, en dos consultas para toda la lista, dónde está el pago de cada
 * regalo que lo requiere. Se hace en lote a propósito: hacerlo por fila daría
 * una consulta por regalo.
 */
async function resolverPagos(
  regalos: { id: string; tipo: string; estado: string; compraDestinoId: string | null; membershipDestinoId: string | null }[]
): Promise<Map<string, PagoDelRegalo>> {
  const mapa = new Map<string, PagoDelRegalo>()
  const conPago = regalos.filter((r) => esperaDe(r.tipo, r.estado) === 'PAGO')
  if (conPago.length === 0) return mapa

  const compraIds = conPago.map((r) => r.compraDestinoId).filter((x): x is string => !!x)
  const memIds = conPago.map((r) => r.membershipDestinoId).filter((x): x is string => !!x)

  const [compras, membresias] = await Promise.all([
    compraIds.length
      ? prisma.productoCompra
          .findMany({
            where: { id: { in: compraIds } },
            select: { id: true, estado: true, referencia: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    memIds.length
      ? prisma.membership
          .findMany({
            where: { id: { in: memIds } },
            select: { id: true, estado: true, referencia: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  const porCompra = new Map(compras.map((c) => [c.id, c]))
  const porMembresia = new Map(membresias.map((m) => [m.id, m]))

  for (const r of conPago) {
    if (r.compraDestinoId) {
      const c = porCompra.get(r.compraDestinoId)
      mapa.set(r.id, {
        referencia: c?.referencia ?? null,
        // La compra vive en la wallet del REMITENTE hasta que se paga: ahí
        // están las cuentas y el formulario de comprobante.
        href: `/cliente/mis-promociones/${r.compraDestinoId}`,
        estado: c?.estado ?? null,
        pagado: c?.estado === 'ACTIVA',
      })
    } else if (r.membershipDestinoId) {
      const m = porMembresia.get(r.membershipDestinoId)
      mapa.set(r.id, {
        referencia: m?.referencia ?? null,
        // La membresía es del AMIGO, así que el remitente no puede abrirla:
        // paga en caja citando la referencia. Sin href, con referencia.
        href: null,
        estado: m?.estado ?? null,
        pagado: m?.estado === 'ACTIVA',
      })
    }
  }
  return mapa
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

  const pagos = await resolverPagos(regalos)

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
        espera: esperaDe(r.tipo, r.estado),
        pago: pagos.get(r.id) ?? null,
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
    // Solo los que REQUIEREN una decisión suya. Un regalo que su amigo está
    // pagando no es una tarea pendiente del destinatario, y contarlo como tal
    // pone un contador rojo sobre algo en lo que no puede hacer nada.
    pendientesRecibidos: recibidos.filter((i) => i.espera === 'RESPUESTA').length,
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
  /** Qué falta: que el destinatario responda, o que entre el pago. */
  espera: EsperaRegalo | null
  /** Referencia y estado del cobro, cuando `espera === 'PAGO'`. */
  pago: PagoDelRegalo | null
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

  const visibles = regalos.slice(0, TAKE)
  const pagos = await resolverPagos(visibles)

  const items = await Promise.all(
    visibles.map(async (r) => ({
      id: r.id,
      tipo: r.tipo,
      estado: r.estado,
      usos: r.usos,
      beneficio: await etiquetaBeneficio(r),
      remitente: r.remitente.nombre,
      destinatario: r.destinatario?.nombre ?? r.destinatarioContacto ?? '—',
      sinCuenta: !r.destinatarioId,
      espera: esperaDe(r.tipo, r.estado),
      pago: pagos.get(r.id) ?? null,
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
