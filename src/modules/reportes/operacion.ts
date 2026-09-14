import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * OPERACIÓN — lo que de verdad pasó en la pista.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN ESTOS NÚMEROS
 *
 * De `visits`, una fila por escaneo, y de `audit_logs` para los QR. No hay una
 * sola cifra derivada del estado de nada: un canje es un hecho con su fecha, su
 * sucursal y su empleado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE REPORTE TRAJO UNA COLUMNA CONSIGO
 *
 * `visits` no tenía `companyId`: se llegaba a la empresa por la membresía. Para
 * el historial de un cliente eso basta; para «canjes de esta empresa entre
 * estas dos fechas» obliga a entrar por `membershipId` y descartar filas
 * después, sobre la tabla que más crece del sistema. La columna y su índice
 * `[companyId, fechaVisita]` son de la Fase 5 —migración
 * `20260919_visitas_company_id`—.
 *
 * MIENTRAS EL RELLENO NO TERMINE, ESTE REPORTE LO DICE. `cobertura.pendiente`
 * es verdad hasta que no queda una visita sin empresa asignada, y la pantalla y
 * el CSV lo avisan. Es la misma disciplina del corte de datos de la Fase 3: un
 * reporte que enseñara esas visitas como cero, callando, estaría mintiendo
 * sobre su propio alcance, y nadie lo sabría hasta que ya hubiera decidido algo
 * con el número.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * «SIN ASIGNAR» NO SE ESCONDE
 *
 * `sucursalId` y `empleadoId` son opcionales. Sus filas sin asignar salen en la
 * tabla con ese nombre. Esconderlas haría que los subtotales no sumaran el
 * total, que es la forma más rápida de que nadie vuelva a confiar en el
 * reporte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS EMPLEADOS VAN DETRÁS DE SU PROPIO PERMISO
 *
 * Y miden OPERACIONES, no personas: cuántos canjes registró cada mostrador, que
 * es lo que sirve para repartir turnos. No hay ritmo, ni ranking, ni nada que
 * invite a usar el reporte como vara. `docs/REPORTES.md` lo fija así.
 */

type Tx = Prisma.TransactionClient

export interface FilaOperacion {
  clave: string
  nombre: string
  canjes: number
  descontados: number
}

export interface PuntoOperacion {
  dia: string
  canjes: number
  descontados: number
}

export interface CoberturaVisitas {
  /** Queda histórico sin `companyId`: el relleno por lotes no ha terminado. */
  pendiente: boolean
}

export interface ReporteOperacion {
  canjes: Kpi
  /** De los canjes, los que consumieron un uso del plan o del bono. */
  descontados: Kpi
  /** Canjes que no descontaron nada: planes ilimitados y cortesías. */
  sinDescontar: number
  /**
   * Visitas revertidas en el periodo. NO se restan de los canjes: el lavado se
   * registró, y que después se anulara es un hecho posterior. Se miran aparte,
   * porque un mostrador que revierte mucho tiene un problema que el total
   * esconde.
   */
  revertidas: number
  clientesAtendidos: number
  porSucursal: FilaOperacion[]
  /** `null` = quien mira no tiene el permiso para ver el desglose por persona. */
  porEmpleado: FilaOperacion[] | null
  porServicio: FilaOperacion[]
  qrGenerados: number
  qrUsados: number
  qrCompartidos: number
  serie: PuntoOperacion[]
  cobertura: CoberturaVisitas
  incompleto: boolean
}

const SIN_ASIGNAR = '(sin asignar)'
const RESTO = '(resto, agrupado)'
/** Tope de filas por agrupación. Lo que quede fuera va en una fila «resto». */
const TOPE_GRUPOS = 50

function enRango(
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Prisma.VisitWhereInput {
  // El `companyId` va en el WHERE además de en el contexto de `conEmpresa`:
  // RLS es la segunda barrera, no la única.
  return { companyId, fechaVisita: { gte: rango.desde, lt: rango.hasta } }
}

async function totales(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<{ canjes: number; descontados: number }> {
  const filas = await tx.visit.groupBy({
    by: ['descontado'],
    where: enRango(companyId, rango),
    _count: { _all: true },
  })
  let canjes = 0
  let descontados = 0
  for (const f of filas) {
    canjes += f._count._all
    if (f.descontado) descontados += f._count._all
  }
  return { canjes, descontados }
}

/**
 * Clientes distintos atendidos.
 *
 * SQL crudo porque `groupBy(['clienteId']).length` traería una fila por cliente
 * para después contarlas en JavaScript. Con un negocio de miles de clientes eso
 * es traer miles de filas para enseñar un número, y es justo lo que la tercera
 * regla de `docs/REPORTES.md` prohíbe.
 */
async function clientesAtendidos(
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

/**
 * Agrupación por una columna, con TOPE y con el resto declarado.
 *
 * El tope no es decoración: `servicio` es texto libre escrito en el formulario
 * al canjear, así que su número de valores distintos no lo acota ningún
 * catálogo. Un `groupBy` sin límite sobre esa columna trae tantas filas como
 * cosas distintas se hayan tecleado en la historia del negocio.
 *
 * Pero recortar a secas rompería la regla que más importa aquí: los subtotales
 * tienen que sumar el total. Por eso el que llama añade una fila con TODO lo
 * que quedó fuera, calculada restando de los totales que ya conoce. Recortada y
 * exacta, en vez de completa y arriesgada.
 *
 * SQL crudo y no `groupBy` de Prisma porque el tope tiene que aplicarse sobre
 * la CLAVE. Con `by: [campo, 'descontado']` un `take` recortaría pares, y un
 * servicio podría salir con solo la mitad de sus canjes.
 *
 * `campo` no viene de fuera: es una de tres constantes del propio módulo, así
 * que el `Prisma.raw` no abre una inyección.
 */
async function agrupar(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date },
  campo: 'sucursalId' | 'empleadoId' | 'servicio',
  nombres: (ids: string[]) => Promise<Map<string, string>>
): Promise<FilaOperacion[]> {
  const columna = Prisma.raw(`"${campo}"`)
  const filas = await tx.$queryRaw<{ clave: string | null; canjes: bigint; descontados: bigint }[]>`
    SELECT ${columna} AS clave,
           count(*) AS canjes,
           count(*) FILTER (WHERE "descontado") AS descontados
      FROM "visits"
     WHERE "companyId" = ${companyId}
       AND "fechaVisita" >= ${rango.desde}
       AND "fechaVisita" <  ${rango.hasta}
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT ${TOPE_GRUPOS}
  `
  const ids = filas
    .map((f) => f.clave)
    .filter((v): v is string => typeof v === 'string' && v !== '')
  const mapa = await nombres(ids)

  return filas.map((f) => ({
    clave: f.clave ?? '',
    // Un registro borrado deja canjes huérfanos. Se enseñan como «(eliminado)»
    // en vez de desaparecer: si no, los subtotales dejarían de sumar el total y
    // nadie sabría por qué.
    nombre:
      f.clave == null || f.clave === ''
        ? SIN_ASIGNAR
        : (mapa.get(f.clave) ?? '(eliminado)'),
    canjes: Number(f.canjes),
    descontados: Number(f.descontados),
  }))
}

/**
 * Cierra una agrupación recortada con lo que quedó fuera.
 *
 * El resto se calcula RESTANDO de los totales del periodo, que salen de su
 * propia consulta: así la última fila es exacta y la columna sigue sumando el
 * total, en vez de terminar en un número que no cuadra y que nadie sabe
 * explicar.
 */
function conElResto(
  filas: FilaOperacion[],
  totales: { canjes: number; descontados: number }
): FilaOperacion[] {
  if (filas.length < TOPE_GRUPOS) return filas
  const canjes = totales.canjes - filas.reduce((s, f) => s + f.canjes, 0)
  const descontados = totales.descontados - filas.reduce((s, f) => s + f.descontados, 0)
  if (canjes <= 0) return filas
  return [...filas, { clave: '', nombre: RESTO, canjes, descontados }]
}

async function contarQr(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Record<string, number>> {
  const filas = await tx.auditLog.groupBy({
    by: ['accion'],
    where: {
      companyId,
      accion: { in: ['QR_GENERADO', 'QR_USADO', 'QR_COMPARTIDO'] },
      createdAt: { gte: rango.desde, lt: rango.hasta },
    },
    _count: { _all: true },
  })
  const out: Record<string, number> = {}
  for (const f of filas) out[f.accion] = f._count._all
  return out
}

async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoOperacion[]> {
  // El corte por día se hace en la BASE y en la zona del negocio. Agrupar en
  // JavaScript obligaría a traer una fila por canje, y `AT TIME ZONE` es lo que
  // evita que un lavado de las nueve de la noche caiga en el día siguiente.
  const filas = await tx.$queryRaw<{ dia: string; descontado: boolean; total: bigint }[]>`
    SELECT to_char(("fechaVisita" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           "descontado",
           count(*) AS total
      FROM "visits"
     WHERE "companyId" = ${companyId}
       AND "fechaVisita" >= ${rango.desde}
       AND "fechaVisita" <  ${rango.hasta}
     GROUP BY 1, 2
  `
  const porDia = new Map<string, PuntoOperacion>()
  for (const dia of diasDelRango(rango)) porDia.set(dia, { dia, canjes: 0, descontados: 0 })
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (!punto) continue
    const n = Number(f.total)
    punto.canjes += n
    if (f.descontado) punto.descontados += n
  }
  return [...porDia.values()]
}

/**
 * ¿Terminó el relleno de `companyId`?
 *
 * Una sola fila basta para saberlo, y el índice `[companyId, fechaVisita]`
 * indexa también los nulos, así que es una búsqueda puntual por cara que sea la
 * tabla. Se devuelve un SÍ/NO y no un número a propósito: contar cuántas
 * pendientes son de ESTA empresa exigiría el JOIN por `membershipId` que esta
 * fase existe para evitar, y un número global sería un dato de otro inquilino
 * pintado en la pantalla de este.
 */
async function rellenoPendiente(tx: Tx): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "visits" WHERE "companyId" IS NULL LIMIT 1
  `
  return filas.length > 0
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/operacion]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteOperacion(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: { verEmpleados?: boolean } = {}
): Promise<ReporteOperacion> {
  const fallos = { n: 0 }
  const cero = { canjes: 0, descontados: 0 }

  const [
    actual,
    anterior,
    revertidas,
    clientes,
    sucursales,
    empleados,
    servicios,
    qr,
    serie,
    pendiente,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(totales(tx, companyId, rango), cero, fallos),
      seguro(totales(tx, companyId, rango.anterior), cero, fallos),
      seguro(
        tx.visit.count({
          // Se fecha por CUÁNDO SE REVIRTIÓ, no por cuándo fue la visita: la
          // pregunta que responde es «cuánto se está anulando este mes».
          where: {
            companyId,
            revertidaAt: { gte: rango.desde, lt: rango.hasta },
          },
        }),
        0,
        fallos
      ),
      seguro(clientesAtendidos(tx, companyId, rango), 0, fallos),
      seguro(
        agrupar(tx, companyId, rango, 'sucursalId', async (ids) => {
          if (ids.length === 0) return new Map()
          const filas = await tx.sucursal.findMany({
            where: { id: { in: ids }, companyId },
            select: { id: true, nombre: true },
          })
          return new Map(filas.map((s) => [s.id, s.nombre]))
        }),
        [] as FilaOperacion[],
        fallos
      ),
      // La consulta del desglose por persona NI SE LANZA sin el permiso. No se
      // trae para esconderla en la vista: la ruta de exportación usa esta misma
      // función, así que filtrar en el componente dejaría el dato saliendo por
      // el archivo.
      opciones.verEmpleados
        ? seguro(
            agrupar(tx, companyId, rango, 'empleadoId', async (ids) => {
              if (ids.length === 0) return new Map()
              // Acotado a los usuarios DE ESTA EMPRESA: `users` es global, y
              // cruzarla sin el filtro reconstruiría por detrás lo que la
              // frontera de privacidad prohíbe.
              //
              // Por los DOS caminos, no solo por `companyId`: a una empresa se
              // llega por la empresa activa del usuario y por la tabla de
              // accesos, y casi siempre por los dos. Con solo el primero, un
              // empleado que atiende dos negocios saldría como «(eliminado)» en
              // el reporte del segundo —un nombre falso, no un dato que falte—.
              const filas = await tx.user.findMany({
                where: {
                  id: { in: ids },
                  OR: [{ companyId }, { empresasAcceso: { some: { companyId } } }],
                },
                select: { id: true, name: true },
              })
              return new Map(filas.map((u) => [u.id, u.name]))
            }),
            [] as FilaOperacion[],
            fallos
          )
        : Promise.resolve(null),
      seguro(
        // `servicio` es texto libre escrito al canjear: no hay catálogo que
        // consultar, el propio valor es el nombre.
        agrupar(tx, companyId, rango, 'servicio', async (ids) =>
          new Map(ids.map((s) => [s, s]))
        ),
        [] as FilaOperacion[],
        fallos
      ),
      seguro(contarQr(tx, companyId, rango), {} as Record<string, number>, fallos),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoOperacion[], fallos),
      // Por defecto `true`: si la comprobación falla, se avisa de más. Dar por
      // completa una cobertura que no se pudo verificar es el único error de
      // los dos que hace que alguien confíe en un número incompleto.
      seguro(rellenoPendiente(tx), true, fallos),
    ])
  )

  return {
    canjes: kpi(actual.canjes, anterior.canjes),
    descontados: kpi(actual.descontados, anterior.descontados),
    sinDescontar: actual.canjes - actual.descontados,
    revertidas,
    clientesAtendidos: clientes,
    // El resto se cierra AQUÍ, con los totales ya resueltos: es la única forma
    // de que la última fila sea exacta en vez de un número que no cuadra.
    porSucursal: conElResto(sucursales, actual),
    porEmpleado: empleados && conElResto(empleados, actual),
    porServicio: conElResto(servicios, actual),
    qrGenerados: qr.QR_GENERADO ?? 0,
    qrUsados: qr.QR_USADO ?? 0,
    qrCompartidos: qr.QR_COMPARTIDO ?? 0,
    serie,
    cobertura: { pendiente },
    incompleto: fallos.n > 0,
  }
}
