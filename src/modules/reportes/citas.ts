import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * CITAS — cómo quedó la agenda.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE REPORTE **NO** PUEDE DECIR, Y LO DICE
 *
 * `citas` guarda el estado ACTUAL y nada más: hay `estado`, `createdAt` y
 * `updatedAt`, pero NO hay un sello de tiempo por transición. Confirmar,
 * completar, marcar no-asistió y cancelar escriben el mismo campo `estado`
 * encima del anterior (`modules/citas/actions.ts`), y no existe bitácora de
 * citas: los `CITA_CANCELADA` que se ven por el código son tipos de
 * NOTIFICACIÓN, no de auditoría. De ahí se sigue una cosa incómoda que más
 * valía escribir aquí que descubrir dentro de seis meses:
 *
 *   Una cita del 3 de marzo que se canceló el 10 de abril aparece como
 *   cancelada en el reporte de MARZO, porque lo único que se sabe es que hoy
 *   está cancelada.
 *
 * Por eso este reporte responde «cómo quedó la agenda de este periodo» y no
 * «cuántas se cancelaron esta semana». La pantalla y el CSV lo avisan; es la
 * misma disciplina del corte de datos del ciclo de vida y de la cobertura de
 * Operación.
 *
 * El bus de automatizaciones SÍ guarda un `cita.cancelada` con su fecha, y aun
 * así no se cuenta aquí: `emitirEventoEstrategia` es best-effort —va fuera de
 * la transacción y se traga sus fallos a propósito, para que el bus nunca
 * deshaga una cancelación ya guardada—. Contar con él daría un número que va
 * por debajo sin avisar, que es justo lo que este reporte no hace. La salida
 * honesta es la otra: columnas de transición en `citas`, como las que
 * `ColaVehiculo` ya tiene (`inicioAt`, `listoAt`, `entregadoAt`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO HAY DESGLOSE POR SUCURSAL, Y TAMPOCO ES UN OLVIDO
 *
 * `citas.sucursalId` existe en el esquema y NINGÚN código lo escribe: el único
 * `cita.create` del producto no lo pone. La columna está siempre vacía. Un
 * desglose por sucursal sería una tabla con una sola fila «(sin asignar)», y un
 * filtro por sucursal solo podría devolver reportes vacíos — una trampa que
 * parece un reporte roto. Mientras la reserva no guarde la sucursal, este
 * reporte no ofrece esa dimensión y dice por qué.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS EJES, Y NO SE MEZCLAN
 *
 * `inicio` —cuándo estaba la cita— es el eje de todo el reporte: es el que
 * responde por la agenda. `createdAt` —cuándo se reservó— responde otra cosa:
 * cuánta demanda entró. Va en su propia cifra, rotulada, porque sumarlas daría
 * un número que no significa nada: las reservas de hoy para el mes que viene no
 * son citas de hoy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA TASA DE ASISTENCIA SOLO VALE SI LA AGENDA SE CIERRA
 *
 * Sale de las citas CERRADAS —completadas y no-asistió—, nunca sobre el total:
 * una agenda a medio cerrar daría una asistencia baja que no existió. Y por eso
 * `sinCerrar` es una cifra de primera fila y no una nota al pie: cuenta las
 * citas del periodo que ya pasaron y que nadie marcó. Si ese número es grande,
 * la tasa de asistencia no significa nada, y el reporte lo dice en vez de
 * dejar que alguien decida con ella.
 */

type Tx = Prisma.TransactionClient

/**
 * Los cinco estados de `CitaEstado`. Que esta lista y el enum del esquema no se
 * separen lo vigila `tests/reporte-citas.test.ts`: un estado nuevo que no
 * llegara aquí desaparecería de los totales sin que nada fallara.
 */
export const ESTADOS_CITA = [
  'PENDIENTE',
  'CONFIRMADA',
  'COMPLETADA',
  'CANCELADA',
  'NO_ASISTIO',
] as const

export type EstadoCita = (typeof ESTADOS_CITA)[number]

/** Citas que siguen abiertas: ni se dieron ni se descartaron. */
const ABIERTOS: EstadoCita[] = ['PENDIENTE', 'CONFIRMADA']

export interface FilaCitas {
  clave: string
  nombre: string
  agendadas: number
  completadas: number
  canceladas: number
  noAsistio: number
}

export interface PuntoCitas {
  dia: string
  agendadas: number
  completadas: number
  canceladas: number
  noAsistio: number
}

/**
 * Lo que la URL pide filtrar.
 *
 * Solo el servicio, y es la única dimensión que hoy tiene datos: la sucursal
 * nunca se escribe (ver la cabecera) y quién atendió solo queda registrado en
 * las completadas, así que filtrar por persona pondría canceladas y no-asistió
 * en cero por construcción — un cero que parece un dato y es un artefacto.
 */
export interface FiltroCitas {
  servicio?: string
}

/** El filtro que de verdad se aplicó. */
export interface FiltroCitasAplicado {
  servicio: string
}

export interface ReporteCitas {
  /** Citas cuyo `inicio` cae en el periodo, en cualquier estado. */
  agendadas: Kpi
  completadas: Kpi
  canceladas: Kpi
  noAsistio: Kpi
  /** Siguen abiertas: PENDIENTE o CONFIRMADA. */
  abiertas: number
  /**
   * OTRA PREGUNTA: cuántas se reservaron en el periodo, fechadas por
   * `createdAt`. Es la demanda que entró, no la agenda que se vivió.
   */
  reservadas: Kpi
  /**
   * Citas del periodo que YA PASARON y que nadie cerró: siguen pendientes o
   * confirmadas con su hora vencida. Decide si la tasa de asistencia significa
   * algo, así que no es una nota al pie.
   */
  sinCerrar: number
  /**
   * ALARMA, no cifra del periodo: citas PENDIENTES cuya hora todavía no
   * llegó. El cliente reservó y el negocio no ha confirmado. No depende del
   * rango elegido —una cita sin confirmar para el jueves es un problema hoy,
   * se esté mirando el mes que se esté mirando—.
   */
  porConfirmar: number
  /** Completadas ÷ (completadas + no asistió). `null` = ninguna cerrada. */
  tasaAsistencia: number | null
  /** Canceladas ÷ agendadas. `null` = no hubo citas en el periodo. */
  tasaCancelacion: number | null
  /** Quién canceló, de las canceladas del periodo. */
  quienCancela: { cliente: number; negocio: number; sinRegistrar: number }
  motivosCancelacion: { motivo: string; total: number }[]
  /**
   * Quién atendió. SOLO las completadas registran a la persona
   * (`atendidaPorId` se escribe al completar y en ningún otro sitio), así que
   * lo demás cae en «(sin asignar)» por construcción, no por descuido.
   * `null` = quien mira no tiene permiso para el desglose por persona.
   */
  porEmpleado: FilaCitas[] | null
  porServicio: FilaCitas[]
  serie: PuntoCitas[]
  /** Los servicios distintos del periodo, para el desplegable del filtro. */
  serviciosDisponibles: string[]
  /** `null` = la agenda entera, sin recorte. */
  filtro: FiltroCitasAplicado | null
  incompleto: boolean
}

const SIN_ASIGNAR = '(sin asignar)'
const SIN_SERVICIO = '(sin especificar)'
const RESTO = '(resto, agrupado)'
/** Tope de filas por agrupación. Lo que quede fuera va en una fila «resto». */
const TOPE_GRUPOS = 50
/** Tope de motivos distintos. Son texto libre: no los acota ningún catálogo. */
const TOPE_MOTIVOS = 20

function enRango(
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroCitasAplicado | null,
  campo: 'inicio' | 'createdAt' = 'inicio'
): Prisma.CitaWhereInput {
  // El `companyId` va en el WHERE además de en el contexto de `conEmpresa`:
  // RLS es la segunda barrera, no la única.
  return {
    companyId,
    [campo]: { gte: desde, lt: hasta },
    ...(filtro ? { servicio: filtro.servicio } : {}),
  }
}

/**
 * El MISMO filtro, para las consultas en SQL crudo. Va como fragmento
 * parametrizado (`Prisma.sql`, nunca `Prisma.raw` con el valor dentro): el
 * servicio viene de la URL y viaja como parámetro, no pegado al texto.
 */
function filtroSql(filtro: FiltroCitasAplicado | null): Prisma.Sql {
  return filtro ? Prisma.sql`AND "servicio" = ${filtro.servicio}` : Prisma.empty
}

/** Cuántas citas por estado, fechadas por `inicio`. */
async function contarPorEstado(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroCitasAplicado | null
): Promise<Record<string, number>> {
  const filas = await tx.cita.groupBy({
    by: ['estado'],
    where: enRango(companyId, desde, hasta, filtro),
    _count: { _all: true },
  })
  const out: Record<string, number> = {}
  for (const f of filas) out[f.estado] = f._count._all
  return out
}

/**
 * Agrupación por una columna, con TOPE y con el resto declarado.
 *
 * SQL crudo y no `groupBy` de Prisma porque cada fila lleva sus estados en
 * columnas: con `by: [campo, 'estado']` un `take` recortaría pares, y un
 * servicio podría salir con sus completadas y sin sus canceladas — un número
 * mal, no un número de menos.
 *
 * `campo` no viene de fuera: es una de dos constantes del propio módulo, así
 * que el `Prisma.raw` no abre una inyección.
 */
async function agrupar(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date },
  filtro: FiltroCitasAplicado | null,
  campo: 'atendidaPorId' | 'servicio',
  nombres: (ids: string[]) => Promise<Map<string, string>>
): Promise<FilaCitas[]> {
  const columna = Prisma.raw(`"${campo}"`)
  const filas = await tx.$queryRaw<
    {
      clave: string | null
      agendadas: bigint
      completadas: bigint
      canceladas: bigint
      no_asistio: bigint
    }[]
  >`
    SELECT ${columna} AS clave,
           count(*) AS agendadas,
           count(*) FILTER (WHERE "estado"::text = 'COMPLETADA') AS completadas,
           count(*) FILTER (WHERE "estado"::text = 'CANCELADA')  AS canceladas,
           count(*) FILTER (WHERE "estado"::text = 'NO_ASISTIO') AS no_asistio
      FROM "citas"
     WHERE "companyId" = ${companyId}
       AND "inicio" >= ${rango.desde}
       AND "inicio" <  ${rango.hasta}
       ${filtroSql(filtro)}
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
    // Un registro borrado deja citas huérfanas. Se enseñan como «(eliminado)»
    // en vez de desaparecer: si no, los subtotales dejarían de sumar el total y
    // nadie sabría por qué.
    nombre:
      f.clave == null || f.clave === ''
        ? campo === 'servicio'
          ? SIN_SERVICIO
          : SIN_ASIGNAR
        : (mapa.get(f.clave) ?? '(eliminado)'),
    agendadas: Number(f.agendadas),
    completadas: Number(f.completadas),
    canceladas: Number(f.canceladas),
    noAsistio: Number(f.no_asistio),
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
function conElResto(filas: FilaCitas[], totales: Record<string, number>): FilaCitas[] {
  if (filas.length < TOPE_GRUPOS) return filas
  const suma = (k: 'agendadas' | 'completadas' | 'canceladas' | 'noAsistio') =>
    filas.reduce((s, f) => s + f[k], 0)
  const agendadas = Object.values(totales).reduce((s, n) => s + n, 0) - suma('agendadas')
  if (agendadas <= 0) return filas
  return [
    ...filas,
    {
      clave: '',
      nombre: RESTO,
      agendadas,
      completadas: (totales.COMPLETADA ?? 0) - suma('completadas'),
      canceladas: (totales.CANCELADA ?? 0) - suma('canceladas'),
      noAsistio: (totales.NO_ASISTIO ?? 0) - suma('noAsistio'),
    },
  ]
}

async function quienCancelo(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date },
  filtro: FiltroCitasAplicado | null
): Promise<{ cliente: number; negocio: number; sinRegistrar: number }> {
  const filas = await tx.cita.groupBy({
    by: ['canceladaPor'],
    where: { ...enRango(companyId, rango.desde, rango.hasta, filtro), estado: 'CANCELADA' },
    _count: { _all: true },
  })
  let cliente = 0
  let negocio = 0
  let sinRegistrar = 0
  for (const f of filas) {
    if (f.canceladaPor === 'CLIENTE') cliente += f._count._all
    else if (f.canceladaPor === 'NEGOCIO') negocio += f._count._all
    // Las canceladas sin registrar quién no se esconden: si no, los sumandos
    // dejarían de sumar las canceladas del periodo.
    else sinRegistrar += f._count._all
  }
  return { cliente, negocio, sinRegistrar }
}

async function motivosDeCancelacion(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date },
  filtro: FiltroCitasAplicado | null
): Promise<{ motivo: string; total: number }[]> {
  const filas = await tx.cita.groupBy({
    by: ['motivoCancelacion'],
    where: {
      ...enRango(companyId, rango.desde, rango.hasta, filtro),
      estado: 'CANCELADA',
      motivoCancelacion: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { motivoCancelacion: 'desc' } },
    take: TOPE_MOTIVOS,
  })
  return filas
    .filter((f) => f.motivoCancelacion)
    .map((f) => ({ motivo: f.motivoCancelacion as string, total: f._count._all }))
    .sort((a, b) => b.total - a.total)
}

async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string,
  filtro: FiltroCitasAplicado | null
): Promise<PuntoCitas[]> {
  // El corte por día se hace en la BASE y en la zona del negocio. Agrupar en
  // JavaScript obligaría a traer una fila por cita, y `AT TIME ZONE` es lo que
  // evita que una cita de las nueve de la noche caiga en el día siguiente.
  const filas = await tx.$queryRaw<
    {
      dia: string
      agendadas: bigint
      completadas: bigint
      canceladas: bigint
      no_asistio: bigint
    }[]
  >`
    SELECT to_char(("inicio" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           count(*) AS agendadas,
           count(*) FILTER (WHERE "estado"::text = 'COMPLETADA') AS completadas,
           count(*) FILTER (WHERE "estado"::text = 'CANCELADA')  AS canceladas,
           count(*) FILTER (WHERE "estado"::text = 'NO_ASISTIO') AS no_asistio
      FROM "citas"
     WHERE "companyId" = ${companyId}
       AND "inicio" >= ${rango.desde}
       AND "inicio" <  ${rango.hasta}
       ${filtroSql(filtro)}
     GROUP BY 1
  `
  const porDia = new Map<string, PuntoCitas>()
  for (const dia of diasDelRango(rango)) {
    porDia.set(dia, { dia, agendadas: 0, completadas: 0, canceladas: 0, noAsistio: 0 })
  }
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (!punto) continue
    punto.agendadas += Number(f.agendadas)
    punto.completadas += Number(f.completadas)
    punto.canceladas += Number(f.canceladas)
    punto.noAsistio += Number(f.no_asistio)
  }
  return [...porDia.values()]
}

/**
 * Valida el servicio pedido contra la base y devuelve el que SE APLICA.
 *
 * Se comprueba que exista una cita de ESTA empresa con ese servicio: uno
 * inventado no resuelve y el filtro se descarta, igual que `leerRango` descarta
 * un preset inventado. Aplicar a ciegas pintaría toda la agenda en cero, y el
 * cero es una afirmación sobre el negocio, no sobre la URL.
 */
async function resolverFiltro(
  tx: Tx,
  companyId: string,
  pedido: FiltroCitas
): Promise<FiltroCitasAplicado | null> {
  const servicio = pedido.servicio?.trim()
  if (!servicio) return null
  const existe = await tx.cita.findFirst({
    where: { companyId, servicio },
    select: { id: true },
  })
  return existe ? { servicio } : null
}

/** Los servicios distintos de la empresa, para el desplegable. */
async function serviciosDeLaEmpresa(tx: Tx, companyId: string): Promise<string[]> {
  const filas = await tx.cita.groupBy({
    by: ['servicio'],
    where: { companyId, servicio: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { servicio: 'desc' } },
    take: TOPE_GRUPOS,
  })
  return filas
    .map((f) => f.servicio)
    .filter((s): s is string => typeof s === 'string' && s !== '')
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/citas]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteCitas(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: { verEmpleados?: boolean; filtro?: FiltroCitas; ahora?: Date } = {}
): Promise<ReporteCitas> {
  const fallos = { n: 0 }
  const ahora = opciones.ahora ?? new Date()
  // Lo «ya pasado» del periodo termina donde termine antes: el fin del rango o
  // este instante. Sin el mínimo, mirar el mes en curso contaría como «sin
  // cerrar» las citas de la semana que viene, que no han pasado todavía.
  const yaPaso = new Date(Math.min(ahora.getTime(), rango.hasta.getTime()))

  const {
    filtro,
    actual,
    anterior,
    reservadas,
    reservadasAnt,
    sinCerrar,
    porConfirmar,
    cancelaciones,
    motivos,
    empleados,
    servicios,
    serie,
    disponibles,
  } = await conEmpresa(companyId, async (tx) => {
    // El filtro se resuelve ANTES que todo, porque todo lo demás lo lleva
    // dentro. Si la validación falla, se sigue SIN filtro y con el aviso de
    // reporte incompleto: peor que un aviso sería aplicar un filtro a medias.
    const filtro = opciones.filtro
      ? await seguro(resolverFiltro(tx, companyId, opciones.filtro), null, fallos)
      : null

    const vacio: Record<string, number> = {}
    const [
      actual,
      anterior,
      reservadas,
      reservadasAnt,
      sinCerrar,
      porConfirmar,
      cancelaciones,
      motivos,
      empleados,
      servicios,
      serie,
      disponibles,
    ] = await Promise.all([
      seguro(contarPorEstado(tx, companyId, rango.desde, rango.hasta, filtro), vacio, fallos),
      seguro(
        contarPorEstado(tx, companyId, rango.anterior.desde, rango.anterior.hasta, filtro),
        vacio,
        fallos
      ),
      // La demanda que entró: fechada por CUÁNDO SE RESERVÓ, no por cuándo era
      // la cita. Son dos preguntas distintas y por eso son dos cifras.
      seguro(
        tx.cita.count({
          where: enRango(companyId, rango.desde, rango.hasta, filtro, 'createdAt'),
        }),
        0,
        fallos
      ),
      seguro(
        tx.cita.count({
          where: enRango(
            companyId,
            rango.anterior.desde,
            rango.anterior.hasta,
            filtro,
            'createdAt'
          ),
        }),
        0,
        fallos
      ),
      // La agenda a medio cerrar: ya pasaron y nadie las marcó.
      seguro(
        tx.cita.count({
          where: {
            ...enRango(companyId, rango.desde, yaPaso, filtro),
            estado: { in: ABIERTOS },
          },
        }),
        0,
        fallos
      ),
      // ALARMA, fuera del periodo: reservadas para el futuro y sin confirmar.
      seguro(
        tx.cita.count({
          where: {
            companyId,
            estado: 'PENDIENTE',
            inicio: { gte: ahora },
            ...(filtro ? { servicio: filtro.servicio } : {}),
          },
        }),
        0,
        fallos
      ),
      seguro(
        quienCancelo(tx, companyId, rango, filtro),
        { cliente: 0, negocio: 0, sinRegistrar: 0 },
        fallos
      ),
      seguro(motivosDeCancelacion(tx, companyId, rango, filtro), [], fallos),
      // La consulta del desglose por persona NI SE LANZA sin el permiso. No se
      // trae para esconderla en la vista: la ruta de exportación usa esta misma
      // función, así que filtrar en el componente dejaría el dato saliendo por
      // el archivo.
      opciones.verEmpleados
        ? seguro(
            agrupar(tx, companyId, rango, filtro, 'atendidaPorId', async (ids) => {
              if (ids.length === 0) return new Map()
              // Acotado a los usuarios DE ESTA EMPRESA, y por los DOS caminos
              // —empresa activa y tabla de accesos—: con solo el primero, quien
              // atiende dos negocios saldría como «(eliminado)» en el reporte
              // del segundo, que es un nombre falso y no un dato que falte.
              const filas = await tx.user.findMany({
                where: {
                  id: { in: ids },
                  OR: [{ companyId }, { empresasAcceso: { some: { companyId } } }],
                },
                select: { id: true, name: true },
              })
              return new Map(filas.map((u) => [u.id, u.name]))
            }),
            [] as FilaCitas[],
            fallos
          )
        : Promise.resolve(null),
      seguro(
        // `servicio` es texto libre escrito al agendar: no hay catálogo que
        // consultar, el propio valor es el nombre.
        agrupar(tx, companyId, rango, filtro, 'servicio', async (ids) =>
          new Map(ids.map((s) => [s, s]))
        ),
        [] as FilaCitas[],
        fallos
      ),
      seguro(serieDiaria(tx, companyId, rango, timeZone, filtro), [] as PuntoCitas[], fallos),
      seguro(serviciosDeLaEmpresa(tx, companyId), [] as string[], fallos),
    ])

    return {
      filtro,
      actual,
      anterior,
      reservadas,
      reservadasAnt,
      sinCerrar,
      porConfirmar,
      cancelaciones,
      motivos,
      empleados,
      servicios,
      serie,
      disponibles,
    }
  })

  const total = (r: Record<string, number>) => Object.values(r).reduce((s, n) => s + n, 0)
  const agendadas = total(actual)
  const completadas = actual.COMPLETADA ?? 0
  const noAsistio = actual.NO_ASISTIO ?? 0
  const canceladas = actual.CANCELADA ?? 0
  const cerradas = completadas + noAsistio

  return {
    agendadas: kpi(agendadas, total(anterior)),
    completadas: kpi(completadas, anterior.COMPLETADA ?? 0),
    canceladas: kpi(canceladas, anterior.CANCELADA ?? 0),
    noAsistio: kpi(noAsistio, anterior.NO_ASISTIO ?? 0),
    abiertas: (actual.PENDIENTE ?? 0) + (actual.CONFIRMADA ?? 0),
    reservadas: kpi(reservadas, reservadasAnt),
    sinCerrar,
    porConfirmar,
    // Sin citas cerradas no es 0 %: es «sin dato». Un 0 % diría que no se
    // presentó nadie, que es una afirmación sobre los clientes.
    tasaAsistencia: cerradas === 0 ? null : Math.round((completadas / cerradas) * 100),
    tasaCancelacion: agendadas === 0 ? null : Math.round((canceladas / agendadas) * 100),
    quienCancela: cancelaciones,
    motivosCancelacion: motivos,
    // El resto se cierra AQUÍ, con los totales ya resueltos: es la única forma
    // de que la última fila sea exacta en vez de un número que no cuadra.
    porEmpleado: empleados && conElResto(empleados, actual),
    porServicio: conElResto(servicios, actual),
    serie,
    serviciosDisponibles: disponibles,
    filtro,
    incompleto: fallos.n > 0,
  }
}
