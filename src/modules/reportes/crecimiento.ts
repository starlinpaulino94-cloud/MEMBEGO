import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * CRECIMIENTO — quién trae gente nueva, por dónde entra y dónde se cae.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE CADA CIFRA (y por qué este reporte SÍ se puede construir)
 *
 * La auditoría del módulo encontró varias áreas con arquitectura pero sin dato
 * —`Promocion.canjes` no cuenta canjes, `BenefitGrant.redeemedAt` no lo escribe
 * nadie, no hay modelo `Cupon`—. Crecimiento es la excepción: tiene DOS
 * bitácoras de eventos que el código vivo escribe de verdad.
 *
 *  · `referral_events` (ReferralEvent) — el embudo del programa de referidos.
 *    Lo escriben `lib/referidos.ts`, `lib/referidos-attribution.ts`,
 *    `modules/growth/*`, `modules/referidos/*` y la ruta `/r/[code]`.
 *  · `referidos` (Referido) — el vínculo referente→referido, con `createdAt`
 *    (registro atribuido) y `completadoEn` (cuándo se completó de verdad).
 *  · `growth_links`, `referral_recompensas`, `growth_rewards` — enlaces de
 *    invitación y recompensas entregadas, cada una con su propia fecha.
 *  · `invitacion_eventos` (InvitacionEvento) — el embudo PARALELO de las
 *    campañas «Invita y Gana».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS CUATRO LÍMITES QUE ESTE REPORTE NO ESCONDE
 *
 *  1. EL EMBUDO ES UN SUELO, NO UNA VERDAD EXACTA. `logReferralEvent` traga sus
 *     errores a propósito —«el tracking jamás debe romper el flujo principal»—,
 *     así que un fallo de escritura pierde el evento sin que nadie se entere.
 *     Las cifras de aquí son «al menos esto», nunca «exactamente esto».
 *  2. `PRIMER_USO` ESTÁ DECLARADO Y NADIE LO ESCRIBE. Sale en el enum y tiene
 *     cero escrituras en todo `src/`. Enseñarlo como etapa daría un cero
 *     permanente que se leería como «nadie canjea», que es una afirmación sobre
 *     el negocio y no sobre el código. Va en la lista de lo que NO se reporta.
 *  3. SON DOS EMBUDOS PARALELOS Y NO SE SUMAN. `ReferralEventTipo` e
 *     `InvitacionEventoTipo` miden los mismos hitos con otros nombres (el
 *     propio esquema lista las equivalencias). Un registro de campaña puede
 *     dejar huella en los dos, así que sumarlos contaría a la misma persona dos
 *     veces. Van en secciones distintas, cada una con su nombre.
 *  4. `clienteId` SIEMPRE ES EL REFERENTE, nunca el invitado. Por eso la
 *     columna de personas del embudo se llama «referentes distintos»: decir
 *     «personas» ahí mezclaría a quien invita con quien llega.
 *
 * A cambio, una cosa que sí juega a favor y conviene saber al leerlo: los clics
 * ya vienen depurados. La ruta `/r/[code]` descarta bots, descarta al propio
 * dueño abriendo su enlace y pasa por un limitador, así que «clics» no es
 * tráfico bruto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS NOMBRES VAN DETRÁS DE SU PERMISO
 *
 * La tabla de quién trae más gente es una lista de personas identificadas, así
 * que es `null` sin `ver_datos_personales`. El permiso viaja a la CONSULTA
 * —la exportación reusa esta misma función—, así que sin él ni se lanza.
 */

type Tx = Prisma.TransactionClient

/**
 * El embudo, en orden. Cada etapa es un valor real de `ReferralEventTipo` que
 * algún archivo de `src/` escribe: una prueba lo comprueba contra el enum.
 */
export const ETAPAS = [
  { clave: 'LINK', nombre: 'Enlaces generados', ayuda: 'El cliente obtuvo su código para invitar.' },
  { clave: 'SHARE', nombre: 'Veces que se compartió', ayuda: 'Pulsó compartir (1 por minuto como máximo).' },
  { clave: 'CLICK', nombre: 'Clics en el enlace', ayuda: 'Alguien abrió el enlace. Sin bots ni autoclics.' },
  { clave: 'LANDING_VIEW', nombre: 'Landing vista', ayuda: 'La página de invitación llegó a pintarse.' },
  { clave: 'REGISTRO_INICIADO', nombre: 'Registro empezado', ayuda: 'Cargó el formulario ya con atribución.' },
  { clave: 'REGISTRO', nombre: 'Registro completado', ayuda: 'El invitado creó su cuenta.' },
  { clave: 'VERIFICADO', nombre: 'Correo verificado', ayuda: 'El invitado confirmó su correo.' },
  { clave: 'MEMBRESIA', nombre: 'Membresía activada', ayuda: 'El invitado activó una membresía.' },
  { clave: 'COMPRA', nombre: 'Primera compra', ayuda: 'El invitado pagó algo por primera vez.' },
  { clave: 'RECOMPENSA', nombre: 'Recompensa entregada', ayuda: 'Se le dio su premio a quien invitó.' },
] as const

/**
 * Lo que existe en el enum y NO va en el embudo, con su razón. La lista no es
 * decorativa: una prueba exige que entre las dos cubran el enum entero, para
 * que un tipo nuevo no se caiga del reporte en silencio.
 */
export const FUERA_DEL_EMBUDO = [
  { clave: 'PRIMER_USO', razon: 'declarado en el enum y sin una sola escritura en el código: sería un cero permanente' },
  { clave: 'FRAUDE', razon: 'no es una etapa sino un bloqueo; se cuenta aparte' },
  { clave: 'REGISTRO_GLOBAL', razon: 'el invitado se unió a OTRA empresa de la plataforma; se cuenta aparte' },
  { clave: 'MEMBRESIA_GLOBAL', razon: 'la membresía se activó en OTRA empresa; se cuenta aparte' },
] as const

/** Tope de filas por agrupación. Lo que quede fuera va en una fila «resto». */
const TOPE_GRUPOS = 30
/** Cuántas personas lista la tabla de quién trae más gente. */
const TOPE_TOP = 20
const SIN_CANAL = '(sin canal registrado)'
const RESTO = '(resto, agrupado)'

export interface EtapaEmbudo {
  clave: string
  nombre: string
  ayuda: string
  eventos: number
  /** Referentes distintos con al menos un evento de esta etapa. */
  referentes: number
}

export interface FilaCanal {
  nombre: string
  compartidos: number
  clics: number
}

export interface PuntoCrecimiento {
  dia: string
  clics: number
  registros: number
}

export interface Referente {
  id: string
  nombre: string
  completados: number
}

export interface FilaCampana {
  nombre: string
  clics: number
  registros: number
  premios: number
}

export interface FilasRecompensa {
  pendientes: number
  entregadas: number
  rechazadas: number
}

export interface ReporteCrecimiento {
  // ── Las cifras del periodo ────────────────────────────────────────────────
  /** Clics en enlaces de invitación, ya sin bots ni autoclics. */
  clics: Kpi
  /** Registros atribuidos a una invitación. */
  registros: Kpi
  /** Vínculos que se completaron en el periodo (`Referido.completadoEn`). */
  completados: Kpi
  /** Invitados que activaron membresía. */
  membresias: Kpi

  /** Registros ÷ clics. `null` = no hubo clics, que no es lo mismo que 0 %. */
  tasaRegistro: number | null
  /** Membresías ÷ registros. `null` = no hubo registros. */
  tasaMembresia: number | null

  // ── El embudo entero ──────────────────────────────────────────────────────
  embudo: EtapaEmbudo[]
  /** Visitas ÚNICAS identificadas por cookie, y los clics que no la traían. */
  visitas: { unicas: number; sinIdentificar: number }

  // ── Desgloses ─────────────────────────────────────────────────────────────
  porCanal: FilaCanal[]
  serie: PuntoCrecimiento[]
  /** `null` = sin permiso `ver_datos_personales`. */
  topReferentes: Referente[] | null

  // ── Alrededor del embudo ──────────────────────────────────────────────────
  enlaces: { creados: number; vigentesHoy: number }
  /** Lo que el antifraude apartó: no cuenta en el embudo ni da puntos. */
  bloqueados: { referidosSospechosos: number; eventosFraude: number }
  /** Dos motores de recompensa conviven; se enseñan por separado a propósito. */
  recompensas: { referidos: FilasRecompensa; growth: FilasRecompensa }
  /** El invitado acabó en otra empresa de la plataforma. */
  fueraDeLaEmpresa: { registros: number; membresias: number }

  // ── El otro embudo, en su propia sección ──────────────────────────────────
  campanas: FilaCampana[]

  incompleto: boolean
}

/**
 * El embudo entero en UNA consulta: eventos y referentes distintos por tipo.
 *
 * Una consulta por etapa serían diez viajes para pintar una tabla, y el
 * `count(DISTINCT …)` tiene que salir de la base: agrupar en JavaScript
 * traería una fila por evento, que es justo lo que prohíbe la tercera regla de
 * `docs/REPORTES.md`.
 */
async function embudoBruto(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Map<string, { eventos: number; referentes: number }>> {
  const filas = await tx.$queryRaw<{ tipo: string; eventos: bigint; referentes: bigint }[]>`
    SELECT "tipo"::text AS tipo,
           count(*) AS eventos,
           count(DISTINCT "clienteId") AS referentes
      FROM "referral_events"
     WHERE "companyId" = ${companyId}
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
     GROUP BY 1
  `
  return new Map(
    filas.map((f) => [f.tipo, { eventos: Number(f.eventos), referentes: Number(f.referentes) }])
  )
}

/**
 * Visitas únicas de verdad: `visitorId` es una cookie sembrada en el clic, así
 * que cuenta personas y no pulsaciones. Los clics que no la traen se DICEN en
 * vez de repartirse: un enlace abierto desde un cliente de correo que bloquea
 * cookies es una visita real que no se puede identificar.
 */
async function visitasUnicas(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<{ unicas: number; sinIdentificar: number }> {
  const filas = await tx.$queryRaw<{ unicas: bigint; sin_id: bigint }[]>`
    SELECT count(DISTINCT "visitorId") AS unicas,
           count(*) FILTER (WHERE "visitorId" IS NULL) AS sin_id
      FROM "referral_events"
     WHERE "companyId" = ${companyId}
       AND "tipo" = 'CLICK'
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
  `
  return {
    unicas: Number(filas[0]?.unicas ?? 0),
    sinIdentificar: Number(filas[0]?.sin_id ?? 0),
  }
}

/**
 * Por dónde se comparte y por dónde entra: las dos columnas en la misma fila,
 * porque la pregunta útil no es «cuánto se compartió por WhatsApp» sino «de lo
 * que se compartió por WhatsApp, cuánto volvió en clics».
 */
async function porCanal(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<FilaCanal[]> {
  const filas = await tx.$queryRaw<
    { clave: string | null; compartidos: bigint; clics: bigint }[]
  >`
    SELECT "canal" AS clave,
           count(*) FILTER (WHERE "tipo" = 'SHARE') AS compartidos,
           count(*) FILTER (WHERE "tipo" = 'CLICK') AS clics
      FROM "referral_events"
     WHERE "companyId" = ${companyId}
       AND "tipo" IN ('SHARE', 'CLICK')
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
     GROUP BY 1
     ORDER BY 2 DESC, 3 DESC
     LIMIT ${TOPE_GRUPOS}
  `
  return filas.map((f) => ({
    nombre: f.clave && f.clave.trim() !== '' ? f.clave : SIN_CANAL,
    compartidos: Number(f.compartidos),
    clics: Number(f.clics),
  }))
}

/** Cierra una agrupación recortada con lo que quedó fuera. */
function conElResto(filas: FilaCanal[], compartidos: number, clics: number): FilaCanal[] {
  if (filas.length < TOPE_GRUPOS) return filas
  const resto = {
    compartidos: compartidos - filas.reduce((s, f) => s + f.compartidos, 0),
    clics: clics - filas.reduce((s, f) => s + f.clics, 0),
  }
  if (resto.compartidos <= 0 && resto.clics <= 0) return filas
  return [...filas, { nombre: RESTO, compartidos: Math.max(resto.compartidos, 0), clics: Math.max(resto.clics, 0) }]
}

/** Clics y registros por día, cortados en la zona horaria del negocio. */
async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoCrecimiento[]> {
  const filas = await tx.$queryRaw<{ dia: string; clics: bigint; registros: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           count(*) FILTER (WHERE "tipo" = 'CLICK') AS clics,
           count(*) FILTER (WHERE "tipo" = 'REGISTRO') AS registros
      FROM "referral_events"
     WHERE "companyId" = ${companyId}
       AND "createdAt" >= ${rango.desde}
       AND "createdAt" <  ${rango.hasta}
     GROUP BY 1
  `
  const porDia = new Map<string, PuntoCrecimiento>()
  for (const dia of diasDelRango(rango)) porDia.set(dia, { dia, clics: 0, registros: 0 })
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (!punto) continue
    punto.clics += Number(f.clics)
    punto.registros += Number(f.registros)
  }
  return [...porDia.values()]
}

/**
 * Quién trajo más gente, contando VÍNCULOS COMPLETADOS en el periodo y no
 * eventos: un referente con veinte clics y ningún registro no trajo a nadie.
 * Los marcados como sospechosos quedan fuera, igual que en el programa.
 */
async function quienTrajoMas(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Referente[]> {
  const filas = await tx.referido.groupBy({
    by: ['referenteClienteId'],
    where: {
      companyId,
      sospechoso: false,
      completadoEn: { gte: rango.desde, lt: rango.hasta },
    },
    _count: { _all: true },
    orderBy: { _count: { referenteClienteId: 'desc' } },
    take: TOPE_TOP,
  })
  const ids = filas.map((f) => f.referenteClienteId)
  if (ids.length === 0) return []
  // Acotado a los clientes DE ESTA EMPRESA: nunca se llega a una persona por
  // su usuario global, que es compartido entre negocios.
  const nombres = await tx.cliente.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, nombre: true },
  })
  const mapa = new Map(nombres.map((c) => [c.id, c.nombre]))
  return filas.map((f) => ({
    id: f.referenteClienteId,
    nombre: mapa.get(f.referenteClienteId) ?? '(cliente eliminado)',
    completados: f._count._all,
  }))
}

/**
 * El OTRO embudo: las campañas «Invita y Gana». Se enseña aparte y con sus
 * propios nombres de hito, porque sumarlo al de referidos contaría dos veces a
 * quien pasó por los dos.
 */
async function porCampana(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<FilaCampana[]> {
  const filas = await tx.$queryRaw<
    { nombre: string; clics: bigint; registros: bigint; premios: bigint }[]
  >`
    SELECT c."nombre" AS nombre,
           count(*) FILTER (WHERE e."tipo" = 'ENLACE_ABIERTO') AS clics,
           count(*) FILTER (WHERE e."tipo" = 'REGISTRO_COMPLETADO') AS registros,
           count(*) FILTER (WHERE e."tipo" = 'PREMIO_RECLAMADO') AS premios
      FROM "invitacion_eventos" e
      JOIN "campanas_invitacion" c
        ON c."id" = e."campanaId"
       AND c."companyId" = ${companyId}
     WHERE e."companyId" = ${companyId}
       AND e."createdAt" >= ${rango.desde}
       AND e."createdAt" <  ${rango.hasta}
     GROUP BY 1
     ORDER BY 3 DESC, 2 DESC
     LIMIT ${TOPE_GRUPOS}
  `
  return filas.map((f) => ({
    nombre: f.nombre,
    clics: Number(f.clics),
    registros: Number(f.registros),
    premios: Number(f.premios),
  }))
}

function filasRecompensa(
  filas: { estado: string; _count: { _all: number } }[]
): FilasRecompensa {
  const de = (estado: string) => filas.find((f) => f.estado === estado)?._count._all ?? 0
  return { pendientes: de('PENDIENTE'), entregadas: de('ENTREGADA'), rechazadas: de('RECHAZADA') }
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/crecimiento]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteCrecimiento(
  companyId: string,
  rango: Rango,
  timeZone: string,
  opciones: {
    verDatosPersonales?: boolean
    ahora?: Date
  } = {}
): Promise<ReporteCrecimiento> {
  const fallos = { n: 0 }
  const ahora = opciones.ahora ?? new Date()

  const [
    actual,
    anterior,
    completados,
    completadosAnt,
    visitas,
    canales,
    serie,
    top,
    enlacesCreados,
    enlacesVigentes,
    sospechosos,
    recompensasReferidos,
    recompensasGrowth,
    campanas,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(embudoBruto(tx, companyId, rango), new Map(), fallos),
      seguro(embudoBruto(tx, companyId, rango.anterior), new Map(), fallos),
      // Los completados NO salen del embudo de eventos: `Referido.completadoEn`
      // es la única fecha que dice cuándo se cerró el círculo de verdad.
      seguro(
        tx.referido.count({
          where: {
            companyId,
            sospechoso: false,
            completadoEn: { gte: rango.desde, lt: rango.hasta },
          },
        }),
        0,
        fallos
      ),
      seguro(
        tx.referido.count({
          where: {
            companyId,
            sospechoso: false,
            completadoEn: { gte: rango.anterior.desde, lt: rango.anterior.hasta },
          },
        }),
        0,
        fallos
      ),
      seguro(visitasUnicas(tx, companyId, rango), { unicas: 0, sinIdentificar: 0 }, fallos),
      seguro(porCanal(tx, companyId, rango), [] as FilaCanal[], fallos),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoCrecimiento[], fallos),
      // Sin el permiso la consulta NI SE LANZA: la exportación usa esta misma
      // función, así que esconder la tabla en la vista dejaría los nombres
      // saliendo por el archivo.
      opciones.verDatosPersonales === true
        ? seguro(quienTrajoMas(tx, companyId, rango), [] as Referente[], fallos)
        : Promise.resolve(null),
      seguro(
        tx.growthLink.count({
          where: { companyId, createdAt: { gte: rango.desde, lt: rango.hasta } },
        }),
        0,
        fallos
      ),
      // Foto de hoy: cuántos enlaces siguen sirviendo ahora mismo. No depende
      // del periodo y por eso no se compara contra el anterior.
      seguro(
        tx.growthLink.count({
          where: {
            companyId,
            activo: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: ahora } }],
          },
        }),
        0,
        fallos
      ),
      seguro(
        tx.referido.count({
          where: {
            companyId,
            sospechoso: true,
            createdAt: { gte: rango.desde, lt: rango.hasta },
          },
        }),
        0,
        fallos
      ),
      seguro(
        tx.referralRecompensa.groupBy({
          by: ['estado'],
          where: { companyId, createdAt: { gte: rango.desde, lt: rango.hasta } },
          _count: { _all: true },
        }),
        [] as { estado: string; _count: { _all: number } }[],
        fallos
      ),
      seguro(
        tx.growthReward.groupBy({
          by: ['estado'],
          where: { companyId, createdAt: { gte: rango.desde, lt: rango.hasta } },
          _count: { _all: true },
        }),
        [] as { estado: string; _count: { _all: number } }[],
        fallos
      ),
      seguro(porCampana(tx, companyId, rango), [] as FilaCampana[], fallos),
    ])
  )

  const cuenta = (
    mapa: Map<string, { eventos: number; referentes: number }>,
    clave: string
  ) => mapa.get(clave)?.eventos ?? 0

  const clics = cuenta(actual, 'CLICK')
  const registros = cuenta(actual, 'REGISTRO')
  const membresias = cuenta(actual, 'MEMBRESIA')

  const compartidos = cuenta(actual, 'SHARE')

  return {
    clics: kpi(clics, cuenta(anterior, 'CLICK')),
    registros: kpi(registros, cuenta(anterior, 'REGISTRO')),
    completados: kpi(completados, completadosAnt),
    membresias: kpi(membresias, cuenta(anterior, 'MEMBRESIA')),
    // Sin clics no es 0 %: es «sin dato». Un 0 % diría que nadie que entró se
    // registró, y lo que pasó es que no entró nadie.
    tasaRegistro: clics === 0 ? null : Math.round((registros / clics) * 100),
    tasaMembresia: registros === 0 ? null : Math.round((membresias / registros) * 100),
    embudo: ETAPAS.map((e) => ({
      clave: e.clave,
      nombre: e.nombre,
      ayuda: e.ayuda,
      eventos: actual.get(e.clave)?.eventos ?? 0,
      referentes: actual.get(e.clave)?.referentes ?? 0,
    })),
    visitas,
    porCanal: conElResto(canales, compartidos, clics),
    serie,
    topReferentes: top,
    enlaces: { creados: enlacesCreados, vigentesHoy: enlacesVigentes },
    bloqueados: {
      referidosSospechosos: sospechosos,
      eventosFraude: cuenta(actual, 'FRAUDE'),
    },
    recompensas: {
      referidos: filasRecompensa(recompensasReferidos),
      growth: filasRecompensa(recompensasGrowth),
    },
    fueraDeLaEmpresa: {
      registros: cuenta(actual, 'REGISTRO_GLOBAL'),
      membresias: cuenta(actual, 'MEMBRESIA_GLOBAL'),
    },
    campanas,
    incompleto: fallos.n > 0,
  }
}
