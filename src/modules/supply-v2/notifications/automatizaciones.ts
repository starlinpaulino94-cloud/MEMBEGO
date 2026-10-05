import { rolPuede } from '../contracts/adapters'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import type { ContextoAuditoria } from '../core/auditoria'
import {
  AVISO_DEL_DISPARADOR,
  DISPARADORES,
  claveDeAutomatizacion,
  diasDeAviso,
  periodoDelDia,
  type Disparador,
} from './dominio'
import { apuntarAvisoEnTx } from './servicio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · AUTOMATIZACIONES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE CONSTRUYE ZAPIER, Y TAMPOCO SE CREA OTRA TABLA DE REGLAS
 *
 * Membego YA tiene un motor de reglas: `Rule` / `RuleCondition` / `RuleAction`
 * / `RuleExecutionLog` en `prisma/schema/motores.prisma`, con su `actionSink`
 * que sabe mandar por los tres canales de Meta y entregar por webhook con
 * firma, outbox y dead letter. Está bien hecho y se reutiliza donde encaja.
 *
 * Lo que NO encaja es su alcance: `Rule.companyId` es OBLIGATORIO y con
 * borrado en cascada —una regla pertenece a UNA empresa— y sus disparadores
 * son eventos de negocio de esa empresa. Las automatizaciones de este bloque
 * son de PLATAFORMA: «la membresía de alguien vence en 7 días» y «hay un
 * incidente de pago sin resolver» no pertenecen a ningún comercio. Meterlas
 * ahí obligaría a inventar una empresa dueña, que es exactamente el
 * «proveedor sistema inventado» que el bloque 3 rechazó.
 *
 * Así que las automatizaciones se declaran AQUÍ, en código, igual que las
 * condiciones de alerta del bloque 4: cuatro entradas con su disparador, su
 * condición y su acción. El modelo conceptual de §10 queda así:
 *
 *   trigger      el nombre del disparador
 *   conditions   la consulta de cada evaluador, con su umbral configurable
 *   action       apuntar un aviso en el outbox (nunca mover dinero)
 *   status       el interruptor `SUPPLY_V2_AUTOMATIONS` del bloque 4, que ya
 *                vive en base, se cambia desde el panel y queda auditado
 *   lastRunAt    ver la limitación de abajo
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LIMITACIÓN DE `lastRunAt`, DICHA ANTES DE CREAR UNA TABLA (§20, §10)
 *
 * No hay un `lastRunAt` por automatización. Lo que hay es: la respuesta del
 * cron, que dice qué hizo cada pasada; los efectos del outbox que produjo, con
 * su fecha y su clave; y la bitácora. Con eso se responde «¿corrió?» y «¿qué
 * produjo?», que son las preguntas operativas reales.
 *
 * Lo que NO se responde sin una tabla nueva es «¿cuándo corrió la
 * automatización X por última vez si no produjo nada?». Se deja sin responder
 * a propósito: una tabla de ejecuciones que se escribe una vez al día y que
 * solo sirve para eso es una tabla que hay que mantener, migrar y purgar. Si
 * algún día hace falta, el sitio natural es extender `RuleExecutionLog`, no
 * inventar otra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA, IMPUESTA POR LA BASE (§12)
 *
 * `regla + sujeto + periodo` entra en la `dedupeKey` del efecto, y esa columna
 * es ÚNICA. Dos pasadas del cron el mismo día dejan UN aviso porque PostgreSQL
 * rechaza la segunda, no porque alguien se acuerde de comprobarlo.
 *
 * El periodo es el DÍA y no un `lastRunAt` a propósito: un `lastRunAt` se
 * puede quedar sin escribir si el proceso muere entre el envío y la
 * actualización, y entonces el aviso sale dos veces. Una clave determinista no
 * tiene ese hueco.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NINGUNA AUTOMATIZACIÓN MUEVE DINERO (§10)
 *
 * Las acciones posibles son avisar y abrir una alerta operativa. No hay
 * ninguna que confirme un pago, emita un derecho, gaste presupuesto ni
 * resuelva un incidente. Eso sigue necesitando una persona, como en los
 * bloques 3 y 4.
 */

export interface ResultadoDeAutomatizacion {
  regla: Disparador
  /** Cuántos sujetos cumplían la condición. */
  encontrados: number
  /** Cuántos avisos se apuntaron de verdad (los repetidos no cuentan). */
  apuntados: number
  /** Cuántos ya estaban apuntados: la idempotencia funcionando. */
  repetidos: number
}

export interface ResultadoDeAutomatizaciones {
  activo: boolean
  reglas: ResultadoDeAutomatizacion[]
}

/** Lo más que se avisa de una vez. Un cron no debe tardar lo que no se sabe. */
const TOPE = 200

/**
 * Quién recibe los avisos de operaciones.
 *
 * Se resuelve por PERMISO y no por una lista de correos en una variable: una
 * lista se queda vieja el día que alguien entra o sale del equipo, y entonces
 * los avisos de madrugada van a quien ya no está. El permiso lo da el rol, que
 * es lo que se mantiene al día por otras razones.
 */
async function genteDeOperaciones(tx: Tx): Promise<string[]> {
  const candidatos = await tx.user.findMany({
    where: { role: 'SUPERADMIN' },
    select: { id: true, role: true },
    take: 50,
  })
  return candidatos.filter((u) => rolPuede(u.role, 'SUPPLY_V2_OPERATIONS_VIEW')).map((u) => u.id)
}

/**
 * Evalúa las automatizaciones y apunta los avisos que toquen.
 *
 * Idempotente, tolera retraso y se puede lanzar a mano: procesa lo que haya
 * acumulado, no lo que pasó «desde la última vez».
 */
export async function evaluarAutomatizaciones(
  ctx: ContextoAuditoria,
  ahora = new Date()
): Promise<ResultadoDeAutomatizaciones> {
  const periodo = periodoDelDia(ahora)
  const reglas: ResultadoDeAutomatizacion[] = []

  for (const regla of DISPARADORES) {
    reglas.push(await evaluarUna(regla, periodo, ahora, ctx))
  }
  return { activo: true, reglas }
}

async function evaluarUna(
  regla: Disparador,
  periodo: string,
  ahora: Date,
  ctx: ContextoAuditoria
): Promise<ResultadoDeAutomatizacion> {
  const aviso = AVISO_DEL_DISPARADOR[regla]
  let encontrados = 0
  let apuntados = 0
  let repetidos = 0

  const contar = (r: { repetido: boolean }[]) => {
    for (const x of r) {
      if (x.repetido) repetidos++
      else apuntados++
    }
  }

  if (regla === 'MEMBERSHIP_EXPIRING') {
    const dias = diasDeAviso('SUPPLY_V2_MEMBERSHIP_EXPIRING_DAYS', 7)
    const hasta = new Date(ahora.getTime() + dias * 86_400_000)
    await sinEmpresa('Supply 2.0: automatización · membresías por vencer', async (tx) => {
      const filas = await tx.supplyV2CustomerMembership.findMany({
        where: { status: 'ACTIVE', expiresAt: { gt: ahora, lte: hasta } },
        select: { id: true, customerId: true, code: true },
        take: TOPE,
      })
      encontrados = filas.length
      for (const m of filas) {
        contar(
          await apuntarAvisoEnTx(tx, {
            aviso,
            userId: m.customerId,
            agregadoType: 'SupplyV2CustomerMembership',
            agregadoId: m.id,
            correlationId: claveDeAutomatizacion({ regla, sujetoId: m.id, periodo }),
            eventoId: periodo,
            datos: { membresia: m.code, diasDeAviso: dias },
          })
        )
      }
    })
  }

  if (regla === 'BENEFIT_EXPIRING') {
    const dias = diasDeAviso('SUPPLY_V2_BENEFIT_EXPIRING_DAYS', 3)
    const hasta = new Date(ahora.getTime() + dias * 86_400_000)
    await sinEmpresa('Supply 2.0: automatización · beneficios por vencer', async (tx) => {
      const filas = await tx.supplyV2CustomerBenefit.findMany({
        where: { status: 'AVAILABLE', expiresAt: { gt: ahora, lte: hasta } },
        select: { id: true, customerId: true },
        take: TOPE,
      })
      encontrados = filas.length
      for (const g of filas) {
        contar(
          await apuntarAvisoEnTx(tx, {
            aviso,
            userId: g.customerId,
            agregadoType: 'SupplyV2CustomerBenefit',
            agregadoId: g.id,
            correlationId: claveDeAutomatizacion({ regla, sujetoId: g.id, periodo }),
            eventoId: periodo,
            datos: { diasDeAviso: dias },
          })
        )
      }
    })
  }

  /**
   * Los dos de operaciones van AGREGADOS (§13).
   *
   * Un aviso por incidente sería un aviso por fila, que es la forma más rápida
   * de que nadie lea ninguno: con veinte incidentes, veinte correos idénticos
   * a las tres de la mañana. Se manda UNO con la cuenta dentro, y el
   * identificador del agregado es el DÍA, no el incidente, para que la clave
   * de deduplicación deje un solo aviso por jornada.
   */
  if (regla === 'FINANCE_INCIDENT_HIGH') {
    await sinEmpresa('Supply 2.0: automatización · incidentes de severidad alta', async (tx) => {
      const cuantos = await tx.supplyV2FinanceIncident.count({
        where: { status: { in: ['OPEN', 'INVESTIGATING'] }, severity: 'HIGH' },
      })
      encontrados = cuantos
      if (cuantos === 0) return
      for (const userId of await genteDeOperaciones(tx)) {
        contar(
          await apuntarAvisoEnTx(tx, {
            aviso,
            userId,
            agregadoType: 'SupplyV2FinanceIncident',
            agregadoId: `dia:${periodo}`,
            correlationId: claveDeAutomatizacion({ regla, sujetoId: 'plataforma', periodo }),
            eventoId: periodo,
            datos: { incidentes: cuantos },
          })
        )
      }
    })
  }

  if (regla === 'OUTBOX_DEAD') {
    await sinEmpresa('Supply 2.0: automatización · efectos sin salida', async (tx) => {
      const cuantos = await tx.supplyV2OutboxEvent.count({ where: { status: 'DEAD_LETTER' } })
      encontrados = cuantos
      if (cuantos === 0) return
      for (const userId of await genteDeOperaciones(tx)) {
        contar(
          await apuntarAvisoEnTx(tx, {
            aviso,
            userId,
            agregadoType: 'SupplyV2OutboxEvent',
            agregadoId: `dia:${periodo}`,
            correlationId: claveDeAutomatizacion({ regla, sujetoId: 'plataforma', periodo }),
            eventoId: periodo,
            datos: { efectos: cuantos },
          })
        )
      }
    })
  }

  void ctx
  return { regla, encontrados, apuntados, repetidos }
}
