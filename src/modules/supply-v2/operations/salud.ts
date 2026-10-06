import { sinEmpresa } from '@/lib/tenant'
import { saludDeLaCola } from '@/modules/jobs/muertos'
import { saludDeConfiguracion } from './config-salud'
import { capacidadActiva } from './flags'
import {
  CIFRAS_EN_CERO,
  componentesDeSalud,
  estadoDelSistema,
  minutosDesde,
  umbralesDelEntorno,
  type Capacidad,
  type CifrasOperativas,
  type Componente,
  type EntradaDeSalud,
  type EstadoComponente,
} from './salud-dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · LAS CIFRAS, DE LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTAR EN SQL, NO EN JAVASCRIPT
 *
 * Todo lo de aquí son agregaciones: `count`, `groupBy`, `findFirst` ordenado.
 * Ni una consulta se trae filas para contarlas en memoria, y no es purismo: el
 * panel se abre justo cuando hay mucho acumulado —es decir, cuando traerse las
 * filas es más caro—, y un panel de operaciones que se cae con el sistema
 * enfermo es peor que no tenerlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADA DICE «SANO» POR EXISTIR
 *
 * Cada estado sale de un número de la base comparado con un umbral que alguien
 * decidió. Si no hay datos se dice que no hay datos; nunca «todo cuadra».
 */

export interface ResumenOperativo {
  estado: EstadoComponente
  componentes: Componente[]
  cifras: CifrasOperativas
  configuracion: Awaited<ReturnType<typeof saludDeConfiguracion>>
  capacidades: Record<Capacidad, boolean>
  umbrales: ReturnType<typeof umbralesDelEntorno>
  /** Si la base no responde, el resumen lo dice y no finge cifras en cero. */
  baseViva: boolean
  derivaDeEsquema: boolean
  medidoEn: Date
}

/** La ventana en la que se mira «¿se entregó algo últimamente?». */
const VENTANA_VIDA_MS = 24 * 60 * 60 * 1000

export async function resumenOperativo(ahora = new Date()): Promise<ResumenOperativo> {
  const umbrales = umbralesDelEntorno()
  const capacidades = {
    SUPPLY_V2_EXTERNAL_PAYMENTS: await capacidadActiva('SUPPLY_V2_EXTERNAL_PAYMENTS'),
    SUPPLY_V2_OUTBOX_DELIVERY: await capacidadActiva('SUPPLY_V2_OUTBOX_DELIVERY'),
    SUPPLY_V2_RECONCILIATION_SWEEP: await capacidadActiva('SUPPLY_V2_RECONCILIATION_SWEEP'),
    SUPPLY_V2_OPERATIONS_CENTER: await capacidadActiva('SUPPLY_V2_OPERATIONS_CENTER'),
    SUPPLY_V2_AUTOMATIONS: await capacidadActiva('SUPPLY_V2_AUTOMATIONS'),
  } satisfies Record<Capacidad, boolean>

  const configuracion = await saludDeConfiguracion()

  let cifras = CIFRAS_EN_CERO
  let baseViva = true
  let derivaDeEsquema = false
  try {
    cifras = await cifrasOperativas(ahora)
    derivaDeEsquema = await hayDerivaDeEsquema()
  } catch {
    // Si la base no responde, NO se devuelven ceros: eso diría «todo en orden»
    // justo cuando nada está en orden.
    baseViva = false
  }

  const entrada: EntradaDeSalud = {
    cifras,
    baseViva,
    derivaDeEsquema,
    configuracion: configuracion.piezas.map((p) => ({ clave: p.clave, estado: p.estado })),
    capacidades,
    umbrales,
  }
  const componentes = componentesDeSalud(entrada)

  return {
    estado: estadoDelSistema(componentes),
    componentes,
    cifras,
    configuracion,
    capacidades,
    umbrales,
    baseViva,
    derivaDeEsquema,
    medidoEn: ahora,
  }
}

/** Las nueve cifras del panel, en agregaciones. */
export async function cifrasOperativas(ahora = new Date()): Promise<CifrasOperativas> {
  const desde = new Date(ahora.getTime() - VENTANA_VIDA_MS)

  // ── `sinEmpresa` sobre TODO el bloque, y no fila por fila ────────────────
  //
  // No es higiene: es la diferencia entre un panel que dice la verdad y uno que
  // miente tranquilizando. Las tablas de operación de Supply 2.0 solo se dejan
  // leer en modo omnisciente —son de plataforma, no de un inquilino— y con RLS
  // encendida una consulta sin contexto NO falla: devuelve cero filas. Cero
  // filas aquí se leería como «cero incidentes, cero difuntos, nada atrasado»,
  // es decir, el panel en verde justo cuando hace falta que esté en rojo.
  //
  // Va UNA transacción para las nueve, no nueve: son lecturas de un instante y
  // así además se ven coherentes entre sí.
  const [
    incidentesAbiertos,
    incidentesAltos,
    discrepancias,
    outboxPendiente,
    masViejo,
    outboxMuertos,
    eventosFallidos,
    eventosMuertos,
    efectosEntregados,
  ] = await sinEmpresa('Supply 2.0: cifras operativas', (tx) =>
    Promise.all([
      tx.supplyV2FinanceIncident.count({ where: { type: 'EXTERNAL_PAYMENT_MISMATCH', status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      tx.supplyV2FinanceIncident.count({ where: { type: 'EXTERNAL_PAYMENT_MISMATCH', status: { in: ['OPEN', 'INVESTIGATING'] }, severity: 'HIGH' } }),
      tx.supplyV2PaymentReconciliation.count({ where: { outcome: 'MISMATCH' } }),
      tx.supplyV2OutboxEvent.count({ where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } } }),
      tx.supplyV2OutboxEvent.findFirst({
        where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      tx.supplyV2OutboxEvent.count({ where: { status: 'DEAD_LETTER' } }),
      tx.supplyV2ExternalEvent.count({ where: { status: 'FAILED' } }),
      tx.supplyV2ExternalEvent.count({ where: { status: 'DEAD_LETTER' } }),
      tx.supplyV2OutboxEvent.count({ where: { status: 'DELIVERED', processedAt: { gte: desde } } }),
    ])
  )
  // La cola de trabajos va FUERA de esa transacción: es de otro módulo, trae su
  // propio contexto y meterla dentro anidaría transacciones.
  const cola = await saludDeLaCola()

  return {
    incidentesAbiertos,
    incidentesAltos,
    discrepancias,
    outboxPendiente,
    outboxMasViejoMin: minutosDesde(masViejo?.createdAt ?? null, ahora),
    outboxMuertos,
    eventosFallidos,
    eventosMuertos,
    // La cola de trabajos NO se reimplementa: es `saludDeLaCola` de siempre.
    difuntosDeCola: cola.trabajosMuertos,
    efectosEntregados,
  }
}

/**
 * ¿El código espera objetos que la base no tiene?
 *
 * Centinelas del Slice 9, con la misma idea que los de `/api/health`: una tabla
 * o columna representativa de cada tanda. Si falta alguna, el despliegue va
 * por delante de la base y el panel lo dice en vez de fallar con un error de
 * Prisma a mitad de una consulta.
 */
export async function hayDerivaDeEsquema(): Promise<boolean> {
  const filas = await sinEmpresa('Supply 2.0: centinelas de esquema del Slice 9', (tx) =>
    tx.$queryRaw<{ ok: boolean }[]>`
      SELECT to_regclass('public.supply_v2_external_events') IS NOT NULL AS ok
      UNION ALL SELECT to_regclass('public.supply_v2_outbox_events') IS NOT NULL
      UNION ALL SELECT to_regclass('public.supply_v2_payment_reconciliations') IS NOT NULL
      UNION ALL SELECT to_regclass('public.supply_v2_operational_alerts') IS NOT NULL
      UNION ALL SELECT to_regclass('public.supply_v2_operational_switches') IS NOT NULL
      UNION ALL SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'supply_v2_outbox_events' AND column_name = 'claimedAt')
      UNION ALL SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'supply_v2_finance_incidents' AND column_name = 'reasonCode')`
  )
  return filas.some((f) => !f.ok)
}

/**
 * LIVENESS: ¿está viva la aplicación?
 *
 * No toca la base y no llama a nadie de fuera, y eso es el punto: si liveness
 * dependiera de un tercero, un proveedor caído haría que el orquestador
 * reiniciara una aplicación perfectamente sana. Liveness responde «el proceso
 * atiende peticiones»; nada más.
 */
export function liveness(): { status: 'alive'; at: string } {
  return { status: 'alive', at: new Date().toISOString() }
}

export interface Readiness {
  /** `ready` | `degraded` | `not_ready`. */
  status: 'ready' | 'degraded' | 'not_ready'
  componentes: { clave: string; estado: EstadoComponente; detalle: string }[]
}

/**
 * READINESS: ¿puede Supply 2.0 operar?
 *
 * Comprueba base, esquema, configuración crítica, cuenta de integración,
 * secreto de la pasarela cuando la capacidad está encendida, y la cola. Lo que
 * NO hace es llamar al proveedor externo: readiness se consulta muchas veces
 * por minuto y hacerlo convertiría cada sonda en tráfico hacia un tercero —y
 * su latencia, en nuestra indisponibilidad—.
 *
 * Y distingue las dos cosas que no son lo mismo (§26):
 *
 *   capacidad apagada a propósito     → ready, componente DISABLED
 *   capacidad encendida sin configurar → not_ready
 */
export async function readiness(ahora = new Date()): Promise<Readiness> {
  const r = await resumenOperativo(ahora)
  const estado = r.estado
  return {
    status: estado === 'UNAVAILABLE' ? 'not_ready' : estado === 'DEGRADED' ? 'degraded' : 'ready',
    componentes: r.componentes.map((c) => ({ clave: c.clave, estado: c.estado, detalle: c.detalle })),
  }
}
