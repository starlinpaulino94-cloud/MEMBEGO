import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * CLIENTES — quién entra, quién vuelve y de dónde vienen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA FRONTERA DE PRIVACIDAD, QUE AQUÍ NO ES UN DETALLE
 *
 * `docs/REPORTES.md` la llama no negociable: una empresa ve SU relación con el
 * cliente, nunca sus membresías, visitas ni gasto en otra empresa. `Cliente`
 * lleva `companyId`, así que el aislamiento es directo y todas las consultas de
 * aquí entran por ahí.
 *
 * Lo que hay que vigilar —y lo vigila una prueba— es NO CRUZAR POR `User`, que
 * sí es global: una misma persona puede ser cliente de tres negocios, y llegar
 * a sus filas por el usuario reconstruiría por detrás justo lo que la frontera
 * prohíbe. En este módulo no se nombra `user` ni una vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS RELOJES, Y SE DICE CUÁL MARCA CADA CIFRA
 *
 * Las cifras DEL PERIODO se fechan por cuándo pasó la cosa: el alta del
 * cliente, su visita, su cobro. Las de FOTO DE HOY —cuántos clientes hay,
 * cuántos tienen membresía vigente— no dependen del rango y no se comparan
 * contra el periodo anterior: compararlas sería inventar una variación, porque
 * el pasado de una foto de hoy no existe. Van en su propia sección, rotuladas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SEMÁFORO NO SE REPITE AQUÍ
 *
 * `modules/riesgo/semaforo.ts` es la única definición de «cómo va esta
 * relación» (activo, en riesgo, dormido, perdido) y ya tiene su pantalla en
 * `/admin/riesgo`. Este reporte usa POR SU NOMBRE los dos ingredientes que el
 * vocabulario distingue —«con membresía vigente» y «con actividad»— y no
 * estrena una tercera forma de decir «activo». Cuando alguien quiera el
 * semáforo, el reporte enlaza a donde vive.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DINERO VA DETRÁS DE SU PERMISO, Y LOS NOMBRES DETRÁS DEL SUYO
 *
 * `valorGenerado` es `null` sin `ver_financieros`, y los clientes que más
 * gastan son `null` sin `ver_financieros` O sin `ver_datos_personales`: esa
 * tabla es dinero Y nombres a la vez. Los dos permisos se resuelven en la
 * CONSULTA —la exportación reusa esta función—, así que sin ellos la consulta
 * ni se lanza.
 */

type Tx = Prisma.TransactionClient

/** Los únicos estados de `Transaction` que significan que el dinero entró. */
const COBRADOS = ['APPROVED', 'APPLIED'] as const

export interface FilaClientes {
  clave: string
  nombre: string
  clientes: number
}

export interface PuntoClientes {
  dia: string
  nuevos: number
}

export interface ClienteValioso {
  id: string
  nombre: string
  monto: number
}

export interface ReporteClientes {
  // ── Del periodo ───────────────────────────────────────────────────────────
  /** Altas en el periodo, por `Cliente.createdAt`. */
  nuevos: Kpi
  /** Clientes DISTINTOS con al menos una visita en el periodo. */
  conActividad: Kpi
  /** Clientes DISTINTOS con al menos un cobro de membresía en el periodo. */
  quePagaron: Kpi
  /** `null` = sin permiso `ver_financieros`. Cobros de membresía + caja. */
  valorGenerado: Kpi | null

  // ── Qué tal entraron los nuevos ───────────────────────────────────────────
  /**
   * De los nuevos del periodo, cuántos llegaron a venir alguna vez. Es la
   * pregunta que separa crecer de registrar gente: un alta que nunca vuelve no
   * es un cliente, es un formulario.
   */
  nuevosQueVolvieron: number
  /** Volvieron ÷ nuevos. `null` = no hubo altas en el periodo. */
  tasaActivacion: number | null

  // ── Foto de hoy (no depende del periodo) ──────────────────────────────────
  base: number
  conMembresiaVigente: number
  /** Nunca tuvieron una membresía con este negocio. */
  sinMembresiaNunca: number
  /** De la base de hoy: quiénes aceptan que se les escriba. */
  consentimiento: { promos: number; recordatorios: number }

  // ── Desgloses ─────────────────────────────────────────────────────────────
  /** Por dónde llegaron los nuevos del periodo (`canalOrigen`). */
  porCanal: FilaClientes[]
  /** De dónde son los nuevos del periodo (`ciudad`). */
  porCiudad: FilaClientes[]
  serie: PuntoClientes[]
  /** `null` = falta `ver_financieros` o `ver_datos_personales`. */
  topClientes: ClienteValioso[] | null
  incompleto: boolean
}

const SIN_CANAL = '(directo o sin registrar)'
const SIN_CIUDAD = '(sin registrar)'
const RESTO = '(resto, agrupado)'
/** Tope de filas por agrupación. Lo que quede fuera va en una fila «resto». */
const TOPE_GRUPOS = 30
/** Cuántos clientes lista la tabla de los que más gastan. */
const TOPE_TOP = 20

/**
 * Agrupación de las ALTAS del periodo por una columna del propio cliente.
 *
 * SQL crudo y no `groupBy` de Prisma porque el tope tiene que aplicarse sobre
 * la clave ya ordenada, y porque así el «resto» se calcula restando de un total
 * que sale de su propia consulta: recortar a secas dejaría una columna que no
 * suma el total, que es la forma más rápida de que nadie confíe en el reporte.
 *
 * `campo` no viene de fuera: es una de dos constantes del propio módulo, así
 * que el `Prisma.raw` no abre una inyección.
 */
async function agruparAltas(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date },
  campo: 'canalOrigen' | 'ciudad'
): Promise<FilaClientes[]> {
  const columna = Prisma.raw(`"${campo}"`)
  const filas = await tx.$queryRaw<{ clave: string | null; clientes: bigint }[]>`
    SELECT ${columna} AS clave, count(*) AS clientes
      FROM "clientes"
     WHERE "companyId" = ${companyId}
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT ${TOPE_GRUPOS}
  `
  const vacio = campo === 'canalOrigen' ? SIN_CANAL : SIN_CIUDAD
  return filas.map((f) => ({
    clave: f.clave ?? '',
    nombre: f.clave && f.clave.trim() !== '' ? f.clave : vacio,
    clientes: Number(f.clientes),
  }))
}

/** Cierra una agrupación recortada con lo que quedó fuera. */
function conElResto(filas: FilaClientes[], total: number): FilaClientes[] {
  if (filas.length < TOPE_GRUPOS) return filas
  const resto = total - filas.reduce((s, f) => s + f.clientes, 0)
  if (resto <= 0) return filas
  return [...filas, { clave: '', nombre: RESTO, clientes: resto }]
}

/**
 * Clientes DISTINTOS con visita en el periodo.
 *
 * SQL crudo porque `groupBy(['clienteId']).length` traería una fila por cliente
 * para después contarlas en JavaScript, que es justo lo que la tercera regla de
 * `docs/REPORTES.md` prohíbe.
 */
async function conVisita(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<number> {
  const filas = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(DISTINCT "clienteId") AS total
      FROM "visits"
     WHERE "companyId" = ${companyId}
       AND "fechaVisita" >= ${rango.desde}
       AND "fechaVisita" <  ${rango.hasta}
  `
  return Number(filas[0]?.total ?? 0)
}

/** Clientes DISTINTOS con un cobro de membresía en el periodo. */
async function conCobro(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<number> {
  // `whereCobrado` es la única puerta para fechar un cobro. El conteo de
  // clientes distintos se hace con `distinct` sobre la agrupación, no con el
  // largo de una lista traída a memoria.
  const filas = await tx.membership.groupBy({
    by: ['clienteId'],
    where: whereCobrado(rango.desde, rango.hasta, { companyId }),
  })
  return filas.length
}

/**
 * De los clientes dados de alta en el periodo, cuántos llegaron a venir.
 *
 * Se cuenta en la BASE con un `EXISTS`: traer las altas y cruzarlas en
 * JavaScript sería una lista por cada periodo mirado.
 */
async function altasQueVolvieron(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<number> {
  const filas = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS total
      FROM "clientes" c
     WHERE c."companyId" = ${companyId}
       AND c."createdAt" >= ${rango.desde}
       AND c."createdAt" <  ${rango.hasta}
       AND EXISTS (
         SELECT 1 FROM "visits" v
          WHERE v."clienteId" = c."id"
            AND v."companyId" = ${companyId}
       )
  `
  return Number(filas[0]?.total ?? 0)
}

/** Altas por día, cortadas en la zona horaria del negocio. */
async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoClientes[]> {
  const filas = await tx.$queryRaw<{ dia: string; total: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           count(*) AS total
      FROM "clientes"
     WHERE "companyId" = ${companyId}
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
     GROUP BY 1
  `
  const porDia = new Map<string, PuntoClientes>()
  for (const dia of diasDelRango(rango)) porDia.set(dia, { dia, nuevos: 0 })
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (punto) punto.nuevos += Number(f.total)
  }
  return [...porDia.values()]
}

/**
 * Dinero que dejaron los clientes en el periodo: cobros de membresía MÁS caja.
 *
 * Son los dos caminos por los que entra dinero y se suman a propósito aquí
 * —esta cifra responde «cuánto dejó la gente», no «cómo cuadra la caja»—. El
 * reporte de Finanzas los sigue enseñando separados, que es donde importa.
 */
async function valorDelPeriodo(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<number> {
  const [membresias, caja] = await Promise.all([
    tx.membership.aggregate({
      where: whereCobrado(rango.desde, rango.hasta, { companyId }),
      _sum: { montoPagado: true },
    }),
    tx.transaction.aggregate({
      where: {
        companyId,
        estado: { in: [...COBRADOS] },
        createdAt: { gte: rango.desde, lt: rango.hasta },
      },
      _sum: { monto: true },
    }),
  ])
  return Number(membresias._sum.montoPagado ?? 0) + Number(caja._sum.monto ?? 0)
}

/**
 * Los clientes que más dejaron en el periodo.
 *
 * Solo cobros de membresía: la caja puede no llevar cliente (`Transaction`
 * tiene `clienteId` opcional), y una tabla de «los que más gastan» que se
 * saltara las ventas sin cliente ordenaría mal sin decirlo. Se dice en la
 * pantalla en vez de mezclar dos criterios en una columna.
 */
async function clientesQueMasDejaron(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<ClienteValioso[]> {
  const filas = await tx.membership.groupBy({
    by: ['clienteId'],
    where: whereCobrado(rango.desde, rango.hasta, { companyId }),
    _sum: { montoPagado: true },
    orderBy: { _sum: { montoPagado: 'desc' } },
    take: TOPE_TOP,
  })
  const ids = filas.map((f) => f.clienteId).filter((v): v is string => typeof v === 'string')
  if (ids.length === 0) return []
  // Acotado a los clientes DE ESTA EMPRESA. `Cliente` ya lleva `companyId`, y
  // repetirlo aquí es la segunda barrera: nunca se llega a una persona por su
  // usuario global.
  const nombres = await tx.cliente.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, nombre: true },
  })
  const mapa = new Map(nombres.map((c) => [c.id, c.nombre]))
  return filas
    .map((f) => ({
      id: f.clienteId,
      nombre: mapa.get(f.clienteId) ?? '(cliente eliminado)',
      monto: Number(f._sum.montoPagado ?? 0),
    }))
    .filter((f) => f.monto > 0)
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/clientes]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteClientes(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: {
    verFinancieros?: boolean
    verDatosPersonales?: boolean
    ahora?: Date
  } = {}
): Promise<ReporteClientes> {
  const fallos = { n: 0 }
  const ahora = opciones.ahora ?? new Date()
  const verDinero = opciones.verFinancieros === true
  // La tabla de los que más gastan es dinero Y nombres: hacen falta LOS DOS.
  const verTop = verDinero && opciones.verDatosPersonales === true

  const [
    nuevos,
    nuevosAnt,
    actividad,
    actividadAnt,
    pagaron,
    pagaronAnt,
    valor,
    valorAnt,
    volvieron,
    base,
    vigentes,
    sinMembresia,
    promos,
    recordatorios,
    canales,
    ciudades,
    serie,
    top,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(
        tx.cliente.count({
          where: { companyId, createdAt: { gte: rango.desde, lt: rango.hasta } },
        }),
        0,
        fallos
      ),
      seguro(
        tx.cliente.count({
          where: {
            companyId,
            createdAt: { gte: rango.anterior.desde, lt: rango.anterior.hasta },
          },
        }),
        0,
        fallos
      ),
      seguro(conVisita(tx, companyId, rango), 0, fallos),
      seguro(conVisita(tx, companyId, rango.anterior), 0, fallos),
      seguro(conCobro(tx, companyId, rango), 0, fallos),
      seguro(conCobro(tx, companyId, rango.anterior), 0, fallos),
      // Sin el permiso, la consulta del dinero NI SE LANZA: la exportación usa
      // esta misma función, así que esconderlo en la vista dejaría la cifra
      // saliendo por el archivo.
      verDinero ? seguro(valorDelPeriodo(tx, companyId, rango), 0, fallos) : Promise.resolve(0),
      verDinero
        ? seguro(valorDelPeriodo(tx, companyId, rango.anterior), 0, fallos)
        : Promise.resolve(0),
      seguro(altasQueVolvieron(tx, companyId, rango), 0, fallos),
      // Foto de hoy: no dependen del periodo y por eso no se comparan.
      seguro(tx.cliente.count({ where: { companyId } }), 0, fallos),
      seguro(
        tx.cliente.count({
          where: { companyId, memberships: { some: membresiaVigente(ahora) } },
        }),
        0,
        fallos
      ),
      seguro(
        tx.cliente.count({ where: { companyId, memberships: { none: {} } } }),
        0,
        fallos
      ),
      seguro(tx.cliente.count({ where: { companyId, notifPromos: true } }), 0, fallos),
      seguro(tx.cliente.count({ where: { companyId, notifRecordatorios: true } }), 0, fallos),
      seguro(agruparAltas(tx, companyId, rango, 'canalOrigen'), [] as FilaClientes[], fallos),
      seguro(agruparAltas(tx, companyId, rango, 'ciudad'), [] as FilaClientes[], fallos),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoClientes[], fallos),
      verTop
        ? seguro(clientesQueMasDejaron(tx, companyId, rango), [] as ClienteValioso[], fallos)
        : Promise.resolve(null),
    ])
  )

  return {
    nuevos: kpi(nuevos, nuevosAnt),
    conActividad: kpi(actividad, actividadAnt),
    quePagaron: kpi(pagaron, pagaronAnt),
    valorGenerado: verDinero ? kpi(valor, valorAnt) : null,
    nuevosQueVolvieron: volvieron,
    // Sin altas no es 0 %: es «sin dato». Un 0 % diría que ninguno volvió, que
    // es una afirmación sobre el negocio y no sobre la ausencia de altas.
    tasaActivacion: nuevos === 0 ? null : Math.round((volvieron / nuevos) * 100),
    base,
    conMembresiaVigente: vigentes,
    sinMembresiaNunca: sinMembresia,
    consentimiento: { promos, recordatorios },
    // El resto se cierra AQUÍ, con el total del periodo ya resuelto.
    porCanal: conElResto(canales, nuevos),
    porCiudad: conElResto(ciudades, nuevos),
    serie,
    topClientes: top,
    incompleto: fallos.n > 0,
  }
}
