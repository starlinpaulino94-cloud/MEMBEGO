import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * CÓDIGOS Y REGALOS — lo que un cliente le paga a otro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA CATEGORÍA Y NO «CUPONES»
 *
 * El plan del rediseño pedía una categoría de cupones. No existe: no hay modelo
 * `Cupon` en el esquema, y `BeneficioTipo.COUPON` y `TransactionTipo.COUPON_USE`
 * están declarados sin que ningún código los escriba. Un reporte de cupones
 * daría cero en todas sus cifras, y un cero se lee como una afirmación sobre el
 * negocio.
 *
 * Lo que SÍ existe, con dato de primera, son las dos formas en que un cliente
 * paga por otro:
 *
 *  · `Regalo` — regalar usos, una promoción o un plan a otra persona. Nunca se
 *    aplica solo: el receptor lo acepta, lo rechaza o se le vence.
 *  · `GiftCard` — monto abierto que el destinatario consume mostrando su código.
 *
 * Las dos llevan sus fechas de desenlace escritas (`resueltoAt`, `activadaAt`),
 * así que el ciclo entero se puede fechar de verdad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PUEDE FECHAR, Y SE DICE
 *
 * EL CONSUMO DE UNA GIFT CARD NO TIENE FILA PROPIA. Consumir baja `saldo` con
 * un `decrement` y no deja un registro con su fecha. La transacción que sí se
 * emite es de tipo `BENEFIT_USE`, y ese tipo lo comparten CUATRO flujos —
 * ofertas privadas, gift cards y regalos—, así que contarla como «consumos de
 * gift card» mezclaría cosas distintas.
 *
 * Por eso lo consumido va como ACUMULADO (`monto − saldo`) y no como cifra del
 * periodo. Enseñarlo fechado sería inventar un reloj que no existe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA TASA DE ACEPTACIÓN SALE DE LOS CERRADOS, Y SIN LOS CANCELADOS
 *
 * Sobre el total, una tanda de regalos recién enviados daría una aceptación
 * baja que no fue: todavía no les ha dado tiempo. Y un regalo CANCELADO lo
 * retira quien lo envía, no lo rechaza quien lo recibe: meterlo en el
 * denominador castigaría al negocio por una decisión del remitente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SALDO VIVO ES UN PASIVO, NO UN INGRESO
 *
 * El dinero de una gift card entra cuando se paga, pero el negocio todavía debe
 * el servicio. El reporte lo enseña rotulado como lo que es —dinero cobrado y
 * pendiente de entregar—, porque sumarlo a los ingresos del mes lo contaría dos
 * veces: una al venderse y otra al consumirse.
 *
 * El dinero va detrás de `ver_financieros` y los nombres detrás de
 * `ver_datos_personales`; los dos permisos se resuelven en la CONSULTA, porque
 * la exportación reusa esta misma función.
 */

type Tx = Prisma.TransactionClient

/** Los tres tipos de regalo, del enum `RegaloTipo`. */
export const TIPOS_REGALO = [
  { clave: 'TRANSFERENCIA_USOS', nombre: 'Usos transferidos' },
  { clave: 'REGALO_COMPRA', nombre: 'Promoción regalada' },
  { clave: 'REGALO_MEMBRESIA', nombre: 'Membresía regalada' },
] as const

/**
 * Los desenlaces de un regalo. `PENDIENTE` no está: no es un desenlace, es la
 * espera — y se enseña aparte, como foto de hoy.
 */
export const DESENLACES_REGALO = [
  { clave: 'ACEPTADO', nombre: 'Aceptados', cierra: true },
  { clave: 'RECHAZADO', nombre: 'Rechazados', cierra: true },
  { clave: 'EXPIRADO', nombre: 'Vencidos sin responder', cierra: true },
  // Lo retira quien envía, no lo rechaza quien recibe: cuenta como movimiento
  // pero NO entra en el denominador de la tasa de aceptación.
  { clave: 'CANCELADO', nombre: 'Retirados por quien los envió', cierra: false },
] as const

/** Cuántos remitentes lista la tabla de quién más regala. */
const TOPE_TOP = 20
/** Cuántos días mira «vence pronto». */
const DIAS_VENCE_PRONTO = 7

export interface FilaRegalo {
  clave: string
  nombre: string
  total: number
}

export interface PuntoRegalos {
  dia: string
  enviados: number
  aceptados: number
}

export interface Remitente {
  id: string
  nombre: string
  enviados: number
}

export interface ReporteRegalos {
  // ── Regalos entre clientes, del periodo ───────────────────────────────────
  enviados: Kpi
  aceptados: Kpi
  /** Aceptados ÷ cerrados. `null` = ninguno se cerró en el periodo. */
  tasaAceptacion: number | null
  porTipo: FilaRegalo[]
  /** Cómo acabaron los que se resolvieron DENTRO del periodo. */
  desenlaces: FilaRegalo[]
  /**
   * De los enviados, cuántos iban a alguien SIN cuenta todavía. Es la puerta
   * de entrada que un regalo abre sin que nadie la llame invitación.
   */
  aQuienNoTieneCuenta: number

  // ── Gift cards, del periodo ───────────────────────────────────────────────
  emitidas: Kpi
  activadas: Kpi
  /** `null` = sin permiso. Monto de las gift cards ACTIVADAS en el periodo. */
  vendido: Kpi | null

  // ── Foto de hoy (no depende del periodo) ──────────────────────────────────
  esperando: {
    regalosPendientes: number
    regalosVencenPronto: number
    giftCardsPorPagar: number
  }
  /** Dinero cobrado y pendiente de entregar. Es un PASIVO, no un ingreso. */
  saldoVivo: { tarjetas: number; monto: number | null }
  /** Acumulado sin fecha: lo que ya se consumió de todas las gift cards. */
  consumidoAcumulado: number | null

  serie: PuntoRegalos[]
  /** `null` = sin permiso `ver_datos_personales`. */
  topRemitentes: Remitente[] | null
  incompleto: boolean
}

/** Regalos que se RESOLVIERON dentro del periodo, por desenlace. */
async function desenlacesEnPeriodo(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Map<string, number>> {
  const filas = await tx.regalo.groupBy({
    by: ['estado'],
    where: { companyId, resueltoAt: { gte: rango.desde, lt: rango.hasta } },
    _count: { _all: true },
  })
  return new Map(filas.map((f) => [f.estado, f._count._all]))
}

/** Enviados y aceptados por día, cortados en la zona horaria del negocio. */
async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoRegalos[]> {
  // Dos relojes distintos en la misma consulta: el envío se fecha por
  // `createdAt` y la aceptación por `resueltoAt`. Un regalo enviado el lunes y
  // aceptado el jueves aparece en los dos días, en su columna.
  const filas = await tx.$queryRaw<{ dia: string; enviados: bigint; aceptados: bigint }[]>`
    SELECT dia, sum(enviados) AS enviados, sum(aceptados) AS aceptados
      FROM (
        SELECT to_char(("createdAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
               count(*) AS enviados,
               0::bigint AS aceptados
          FROM "regalos"
         WHERE "companyId" = ${companyId}
           AND "createdAt" >= ${rango.desde}
           AND "createdAt" <  ${rango.hasta}
         GROUP BY 1
        UNION ALL
        SELECT to_char(("resueltoAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
               0::bigint AS enviados,
               count(*) AS aceptados
          FROM "regalos"
         WHERE "companyId" = ${companyId}
           AND "estado" = 'ACEPTADO'
           AND "resueltoAt" >= ${rango.desde}
           AND "resueltoAt" <  ${rango.hasta}
         GROUP BY 1
      ) AS union_dias
     GROUP BY 1
  `
  const porDia = new Map<string, PuntoRegalos>()
  for (const dia of diasDelRango(rango)) porDia.set(dia, { dia, enviados: 0, aceptados: 0 })
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (!punto) continue
    punto.enviados += Number(f.enviados)
    punto.aceptados += Number(f.aceptados)
  }
  return [...porDia.values()]
}

/** Quién más regala en el periodo, por cuántos ENVIÓ. */
async function quienMasRegala(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Remitente[]> {
  const filas = await tx.regalo.groupBy({
    by: ['remitenteId'],
    where: { companyId, createdAt: { gte: rango.desde, lt: rango.hasta } },
    _count: { _all: true },
    orderBy: { _count: { remitenteId: 'desc' } },
    take: TOPE_TOP,
  })
  const ids = filas.map((f) => f.remitenteId)
  if (ids.length === 0) return []
  // Acotado a los clientes DE ESTA EMPRESA: nunca se llega a una persona por
  // su usuario global, que es compartido entre negocios.
  const nombres = await tx.cliente.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, nombre: true },
  })
  const mapa = new Map(nombres.map((c) => [c.id, c.nombre]))
  return filas.map((f) => ({
    id: f.remitenteId,
    nombre: mapa.get(f.remitenteId) ?? '(cliente eliminado)',
    enviados: f._count._all,
  }))
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/regalos]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteRegalos(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: {
    verFinancieros?: boolean
    verDatosPersonales?: boolean
    ahora?: Date
  } = {}
): Promise<ReporteRegalos> {
  const fallos = { n: 0 }
  const ahora = opciones.ahora ?? new Date()
  const verDinero = opciones.verFinancieros === true
  const prontito = new Date(ahora.getTime() + DIAS_VENCE_PRONTO * 24 * 60 * 60 * 1000)

  const creadosEn = (r: { desde: Date; hasta: Date }) => ({
    companyId,
    createdAt: { gte: r.desde, lt: r.hasta },
  })

  const [
    enviados,
    enviadosAnt,
    desenlaces,
    desenlacesAnt,
    tipos,
    sinCuenta,
    pendientes,
    vencenPronto,
    emitidas,
    emitidasAnt,
    activadas,
    activadasAnt,
    vendido,
    vendidoAnt,
    porPagar,
    saldo,
    consumido,
    serie,
    top,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(tx.regalo.count({ where: creadosEn(rango) }), 0, fallos),
      seguro(tx.regalo.count({ where: creadosEn(rango.anterior) }), 0, fallos),
      seguro(desenlacesEnPeriodo(tx, companyId, rango), new Map<string, number>(), fallos),
      seguro(
        desenlacesEnPeriodo(tx, companyId, rango.anterior),
        new Map<string, number>(),
        fallos
      ),
      seguro(
        tx.regalo.groupBy({ by: ['tipo'], where: creadosEn(rango), _count: { _all: true } }),
        [] as { tipo: string; _count: { _all: number } }[],
        fallos
      ),
      // Un regalo a alguien sin cuenta es una puerta de entrada al negocio que
      // nadie llama invitación. Se cuenta, porque se puede.
      seguro(
        tx.regalo.count({ where: { ...creadosEn(rango), destinatarioId: null } }),
        0,
        fallos
      ),
      // ── Foto de hoy ──────────────────────────────────────────────────────
      seguro(tx.regalo.count({ where: { companyId, estado: 'PENDIENTE' } }), 0, fallos),
      seguro(
        tx.regalo.count({
          where: { companyId, estado: 'PENDIENTE', expiraAt: { gte: ahora, lt: prontito } },
        }),
        0,
        fallos
      ),
      // ── Gift cards ───────────────────────────────────────────────────────
      seguro(tx.giftCard.count({ where: creadosEn(rango) }), 0, fallos),
      seguro(tx.giftCard.count({ where: creadosEn(rango.anterior) }), 0, fallos),
      seguro(
        tx.giftCard.count({
          where: { companyId, activadaAt: { gte: rango.desde, lt: rango.hasta } },
        }),
        0,
        fallos
      ),
      seguro(
        tx.giftCard.count({
          where: { companyId, activadaAt: { gte: rango.anterior.desde, lt: rango.anterior.hasta } },
        }),
        0,
        fallos
      ),
      // Sin el permiso la consulta del dinero NI SE LANZA: la exportación usa
      // esta misma función.
      verDinero
        ? seguro(
            tx.giftCard.aggregate({
              where: { companyId, activadaAt: { gte: rango.desde, lt: rango.hasta } },
              _sum: { monto: true },
            }),
            { _sum: { monto: null } },
            fallos
          )
        : Promise.resolve({ _sum: { monto: null } }),
      verDinero
        ? seguro(
            tx.giftCard.aggregate({
              where: {
                companyId,
                activadaAt: { gte: rango.anterior.desde, lt: rango.anterior.hasta },
              },
              _sum: { monto: true },
            }),
            { _sum: { monto: null } },
            fallos
          )
        : Promise.resolve({ _sum: { monto: null } }),
      seguro(
        tx.giftCard.count({ where: { companyId, estado: 'PENDIENTE_PAGO' } }),
        0,
        fallos
      ),
      seguro(
        tx.giftCard.aggregate({
          where: { companyId, estado: 'ACTIVA' },
          _count: { _all: true },
          ...(verDinero ? { _sum: { saldo: true } } : {}),
        }),
        { _count: { _all: 0 }, _sum: { saldo: null } },
        fallos
      ),
      // Lo consumido NO se puede fechar —el saldo baja sin dejar fila— así que
      // sale como acumulado: lo vendido menos lo que queda por gastar.
      verDinero
        ? seguro(
            tx.giftCard.aggregate({
              where: { companyId, estado: { in: ['ACTIVA', 'AGOTADA'] } },
              _sum: { monto: true, saldo: true },
            }),
            { _sum: { monto: null, saldo: null } },
            fallos
          )
        : Promise.resolve({ _sum: { monto: null, saldo: null } }),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoRegalos[], fallos),
      opciones.verDatosPersonales === true
        ? seguro(quienMasRegala(tx, companyId, rango), [] as Remitente[], fallos)
        : Promise.resolve(null),
    ])
  )

  const aceptados = desenlaces.get('ACEPTADO') ?? 0
  const aceptadosAnt = desenlacesAnt.get('ACEPTADO') ?? 0
  // Solo los que de verdad cerraron, y sin los que retiró quien los envió.
  const cerrados = DESENLACES_REGALO.filter((d) => d.cierra).reduce(
    (s, d) => s + (desenlaces.get(d.clave) ?? 0),
    0
  )

  const porTipo = TIPOS_REGALO.map((t) => ({
    clave: t.clave,
    nombre: t.nombre,
    total: tipos.find((f) => f.tipo === t.clave)?._count._all ?? 0,
  }))

  const saldoVivoMonto = verDinero ? Number(saldo._sum?.saldo ?? 0) : null
  const consumidoMonto = verDinero
    ? Number(consumido._sum.monto ?? 0) - Number(consumido._sum.saldo ?? 0)
    : null

  return {
    enviados: kpi(enviados, enviadosAnt),
    aceptados: kpi(aceptados, aceptadosAnt),
    // Sin cierres no es 0 %: es «sin dato». Un 0 % diría que nadie aceptó, y lo
    // que pasó es que nadie llegó a responder todavía.
    tasaAceptacion: cerrados === 0 ? null : Math.round((aceptados / cerrados) * 100),
    porTipo,
    desenlaces: DESENLACES_REGALO.map((d) => ({
      clave: d.clave,
      nombre: d.nombre,
      total: desenlaces.get(d.clave) ?? 0,
    })),
    aQuienNoTieneCuenta: sinCuenta,
    emitidas: kpi(emitidas, emitidasAnt),
    activadas: kpi(activadas, activadasAnt),
    vendido: verDinero
      ? kpi(Number(vendido._sum.monto ?? 0), Number(vendidoAnt._sum.monto ?? 0))
      : null,
    esperando: {
      regalosPendientes: pendientes,
      regalosVencenPronto: vencenPronto,
      giftCardsPorPagar: porPagar,
    },
    saldoVivo: { tarjetas: saldo._count._all, monto: saldoVivoMonto },
    consumidoAcumulado: consumidoMonto,
    serie,
    topRemitentes: top,
    incompleto: fallos.n > 0,
  }
}
