import 'server-only'
import { anotarFallo } from '@/lib/prisma-errors'
import { sinEmpresa } from '@/lib/tenant'
import {
  CLAVE_INTERRUPTOR_IDENTIDAD,
  ErrorDeIdentidad,
  atenderIncidenciaDeIdentidad,
  cambiarReglaDeIdentidad,
  compuertaDeIdentidad,
  consultarIdentidadComoStaff,
  exigirGestionDeIdentidad,
  leerReglasDeIdentidad,
  resolverRevisionDeIdentidad,
  type ActorDeIdentidad,
  type CompuertaDeIdentidad,
  type IdentidadParaStaff,
  type ResultadoAtenderIncidencia,
  type ResultadoResolverRevision,
} from '@/modules/identidad/identidad'
import { OPERACIONES_SIN_REGLA, operacionConRegla, type AlcanceDeRegla, type OperacionDeIdentidad } from '@/modules/identidad/reglasCore'
import { avisarRepeticionDeIdentidad, avisarRespuestaDeIncidencia, avisarResultadoDeIdentidad } from '@/modules/identidad/avisos'
import { purgarSesionDeIntento } from '@/modules/identidad/sincronizacion'

/**
 * LO QUE VE Y HACE EL EQUIPO DE MEMBEGO con la verificación de identidad (Fase 4).
 *
 * TODO empieza con `exigirGestionDeIdentidad(actor)`: solo `SUPERADMIN` (no existe un rol de «soporte de plataforma»; los
 * demás roles son de empresa). Una EMPRESA no llama a nada de aquí ni puede descargar documentos de nadie: lo único que
 * ve de una persona es la insignia «verificada» de su ficha, y solo si la persona lo permitió.
 *
 * Qué NO sale nunca de esta capa: imágenes, la referencia de la sesión del proveedor, el hash del documento, el número de
 * documento. Para ver la evidencia de un caso, el equipo la busca en la consola del proveedor por la referencia propia del
 * intento (`vendor_data` = su id): MEMBEGO no la tiene.
 *
 * Cada consulta de un caso deja asiento con su motivo (de una lista cerrada) y cada acción deja el suyo, con el actor.
 */

// ── Motivos de consulta (lista cerrada) ─────────────────────────────────────

export const MOTIVOS_DE_CONSULTA = [
  { valor: 'revision_de_caso', etiqueta: 'Revisar un caso' },
  { valor: 'incidencia', etiqueta: 'Atender una incidencia' },
  { valor: 'soporte', etiqueta: 'Soporte a la persona' },
  { valor: 'auditoria', etiqueta: 'Auditoría' },
] as const
export type MotivoDeConsulta = (typeof MOTIVOS_DE_CONSULTA)[number]['valor']

export function esMotivoDeConsulta(valor: unknown): valor is MotivoDeConsulta {
  return MOTIVOS_DE_CONSULTA.some((m) => m.valor === valor)
}

// ── Resumen de la plataforma ────────────────────────────────────────────────

export interface ResumenDeLaPlataforma {
  compuerta: CompuertaDeIdentidad
  interruptor: { encendido: boolean; motivo: string | null; cambiadoAt: Date | null; cambiadoPor: string | null }
  /** `null` = «sin dato»: la consulta falló. Nunca un cero inventado. */
  intentos24h: { total: number; porEstado: Record<string, number> } | null
  verificadasVigentes: number | null
  vencenEn30Dias: number | null
  enRevision: { total: number; porDocumentoRepetido: number; masAntiguoAt: Date | null } | null
  incidenciasAbiertas: { total: number; masAntiguaAt: Date | null } | null
  /** Intentos cerrados cuya sesión sigue en el proveedor: los documentos no se han borrado allí. */
  purgasPendientes: number | null
  avisosFallidos: number | null
  /** Solicitudes de borrado sin completar: el plazo legal es de 10 días hábiles. */
  supresionesSinCompletar: { total: number; masAntiguaAt: Date | null; vencidas: number } | null
}

/** Pasada ese número de días sin completarse, una supresión se marca como en riesgo (el plazo legal son 10 días hábiles). */
export const DIAS_DE_ALERTA_DE_SUPRESION = 7

async function medir<T>(contexto: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f()
  } catch (e) {
    anotarFallo('identidad:resumen', { contexto })(e)
    return null
  }
}

export async function resumenDeLaPlataforma(actor: ActorDeIdentidad, ahora: Date = new Date()): Promise<ResumenDeLaPlataforma> {
  exigirGestionDeIdentidad(actor)
  const desde24h = new Date(ahora.getTime() - 24 * 3_600_000)
  const en30Dias = new Date(ahora.getTime() + 30 * 86_400_000)
  const DB = (motivo: string) => `identidad: ${motivo}`

  const fila = await medir('interruptor', () =>
    sinEmpresa(DB('el equipo lee el interruptor'), (tx) =>
      tx.identidadInterruptor.findUnique({ where: { clave: CLAVE_INTERRUPTOR_IDENTIDAD }, include: { changedBy: { select: { name: true } } } })
    )
  )
  const compuerta = await compuertaDeIdentidad()

  const [intentos24h, verificadasVigentes, vencenEn30Dias, enRevision, incidenciasAbiertas, purgasPendientes, avisosFallidos, supresiones] = await Promise.all([
    medir('intentos24h', () =>
      sinEmpresa(DB('el equipo cuenta los intentos del día'), async (tx) => {
        const grupos = await tx.identidadIntento.groupBy({ by: ['estado'], where: { creadoAt: { gte: desde24h } }, _count: { _all: true } })
        const porEstado = Object.fromEntries(grupos.map((g) => [g.estado, g._count._all]))
        return { total: grupos.reduce((n, g) => n + g._count._all, 0), porEstado }
      })
    ),
    medir('verificadas', () => sinEmpresa(DB('el equipo cuenta las verificaciones vigentes'), (tx) => tx.identidadVerificacion.count({ where: { estado: 'verificada', expiraEn: { gt: ahora } } }))),
    medir('vencen', () => sinEmpresa(DB('el equipo cuenta las que vencen pronto'), (tx) => tx.identidadVerificacion.count({ where: { estado: 'verificada', expiraEn: { gt: ahora, lte: en30Dias } } }))),
    medir('revision', () =>
      sinEmpresa(DB('el equipo cuenta los casos en revisión'), async (tx) => {
        const [total, repetidos, viejo] = await Promise.all([
          tx.identidadIntento.count({ where: { estado: 'en_revision' } }),
          tx.identidadIntento.count({ where: { estado: 'en_revision', codigoRazon: 'IDENTIDAD_DUPLICADA' } }),
          tx.identidadIntento.findFirst({ where: { estado: 'en_revision' }, orderBy: { creadoAt: 'asc' }, select: { creadoAt: true } }),
        ])
        return { total, porDocumentoRepetido: repetidos, masAntiguoAt: viejo?.creadoAt ?? null }
      })
    ),
    medir('incidencias', () =>
      sinEmpresa(DB('el equipo cuenta las incidencias abiertas'), async (tx) => {
        const where = { estado: { in: ['abierta', 'en_proceso'] } }
        const [total, viejo] = await Promise.all([
          tx.identidadIncidencia.count({ where }),
          tx.identidadIncidencia.findFirst({ where, orderBy: { creadaAt: 'asc' }, select: { creadaAt: true } }),
        ])
        return { total, masAntiguaAt: viejo?.creadaAt ?? null }
      })
    ),
    medir('purgas', () =>
      sinEmpresa(DB('el equipo cuenta los borrados pendientes en el proveedor'), (tx) =>
        tx.identidadIntento.count({
          where: {
            estado: { in: ['aprobada', 'rechazada_reintentable', 'rechazada_definitiva', 'expirada', 'abandonada', 'cancelada'] },
            referenciaProveedorSellada: { not: null },
            purgadoAt: null,
          },
        })
      )
    ),
    medir('avisos', () => sinEmpresa(DB('el equipo cuenta los avisos del proveedor sin procesar'), (tx) => tx.identidadEventoExterno.count({ where: { estado: 'fallido' } }))),
    medir('supresiones', () =>
      sinEmpresa(DB('el equipo busca borrados sin completar'), async (tx) => {
        const desde = new Date(ahora.getTime() - 90 * 86_400_000)
        const pedidas = await tx.auditLog.findMany({
          where: { accion: 'IDENTIDAD_SUPRESION_SOLICITADA', createdAt: { gte: desde } },
          select: { entidadId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 1000,
        })
        if (pedidas.length === 0) return { total: 0, masAntiguaAt: null, vencidas: 0 }
        const hechas = await tx.auditLog.findMany({
          where: { accion: 'IDENTIDAD_SUPRESION_COMPLETADA', entidadId: { in: [...new Set(pedidas.map((p) => p.entidadId))] }, createdAt: { gte: desde } },
          select: { entidadId: true, createdAt: true },
        })
        // Una persona está pendiente si su última solicitud es posterior a su última finalización.
        const ultimaPedida = new Map<string, Date>()
        for (const p of pedidas) ultimaPedida.set(p.entidadId, p.createdAt)
        const ultimaHecha = new Map<string, Date>()
        for (const h of hechas) if (!ultimaHecha.has(h.entidadId) || h.createdAt > ultimaHecha.get(h.entidadId)!) ultimaHecha.set(h.entidadId, h.createdAt)
        const pendientes = [...ultimaPedida].filter(([id, t]) => !ultimaHecha.has(id) || ultimaHecha.get(id)! < t).map(([, t]) => t)
        const limite = new Date(ahora.getTime() - DIAS_DE_ALERTA_DE_SUPRESION * 86_400_000)
        return {
          total: pendientes.length,
          masAntiguaAt: pendientes.length ? new Date(Math.min(...pendientes.map((t) => t.getTime()))) : null,
          vencidas: pendientes.filter((t) => t < limite).length,
        }
      })
    ),
  ])

  return {
    compuerta,
    interruptor: {
      encendido: fila?.enabled === true,
      motivo: fila?.reason ?? null,
      cambiadoAt: fila?.changedAt ?? null,
      cambiadoPor: fila?.changedBy?.name ?? null,
    },
    intentos24h,
    verificadasVigentes,
    vencenEn30Dias,
    enRevision,
    incidenciasAbiertas,
    purgasPendientes,
    avisosFallidos,
    supresionesSinCompletar: supresiones,
  }
}

// ── Colas ───────────────────────────────────────────────────────────────────

/** Lo máximo que muestra una cola: las más antiguas primero. Si hay más, se dice cuántas hay en total. */
export const LIMITE_DE_COLA = 100

export interface CasoEnRevision {
  intentoId: string
  userId: string
  nombre: string
  email: string
  /** El código crudo (el equipo sí lo ve; la persona no): `IDENTIDAD_DUPLICADA`, `FLUJO_INCOMPLETO`, un motivo del proveedor… */
  codigoRazon: string | null
  canal: string
  creadoAt: Date
}

export async function colaDeRevision(actor: ActorDeIdentidad): Promise<{ casos: CasoEnRevision[]; total: number }> {
  exigirGestionDeIdentidad(actor)
  return sinEmpresa('identidad: el equipo lee la cola de casos en revisión', async (tx) => {
    const [filas, total] = await Promise.all([
      tx.identidadIntento.findMany({
        where: { estado: 'en_revision' },
        orderBy: { creadoAt: 'asc' },
        take: LIMITE_DE_COLA,
        select: { id: true, userId: true, codigoRazon: true, canal: true, creadoAt: true, user: { select: { name: true, email: true } } },
      }),
      tx.identidadIntento.count({ where: { estado: 'en_revision' } }),
    ])
    return {
      total,
      casos: filas.map((f) => ({ intentoId: f.id, userId: f.userId, nombre: f.user.name, email: f.user.email, codigoRazon: f.codigoRazon, canal: f.canal, creadoAt: f.creadoAt })),
    }
  })
}

export interface IncidenciaEnCola {
  id: string
  userId: string
  nombre: string
  email: string
  intentoId: string | null
  tipo: string
  /** Lo que escribió la persona: el equipo lo lee para ayudarla, y NUNCA se copia a una bitácora ni a un correo. */
  mensaje: string
  estado: string
  creadaAt: Date
  respuesta: string | null
  resueltaAt: Date | null
  atendidaPor: string | null
}

export async function colaDeIncidencias(actor: ActorDeIdentidad, vista: 'abiertas' | 'resueltas'): Promise<{ incidencias: IncidenciaEnCola[]; total: number }> {
  exigirGestionDeIdentidad(actor)
  const where = vista === 'abiertas' ? { estado: { in: ['abierta', 'en_proceso'] } } : { estado: 'resuelta' }
  return sinEmpresa('identidad: el equipo lee la cola de incidencias', async (tx) => {
    const [filas, total] = await Promise.all([
      tx.identidadIncidencia.findMany({
        where,
        orderBy: vista === 'abiertas' ? { creadaAt: 'asc' } : { resueltaAt: 'desc' },
        take: LIMITE_DE_COLA,
        include: { user: { select: { name: true, email: true } }, atendidaPor: { select: { name: true } } },
      }),
      tx.identidadIncidencia.count({ where }),
    ])
    return {
      total,
      incidencias: filas.map((f) => ({
        id: f.id,
        userId: f.userId,
        nombre: f.user.name,
        email: f.user.email,
        intentoId: f.intentoId,
        tipo: f.tipo,
        mensaje: f.mensaje,
        estado: f.estado,
        creadaAt: f.creadaAt,
        respuesta: f.respuesta,
        resueltaAt: f.resueltaAt,
        atendidaPor: f.atendidaPor?.name ?? null,
      })),
    }
  })
}

// ── Buscar y ver un caso ────────────────────────────────────────────────────

export interface PersonaEncontrada {
  userId: string
  nombre: string
  email: string
  estado: string | null
  ultimoIntento: { estado: string; creadoAt: Date } | null
}

/** Busca personas por correo (parcial), nombre (parcial) o id exacto. Mínimo 3 caracteres: no es un volcado de usuarios. */
export async function buscarPersonas(actor: ActorDeIdentidad, texto: string): Promise<PersonaEncontrada[]> {
  exigirGestionDeIdentidad(actor)
  const q = texto.trim()
  if (q.length < 3) return []
  return sinEmpresa('identidad: el equipo busca a una persona', async (tx) => {
    const usuarios = await tx.user.findMany({
      where: { OR: [{ id: q }, { email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, identidadVerificacion: { select: { estado: true } }, identidadIntentos: { orderBy: { creadoAt: 'desc' }, take: 1, select: { estado: true, creadoAt: true } } },
    })
    return usuarios.map((u) => ({
      userId: u.id,
      nombre: u.name,
      email: u.email,
      estado: u.identidadVerificacion?.estado ?? null,
      ultimoIntento: u.identidadIntentos[0] ?? null,
    }))
  })
}

export interface CasoDeIdentidad extends IdentidadParaStaff {
  persona: { userId: string; nombre: string; email: string }
  /** El resultado global SIN la referencia del proveedor ni el hash del documento. */
  verificacion: { estado: string; nivel: string | null; via: string | null; proveedor: string | null; verificadaEn: Date | null; expiraEn: Date | null; revocadaEn: Date | null; motivoRevocacion: string | null } | null
  consentimientos: { tipo: string; version: string; canal: string; otorgadoAt: Date; revocadoAt: Date | null }[]
  incidencias: IncidenciaEnCola[]
}

/**
 * Abre un caso: el estado, los intentos, el resultado, la prueba de los consentimientos y las incidencias de la persona.
 * LA CONSULTA DEJA ASIENTO (quién, a quién, con qué motivo y desde qué IP) antes de devolver nada: es el acceso a un dato
 * sensible y se audita, como pide OWASP. El motivo es de una lista cerrada.
 */
export async function verCasoDeIdentidad(
  actor: ActorDeIdentidad,
  userId: string,
  motivo: string,
  contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<CasoDeIdentidad> {
  exigirGestionDeIdentidad(actor)
  if (!esMotivoDeConsulta(motivo)) throw new ErrorDeIdentidad('motivo_requerido', 'Elige el motivo de la consulta.')
  const base = await consultarIdentidadComoStaff(actor, userId, motivo, contexto)
  const extra = await sinEmpresa('identidad: el equipo completa el caso de una persona', async (tx) => {
    const [user, verificacion, consentimientos, incidencias] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } }),
      tx.identidadVerificacion.findUnique({
        where: { userId },
        select: { estado: true, nivel: true, viaVerificacion: true, proveedor: true, verificadaEn: true, expiraEn: true, revocadaEn: true, motivoRevocacion: true },
      }),
      tx.identidadConsentimiento.findMany({ where: { userId }, orderBy: { otorgadoAt: 'desc' }, take: 20, select: { tipo: true, textoVersion: true, canal: true, otorgadoAt: true, revocadoAt: true } }),
      tx.identidadIncidencia.findMany({
        where: { userId },
        orderBy: { creadaAt: 'desc' },
        take: 20,
        include: { atendidaPor: { select: { name: true } } },
      }),
    ])
    return { user, verificacion, consentimientos, incidencias }
  })
  return {
    ...base,
    persona: { userId, nombre: extra.user.name, email: extra.user.email },
    verificacion: extra.verificacion
      ? {
          estado: extra.verificacion.estado,
          nivel: extra.verificacion.nivel,
          via: extra.verificacion.viaVerificacion,
          proveedor: extra.verificacion.proveedor,
          verificadaEn: extra.verificacion.verificadaEn,
          expiraEn: extra.verificacion.expiraEn,
          revocadaEn: extra.verificacion.revocadaEn,
          motivoRevocacion: extra.verificacion.motivoRevocacion,
        }
      : null,
    consentimientos: extra.consentimientos.map((c) => ({ tipo: c.tipo, version: c.textoVersion, canal: c.canal, otorgadoAt: c.otorgadoAt, revocadoAt: c.revocadoAt })),
    incidencias: extra.incidencias.map((f) => ({
      id: f.id,
      userId,
      nombre: extra.user.name,
      email: extra.user.email,
      intentoId: f.intentoId,
      tipo: f.tipo,
      mensaje: f.mensaje,
      estado: f.estado,
      creadaAt: f.creadaAt,
      respuesta: f.respuesta,
      resueltaAt: f.resueltaAt,
      atendidaPor: f.atendidaPor?.name ?? null,
    })),
  }
}

// ── Acciones que tocan al proveedor o a la persona ──────────────────────────

/**
 * Resuelve un caso en revisión (rechazarlo o pedir que se repita) y, ya guardado, hace lo que sigue: borra la sesión en el
 * proveedor (la evidencia ya no hace falta) y le avisa a la persona. Ambos pasos son «fail-open»: si fallan quedan para el
 * barrido (el borrado) o se anotan (el aviso); la decisión del equipo no se pierde.
 */
export async function resolverRevisionComoStaff(
  actor: ActorDeIdentidad,
  intentoId: string,
  decision: 'rechazar' | 'pedir_repeticion',
  motivo: string
): Promise<ResultadoResolverRevision> {
  const r = await resolverRevisionDeIdentidad(actor, intentoId, decision, motivo)
  if (!r.ok) return r
  await purgarSesionDeIntento(intentoId).catch(anotarFallo('identidad:purga-tras-revision', { intento: intentoId }))
  if (r.resultado === 'rechazada') await avisarResultadoDeIdentidad(intentoId)
  else await avisarRepeticionDeIdentidad(intentoId)
  return r
}

/** Toma o resuelve una incidencia; al resolverla, la respuesta le llega a la persona en su campana. */
export async function atenderIncidenciaComoStaff(
  actor: ActorDeIdentidad,
  incidenciaId: string,
  accion: 'tomar' | 'resolver',
  respuesta?: string
): Promise<ResultadoAtenderIncidencia> {
  const r = await atenderIncidenciaDeIdentidad(actor, incidenciaId, accion, respuesta)
  if (r.ok && accion === 'resolver' && r.cambio && r.respuesta) await avisarRespuestaDeIncidencia(r.userId, incidenciaId, r.respuesta)
  return r
}

// ── Reglas por función (Fase 5) ─────────────────────────────────────────────

export interface ReglaParaElEquipo {
  operacion: OperacionDeIdentidad
  titulo: string
  descripcion: string
  seVerificaA: string
  alcances: readonly { valor: AlcanceDeRegla; etiqueta: string; explicacion: string }[]
  activa: boolean
  alcance: AlcanceDeRegla
  motivo: string | null
  cambiadoAt: Date | null
  cambiadoPor: string | null
  /** Con la verificación apagada la regla no frena nada aunque esté encendida. */
  suspendidaPorLaCompuerta: boolean
}

export interface ProveedoresYRepresentantes {
  activos: number
  sinRepresentante: number
  representanteSinVerificar: number
  representanteVerificado: number
}

export interface ReglasParaElEquipo {
  compuerta: CompuertaDeIdentidad
  reglas: ReglaParaElEquipo[]
  /** `null` = «sin dato». Informativo: cuántos proveedores activos se frenarían hoy en su próximo pago si la regla pidiera a todos. */
  proveedores: ProveedoresYRepresentantes | null
  /** Lo que nunca pide identidad, para que la pantalla lo diga con todas las letras. */
  nuncaPide: readonly string[]
}

/** Lo que el panel enseña de las reglas: cada operación con su estado, y el efecto probable en los proveedores de hoy. */
export async function reglasDeLaPlataforma(actor: ActorDeIdentidad): Promise<ReglasParaElEquipo> {
  exigirGestionDeIdentidad(actor)
  const [compuerta, reglas, proveedores] = await Promise.all([
    compuertaDeIdentidad(),
    leerReglasDeIdentidad(),
    medir('proveedores', () =>
      sinEmpresa('identidad: el equipo cuenta los proveedores y la verificación de su representante', async (tx) => {
        const filas = await tx.supplyV2Supplier.findMany({ where: { status: 'ACTIVE' }, select: { termsAcceptedById: true } })
        const ids = [...new Set(filas.flatMap((f) => (f.termsAcceptedById ? [f.termsAcceptedById] : [])))]
        const verificados = ids.length
          ? await tx.identidadVerificacion.findMany({
              where: { userId: { in: ids }, estado: 'verificada', nivel: { in: ['documento_selfie', 'jce_oficial'] }, expiraEn: { gt: new Date() } },
              select: { userId: true },
            })
          : []
        const ok = new Set(verificados.map((v) => v.userId))
        const conRep = filas.filter((f) => f.termsAcceptedById)
        return {
          activos: filas.length,
          sinRepresentante: filas.length - conRep.length,
          representanteVerificado: conRep.filter((f) => ok.has(f.termsAcceptedById!)).length,
          representanteSinVerificar: conRep.filter((f) => !ok.has(f.termsAcceptedById!)).length,
        }
      })
    ),
  ])
  return {
    compuerta,
    reglas: reglas.map((r) => {
      const o = operacionConRegla(r.operacion)
      return {
        operacion: r.operacion,
        titulo: o.titulo,
        descripcion: o.descripcion,
        seVerificaA: o.seVerificaA,
        alcances: o.alcances,
        activa: r.activa,
        alcance: r.alcance,
        motivo: r.motivo,
        cambiadoAt: r.cambiadoAt,
        cambiadoPor: r.cambiadoPor,
        suspendidaPorLaCompuerta: r.activa && !compuerta.habilitada,
      }
    }),
    proveedores,
    nuncaPide: OPERACIONES_SIN_REGLA.map((o) => o.titulo),
  }
}

/** Cambia una regla (con motivo) en nombre del equipo. */
export async function cambiarReglaComoStaff(
  actor: ActorDeIdentidad,
  entrada: { operacion: string; activa: boolean; alcance: string; motivo: string }
): Promise<void> {
  exigirGestionDeIdentidad(actor)
  await cambiarReglaDeIdentidad(actor, entrada)
}
