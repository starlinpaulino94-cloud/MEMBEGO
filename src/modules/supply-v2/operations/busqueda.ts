import { sinEmpresa, type Tx } from '@/lib/tenant'
import { interpretarBusqueda, type TipoDeBusqueda } from './salud-dominio'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 4 · BUSCAR UNA OPERACIÓN (§5, §6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR IGUALDAD Y POR ÍNDICE, NUNCA POR `contains`
 *
 * El texto se INTERPRETA antes de consultar (`MBG-SO-…` es un número de compra,
 * `sv2-…` un hilo, `TX-…` una transacción) y cada caso se busca por su campo
 * indexado y por igualdad.
 *
 * Un `%texto%` sobre cuatro tablas sería cómodo de escribir y acabaría siendo
 * la consulta más lenta del sistema justo el día que hay un incidente: el panel
 * se abre cuando hay mucho acumulado, que es cuando un escaneo completo duele.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEVUELVE ESTÁ AGRUPADO
 *
 * Buscar `MBG-SO-000123` no devuelve una lista de coincidencias: devuelve la
 * compra Y sus eventos externos, sus comprobaciones, sus incidentes, sus
 * efectos del outbox y sus avisos. La pregunta real nunca es «¿dónde aparece
 * este texto?», es «¿qué pasó con esto?».
 */

export interface ResultadoBusqueda {
  tipo: TipoDeBusqueda
  valor: string
  encontrado: boolean
  orden: {
    id: string
    number: string
    status: string
    total: string
    currency: string
    createdAt: Date
    paidAt: Date | null
    clienteId: string
  } | null
  eventos: {
    id: string
    provider: string
    externalEventId: string
    eventType: string
    status: string
    attempts: number
    lastError: string | null
    receivedAt: Date
    processedAt: Date | null
    correlationId: string
  }[]
  conciliaciones: {
    id: string
    provider: string
    externalTransactionId: string | null
    outcome: string
    reasonCode: string | null
    severity: string
    expectedAmount: string | null
    reportedAmount: string | null
    expectedCurrency: string | null
    reportedCurrency: string | null
    differenceAmount: string | null
    internalStatus: string | null
    externalStatus: string | null
    checks: number
    checkedAt: Date
    incidentId: string | null
  }[]
  incidentes: {
    id: string
    status: string
    severity: string
    reasonCode: string | null
    provider: string | null
    externalTransactionId: string | null
    amount: string
    currency: string
    notes: string
    resolution: string | null
    resolvedAt: Date | null
    resueltoPor: string | null
    createdAt: Date
    correlationId: string | null
  }[]
  efectos: {
    id: string
    eventType: string
    status: string
    attempts: number
    availableAt: Date
    claimedAt: Date | null
    processedAt: Date | null
    lastError: string | null
    createdAt: Date
    correlationId: string
  }[]
  avisos: { id: string; tipo: string; titulo: string; createdAt: Date; leida: boolean }[]
}

const VACIO = (tipo: TipoDeBusqueda, valor: string): ResultadoBusqueda => ({
  tipo,
  valor,
  encontrado: false,
  orden: null,
  eventos: [],
  conciliaciones: [],
  incidentes: [],
  efectos: [],
  avisos: [],
})

/** Lo más que se devuelve de cada tipo: un panel no es un volcado. */
const TOPE = 25

/**
 * `sinEmpresa` y no `prisma` a pelo, en toda la búsqueda.
 *
 * Esto es una lectura de PLATAFORMA: cruza compras, eventos, conciliaciones,
 * incidentes y efectos de cualquier empresa, que es justo lo que un operador
 * necesita y lo que el portal del proveedor nunca debe recibir. Pero
 * «cross-tenant» no significa «sin contexto»: con RLS encendida una consulta
 * sin contexto NO falla, devuelve cero filas, y aquí cero filas se leería como
 * «esa operación no existe» —el peor resultado posible en un panel que se abre
 * justamente cuando algo no cuadra—. El gate `rls:cobertura` existe para no
 * dejar pasar esto, y tenía razón.
 */
export async function buscarOperacion(texto: string): Promise<ResultadoBusqueda> {
  return sinEmpresa('Supply 2.0: búsqueda operativa', (tx) => buscarOperacionEnTx(tx, texto))
}

async function buscarOperacionEnTx(tx: Tx, texto: string): Promise<ResultadoBusqueda> {
  const { tipo, valor } = interpretarBusqueda(texto)
  if (tipo === 'DESCONOCIDO' || !valor) return VACIO(tipo, valor)

  // Primero se resuelve el ANCLA: la compra o el hilo. Todo lo demás cuelga de
  // ahí, y así cada consulta siguiente usa una clave indexada.
  let orderId: string | null = null
  let correlationId: string | null = null

  if (tipo === 'ORDEN') {
    const o = await tx.supplyV2CustomerOrder.findUnique({ where: { number: valor }, select: { id: true } })
    orderId = o?.id ?? null
  } else if (tipo === 'CORRELACION') {
    correlationId = valor
    const e = await tx.supplyV2ExternalEvent.findFirst({ where: { correlationId: valor }, select: { orderId: true } })
    orderId = e?.orderId ?? null
    if (!orderId) {
      const c = await tx.supplyV2PaymentReconciliation.findFirst({ where: { correlationId: valor }, select: { orderId: true } })
      orderId = c?.orderId ?? null
    }
  } else if (tipo === 'TRANSACCION') {
    const c = await tx.supplyV2PaymentReconciliation.findFirst({
      where: { externalTransactionId: valor },
      select: { orderId: true, correlationId: true },
      orderBy: { createdAt: 'desc' },
    })
    orderId = c?.orderId ?? null
    correlationId = c?.correlationId ?? null
    if (!orderId && !correlationId) {
      const i = await tx.supplyV2FinanceIncident.findFirst({
        where: { externalTransactionId: valor },
        select: { orderId: true, correlationId: true },
      })
      orderId = i?.orderId ?? null
      correlationId = i?.correlationId ?? null
    }
  } else if (tipo === 'EVENTO_EXTERNO') {
    const e = await tx.supplyV2ExternalEvent.findFirst({
      where: { externalEventId: valor },
      select: { orderId: true, correlationId: true },
    })
    orderId = e?.orderId ?? null
    correlationId = e?.correlationId ?? null
  } else if (tipo === 'ID') {
    // Un cuid puede ser de cuatro cosas. Se prueban por clave primaria, que es
    // una búsqueda exacta y barata, y se para en la primera que exista.
    const [evento, conciliacion, incidente, efecto] = await Promise.all([
      tx.supplyV2ExternalEvent.findUnique({ where: { id: valor }, select: { orderId: true, correlationId: true } }),
      tx.supplyV2PaymentReconciliation.findUnique({ where: { id: valor }, select: { orderId: true, correlationId: true } }),
      tx.supplyV2FinanceIncident.findUnique({ where: { id: valor }, select: { orderId: true, correlationId: true } }),
      tx.supplyV2OutboxEvent.findUnique({ where: { id: valor }, select: { aggregateId: true, correlationId: true } }),
    ])
    const hallado = evento ?? conciliacion ?? incidente
    orderId = hallado?.orderId ?? efecto?.aggregateId ?? null
    correlationId = hallado?.correlationId ?? efecto?.correlationId ?? null
    // Puede ser el id de la compra misma.
    if (!orderId) {
      const o = await tx.supplyV2CustomerOrder.findUnique({ where: { id: valor }, select: { id: true } })
      orderId = o?.id ?? null
    }
  }

  if (!orderId && !correlationId) return VACIO(tipo, valor)

  const porOrdenOHilo = <T extends object>(campoOrden: T) =>
    orderId && correlationId
      ? { OR: [campoOrden, { correlationId }] }
      : orderId
        ? campoOrden
        : { correlationId: correlationId! }

  const [orden, eventos, conciliaciones, incidentes, efectos] = await Promise.all([
    orderId
      ? tx.supplyV2CustomerOrder.findUnique({
          where: { id: orderId },
          select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true, paidAt: true, customerId: true },
        })
      : null,
    tx.supplyV2ExternalEvent.findMany({
      where: porOrdenOHilo({ orderId: orderId ?? undefined }),
      orderBy: { receivedAt: 'asc' },
      take: TOPE,
      select: { id: true, provider: true, externalEventId: true, eventType: true, status: true, attempts: true, lastError: true, receivedAt: true, processedAt: true, correlationId: true },
    }),
    tx.supplyV2PaymentReconciliation.findMany({
      where: porOrdenOHilo({ orderId: orderId ?? undefined }),
      orderBy: { createdAt: 'asc' },
      take: TOPE,
      select: {
        id: true, provider: true, externalTransactionId: true, outcome: true, reasonCode: true, severity: true,
        expectedAmount: true, reportedAmount: true, expectedCurrency: true, reportedCurrency: true, differenceAmount: true,
        internalStatus: true, externalStatus: true, checks: true, checkedAt: true, incidentId: true,
      },
    }),
    tx.supplyV2FinanceIncident.findMany({
      where: porOrdenOHilo({ orderId: orderId ?? undefined }),
      orderBy: { createdAt: 'asc' },
      take: TOPE,
      select: {
        id: true, status: true, severity: true, reasonCode: true, provider: true, externalTransactionId: true,
        amount: true, currency: true, notes: true, resolution: true, resolvedAt: true, createdAt: true, correlationId: true,
        resolvedBy: { select: { name: true, email: true } },
      },
    }),
    orderId
      ? tx.supplyV2OutboxEvent.findMany({
          where: { aggregateId: orderId },
          orderBy: { createdAt: 'asc' },
          take: TOPE,
          select: { id: true, eventType: true, status: true, attempts: true, availableAt: true, claimedAt: true, processedAt: true, lastError: true, createdAt: true, correlationId: true, dedupeKey: true },
        })
      : tx.supplyV2OutboxEvent.findMany({
          where: { correlationId: correlationId! },
          orderBy: { createdAt: 'asc' },
          take: TOPE,
          select: { id: true, eventType: true, status: true, attempts: true, availableAt: true, claimedAt: true, processedAt: true, lastError: true, createdAt: true, correlationId: true, dedupeKey: true },
        }),
  ])

  // Los avisos al cliente: su `dedupeKey` es la identidad del efecto, así que
  // se buscan por igualdad sobre las claves que acabamos de leer.
  const claves = efectos.map((e) => e.dedupeKey)
  const avisos = claves.length
    ? await tx.notificacion.findMany({
        where: { dedupeKey: { in: claves } },
        orderBy: { createdAt: 'asc' },
        take: TOPE,
        select: { id: true, tipo: true, titulo: true, createdAt: true, leida: true },
      })
    : []

  return {
    tipo,
    valor,
    encontrado: Boolean(orden || eventos.length || conciliaciones.length || incidentes.length || efectos.length),
    orden: orden
      ? {
          id: orden.id,
          number: orden.number,
          status: orden.status,
          total: orden.total.toFixed(2),
          currency: orden.currency,
          createdAt: orden.createdAt,
          paidAt: orden.paidAt,
          clienteId: orden.customerId,
        }
      : null,
    eventos,
    conciliaciones: conciliaciones.map((c) => ({
      ...c,
      expectedAmount: c.expectedAmount?.toFixed(2) ?? null,
      reportedAmount: c.reportedAmount?.toFixed(2) ?? null,
      differenceAmount: c.differenceAmount?.toFixed(2) ?? null,
    })),
    incidentes: incidentes.map((i) => ({
      id: i.id,
      status: i.status,
      severity: i.severity,
      reasonCode: i.reasonCode,
      provider: i.provider,
      externalTransactionId: i.externalTransactionId,
      amount: i.amount.toFixed(2),
      currency: i.currency,
      notes: i.notes,
      resolution: i.resolution,
      resolvedAt: i.resolvedAt,
      resueltoPor: i.resolvedBy?.name ?? i.resolvedBy?.email ?? null,
      createdAt: i.createdAt,
      correlationId: i.correlationId,
    })),
    efectos: efectos.map(({ dedupeKey: _dedupeKey, ...e }) => e),
    avisos: avisos.map((a) => ({ id: a.id, tipo: a.tipo, titulo: a.titulo, createdAt: a.createdAt, leida: a.leida })),
  }
}

// ── Línea de tiempo (§6) ───────────────────────────────────────────────────

export interface MomentoDeLaOperacion {
  cuando: Date
  que: string
  detalle: string
  /** De dónde sale el dato. Si no está persistido, se dice. */
  fuente: 'inbox' | 'conciliacion' | 'incidente' | 'orden' | 'outbox' | 'aviso' | 'bitacora'
}

export interface LineaDeTiempo {
  momentos: MomentoDeLaOperacion[]
  /**
   * Lo que NO se puede reconstruir, dicho explícitamente.
   *
   * La verificación de la firma, el rechazo de un replay y el tamaño del cuerpo
   * NO dejan fila en la base —a propósito: lo que no está firmado no entra—, así
   * que solo viven en los logs estructurados `sv2`. Decir «firma verificada» en
   * una línea de tiempo construida desde la base sería inventarse un momento
   * que nadie guardó.
   */
  avisos: string[]
}

/**
 * LA HISTORIA DE UNA OPERACIÓN, SOLO CON LO PERSISTIDO.
 *
 * Cada momento sale de una fila con su marca de tiempo. No se inventa ninguno:
 * si el dato solo existe en los logs, aparece en `avisos` diciendo dónde
 * buscarlo, no como un momento más.
 */
export async function lineaDeTiempoDeOperacion(texto: string): Promise<{ busqueda: ResultadoBusqueda; linea: LineaDeTiempo }> {
  const busqueda = await buscarOperacion(texto)
  const momentos: MomentoDeLaOperacion[] = []

  if (busqueda.orden) {
    momentos.push({
      cuando: busqueda.orden.createdAt,
      que: 'Compra abierta',
      detalle: `${busqueda.orden.number} · ${busqueda.orden.currency} ${busqueda.orden.total}`,
      fuente: 'orden',
    })
    if (busqueda.orden.paidAt) {
      momentos.push({
        cuando: busqueda.orden.paidAt,
        que: 'Compra PAGADA',
        detalle: `estado ${busqueda.orden.status}`,
        fuente: 'orden',
      })
    }
  }

  for (const e of busqueda.eventos) {
    momentos.push({
      cuando: e.receivedAt,
      que: 'Evento externo recibido',
      detalle: `${e.provider} · ${e.eventType} · ${e.externalEventId}`,
      fuente: 'inbox',
    })
    if (e.processedAt) {
      momentos.push({ cuando: e.processedAt, que: `Evento ${e.status}`, detalle: e.eventType, fuente: 'inbox' })
    } else if (e.status !== 'RECEIVED' && e.lastError) {
      // No hay `processedAt` cuando no acabó bien; se usa la recepción como
      // ancla y se dice que el momento exacto no está guardado.
      momentos.push({
        cuando: e.receivedAt,
        que: `Evento ${e.status}`,
        detalle: `${e.lastError} (intentos: ${e.attempts})`,
        fuente: 'inbox',
      })
    }
  }

  for (const c of busqueda.conciliaciones) {
    momentos.push({
      cuando: c.checkedAt,
      que: `Conciliación ${c.outcome}`,
      detalle: c.reasonCode
        ? `${c.reasonCode} · esperado ${c.expectedCurrency ?? ''} ${c.expectedAmount ?? '—'} · reportado ${c.reportedCurrency ?? ''} ${c.reportedAmount ?? '—'}`
        : `comprobada ${c.checks} vez(ces)`,
      fuente: 'conciliacion',
    })
  }

  for (const i of busqueda.incidentes) {
    momentos.push({
      cuando: i.createdAt,
      que: 'Incidente ABIERTO',
      detalle: `${i.reasonCode ?? 'sin motivo'} · severidad ${i.severity}`,
      fuente: 'incidente',
    })
    if (i.resolvedAt) {
      momentos.push({
        cuando: i.resolvedAt,
        que: 'Incidente RESUELTO',
        detalle: `${i.resolution ?? 'sin resolución'}${i.resueltoPor ? ` · ${i.resueltoPor}` : ''}`,
        fuente: 'incidente',
      })
    }
  }

  for (const o of busqueda.efectos) {
    momentos.push({ cuando: o.createdAt, que: 'Efecto apuntado en el outbox', detalle: o.eventType, fuente: 'outbox' })
    if (o.claimedAt) momentos.push({ cuando: o.claimedAt, que: 'Efecto reclamado por un worker', detalle: `intento ${o.attempts}`, fuente: 'outbox' })
    if (o.processedAt) momentos.push({ cuando: o.processedAt, que: `Efecto ${o.status}`, detalle: o.eventType, fuente: 'outbox' })
  }

  for (const a of busqueda.avisos) {
    momentos.push({ cuando: a.createdAt, que: 'Aviso al cliente creado', detalle: a.titulo, fuente: 'aviso' })
  }

  // La bitácora: lo que una PERSONA decidió. Se lee por entidad, que está
  // indexada, y solo de las entidades que ya tenemos en la mano.
  const entidades = [
    ...busqueda.incidentes.map((i) => i.id),
    ...busqueda.eventos.map((e) => e.id),
    ...busqueda.efectos.map((o) => o.id),
  ]
  if (entidades.length) {
    const bitacora = await sinEmpresa('Supply 2.0: bitácora de una operación', (tx) =>
      tx.auditLog.findMany({
        where: { entidadId: { in: entidades } },
        orderBy: { createdAt: 'asc' },
        take: 60,
        select: { accion: true, createdAt: true, user: { select: { name: true, email: true } } },
      })
    )
    for (const b of bitacora) {
      momentos.push({
        cuando: b.createdAt,
        que: b.accion,
        detalle: b.user ? `por ${b.user.name ?? b.user.email}` : 'automático',
        fuente: 'bitacora',
      })
    }
  }

  const avisos: string[] = []
  if (busqueda.eventos.length > 0) {
    avisos.push(
      'La verificación de firma, el rechazo por frescura (replay) y el corte por tamaño NO dejan fila en la base —lo que no está firmado no entra— y solo constan en los logs estructurados `sv2` del servidor.'
    )
  }
  if (!busqueda.encontrado) {
    avisos.push('No se encontró ninguna operación con esa referencia.')
  }

  return { busqueda, linea: { momentos: momentos.sort((a, b) => a.cuando.getTime() - b.cuando.getTime()), avisos } }
}
