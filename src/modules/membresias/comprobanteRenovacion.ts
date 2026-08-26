import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { METODO_COBRO_LABEL, type MetodoCobroMembresia } from './cobro'

/**
 * COMPROBANTE DE RENOVACIÓN — se reconstruye desde el REGISTRO, no desde el
 * formulario.
 *
 * El comprobante es un papel que se le entrega al cliente y que después se usa
 * para reclamar. Si se armara con lo que la pantalla tenía en memoria, podría
 * decir algo distinto de lo que quedó guardado —un precio que cambió entre el
 * render y el clic, por ejemplo— y el papel ganaría la discusión.
 *
 * Leyéndolo del asiento de auditoría, el papel y el registro no pueden
 * discrepar: son el mismo dato.
 */
export interface ComprobanteRenovacion {
  id: string
  fecha: Date
  cliente: string
  plan: string
  monto: number
  metodo: string
  referencia: string | null
  desde: Date | null
  hasta: Date | null
  encadenada: boolean
  lavadosPlan: number | null
  lavadosRegaloConservados: number
  atendidoPor: string | null
}

export async function comprobanteRenovacion(
  companyId: string,
  registroId: string
): Promise<ComprobanteRenovacion | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.auditLog.findFirst({
      where: { id: registroId, companyId, accion: 'MEMBRESIA_RENOVADA' },
      select: {
        id: true,
        createdAt: true,
        payload: true,
        user: { select: { name: true, email: true } },
      },
    })
  )
  if (!fila) return null

  const p = (fila.payload ?? {}) as Record<string, unknown>
  const texto = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const fecha = (v: unknown): Date | null => {
    const s = texto(v)
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const metodoCrudo = (texto(p.metodo) ?? '') as MetodoCobroMembresia

  return {
    id: fila.id,
    fecha: fila.createdAt,
    cliente: texto(p.cliente) ?? 'Cliente',
    plan: texto(p.plan) ?? 'Plan',
    monto: Number(p.monto ?? 0),
    // Las renovaciones anteriores a este cambio no guardaron el método. Se dice
    // «no registrado» en vez de inventar uno: un comprobante que afirma un
    // método que nadie declaró es peor que uno que reconoce el hueco.
    metodo: METODO_COBRO_LABEL[metodoCrudo] ?? 'No registrado',
    referencia: texto(p.referencia),
    desde: fecha(p.desde),
    hasta: fecha(p.hasta),
    encadenada: p.encadenada === true,
    lavadosPlan: typeof p.lavadosPlan === 'number' ? p.lavadosPlan : null,
    lavadosRegaloConservados:
      typeof p.lavadosRegaloConservados === 'number' ? p.lavadosRegaloConservados : 0,
    atendidoPor: fila.user?.name ?? fila.user?.email ?? null,
  }
}
