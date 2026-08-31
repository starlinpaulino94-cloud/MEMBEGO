import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { TIPOS_TRABAJO, type CargaTrabajo } from '@/modules/jobs/tipos'

/**
 * DEAD LETTER de la cola de trabajos (Membego Connect · Fase 2).
 *
 * Cuando QStash agota sus reintentos, el failure callback deja el mensaje
 * difunto en `trabajos_muertos` con su carga íntegra. Misma doctrina que el
 * DEAD_LETTER del outbox de satélites: un fallo se reintenta solo; un difunto
 * necesita que alguien decida — por eso reencolar y descartar son acciones del
 * panel, no automatismos.
 *
 * Todo con `sinEmpresa` y motivo: los difuntos llegan de un callback sin
 * contexto de inquilino y el panel que los administra es del superadmin.
 */

export type ResultadoRegistrarMuerto =
  | { ok: true; id: string }
  | { ok: true; duplicado: true }
  | { ok: false; motivo: 'carga_invalida' }

/**
 * Registra un difunto. Idempotente por `mensajeId`: QStash también reintenta
 * el callback, y la segunda entrega debe chocar con el unique, no duplicar.
 */
export async function registrarTrabajoMuerto(input: {
  mensajeId: string | null
  carga: unknown
  error?: string | null
  intentos?: number
}): Promise<ResultadoRegistrarMuerto> {
  const carga = input.carga as CargaTrabajo | null
  if (!carga || typeof carga !== 'object' || !TIPOS_TRABAJO.includes(carga.tipo)) {
    return { ok: false, motivo: 'carga_invalida' }
  }

  try {
    const fila = await sinEmpresa('jobs: registrar trabajo difunto (callback sin tenant)', (tx) =>
      tx.trabajoMuerto.create({
        data: {
          mensajeId: input.mensajeId,
          tipo: carga.tipo,
          companyId: 'companyId' in carga ? (carga.companyId ?? null) : null,
          carga: carga as object,
          error: input.error?.slice(0, 500) ?? null,
          intentos: input.intentos ?? 0,
        },
        select: { id: true },
      })
    )
    return { ok: true, id: fila.id }
  } catch (e) {
    // P2002 = el mensajeId ya está: entrega repetida del callback. Correcto.
    if ((e as { code?: string }).code === 'P2002') return { ok: true, duplicado: true }
    throw e
  }
}

export interface DifuntoPanel {
  id: string
  tipo: string
  /** Nombre de la empresa, resuelto — un cuid pelado no le dice nada a nadie. */
  empresa: string | null
  error: string | null
  intentos: number
  createdAt: Date
}

/** Los difuntos pendientes de decisión, para el panel del superadmin. */
export async function trabajosMuertosPendientes(limite = 50): Promise<DifuntoPanel[]> {
  return sinEmpresa('jobs: listar trabajos difuntos (panel superadmin)', async (tx) => {
    const filas = await tx.trabajoMuerto.findMany({
      where: { estado: 'PENDIENTE' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limite, 200),
      select: { id: true, tipo: true, companyId: true, error: true, intentos: true, createdAt: true },
    })
    const ids = [...new Set(filas.map((f) => f.companyId).filter((v): v is string => !!v))]
    const empresas = ids.length
      ? await tx.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : []
    const nombreDe = new Map(empresas.map((e) => [e.id, e.name]))
    return filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      empresa: f.companyId ? (nombreDe.get(f.companyId) ?? null) : null,
      error: f.error,
      intentos: f.intentos,
      createdAt: f.createdAt,
    }))
  })
}

export type ResultadoReencolar =
  | { ok: true; via: 'cola' | 'en-linea' }
  | { ok: false; motivo: 'no_existe' | 'ya_resuelto' }

/**
 * Vuelve a encolar un difunto. La transición PENDIENTE → REENCOLADO se hace
 * ANTES de publicar y con updateMany condicionado: dos clics simultáneos sobre
 * el mismo botón hacen que el segundo no encuentre nada que mover — el mismo
 * flip atómico que el despacho de eventos. Si la publicación fallara, el
 * trabajo corre en línea (`encolar` degrada), así que no se pierde.
 */
export async function reencolarTrabajoMuerto(id: string): Promise<ResultadoReencolar> {
  const fila = await sinEmpresa('jobs: leer trabajo difunto para reencolar', (tx) =>
    tx.trabajoMuerto.findUnique({ where: { id }, select: { carga: true, estado: true } })
  )
  if (!fila) return { ok: false, motivo: 'no_existe' }
  if (fila.estado !== 'PENDIENTE') return { ok: false, motivo: 'ya_resuelto' }

  const flip = await sinEmpresa('jobs: flip atómico del difunto a REENCOLADO', (tx) =>
    tx.trabajoMuerto.updateMany({
      where: { id, estado: 'PENDIENTE' },
      data: { estado: 'REENCOLADO', resueltoAt: new Date() },
    })
  )
  if (flip.count === 0) return { ok: false, motivo: 'ya_resuelto' }

  const { encolar } = await import('@/modules/jobs/cola')
  const via = await encolar(fila.carga as unknown as CargaTrabajo)
  return { ok: true, via }
}

/** Descarta un difunto: se decidió que ese trabajo ya no debe ejecutarse. */
export async function descartarTrabajoMuerto(id: string): Promise<{ ok: boolean }> {
  const flip = await sinEmpresa('jobs: descartar trabajo difunto', (tx) =>
    tx.trabajoMuerto.updateMany({
      where: { id, estado: 'PENDIENTE' },
      data: { estado: 'DESCARTADO', resueltoAt: new Date() },
    })
  )
  return { ok: flip.count > 0 }
}

/**
 * Rastro de las decisiones sobre difuntos. Reencolar re-ejecuta un trabajo con
 * efectos reales y descartar renuncia a él para siempre: ninguna de las dos
 * puede quedar sin nombre y sin fecha. FAIL-OPEN, como la auditoría del panel
 * de integraciones: estas acciones se usan cuando algo ya está roto, y
 * quedarse sin poder reencolar por no poder anotarlo sería una avería nueva.
 */
export async function auditarCola(
  accion: 'COLA_REENCOLADA' | 'COLA_DESCARTADA',
  trabajoId: string,
  userId: string | null,
  payload: Record<string, string | number | boolean>
): Promise<void> {
  const meta = await getRequestMeta()
  await sinEmpresa('jobs: registrar la decisión del superadmin sobre un difunto', (tx) =>
    tx.auditLog.create({
      data: {
        companyId: null,
        userId,
        accion,
        entidadTipo: 'TrabajoMuerto',
        entidadId: trabajoId,
        payload,
        ...meta,
      },
    })
  ).catch(anotarFallo('jobs:auditLog.create', { accion, trabajoId }))
}

export interface SaludCola {
  /** Trabajos difuntos esperando decisión. */
  trabajosMuertos: number
  /** Eventos hacia satélites aún en cola de reintento. */
  webhooksPendientes: number
  /** Eventos hacia satélites que agotaron reintentos. */
  webhooksMuertos: number
  /** Eventos del bus sin despachar desde hace más de 6 horas. */
  eventosEstancados: number
}

/**
 * La salud de TODO el procesamiento asíncrono en cuatro números. Es la vista
 * que faltaba: cada pieza guardaba su estado, pero ninguna pantalla los sumaba
 * — y una cola enferma se descubría consultando la base a mano.
 */
export async function saludDeLaCola(): Promise<SaludCola> {
  const corte = new Date(Date.now() - 6 * 60 * 60 * 1000)
  return sinEmpresa('jobs: salud agregada de la cola (panel superadmin)', async (tx) => {
    const [trabajosMuertos, webhooksPendientes, webhooksMuertos, eventosEstancados] =
      await Promise.all([
        tx.trabajoMuerto.count({ where: { estado: 'PENDIENTE' } }),
        tx.eventoSaliente.count({ where: { estado: 'PENDIENTE' } }),
        tx.eventoSaliente.count({ where: { estado: 'DEAD_LETTER' } }),
        tx.domainEvent.count({ where: { processed: false, occurredAt: { lt: corte } } }),
      ])
    return { trabajosMuertos, webhooksPendientes, webhooksMuertos, eventosEstancados }
  })
}
