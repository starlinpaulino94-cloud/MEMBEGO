import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import { resumenOperativo } from './salud'
import {
  CONDICIONES,
  ETIQUETA_CONDICION,
  ORDEN_SEVERIDAD,
  evaluarAlertas,
  transicionDeAlerta,
  umbralesDelEntorno,
  type AlertaCalculada,
  type Condicion,
  type EstadoAlerta,
  type SeveridadAlerta,
} from './salud-dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · ALERTAS QUE SE PUEDEN LEER (§12, §13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA POR CONDICIÓN, NO UNA POR FILA
 *
 * La clave primaria de la tabla ES la condición. Eso no es una optimización:
 * es la única forma de que esto siga sirviendo cuando haya mucho acumulado. Si
 * cada efecto fallido abriera su alerta, veintitrés efectos fallidos serían
 * veintitrés avisos, y el aviso veinticuatro —el que importaba— llegaría a una
 * bandeja que ya nadie abre.
 *
 * Lo que se guarda es `OUTBOX_BACKLOG count=23 oldest=17m`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA ALERTA SE CIERRA PORQUE EL PROBLEMA SE FUE
 *
 * No porque alguien la cerrara. `ACKNOWLEDGED` significa «ya lo sé, estoy en
 * ello» y se respeta mientras la condición siga: volver a ponerla en ACTIVE
 * cada vez que el cron pasa sería discutir con quien ya la vio. Lo que la
 * mueve a RESOLVED es que la condición DESAPAREZCA.
 *
 * Esto es idempotente por construcción: evaluar dos veces lo mismo no crea una
 * segunda alerta ni reabre una reconocida.
 */

export interface AlertaEnPanel {
  key: string
  condicion: string
  etiqueta: string
  status: EstadoAlerta
  severity: SeveridadAlerta
  count: number
  summary: string
  detail: Record<string, number>
  firstSeenAt: Date
  lastSeenAt: Date
  resolvedAt: Date | null
  acknowledgedAt: Date | null
  acknowledgedPor: string | null
  acknowledgedNote: string | null
}

export interface ResultadoEvaluacion {
  activas: number
  nuevas: string[]
  resueltas: string[]
  /** Las que siguen y ya estaban reconocidas: no se vuelven a gritar. */
  reconocidasQueSiguen: string[]
}

/**
 * EVALUAR. Lo llama el cron y se puede llamar a mano desde el panel.
 *
 * Idempotente: dos pasadas seguidas dejan el mismo estado. Es requisito, no
 * una propiedad bonita —el cron puede dispararse dos veces y el operador puede
 * pulsar «evaluar» mientras el cron corre—.
 */
export async function evaluarYGuardarAlertas(ctx: ContextoAuditoria, ahora = new Date()): Promise<ResultadoEvaluacion> {
  const resumen = await resumenOperativo(ahora)
  const calculadas = evaluarAlertas({
    cifras: resumen.cifras,
    baseViva: resumen.baseViva,
    derivaDeEsquema: resumen.derivaDeEsquema,
    configuracion: resumen.configuracion.piezas.map((p) => ({ clave: p.clave, estado: p.estado })),
    capacidades: resumen.capacidades,
    umbrales: resumen.umbrales,
  })
  const porCondicion = new Map<string, AlertaCalculada>(calculadas.map((a) => [a.condicion, a]))

  const r: ResultadoEvaluacion = { activas: 0, nuevas: [], resueltas: [], reconocidasQueSiguen: [] }

  // ── Leer y escribir el estado de las alertas en UNA transacción ──────────
  //
  // `sinEmpresa` y no `prisma` a pelo: la política de capa 2 de
  // `supply_v2_operational_alerts` solo deja tocarla en modo omnisciente —una
  // alerta cuenta efectos de TODO Membego, no de un inquilino—. Sin contexto,
  // con RLS encendida, la lectura devolvería cero filas y el estado previo se
  // leería como «nunca hubo ninguna alerta»: cada pasada del cron las
  // reabriría todas como NUEVAS y una reconocida volvería a gritar.
  //
  // Y en una sola transacción porque el conjunto es un estado coherente: dejar
  // la mitad de las condiciones refrescadas y la otra mitad no es peor que no
  // refrescar ninguna. `resumenOperativo` queda FUERA a propósito —ya abre la
  // suya— para no anidar.
  await sinEmpresa('Supply 2.0: evaluar y guardar alertas', async (tx) => {
    const previas = await tx.supplyV2OperationalAlert.findMany({
      where: { key: { in: [...CONDICIONES] } },
      select: { key: true, status: true },
    })
    const estadoPrevio = new Map(previas.map((p) => [p.key, p.status as EstadoAlerta]))

    for (const condicion of CONDICIONES) {
      const calculada = porCondicion.get(condicion)
      const previo = estadoPrevio.get(condicion) ?? null
      const siguiente = transicionDeAlerta(previo, Boolean(calculada))

      if (calculada) {
        r.activas++
        // La fila se refresca SIEMPRE que la condición siga: las cifras cambian
        // aunque el estado no, y un operador necesita el número de ahora.
        await tx.supplyV2OperationalAlert.upsert({
          where: { key: condicion },
          create: {
            key: condicion,
            status: 'ACTIVE',
            severity: calculada.severidad,
            count: calculada.cuenta,
            detail: calculada.detalle as Prisma.InputJsonValue,
            summary: calculada.resumen,
            firstSeenAt: ahora,
            lastSeenAt: ahora,
          },
          update: {
            severity: calculada.severidad,
            count: calculada.cuenta,
            detail: calculada.detalle as Prisma.InputJsonValue,
            summary: calculada.resumen,
            lastSeenAt: ahora,
            // Solo se reabre lo que estaba RESUELTO. Una reconocida se queda
            // reconocida (el `transicionDeAlerta` lo decide; esto lo aplica).
            ...(siguiente === 'ACTIVE'
              ? { status: 'ACTIVE', resolvedAt: null, acknowledgedById: null, acknowledgedAt: null, acknowledgedNote: null, firstSeenAt: ahora }
              : {}),
          },
        })
        if (previo === null) r.nuevas.push(condicion)
        else if (previo === 'ACKNOWLEDGED') r.reconocidasQueSiguen.push(condicion)
        continue
      }

      if (siguiente === 'RESOLVED') {
        await tx.supplyV2OperationalAlert.update({
          where: { key: condicion },
          data: { status: 'RESOLVED', resolvedAt: ahora, count: 0, lastSeenAt: ahora },
        })
        r.resueltas.push(condicion)
      }
    }
  })

  // No se audita la evaluación: la corre el cron cada vez y llenaría la
  // bitácora de líneas que no son decisiones de nadie. Lo que sí se audita es
  // que una persona reconozca una alerta.
  void ctx
  return r
}

/** Las alertas para el panel, lo peor primero. */
export async function alertasEnPanel(
  f: { status?: EstadoAlerta; incluirResueltas?: boolean } = {},
  limite = 50
): Promise<AlertaEnPanel[]> {
  const filas = await sinEmpresa('Supply 2.0: alertas operativas', (tx) =>
    tx.supplyV2OperationalAlert.findMany({
      where: f.status ? { status: f.status } : f.incluirResueltas ? {} : { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: limite,
      select: {
        key: true,
        status: true,
        severity: true,
        count: true,
        detail: true,
        summary: true,
        firstSeenAt: true,
        lastSeenAt: true,
        resolvedAt: true,
        acknowledgedAt: true,
        acknowledgedNote: true,
        acknowledgedBy: { select: { name: true, email: true } },
      },
    })
  )

  return filas
    .map((f2) => ({
      key: f2.key,
      condicion: f2.key,
      etiqueta: ETIQUETA_CONDICION[f2.key as Condicion] ?? f2.key,
      status: f2.status as EstadoAlerta,
      severity: f2.severity as SeveridadAlerta,
      count: f2.count,
      summary: f2.summary,
      detail: (f2.detail ?? {}) as Record<string, number>,
      firstSeenAt: f2.firstSeenAt,
      lastSeenAt: f2.lastSeenAt,
      resolvedAt: f2.resolvedAt,
      acknowledgedAt: f2.acknowledgedAt,
      acknowledgedPor: f2.acknowledgedBy?.name ?? f2.acknowledgedBy?.email ?? null,
      acknowledgedNote: f2.acknowledgedNote,
    }))
    .sort((a, b) => ORDEN_SEVERIDAD[a.severity] - ORDEN_SEVERIDAD[b.severity])
}

/**
 * «YA LO SÉ, ESTOY EN ELLO.»
 *
 * Con nombre y explicación obligatoria —la base lo impone con un CHECK—,
 * porque un «visto» sin más no ayuda a quien llegue en el siguiente turno. No
 * resuelve nada: la alerta se cerrará cuando la condición desaparezca.
 */
export async function reconocerAlerta(
  d: { key: string; nota: string },
  ctx: ContextoAuditoria
): Promise<{ key: string; estaba: EstadoAlerta }> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Reconocer una alerta necesita quién lo hace.')
  const nota = d.nota?.trim()
  if (!nota || nota.length < 3) fallo('MOTIVO_OBLIGATORIO', 'Reconocer una alerta exige decir qué se está haciendo.')

  return sinEmpresa('Supply 2.0: reconocer una alerta operativa', async (tx) => {
    const previa = await tx.supplyV2OperationalAlert.findUnique({ where: { key: d.key }, select: { key: true, status: true, severity: true, count: true } })
    if (!previa) fallo('ALERTA_NO_ENCONTRADA', 'Esa alerta no existe.')
    if (previa.status === 'RESOLVED') fallo('ALERTA_RESUELTA', 'Esa alerta ya se resolvió sola: la condición desapareció.')
    if (previa.status === 'ACKNOWLEDGED') return { key: previa.key, estaba: 'ACKNOWLEDGED' as EstadoAlerta }

    await tx.supplyV2OperationalAlert.update({
      where: { key: d.key },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: ctx.actorId, acknowledgedAt: new Date(), acknowledgedNote: nota },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OPERATIONS_ALERT_ACKNOWLEDGED', 'SupplyV2OperationalAlert', d.key, {
      condicion: d.key,
      severidad: previa.severity,
      cuenta: previa.count,
      nota,
    }, null)
    return { key: previa.key, estaba: 'ACTIVE' as EstadoAlerta }
  })
}

/** Los umbrales vigentes, para que el panel pueda explicar sus propios avisos. */
export function umbralesVigentes() {
  return umbralesDelEntorno()
}
