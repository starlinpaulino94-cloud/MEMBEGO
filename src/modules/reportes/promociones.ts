import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * PROMOCIONES — qué se vende, qué se entrega y qué se usa de verdad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS TRES RELOJES, Y CUÁL MARCA CADA CIFRA
 *
 * Una promoción comprada pasa por tres momentos distintos que casi nunca son
 * el mismo día, y confundirlos es la forma más fácil de que este reporte
 * mienta sin equivocarse en una suma:
 *
 *  1. SE ADQUIERE — `ProductoCompra.createdAt`. El cliente la pidió.
 *  2. SE ENTREGA — la transición a `ACTIVA` en `producto_compra_transiciones`.
 *     Es cuando el beneficio queda disponible con su QR, después de validar el
 *     pago (o directo, si era gratis).
 *  3. SE USA — una `Transaction` de tipo `PROMOTION_USE`. Es el canje real en
 *     el mostrador.
 *
 * Por eso «adquiridas», «entregadas» y «usadas» son tres cifras y no tres
 * nombres de la misma: en un periodo cualquiera se adquieren unas, se entregan
 * otras (pedidas antes) y se usan otras más (entregadas hace semanas).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * «CANJE» AQUÍ NO ES «CANJE» EN OPERACIÓN
 *
 * El reporte de Operación llama canjes a las VISITAS de membresía (`Visit`).
 * Estos son otra cosa: usos de una promoción comprada, que no generan visita y
 * por lo tanto NO están contados allí. Las dos cifras son disjuntas y ninguna
 * incluye a la otra; el vocabulario de `docs/REPORTES.md` lo recoge.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS USOS SE CUENTAN DESDE LA TRANSACCIÓN, NO RESTANDO `usosRestantes`
 *
 * Y es a propósito: REGALAR usos a un amigo también baja `usosRestantes`
 * (`modules/regalos/actions.ts`) sin que nadie haya canjeado nada. Contar por
 * diferencias metería los regalos dentro de los canjes. La transacción, en
 * cambio, solo existe cuando el mostrador validó el QR — y llega por los dos
 * caminos que canjean: el escáner del panel y la API de plataforma.
 *
 * El enlace hasta la promoción es por ID y no por el título congelado:
 * transacción → QR usado → compra → promoción. Agrupar por el texto del
 * snapshot juntaría dos promociones que se llamaron igual y partiría en dos una
 * que cambió de nombre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE REPORTE NO USA, AUNQUE LA COLUMNA EXISTA
 *
 *  · `Promocion.canjes` — declarada, leída en el marketplace y **sin una sola
 *    escritura en todo `src/`**. Vale 0 para todas, siempre. Usarla daría un
 *    ranking de ceros con pinta de dato.
 *  · `Promocion.maxCanjes` y `limitePorCliente` son CONFIGURACIÓN, no medición:
 *    dicen lo que se permite, no lo que pasó.
 *
 * Y una salvedad sobre las dos que sí se usan: `viewCount` y `shareCount` se
 * escriben desde el marketplace público con un tope por navegador y ventana
 * (`recordPromotionView`), así que son un SUELO. Además son acumuladas desde
 * siempre —no tienen fecha—, por eso van en la foto de hoy y no en el periodo.
 */

type Tx = Prisma.TransactionClient

/** Los estados de `Transaction` que significan que el canje se aplicó. */
const APLICADAS = ['APPROVED', 'APPLIED'] as const

/**
 * Los estados de compra que el reporte enseña como movimiento del periodo.
 * Salen del enum `CompraEstado`; una prueba comprueba que estén todos, para
 * que un estado nuevo no desaparezca del reporte en silencio.
 */
export const ESTADOS_COMPRA = [
  { clave: 'SOLICITADA', nombre: 'Solicitadas' },
  { clave: 'PENDIENTE_PAGO', nombre: 'Esperando pago' },
  { clave: 'EN_VALIDACION', nombre: 'Comprobante enviado' },
  { clave: 'APROBADA', nombre: 'Pago aprobado' },
  { clave: 'ACTIVA', nombre: 'Entregadas (QR emitido)' },
  { clave: 'RECHAZADA', nombre: 'Pago rechazado' },
  { clave: 'CONSUMIDA', nombre: 'Consumidas del todo' },
  { clave: 'EXPIRADA', nombre: 'Vencidas sin usar' },
  { clave: 'CANCELADA', nombre: 'Canceladas' },
] as const

/** Tope de filas por agrupación. Lo que quede fuera va en una fila «resto». */
const TOPE_GRUPOS = 30
const RESTO = '(resto, agrupado)'
const SIN_PROMOCION = '(promoción eliminada)'
/** Cuántos días mira «vence pronto». */
const DIAS_VENCE_PRONTO = 7

export interface FilaEstado {
  clave: string
  nombre: string
  /** Veces que una compra ENTRÓ a este estado dentro del periodo. */
  movimientos: number
}

export interface FilaPromocion {
  id: string
  titulo: string
  adquiridas: number
  usadas: number
}

export interface PuntoPromociones {
  dia: string
  adquiridas: number
  usadas: number
}

export interface ReportePromociones {
  // ── Del periodo ───────────────────────────────────────────────────────────
  /** Compras creadas en el periodo (`ProductoCompra.createdAt`). */
  adquiridas: Kpi
  /** Compras que pasaron a ACTIVA en el periodo: el beneficio se entregó. */
  entregadas: Kpi
  /** Canjes reales en el mostrador (`Transaction` PROMOTION_USE). */
  usadas: Kpi
  /** `null` = sin permiso `ver_financieros`. Fechado por la ENTREGA. */
  ingresos: Kpi | null

  /** Entregadas ÷ adquiridas. `null` = no hubo adquisiciones. */
  tasaEntrega: number | null

  // ── Qué se movió, estado por estado ───────────────────────────────────────
  porEstado: FilaEstado[]

  // ── Desgloses ─────────────────────────────────────────────────────────────
  topPromociones: FilaPromocion[]
  serie: PuntoPromociones[]
  /** Compras del periodo que iban dirigidas a otra persona (regalos P2P). */
  regalos: number

  // ── Foto de hoy (no depende del periodo) ──────────────────────────────────
  catalogo: {
    publicadas: number
    comprables: number
    archivadas: number
    vencenPronto: number
  }
  /** Compras esperando una decisión del negocio AHORA MISMO. */
  esperando: { enValidacion: number; pendientePago: number }
  /** Beneficios entregados y todavía sin usar, ahora mismo. */
  activasSinUsar: number
  /** Acumulado histórico de la vitrina pública. NO se puede fechar. */
  vitrina: { vistas: number; compartidos: number }

  incompleto: boolean
}

/**
 * Compras que ENTRARON a un estado dentro del periodo, según la bitácora
 * inmutable de transiciones.
 *
 * `ProductoCompra.estado` es el de HOY y se pisa a sí mismo: contar por ahí
 * diría «14 rechazadas» sin poder decir cuándo se rechazaron. La bitácora sí
 * tiene fecha por cambio, y `registrarTransicionCompra` la escribe desde los
 * diez sitios que mueven una compra.
 *
 * El `JOIN` lleva su PROPIO filtro de empresa porque la tabla de transiciones
 * no guarda `companyId`: sin él, la acotación dependería de una sola tabla.
 */
async function movimientosPorEstado(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Map<string, number>> {
  const filas = await tx.$queryRaw<{ hacia: string; total: bigint }[]>`
    SELECT t."hacia"::text AS hacia, count(*) AS total
      FROM "producto_compra_transiciones" t
      JOIN "producto_compras" pc
        ON pc."id" = t."compraId"
       AND pc."companyId" = ${companyId}
     WHERE t."createdAt" >= ${rango.desde}
       AND t."createdAt" <  ${rango.hasta}
     GROUP BY 1
  `
  return new Map(filas.map((f) => [f.hacia, Number(f.total)]))
}

/** Dinero de las promociones ENTREGADAS en el periodo. */
async function ingresosEntregados(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<number> {
  // El reloj es la entrega y no el cobro porque `ProductoCompra` no guarda una
  // fecha de pago propia —a diferencia de `Membership.fechaPago`, que es lo que
  // `whereCobrado` usa—. Se dice en la pantalla y dentro del CSV: una cifra de
  // dinero sin su reloj declarado se compara con otra que usa otro y no cuadra.
  const filas = await tx.$queryRaw<{ total: number | null }[]>`
    SELECT sum(pc."montoPagado")::float AS total
      FROM "producto_compra_transiciones" t
      JOIN "producto_compras" pc
        ON pc."id" = t."compraId"
       AND pc."companyId" = ${companyId}
     WHERE t."hacia" = 'ACTIVA'
       AND pc."pagoConfirmado" = true
       AND t."createdAt" >= ${rango.desde}
       AND t."createdAt" <  ${rango.hasta}
  `
  return Number(filas[0]?.total ?? 0)
}

/**
 * Las promociones con más movimiento: adquiridas y usadas, por ID.
 *
 * Dos consultas y no una con dos subconsultas porque cada cifra tiene su
 * propio reloj —la compra se fecha por `createdAt`, el uso por la transacción—
 * y mezclarlas en un solo `JOIN` obligaría a elegir uno de los dos.
 */
async function porPromocion(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<FilaPromocion[]> {
  const [compras, usos] = await Promise.all([
    tx.$queryRaw<{ id: string | null; titulo: string | null; total: bigint }[]>`
      SELECT p."id" AS id, p."titulo" AS titulo, count(*) AS total
        FROM "producto_compras" pc
        LEFT JOIN "promociones" p
          ON p."id" = pc."promocionId"
         AND p."companyId" = ${companyId}
       WHERE pc."companyId" = ${companyId}
         AND pc."createdAt" >= ${rango.desde}
         AND pc."createdAt" <  ${rango.hasta}
       GROUP BY 1, 2
       ORDER BY 3 DESC
       LIMIT ${TOPE_GRUPOS}
    `,
    // El camino hasta la promoción va por ID: transacción → QR usado → compra
    // → promoción. El título del snapshot juntaría dos promociones homónimas.
    tx.$queryRaw<{ id: string | null; titulo: string | null; total: bigint }[]>`
      SELECT p."id" AS id, p."titulo" AS titulo, count(*) AS total
        FROM "transactions" t
        JOIN "qr_tokens" q
          ON q."id" = t."qrTokenUsadoId"
        JOIN "producto_compras" pc
          ON pc."id" = q."compraId"
         AND pc."companyId" = ${companyId}
        LEFT JOIN "promociones" p
          ON p."id" = pc."promocionId"
         AND p."companyId" = ${companyId}
       WHERE t."companyId" = ${companyId}
         AND t."tipo" = 'PROMOTION_USE'
         AND t."estado" IN ('APPROVED', 'APPLIED')
         AND t."createdAt" >= ${rango.desde}
         AND t."createdAt" <  ${rango.hasta}
       GROUP BY 1, 2
       ORDER BY 3 DESC
       LIMIT ${TOPE_GRUPOS}
    `,
  ])

  const mapa = new Map<string, FilaPromocion>()
  const meter = (
    filas: { id: string | null; titulo: string | null; total: bigint }[],
    campo: 'adquiridas' | 'usadas'
  ) => {
    for (const f of filas) {
      const id = f.id ?? ''
      const fila = mapa.get(id) ?? {
        id,
        titulo: f.titulo ?? SIN_PROMOCION,
        adquiridas: 0,
        usadas: 0,
      }
      fila[campo] += Number(f.total)
      mapa.set(id, fila)
    }
  }
  meter(compras, 'adquiridas')
  meter(usos, 'usadas')

  return [...mapa.values()].sort(
    (a, b) => b.usadas - a.usadas || b.adquiridas - a.adquiridas
  )
}

/** Adquisiciones y usos por día, cortados en la zona horaria del negocio. */
async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoPromociones[]> {
  const [compras, usos] = await Promise.all([
    tx.$queryRaw<{ dia: string; total: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
             count(*) AS total
        FROM "producto_compras"
       WHERE "companyId" = ${companyId}
         AND "createdAt" >= ${rango.desde}
         AND "createdAt" <  ${rango.hasta}
       GROUP BY 1
    `,
    tx.$queryRaw<{ dia: string; total: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
             count(*) AS total
        FROM "transactions"
       WHERE "companyId" = ${companyId}
         AND "tipo" = 'PROMOTION_USE'
         AND "estado" IN ('APPROVED', 'APPLIED')
         AND "createdAt" >= ${rango.desde}
         AND "createdAt" <  ${rango.hasta}
       GROUP BY 1
    `,
  ])
  const porDia = new Map<string, PuntoPromociones>()
  for (const dia of diasDelRango(rango)) porDia.set(dia, { dia, adquiridas: 0, usadas: 0 })
  for (const f of compras) {
    const punto = porDia.get(f.dia)
    if (punto) punto.adquiridas += Number(f.total)
  }
  for (const f of usos) {
    const punto = porDia.get(f.dia)
    if (punto) punto.usadas += Number(f.total)
  }
  return [...porDia.values()]
}

/** Cierra una agrupación recortada con lo que quedó fuera. */
function conElResto(filas: FilaPromocion[], adquiridas: number, usadas: number): FilaPromocion[] {
  if (filas.length < TOPE_GRUPOS) return filas
  const resto = {
    adquiridas: adquiridas - filas.reduce((s, f) => s + f.adquiridas, 0),
    usadas: usadas - filas.reduce((s, f) => s + f.usadas, 0),
  }
  if (resto.adquiridas <= 0 && resto.usadas <= 0) return filas
  return [
    ...filas,
    {
      id: '',
      titulo: RESTO,
      adquiridas: Math.max(resto.adquiridas, 0),
      usadas: Math.max(resto.usadas, 0),
    },
  ]
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/promociones]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReportePromociones(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: {
    verFinancieros?: boolean
    ahora?: Date
  } = {}
): Promise<ReportePromociones> {
  const fallos = { n: 0 }
  const ahora = opciones.ahora ?? new Date()
  const verDinero = opciones.verFinancieros === true
  const prontito = new Date(ahora.getTime() + DIAS_VENCE_PRONTO * 24 * 60 * 60 * 1000)

  const enPeriodo = (r: { desde: Date; hasta: Date }) => ({
    companyId,
    createdAt: { gte: r.desde, lt: r.hasta },
  })
  const usosEn = (r: { desde: Date; hasta: Date }) => ({
    companyId,
    tipo: 'PROMOTION_USE' as const,
    estado: { in: [...APLICADAS] },
    createdAt: { gte: r.desde, lt: r.hasta },
  })

  const [
    adquiridas,
    adquiridasAnt,
    movimientos,
    movimientosAnt,
    usadas,
    usadasAnt,
    ingresos,
    ingresosAnt,
    top,
    serie,
    regalos,
    publicadas,
    comprables,
    archivadas,
    vencenPronto,
    enValidacion,
    pendientePago,
    activasSinUsar,
    vitrina,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(tx.productoCompra.count({ where: enPeriodo(rango) }), 0, fallos),
      seguro(tx.productoCompra.count({ where: enPeriodo(rango.anterior) }), 0, fallos),
      seguro(movimientosPorEstado(tx, companyId, rango), new Map<string, number>(), fallos),
      seguro(
        movimientosPorEstado(tx, companyId, rango.anterior),
        new Map<string, number>(),
        fallos
      ),
      seguro(tx.transaction.count({ where: usosEn(rango) }), 0, fallos),
      seguro(tx.transaction.count({ where: usosEn(rango.anterior) }), 0, fallos),
      // Sin el permiso la consulta del dinero NI SE LANZA: la exportación reusa
      // esta función, así que esconderlo en la vista lo dejaría saliendo por el
      // archivo.
      verDinero ? seguro(ingresosEntregados(tx, companyId, rango), 0, fallos) : Promise.resolve(0),
      verDinero
        ? seguro(ingresosEntregados(tx, companyId, rango.anterior), 0, fallos)
        : Promise.resolve(0),
      seguro(porPromocion(tx, companyId, rango), [] as FilaPromocion[], fallos),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoPromociones[], fallos),
      seguro(
        tx.productoCompra.count({
          where: { ...enPeriodo(rango), beneficiarioClienteId: { not: null } },
        }),
        0,
        fallos
      ),
      // ── Foto de hoy ──────────────────────────────────────────────────────
      seguro(
        tx.promocion.count({ where: { companyId, activo: true, archivada: false } }),
        0,
        fallos
      ),
      seguro(
        tx.promocion.count({
          where: { companyId, activo: true, archivada: false, esComprable: true },
        }),
        0,
        fallos
      ),
      seguro(tx.promocion.count({ where: { companyId, archivada: true } }), 0, fallos),
      seguro(
        tx.promocion.count({
          where: {
            companyId,
            activo: true,
            archivada: false,
            vigenciaHasta: { gte: ahora, lt: prontito },
          },
        }),
        0,
        fallos
      ),
      seguro(
        tx.productoCompra.count({ where: { companyId, estado: 'EN_VALIDACION' } }),
        0,
        fallos
      ),
      seguro(
        tx.productoCompra.count({ where: { companyId, estado: 'PENDIENTE_PAGO' } }),
        0,
        fallos
      ),
      seguro(
        tx.productoCompra.count({
          where: { companyId, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
        }),
        0,
        fallos
      ),
      seguro(
        tx.promocion.aggregate({
          where: { companyId },
          _sum: { viewCount: true, shareCount: true },
        }),
        { _sum: { viewCount: null, shareCount: null } },
        fallos
      ),
    ])
  )

  const entregadas = movimientos.get('ACTIVA') ?? 0
  const entregadasAnt = movimientosAnt.get('ACTIVA') ?? 0

  return {
    adquiridas: kpi(adquiridas, adquiridasAnt),
    entregadas: kpi(entregadas, entregadasAnt),
    usadas: kpi(usadas, usadasAnt),
    ingresos: verDinero ? kpi(ingresos, ingresosAnt) : null,
    // Sin adquisiciones no es 0 %: es «sin dato». Un 0 % diría que nada de lo
    // que se pidió llegó a entregarse, y lo que pasó es que no se pidió nada.
    tasaEntrega: adquiridas === 0 ? null : Math.round((entregadas / adquiridas) * 100),
    porEstado: ESTADOS_COMPRA.map((e) => ({
      clave: e.clave,
      nombre: e.nombre,
      movimientos: movimientos.get(e.clave) ?? 0,
    })),
    topPromociones: conElResto(top, adquiridas, usadas),
    serie,
    regalos,
    catalogo: { publicadas, comprables, archivadas, vencenPronto },
    esperando: { enValidacion, pendientePago },
    activasSinUsar,
    vitrina: {
      vistas: Number(vitrina._sum.viewCount ?? 0),
      compartidos: Number(vitrina._sum.shareCount ?? 0),
    },
    incompleto: fallos.n > 0,
  }
}
