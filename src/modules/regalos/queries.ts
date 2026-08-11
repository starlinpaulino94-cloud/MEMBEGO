import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import type { Tx } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { misClienteIds } from '@/modules/cliente/afiliacion'

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
  regalos: { id: string; tipo: string; estado: string; compraDestinoId: string | null; membershipDestinoId: string | null }[],
  tx: Tx
): Promise<Map<string, PagoDelRegalo>> {
  const mapa = new Map<string, PagoDelRegalo>()
  const conPago = regalos.filter((r) => esperaDe(r.tipo, r.estado) === 'PAGO')
  if (conPago.length === 0) return mapa

  const compraIds = conPago.map((r) => r.compraDestinoId).filter((x): x is string => !!x)
  const memIds = conPago.map((r) => r.membershipDestinoId).filter((x): x is string => !!x)

  const [compras, membresias] = await Promise.all([
    compraIds.length
      ? tx.productoCompra
          .findMany({
            where: { id: { in: compraIds } },
            select: { id: true, estado: true, referencia: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    memIds.length
      ? tx.membership
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
export async function devolverUsos(
  regalo: {
    compraOrigenId: string | null
    membershipOrigenId: string | null
    usos: number
  },
  tx?: Tx
) {
  const devolver = async (db: Tx) => {
    if (regalo.compraOrigenId) {
      await db.productoCompra.update({
        where: { id: regalo.compraOrigenId },
        data: { usosRestantes: { increment: regalo.usos }, consumidaAt: null, estado: 'ACTIVA' },
      })
    } else if (regalo.membershipOrigenId) {
      await db.membership.update({
        where: { id: regalo.membershipOrigenId },
        data: { lavadosRestantes: { increment: regalo.usos } },
      })
    }
  }
  if (tx) return devolver(tx)
  return sinEmpresa(
    'regalos: devolver usos reservados (origen por id, empresa no conocida)',
    devolver
  )
}

/** Marca EXPIRADO todo pendiente vencido del cliente (como remitente o receptor) y devuelve usos. */
export async function expirarPendientesVencidos(clienteIds: string[], tx: Tx) {
  if (clienteIds.length === 0) return
  const vencidos = await tx.regalo.findMany({
    where: {
      estado: 'PENDIENTE',
      expiraAt: { lt: new Date() },
      OR: [{ remitenteId: { in: clienteIds } }, { destinatarioId: { in: clienteIds } }],
    },
    select: { id: true, compraOrigenId: true, membershipOrigenId: true, usos: true },
  })
  for (const r of vencidos) {
    // Guard atómico: solo el primero en marcarlo devuelve los usos.
    const upd = await tx.regalo.updateMany({
      where: { id: r.id, estado: 'PENDIENTE' },
      data: { estado: 'EXPIRADO', resueltoAt: new Date() },
    })
    if (upd.count > 0) await devolverUsos(r, tx).catch((e) => console.error('[regalos] refund exp', e))
  }
}

interface RegaloParaEtiqueta {
  id: string
  compraOrigenId: string | null
  membershipOrigenId: string | null
  promocionId: string | null
  planId?: string | null
  usos: number
}

/**
 * Nombres legibles del contenido de VARIOS regalos, en dos consultas para toda
 * la lista (promociones + planes) en vez de un findUnique por regalo. El
 * fallback es idéntico a la versión por fila: promoción si existe, luego plan,
 * luego lavados del plan, luego genérico.
 */
async function resolverEtiquetas(regalos: RegaloParaEtiqueta[], tx: Tx): Promise<Map<string, string>> {
  const promocionIds = regalos.map((r) => r.promocionId).filter((x): x is string => !!x)
  const planIds = regalos.map((r) => r.planId).filter((x): x is string => !!x)

  const [promociones, planes] = await Promise.all([
    promocionIds.length
      ? tx.promocion.findMany({
          where: { id: { in: promocionIds } },
          select: { id: true, titulo: true },
        })
      : Promise.resolve([]),
    planIds.length
      ? tx.plan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([]),
  ])

  const tituloDe = new Map(promociones.map((p) => [p.id, p.titulo]))
  const nombreDe = new Map(planes.map((p) => [p.id, p.nombre]))

  const mapa = new Map<string, string>()
  for (const r of regalos) {
    if (r.promocionId && tituloDe.has(r.promocionId)) {
      mapa.set(r.id, tituloDe.get(r.promocionId)!)
    } else if (r.planId && nombreDe.has(r.planId)) {
      mapa.set(r.id, `Membresía ${nombreDe.get(r.planId)}`)
    } else if (r.membershipOrigenId) {
      mapa.set(r.id, `${r.usos} lavado${r.usos !== 1 ? 's' : ''} del plan`)
    } else {
      mapa.set(r.id, 'Beneficio')
    }
  }
  return mapa
}

/**
 * EL CENTRO DE REGALOS ES DE LA PERSONA.
 *
 * Un regalo se envía y se recibe entre FICHAS —cada una en su empresa—, pero
 * quien mira esta pantalla es la persona. Acotarlo a la ficha activa hacía
 * desaparecer los regalos de sus otros negocios: alguien le transfería usos,
 * le llegaba la notificación, entraba a «Regalos» y no había nada. Y lo que
 * peor envejece: un regalo PENDIENTE invisible expira solo.
 *
 * Las acciones (`responderRegalo`, `cancelarRegalo`) miran las mismas fichas.
 * Migrar el listado sin migrar su acción deja un botón que contesta «este
 * regalo ya no está pendiente» sobre un regalo que sí lo está.
 */
export async function getRegalosCliente(supabaseId: string): Promise<{
  recibidos: RegaloItem[]
  enviados: RegaloItem[]
  pendientesRecibidos: number
}> {
  const misFichas = await misClienteIds(supabaseId)
  if (misFichas.length === 0) return { recibidos: [], enviados: [], pendientesRecibidos: 0 }
  const esMia = (id: string | null) => !!id && misFichas.includes(id)

  const { regalos, pagos, etiquetas } = await sinEmpresa(
    'regalos: panel del cliente por sus fichas (empresa no conocida de entrada)',
    async (tx) => {
      await expirarPendientesVencidos(misFichas, tx).catch(anotarFallo('regalos:expirar-pendientes'))

      const regalos = await tx.regalo.findMany({
        where: {
          OR: [{ remitenteId: { in: misFichas } }, { destinatarioId: { in: misFichas } }],
        },
        include: {
          remitente: { select: { nombre: true } },
          destinatario: { select: { nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
      })

      const [pagos, etiquetas] = await Promise.all([
        resolverPagos(regalos, tx),
        resolverEtiquetas(regalos, tx),
      ])
      return { regalos, pagos, etiquetas }
    }
  )

  const items = regalos.map((r) => ({
    raw: r,
    item: {
      id: r.id,
      tipo: r.tipo,
      estado: r.estado,
      usos: r.usos,
      mensaje: r.mensaje,
      beneficio: etiquetas.get(r.id) ?? 'Beneficio',
      contraparte:
        esMia(r.remitenteId)
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

  const recibidos = items.filter((x) => esMia(x.raw.destinatarioId)).map((x) => x.item)
  const enviados = items.filter((x) => esMia(x.raw.remitenteId)).map((x) => x.item)
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
  const [promos, planes] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.promocion.findMany({
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
      tx.plan.findMany({
        where: { companyId, activo: true },
        select: { id: true, nombre: true, precio: true, lavadosIncluidos: true, vigenciaDias: true },
        orderBy: { orden: 'asc' },
        take: 12,
      }),
    ])
  )
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
  const [compras, membresia] = await sinEmpresa(
    'regalos: fuentes de transferencia por clienteId (empresa no conocida de entrada)',
    (tx) =>
      Promise.all([
        tx.productoCompra.findMany({
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
        tx.membership.findFirst({
          where: {
            cliente: { id: clienteId },
            estado: 'ACTIVA',
            lavadosRestantes: { gt: 0 },
            OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
          },
          select: { id: true, lavadosRestantes: true, plan: { select: { nombre: true } } },
        }),
      ])
  )

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
  filtro: RegaloAdminFiltro = {},
  /** Ventana de la página; omitirla conserva el comportamiento anterior. */
  ventana?: { saltar: number; tomar: number }
): Promise<{
  items: RegaloAdminItem[]
  kpis: RegalosAdminKpis
  truncado: boolean
  /** Total real que cumple el filtro (para paginar). */
  totalFiltrado: number
}> {
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
  const { regalos, visibles, porEstado, totalFiltrado, pagos, etiquetas } = await conEmpresa(
    companyId,
    async (tx) => {
      const [regalos, porEstado, totalFiltrado] = await Promise.all([
        tx.regalo.findMany({
          where,
          include: {
            remitente: { select: { nombre: true } },
            destinatario: { select: { nombre: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: ventana?.saltar ?? 0,
          // Con ventana mandan página y tamaño (ya acotados por leerPaginacion);
          // sin ventana se conserva el tope viejo + 1 para detectar el corte.
          take: ventana ? ventana.tomar : TAKE + 1,
        }),
        tx.regalo.groupBy({
          by: ['estado'],
          where: { companyId },
          _count: { _all: true },
        }),
        tx.regalo.count({ where }),
      ])

      const visibles = ventana ? regalos : regalos.slice(0, TAKE)
      const [pagos, etiquetas] = await Promise.all([
        resolverPagos(visibles, tx),
        resolverEtiquetas(visibles, tx),
      ])
      return { regalos, visibles, porEstado, totalFiltrado, pagos, etiquetas }
    }
  )

  const conteo = (estado: string) =>
    porEstado.find((g) => g.estado === estado)?._count._all ?? 0
  const total = porEstado.reduce((acc, g) => acc + g._count._all, 0)
  const aceptados = conteo('ACEPTADO')
  const resueltosSinCancelar = aceptados + conteo('RECHAZADO') + conteo('EXPIRADO')

  const items = visibles.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    estado: r.estado,
    usos: r.usos,
    beneficio: etiquetas.get(r.id) ?? 'Beneficio',
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

  return {
    items,
    truncado: !ventana && regalos.length > TAKE,
    totalFiltrado,
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
