/**
 * Módulo interno de servidor (sin 'use server'). `procesarReferidoCompletado`
 * otorga recompensas de referido y solo debe llamarse server-to-server desde un
 * flujo ya autorizado (activación de membresía). `getClienteReferidos` se invoca
 * desde un Server Component. Ninguna de las dos debe ser un endpoint público.
 */

import { Prisma, type ReferralEventTipo } from '@prisma/client'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { logReferralEvent, PUNTOS, TIPOS_EMPRESA, TIPOS_GLOBAL } from '@/lib/referidos'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { crearTransaccionAplicada } from '@/lib/transactions'
import { anotarFallo } from '@/lib/prisma-errors'
import { encolarRecompensas } from '@/modules/jobs/emisiones'

/**
 * Fase E6: conversión del referido en su PRIMERA compra confirmada — membresía
 * (origen 'MEMBRESIA') o promoción E5 (origen 'COMPRA'). Reglas:
 * - Un vínculo `sospechoso` NUNCA convierte ni empuja recompensas; genera un
 *   evento FRAUDE auditable en su lugar.
 * - La completación es atómica (guard PENDIENTE) y queda como eventos reales:
 *   COMPRA (+MEMBRESIA si aplica) enlazados al referido concreto.
 * - Las recompensas salen de ReglaRecompensa (umbral >=, sin pérdidas) y se
 *   registran en referral_recompensas con estado real.
 */
export async function procesarReferidoCompletado(
  clienteId: string,
  companyId: string,
  opts: { origen?: 'MEMBRESIA' | 'COMPRA'; monto?: number } = {}
) {
  const origen = opts.origen ?? 'MEMBRESIA'
  // Centro global MembeGo: si este cliente llegó referido desde OTRA empresa,
  // el referente gana los puntos globales de membresía (una sola vez).
  if (origen === 'MEMBRESIA') await procesarMembresiaGlobal(clienteId).catch(anotarFallo('referidos:puntos-globales'))

  try {
    const referido = await sinEmpresa('referidos: buscar vínculo por cliente referido (la empresa del vínculo se valida contra la conversión)', (tx) =>
      tx.referido.findUnique({
        where: { referidoClienteId: clienteId },
        include: { referenteCliente: { select: { nombre: true } } },
      })
    )
    if (!referido || referido.companyId !== companyId) return

    if (referido.sospechoso) {
      // El antifraude aplica en TODAS las etapas (antes solo en el registro):
      // sin puntos, sin COMPLETADO, sin recompensa — pero auditado.
      await logReferralEvent({
        clienteId: referido.referenteClienteId,
        companyId,
        tipo: 'FRAUDE',
        referidoClienteId: clienteId,
        meta: { motivo: 'conversion_bloqueada_vinculo_sospechoso', origen },
      })
      return
    }
    if (referido.estado !== 'PENDIENTE') return

    // Guard atómico anti doble-conversión (dos activaciones concurrentes).
    const upd = await conEmpresa(referido.companyId, (tx) =>
      tx.referido.updateMany({
        where: { id: referido.id, estado: 'PENDIENTE' },
        data: { estado: 'COMPLETADO', completadoEn: new Date() },
      })
    )
    if (upd.count === 0) return

    // Eventos reales del embudo, enlazados al referido concreto.
    await logReferralEvent({
      clienteId: referido.referenteClienteId,
      companyId,
      tipo: 'COMPRA',
      referidoClienteId: clienteId,
      meta: { origen, ...(opts.monto != null ? { monto: opts.monto } : {}) },
      // La conversión vale 200 pts: van en MEMBRESIA si el origen es membresía
      // (semántica histórica) o en COMPRA si convirtió con una promoción.
      puntos: origen === 'COMPRA' ? PUNTOS.MEMBRESIA : 0,
    })
    if (origen === 'MEMBRESIA') {
      await logReferralEvent({
        clienteId: referido.referenteClienteId,
        companyId,
        tipo: 'MEMBRESIA',
        referidoClienteId: clienteId,
      })
    }

    await conEmpresa(referido.companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          accion: 'REFERIDO_COMPLETADO',
          entidadTipo: 'Referido',
          entidadId: referido.id,
          payload: {
            referenteClienteId: referido.referenteClienteId,
            referidoClienteId: clienteId,
            origen,
            ...(opts.monto != null ? { monto: opts.monto } : {}),
          },
        },
      })
    )

    // Bus de estrategias: la conversión ahora SÍ se emite (antes solo existía
    // el evento de registro; el journey de automatizaciones quedaba a ciegas).
    await emitirEventoEstrategia({
      companyId,
      type: 'referido.convirtio',
      subjectId: referido.referenteClienteId,
      payload: {
        cliente: { nombre: referido.referenteCliente.nombre },
        referido: { clienteId, origen, monto: opts.monto ?? null },
      },
    }).catch(anotarFallo('referidos:notificacion'))

    // Fase 4: las recompensas (loop pesado de reglas) salen del request. La
    // transición COMPLETADO + eventos + auditoría ya quedaron en línea — son la
    // fuente de verdad. El worker evalúa e idempotente el unique (referente,
    // regla): si QStash reintenta, no se duplica nada. Se AWAIT por la misma
    // razón que antes: sin QStash `encolar` ejecuta en línea, y el trabajo debe
    // terminar antes de responder al usuario.
    await encolarRecompensas({
      companyId,
      referenteClienteId: referido.referenteClienteId,
      referidoId: referido.id,
    }).catch(anotarFallo('referidos:recompensas'))
  } catch (e) {
    console.error('[referidos] procesarReferidoCompletado error:', e)
  }
}

/**
 * Otorga el evento MEMBRESIA_GLOBAL al referente global (si existe una
 * atribución REGISTRO_GLOBAL para este cliente y aún no se contó su membresía).
 */
async function procesarMembresiaGlobal(referidoClienteId: string) {
  // Fase E6.1: se filtra por la COLUMNA indexada referidoClienteId (antes por
  // meta JSON → seq-scan en cada conversión de membresía). Índice: E6-A.
  const [registroGlobal, yaContada] = await sinEmpresa('referidos: centro global MembeGo (eventos cross-empresa)', (tx) =>
    Promise.all([
      tx.referralEvent.findFirst({
        where: { tipo: 'REGISTRO_GLOBAL', referidoClienteId },
        orderBy: { createdAt: 'asc' },
      }),
      tx.referralEvent.findFirst({
        where: { tipo: 'MEMBRESIA_GLOBAL', referidoClienteId },
        select: { id: true },
      }),
    ])
  )
  if (!registroGlobal) return

  if (yaContada) return

  const meta = (registroGlobal.meta ?? {}) as Record<string, unknown>
  await logReferralEvent({
    clienteId: registroGlobal.clienteId,
    companyId: registroGlobal.companyId,
    tipo: 'MEMBRESIA_GLOBAL',
    referidoClienteId,
    meta: {
      global: true,
      referidoClienteId,
      ...(typeof meta.targetCompanyId === 'string'
        ? { targetCompanyId: meta.targetCompanyId }
        : {}),
    },
    // Si el registro fue marcado sospechoso, la membresía tampoco puntúa.
    ...(meta.sospechoso ? { puntos: 0 } : {}),
  })
}

/**
 * Fase E6: evalúa las reglas activas y otorga recompensas con REGISTRO real.
 * - Umbral `>=` (antes igualdad exacta: si el conteo saltaba el número, la
 *   recompensa se perdía en silencio).
 * - Solo cuentan referidos COMPLETADOS legítimos (sospechoso:false).
 * - Cada regla alcanzada crea UNA fila en referral_recompensas (unique por
 *   referente+regla → sin dobles entregas bajo concurrencia).
 * - Estados reales: ENTREGADA (efecto aplicado) o PENDIENTE (entrega manual:
 *   descuentos, o usos sin membresía activa donde aplicarlos).
 * - Cada entrega genera: transacción oficial (Transaction Engine, REFERRAL),
 *   evento RECOMPENSA, auditoría y notificación.
 *
 * Fase 4: se ejecuta en el worker de la cola; es IDEMPOTENTE gracias al unique
 * (referente, regla) — un reintento salta las ya otorgadas.
 */
export async function evaluarRecompensas(referenteClienteId: string, companyId: string) {
  const completados = await conEmpresa(companyId, (tx) =>
    tx.referido.count({
      where: { companyId, referenteClienteId, estado: 'COMPLETADO', sospechoso: false },
    })
  )
  if (completados === 0) return

  const reglas = await conEmpresa(companyId, (tx) =>
    tx.reglaRecompensa.findMany({
      where: {
        companyId,
        activo: true,
        condicion: 'N_REFERIDOS_COMPLETADOS',
        valorCondicion: { lte: completados },
      },
    })
  )
  if (reglas.length === 0) return

  const referente = await conEmpresa(companyId, (tx) =>
    tx.cliente.findUnique({
      where: { id: referenteClienteId },
      include: { company: { select: { name: true, zonaHoraria: true } } },
    })
  )
  if (!referente) return

  const referenteUser = await sinEmpresa('referidos: buscar user por supabaseId (users son globales, no por empresa)', (tx) =>
    tx.user.findUnique({
      where: { supabaseId: referente.supabaseId },
      select: { id: true },
    })
  )

  const notificacionesACrear: Prisma.NotificacionCreateManyInput[] = []

  for (const regla of reglas) {
    const valor = Number(regla.valorRecompensa)
    if (!Number.isFinite(valor)) {
      console.error('[referidos] Invalid valorRecompensa:', regla.valorRecompensa)
      continue
    }

    // Descripción legible de la recompensa (para registro, ticket y aviso).
    const descripcion =
      regla.tipoRecompensa === 'LAVADOS_GRATIS'
        ? `${valor} uso${valor !== 1 ? 's' : ''} gratis`
        : regla.tipoRecompensa === 'DESCUENTO_PORCENTAJE'
          ? `${valor}% de descuento`
          : `RD$${valor} de descuento`

    // Entrega tangible solo para usos gratis con membresía ACTIVA; el resto
    // queda PENDIENTE hasta que el negocio la aplique (estado real, no un
    // mensaje al vacío).
    let estado: 'ENTREGADA' | 'PENDIENTE' = 'PENDIENTE'
    let mensaje = ''
    if (regla.tipoRecompensa === 'LAVADOS_GRATIS') {
      const activa = await conEmpresa(companyId, (tx) =>
        tx.membership.findUnique({
          where: { clienteId_companyId: { clienteId: referenteClienteId, companyId } },
        })
      )
      if (activa && activa.estado === 'ACTIVA') {
        estado = 'ENTREGADA'
        mensaje = `¡Ganaste ${descripcion} por tus referidos! Ya se aplicaron a tu membresía.`
      } else {
        mensaje = `¡Ganaste ${descripcion} por tus referidos! Se aplicarán cuando actives tu membresía.`
      }
    } else {
      mensaje = `¡Ganaste ${descripcion} por tus referidos! El negocio la tiene registrada como pendiente de aplicar.`
    }

    // Registro real de la recompensa. El unique (referente, regla) hace la
    // creación idempotente: si otra conversión concurrente ya la otorgó, se
    // salta sin duplicar.
    let recompensaId: string
    try {
      const creada = await conEmpresa(companyId, (tx) =>
        tx.referralRecompensa.create({
          data: {
            companyId,
            referenteClienteId,
            reglaId: regla.id,
            estado,
            tipo: regla.tipoRecompensa,
            valor,
            descripcion,
            umbral: regla.valorCondicion,
            completadosAlOtorgar: completados,
            entregadaAt: estado === 'ENTREGADA' ? new Date() : null,
          },
        })
      )
      recompensaId = creada.id
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      throw e
    }

    // Efecto tangible (después de asegurar la fila: sin fila no hay efecto).
    if (estado === 'ENTREGADA') {
      await conEmpresa(companyId, (tx) =>
        tx.membership.updateMany({
          where: { clienteId: referenteClienteId, companyId, estado: 'ACTIVA' },
          // Contador de REGALO: sobrevive a la renovación, a diferencia de
          // los lavados del plan (ver el campo en el esquema).
          data: { lavadosBonoRestantes: { increment: valor } },
        })
      )
    }

    // Transacción oficial (Transaction Engine): la recompensa es una operación
    // auditable con TX-ID, como cualquier otra del sistema.
    await conEmpresa(companyId, async (tx) => {
      await crearTransaccionAplicada(tx, {
        tipo: 'REFERRAL',
        companyId,
        clienteId: referenteClienteId,
        snapshot: {
          cliente: referente.nombre,
          empresa: referente.company.name,
          servicio: `Recompensa por referidos: ${descripcion}`,
          restantes: undefined,
        },
        auditoria: { origen: 'referral_engine', reglaId: regla.id, recompensaId },
        resultado: `Umbral: ${regla.valorCondicion} referidos completados (${completados} al otorgar)`,
        timeZone: referente.company.zonaHoraria,
        userId: null,
      })
    }).catch((e) => console.error('[referidos] tx recompensa:', e))

    // Evento del embudo + auditoría + notificación.
    await logReferralEvent({
      clienteId: referenteClienteId,
      companyId,
      tipo: 'RECOMPENSA',
      meta: { reglaId: regla.id, recompensaId, descripcion, estado },
    })
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          accion: 'RECOMPENSA_OTORGADA',
          entidadTipo: 'ReferralRecompensa',
          entidadId: recompensaId,
          payload: { referenteClienteId, reglaId: regla.id, completados, estado, descripcion },
        },
      })
    )
    if (referenteUser) {
      notificacionesACrear.push({
        userId: referenteUser.id,
        tipo: 'RECOMPENSA_REFERIDO' as const,
        titulo: '¡Recompensa por invitar!',
        mensaje,
        href: '/cliente/invita-y-gana',
      })
    }
  }

  if (notificacionesACrear.length > 0) {
    await sinEmpresa('referidos: crear notificaciones por usuario (notificaciones son por usuario, no por empresa)', (tx) =>
      tx.notificacion.createMany({
        data: notificacionesACrear,
      })
    ).catch((e) => {
      console.error('[referidos-notifications]', e)
    })
  }

  // Compatibilidad con vistas existentes: el booleano legacy se mantiene,
  // pero la fuente de verdad de recompensas es referral_recompensas.
  await conEmpresa(companyId, (tx) =>
    tx.referido.updateMany({
      where: { companyId, referenteClienteId, estado: 'COMPLETADO', sospechoso: false, recompensaAplicada: false },
      data: { recompensaAplicada: true },
    })
  )
}

export async function getClienteReferidos(clienteId: string) {
  return sinEmpresa('referidos: lista de referidos del cliente (panel de cliente, cruza sus empresas)', (tx) =>
    tx.referido.findMany({
      where: { referenteClienteId: clienteId },
      include: { referidoCliente: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  )
}

export interface EtapaEmbudo {
  etapa: string
  valor: number
  /** % respecto a la etapa anterior (null en la primera). */
  tasaPct: number | null
}

export interface ReferidosDashboard {
  stats: {
    compartidos: number
    clicks: number
    clicksUnicos: number
    registrosIniciados: number
    registros: number
    verificados: number
    membresias: number
    /** Conversión registro → compra confirmada (mismo universo: filas Referido). */
    conversionPct: number
    recompensas: number
    puntos: number
  }
  embudo: EtapaEmbudo[]
  historial: {
    id: string
    nombre: string
    fecha: Date
    estado: 'REGISTRADO' | 'MEMBRESIA_ACTIVA' | 'RECOMPENSA_ENTREGADA'
  }[]
  ranking: {
    posicion: number
    nombre: string
    registros: number
    membresias: number
    puntos: number
    esYo: boolean
  }[]
  miPosicion: number | null
  /** Retos activos de la empresa (reglas de recompensa) con progreso REAL. */
  retos: {
    id: string
    nombre: string
    meta: number
    progreso: number
    recompensa: string
    logrado: boolean
  }[]
  /** Recompensas reales del referente (referral_recompensas). */
  misRecompensas: {
    id: string
    descripcion: string
    estado: string
    fecha: Date
  }[]
  /** Centro global MembeGo (suma de todas tus cuentas). */
  global: { puntos: number; registros: number; membresias: number }
}

const RECOMPENSA_LABEL: Record<string, string> = {
  LAVADOS_GRATIS: 'usos gratis',
  DESCUENTO_PORCENTAJE: '% de descuento',
  DESCUENTO_MONTO: 'RD$ de descuento',
}

function tasa(valor: number, base: number): number | null {
  if (base <= 0) return null
  return Math.round((valor / base) * 1000) / 10
}

/**
 * Fase E6 · Panel de referidos del cliente. Reglas de oro:
 * - Cada etapa del embudo sale de UNA fuente consistente y muestra su tasa
 *   respecto a la etapa anterior (nunca se dividen universos distintos).
 * - Clics únicos = visitantes distintos (visitorId sembrado en el clic).
 * - El ranking ordena por CONVERSIONES reales (no por puntos gamificables).
 * - Las recompensas salen de referral_recompensas (estado real).
 */
export async function getReferidosDashboard(
  clienteId: string,
  companyId: string,
  supabaseId: string
): Promise<ReferidosDashboard> {
  // Los IDs de todas mis cuentas (para el Centro global) se resuelven primero
  // porque globalAgg depende de ellos; el resto va en un único Promise.all.
  const misClientes = await sinEmpresa('referidos: resolver todas las cuentas del cliente (centro global MembeGo)', (tx) =>
    tx.cliente.findMany({ where: { supabaseId }, select: { id: true } })
  )
  const misIds = misClientes.map((c) => c.id)

  const [
    eventos,
    clicksUnicosRows,
    registros, // conteo EXACTO sin cap (fuente: filas Referido legítimas)
    membresias, // conversiones EXACTAS sin cap
    recompensas, // total EXACTO de recompensas del referente
    referidos, // solo para la lista de historial (acotada a 200 recientes)
    rankingRows,
    reglas,
    misRecompensasRows,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.referralEvent.groupBy({
        by: ['tipo'],
        where: { clienteId, companyId },
        _count: { _all: true },
        _sum: { puntos: true },
      }),
      tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "visitorId")::bigint AS n
          FROM "referral_events"
          WHERE "clienteId" = ${clienteId} AND "companyId" = ${companyId}
            AND tipo = 'CLICK' AND "visitorId" IS NOT NULL`
      ),
      // Fuente autoritativa SIN cap: coincide con el admin y con el SQL de
      // auditoría aun para referentes con miles de referidos.
      tx.referido.count({ where: { referenteClienteId: clienteId, companyId, sospechoso: false } }),
      tx.referido.count({
        where: { referenteClienteId: clienteId, companyId, sospechoso: false, estado: 'COMPLETADO' },
      }),
      tx.referralRecompensa.count({ where: { referenteClienteId: clienteId, companyId } }),
      tx.referido.findMany({
        where: { referenteClienteId: clienteId, companyId },
        include: { referidoCliente: { select: { nombre: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      // Ranking por conversiones REALES: referidos legítimos por referente.
      tx.$queryRaw<{ referente: string; registros: bigint; membresias: bigint }[]>(
        Prisma.sql`SELECT "referenteClienteId" AS referente,
            count(*)::bigint AS registros,
            count(*) FILTER (WHERE estado = 'COMPLETADO')::bigint AS membresias
          FROM "referidos"
          WHERE "companyId" = ${companyId} AND sospechoso = false
          GROUP BY 1
          ORDER BY membresias DESC, registros DESC
          LIMIT 50`
      ),
      tx.reglaRecompensa.findMany({
        where: { companyId, activo: true },
        orderBy: { valorCondicion: 'asc' },
      }),
      tx.referralRecompensa.findMany({
        where: { referenteClienteId: clienteId, companyId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])
  )

  // Centro global MembeGo: eventos globales de TODAS tus cuentas.
  const globalAgg = await sinEmpresa('referidos: eventos globales del cliente (centro MembeGo, cruza sus empresas)', (tx) =>
    tx.referralEvent.groupBy({
      by: ['tipo'],
      where: { clienteId: { in: misIds }, tipo: { in: TIPOS_GLOBAL } },
      _count: { _all: true },
      _sum: { puntos: true },
    })
  )

  const byTipo = new Map(eventos.map((e) => [e.tipo, e]))
  const count = (t: string) => byTipo.get(t as never)?._count._all ?? 0
  const compartidos = count('SHARE')
  const clicks = count('CLICK')
  const clicksUnicos = Number(clicksUnicosRows[0]?.n ?? 0)
  const registrosIniciados = count('REGISTRO_INICIADO')

  // La lista de historial se acota a 200; las CIFRAS usan los conteos exactos.
  const legitimos = referidos.filter((r) => !r.sospechoso)
  const verificados = count('VERIFICADO')
  const puntos = eventos
    .filter((e) => (TIPOS_EMPRESA as string[]).includes(e.tipo))
    .reduce((acc, e) => acc + (e._sum.puntos ?? 0), 0)
  // Conversión honesta: registro → compra confirmada (mismo universo).
  const conversionPct = registros > 0 ? Math.round((membresias / registros) * 100) : 0

  const embudo: EtapaEmbudo[] = [
    { etapa: 'Compartidos', valor: compartidos, tasaPct: null },
    { etapa: 'Clics', valor: clicks, tasaPct: tasa(clicks, compartidos) },
    { etapa: 'Visitantes únicos', valor: clicksUnicos, tasaPct: tasa(clicksUnicos, clicks) },
    { etapa: 'Registros iniciados', valor: registrosIniciados, tasaPct: tasa(registrosIniciados, clicksUnicos) },
    { etapa: 'Registros', valor: registros, tasaPct: tasa(registros, clicksUnicos) },
    { etapa: 'Conversiones', valor: membresias, tasaPct: tasa(membresias, registros) },
    { etapa: 'Recompensas', valor: recompensas, tasaPct: null },
  ]

  // Ranking (top 5 + posición propia), con nombres y puntos de gamificación.
  const top5 = rankingRows.slice(0, 5)
  const [nombres, puntosTop] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.cliente.findMany({
        where: { id: { in: top5.map((t) => t.referente) } },
        select: { id: true, nombre: true },
      }),
      tx.referralEvent.groupBy({
        by: ['clienteId'],
        where: { companyId, clienteId: { in: top5.map((t) => t.referente) }, tipo: { in: TIPOS_EMPRESA } },
        _sum: { puntos: true },
      }),
    ])
  )
  const nombreDe = new Map(nombres.map((n) => [n.id, n.nombre]))
  const puntosDe = new Map(puntosTop.map((t) => [t.clienteId, t._sum.puntos ?? 0]))
  const ranking = top5.map((t, i) => ({
    posicion: i + 1,
    nombre: nombreDe.get(t.referente) ?? 'Cliente',
    registros: Number(t.registros),
    membresias: Number(t.membresias),
    puntos: puntosDe.get(t.referente) ?? 0,
    esYo: t.referente === clienteId,
  }))
  const idx = rankingRows.findIndex((t) => t.referente === clienteId)
  const miPosicion = idx >= 0 ? idx + 1 : null

  const globalPorTipo = new Map(globalAgg.map((g) => [g.tipo, g]))
  const recompensaPorRegla = new Set(misRecompensasRows.map((r) => r.reglaId))

  return {
    stats: {
      compartidos, clicks, clicksUnicos, registrosIniciados, registros,
      verificados, membresias, conversionPct, recompensas, puntos,
    },
    embudo,
    historial: legitimos.map((r) => ({
      id: r.id,
      nombre: r.referidoCliente.nombre,
      fecha: r.createdAt,
      estado: r.recompensaAplicada
        ? 'RECOMPENSA_ENTREGADA'
        : r.estado === 'COMPLETADO'
          ? 'MEMBRESIA_ACTIVA'
          : 'REGISTRADO',
    })),
    ranking,
    miPosicion,
    retos: reglas.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      meta: r.valorCondicion,
      progreso: Math.min(membresias, r.valorCondicion),
      recompensa: `${Number(r.valorRecompensa)} ${RECOMPENSA_LABEL[r.tipoRecompensa] ?? ''}`.trim(),
      logrado: recompensaPorRegla.has(r.id),
    })),
    misRecompensas: misRecompensasRows.map((r) => ({
      id: r.id,
      descripcion: r.descripcion,
      estado: r.estado,
      fecha: r.entregadaAt ?? r.createdAt,
    })),
    global: {
      puntos: globalAgg.reduce((acc, g) => acc + (g._sum.puntos ?? 0), 0),
      registros: globalPorTipo.get('REGISTRO_GLOBAL')?._count._all ?? 0,
      membresias: globalPorTipo.get('MEMBRESIA_GLOBAL')?._count._all ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Dashboard ROI del programa de referidos para la empresa (/admin/referidos).
// ---------------------------------------------------------------------------

export interface EmpresaReferidosDashboard {
  kpis: {
    linksGenerados: number
    compartidos: number
    clicks: number
    visitantesUnicos: number
    registrosIniciados: number
    registros: number
    verificados: number
    activos: number
    compras: number
    membresias: number
    /** Conversión registro → compra confirmada (mismo universo). */
    conversionPct: number
    /** Conversión visitante único → registro. */
    conversionClickPct: number
    recompensasEntregadas: number
    recompensasPendientes: number
    ingresosReferidos: number
    valorPromedioPorReferido: number
    tiempoPromedioConversionDias: number | null
    sospechosos: number
    fraudes: number
    embajadoresActivos: number
    embajadoresInactivos: number
  }
  embudo: EtapaEmbudo[]
  porCanal: { canal: string; clicks: number; compartidos: number; registros: number }[]
  porCampana: { campana: string; clicks: number }[]
  registrosDiarios: { dia: string; registros: number }[]
  evolucionMensual: { mes: string; registros: number; membresias: number }[]
  topEmbajadores: { nombre: string; registros: number; membresias: number; puntos: number }[]
  topConversion: { nombre: string; registros: number; membresias: number; pct: number }[]
  ultimosMovimientos: { id: string; tipo: string; nombre: string; fecha: Date; canal: string | null }[]
  referidosRecientes: {
    id: string
    referidoClienteId: string
    nombre: string
    referente: string
    estado: string
    sospechoso: boolean
    fecha: Date
    completadoEn: Date | null
  }[]
}

/**
 * Fase E6 · Métricas del programa de referidos de la empresa. `companyId`
 * null = superadmin (toda la plataforma). Cada cifra proviene de eventos o
 * filas reales, con UNA fuente por etapa; los sospechosos/fraudes se reportan
 * aparte y no contaminan ninguna métrica. Server-only.
 */
export async function getEmpresaReferidosDashboard(
  companyId: string | null
): Promise<EmpresaReferidosDashboard> {
  // companyId null = superadmin: toda la plataforma (omnisciente).
  const queries = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    companyId
      ? conEmpresa(companyId, fn)
      : sinEmpresa('referidos: dashboard superadmin (todas las empresas)', fn)

  const whereRef = companyId ? { companyId } : {}
  const companySql = companyId
    ? Prisma.sql`"companyId" = ${companyId}`
    : Prisma.sql`TRUE`

  const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const hace6m = new Date()
  hace6m.setMonth(hace6m.getMonth() - 5)
  hace6m.setDate(1)

  // Ronda 1: agregaciones independientes.
  const [
    eventosTipo,
    visitantesUnicosRows,
    referidosTotal,
    membresias,
    activosRows,
    recompensasAgg,
    canalRows,
    canalRegistrosRows,
    rankingRows,
    activosCountRows,
    tiempoConversionRows,
  ] = await queries((tx) =>
    Promise.all([
      tx.referralEvent.groupBy({
        by: ['tipo'],
        where: whereRef,
        _count: { _all: true },
      }),
      tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "visitorId")::bigint AS n
          FROM "referral_events"
          WHERE ${companySql} AND tipo = 'CLICK' AND "visitorId" IS NOT NULL`
      ),
      tx.referido.count({ where: { ...whereRef, sospechoso: false } }),
      tx.referido.count({ where: { ...whereRef, estado: 'COMPLETADO', sospechoso: false } }),
      // Clientes referidos ACTIVOS: con membresía activa hoy (legítimos).
      tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT r."referidoClienteId")::bigint AS n
          FROM "referidos" r
          JOIN "memberships" m ON m."clienteId" = r."referidoClienteId"
            AND m.estado = 'ACTIVA' AND m."companyId" = r."companyId"
          WHERE ${companyId ? Prisma.sql`r."companyId" = ${companyId}` : Prisma.sql`TRUE`}
            AND r.sospechoso = false`
      ),
      tx.referralRecompensa.groupBy({
        by: ['estado'],
        where: whereRef,
        _count: { _all: true },
      }),
      tx.referralEvent.groupBy({
        by: ['tipo', 'canal'],
        where: { ...whereRef, tipo: { in: ['SHARE', 'CLICK'] } },
        _count: { _all: true },
      }),
      // Canal con mayor conversión (LAST-TOUCH, sin fan-out): para cada referido
      // LEGÍTIMO se toma UN solo clic —el último antes de su registro, del mismo
      // visitante— y se cuenta su canal. Excluye sospechosos y respeta companyId
      // en ambos lados (el visitorId es una cookie cross-empresa de 365 días).
      tx.$queryRaw<{ canal: string; n: bigint }[]>(
        Prisma.sql`SELECT canal, count(*)::bigint AS n FROM (
          SELECT DISTINCT ON (reg."referidoClienteId") COALESCE(c.canal, 'directo') AS canal
          FROM "referral_events" reg
          JOIN "referidos" rf
            ON rf."referidoClienteId" = reg."referidoClienteId" AND rf.sospechoso = false
            ${companyId ? Prisma.sql`AND rf."companyId" = ${companyId}` : Prisma.empty}
          LEFT JOIN "referral_events" c
            ON c."visitorId" = reg."visitorId" AND c.tipo = 'CLICK'
            AND c."createdAt" <= reg."createdAt"
            ${companyId ? Prisma.sql`AND c."companyId" = ${companyId}` : Prisma.empty}
          WHERE ${companyId ? Prisma.sql`reg."companyId" = ${companyId}` : Prisma.sql`TRUE`}
            AND reg.tipo = 'REGISTRO' AND reg."visitorId" IS NOT NULL
          ORDER BY reg."referidoClienteId", c."createdAt" DESC NULLS LAST
        ) t GROUP BY 1`
      ),
      // Ranking por conversiones reales (no por puntos gamificables).
      tx.$queryRaw<{ referente: string; registros: bigint; membresias: bigint }[]>(
        Prisma.sql`SELECT "referenteClienteId" AS referente,
            count(*)::bigint AS registros,
            count(*) FILTER (WHERE estado = 'COMPLETADO')::bigint AS membresias
          FROM "referidos"
          WHERE ${companySql} AND sospechoso = false
          GROUP BY 1
          ORDER BY membresias DESC, registros DESC
          LIMIT 10`
      ),
      tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(DISTINCT "clienteId")::bigint AS n
          FROM "referral_events"
          WHERE ${companySql} AND "createdAt" >= ${hace30d}`
      ),
      // Tiempo promedio registro → conversión (días), solo legítimos completados.
      tx.$queryRaw<{ dias: number | null }[]>(
        Prisma.sql`SELECT avg(EXTRACT(EPOCH FROM ("completadoEn" - "createdAt")) / 86400)::float AS dias
          FROM "referidos"
          WHERE ${companySql} AND estado = 'COMPLETADO' AND sospechoso = false
            AND "completadoEn" IS NOT NULL`
      ),
    ])
  )

  const countTipo = (t: string) =>
    eventosTipo.find((e) => e.tipo === t)?._count._all ?? 0
  const clicks = countTipo('CLICK')
  const visitantesUnicos = Number(visitantesUnicosRows[0]?.n ?? 0)
  const registrosIniciados = countTipo('REGISTRO_INICIADO')
  const verificados = countTipo('VERIFICADO')
  const compras = countTipo('COMPRA')
  const fraudes = countTipo('FRAUDE')

  // Ronda 2: agregados y series.
  const [ingresosAgg, sospechosos, campanaRows, diariosRows, mensualRows, historicosCountRows, movimientos, referidosRecientesRows] =
    await queries((tx) =>
      Promise.all([
        // Ingresos atribuibles: pagos confirmados de clientes referidos LEGÍTIMOS.
        tx.membership.aggregate({
          // Mismo criterio de «cobrado» que el resto del sistema, sin límite de
          // fecha: aquí interesa todo lo que ha entrado por vía de referidos.
          where: whereCobrado(new Date(0), undefined, {
            cliente: {
              referidoComo: {
                some: { estado: 'COMPLETADO', sospechoso: false, ...(companyId ? { companyId } : {}) },
              },
            },
          }),
          _sum: { montoPagado: true },
        }),
        tx.referido.count({ where: { ...whereRef, sospechoso: true } }),
        tx.$queryRaw<{ campana: string; n: bigint }[]>(
          Prisma.sql`SELECT meta->>'campana' AS campana, count(*)::bigint AS n
            FROM "referral_events"
            WHERE ${companySql} AND tipo = 'CLICK' AND meta->>'campana' IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
        ),
        tx.$queryRaw<{ dia: Date; n: bigint }[]>(
          Prisma.sql`SELECT date_trunc('day', "createdAt") AS dia, count(*)::bigint AS n
            FROM "referidos" WHERE ${companySql} AND "sospechoso" = false AND "createdAt" >= ${hace30d}
            GROUP BY 1 ORDER BY 1`
        ),
        tx.$queryRaw<{ mes: Date; registros: bigint; membresias: bigint }[]>(
          Prisma.sql`SELECT date_trunc('month', "createdAt") AS mes,
              count(*)::bigint AS registros,
              count(*) FILTER (WHERE estado = 'COMPLETADO')::bigint AS membresias
            FROM "referidos" WHERE ${companySql} AND "sospechoso" = false AND "createdAt" >= ${hace6m}
            GROUP BY 1 ORDER BY 1`
        ),
        tx.$queryRaw<{ n: bigint }[]>(
          Prisma.sql`SELECT count(DISTINCT "clienteId")::bigint AS n
            FROM "referral_events" WHERE ${companySql}`
        ),
        // Últimos movimientos del programa (eventos reales, cronológicos).
        tx.referralEvent.findMany({
          where: whereRef,
          include: { cliente: { select: { nombre: true } } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
        // Estado de cada referido (los sospechosos visibles, marcados).
        tx.referido.findMany({
          where: whereRef,
          include: {
            referidoCliente: { select: { nombre: true } },
            referenteCliente: { select: { nombre: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
      ])
    )

  const ingresosReferidos = Number(ingresosAgg._sum.montoPagado ?? 0)
  const recompensasEntregadas =
    recompensasAgg.find((r) => r.estado === 'ENTREGADA')?._count._all ?? 0
  const recompensasPendientes =
    recompensasAgg.find((r) => r.estado === 'PENDIENTE')?._count._all ?? 0
  const linksGenerados = countTipo('LINK')

  // Nombres y puntos de los tops (ranking ya viene por conversiones).
  const topIds = rankingRows.map((t) => t.referente)
  const [nombres, puntosTop] = await queries((tx) =>
    Promise.all([
      tx.cliente.findMany({
        where: { id: { in: topIds } },
        select: { id: true, nombre: true },
      }),
      tx.referralEvent.groupBy({
        by: ['clienteId'],
        where: { ...whereRef, clienteId: { in: topIds }, tipo: { in: TIPOS_EMPRESA } },
        _sum: { puntos: true },
      }),
    ])
  )
  const nombreDe = new Map(nombres.map((n) => [n.id, n.nombre]))
  const puntosDe = new Map(puntosTop.map((t) => [t.clienteId, t._sum.puntos ?? 0]))

  const embajadoresActivos = Number(activosCountRows[0]?.n ?? 0)
  const embajadoresInactivos = Math.max(
    0,
    Number(historicosCountRows[0]?.n ?? 0) - embajadoresActivos
  )

  const embudo: EtapaEmbudo[] = [
    { etapa: 'Links generados', valor: linksGenerados, tasaPct: null },
    { etapa: 'Clics', valor: clicks, tasaPct: null },
    { etapa: 'Visitantes únicos', valor: visitantesUnicos, tasaPct: tasa(visitantesUnicos, clicks) },
    { etapa: 'Registros iniciados', valor: registrosIniciados, tasaPct: tasa(registrosIniciados, visitantesUnicos) },
    { etapa: 'Registros completados', valor: referidosTotal, tasaPct: tasa(referidosTotal, visitantesUnicos) },
    { etapa: 'Verificados', valor: verificados, tasaPct: tasa(verificados, referidosTotal) },
    { etapa: 'Compras realizadas', valor: compras, tasaPct: tasa(compras, referidosTotal) },
    { etapa: 'Referidos válidos', valor: membresias, tasaPct: tasa(membresias, referidosTotal) },
    { etapa: 'Recompensas entregadas', valor: recompensasEntregadas, tasaPct: null },
  ]

  const fmtMes = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', month: 'short', year: '2-digit' })
  const fmtDia = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: '2-digit', month: 'short' })

  return {
    kpis: {
      linksGenerados,
      compartidos: countTipo('SHARE'),
      clicks,
      visitantesUnicos,
      registrosIniciados,
      registros: referidosTotal,
      verificados,
      activos: Number(activosRows[0]?.n ?? 0),
      compras,
      membresias,
      conversionPct: referidosTotal > 0 ? Math.round((membresias / referidosTotal) * 100) : 0,
      conversionClickPct:
        visitantesUnicos > 0 ? Math.round((referidosTotal / visitantesUnicos) * 100) : 0,
      recompensasEntregadas,
      recompensasPendientes,
      ingresosReferidos,
      valorPromedioPorReferido: membresias > 0 ? Math.round(ingresosReferidos / membresias) : 0,
      tiempoPromedioConversionDias:
        tiempoConversionRows[0]?.dias != null
          ? Math.round(tiempoConversionRows[0].dias * 10) / 10
          : null,
      sospechosos,
      fraudes,
      embajadoresActivos,
      embajadoresInactivos,
    },
    embudo,
    porCanal: (() => {
      const registrosPorCanal = new Map(canalRegistrosRows.map((r) => [r.canal, Number(r.n)]))
      const mapa = new Map<string, { clicks: number; compartidos: number; registros: number }>()
      const get = (canal: string) => {
        const item = mapa.get(canal) ?? { clicks: 0, compartidos: 0, registros: 0 }
        mapa.set(canal, item)
        return item
      }
      for (const r of canalRows) {
        const item = get(r.canal ?? 'directo')
        if (r.tipo === 'CLICK') item.clicks += r._count._all
        else item.compartidos += r._count._all
      }
      // Los registros por canal (last-touch) incluyen 'directo' —registros cuyo
      // último toque no fue un clic rastreable— que NO aparece en canalRows;
      // se recorren aparte para no perderlos de la tabla.
      for (const [canal, n] of registrosPorCanal) {
        get(canal).registros = n
      }
      return [...mapa.entries()]
        .map(([canal, v]) => ({ canal, ...v }))
        .sort((a, b) => b.registros - a.registros || b.clicks - a.clicks)
    })(),
    porCampana: campanaRows.map((c) => ({ campana: c.campana, clicks: Number(c.n) })),
    registrosDiarios: diariosRows.map((d) => ({ dia: fmtDia.format(d.dia), registros: Number(d.n) })),
    evolucionMensual: mensualRows.map((m) => ({
      mes: fmtMes.format(m.mes),
      registros: Number(m.registros),
      membresias: Number(m.membresias),
    })),
    topEmbajadores: rankingRows.slice(0, 5).map((t) => ({
      nombre: nombreDe.get(t.referente) ?? 'Cliente',
      registros: Number(t.registros),
      membresias: Number(t.membresias),
      puntos: puntosDe.get(t.referente) ?? 0,
    })),
    // Conversión por embajador: registro → compra, MISMO universo, mín. 3 registros.
    topConversion: rankingRows
      .filter((t) => Number(t.registros) >= 3)
      .map((t) => ({
        nombre: nombreDe.get(t.referente) ?? 'Cliente',
        registros: Number(t.registros),
        membresias: Number(t.membresias),
        pct: Math.round((Number(t.membresias) / Number(t.registros)) * 100),
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5),
    ultimosMovimientos: movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      nombre: m.cliente.nombre,
      fecha: m.createdAt,
      canal: m.canal,
    })),
    referidosRecientes: referidosRecientesRows.map((r) => ({
      id: r.id,
      referidoClienteId: r.referidoClienteId,
      nombre: r.referidoCliente.nombre,
      referente: r.referenteCliente.nombre,
      estado: r.sospechoso ? 'SOSPECHOSO' : r.estado,
      sospechoso: r.sospechoso,
      fecha: r.createdAt,
      completadoEn: r.completadoEn,
    })),
  }
}

/**
 * Fase E6 · Línea de tiempo completa de UN referido: todos los eventos reales
 * de su recorrido (clic del visitante que se convirtió en su registro,
 * registro, verificación, compras, recompensas) con fecha y hora. Server-only.
 */
export async function getReferidoTimeline(referidoClienteId: string) {
  const registro = await sinEmpresa('referidos: timeline - evento REGISTRO del referido', (tx) =>
    tx.referralEvent.findFirst({
      where: { tipo: 'REGISTRO', referidoClienteId },
      select: { visitorId: true },
    })
  )
  const eventos = await sinEmpresa('referidos: timeline - eventos del referido (cross-empresa por visitorId)', (tx) =>
    tx.referralEvent.findMany({
      where: {
        OR: [
          { referidoClienteId },
          ...(registro?.visitorId
            ? [{ visitorId: registro.visitorId, tipo: { in: ['CLICK', 'REGISTRO_INICIADO'] as ReferralEventTipo[] } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
  )
  return eventos.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    fecha: e.createdAt,
    canal: e.canal,
    puntos: e.puntos,
  }))
}
