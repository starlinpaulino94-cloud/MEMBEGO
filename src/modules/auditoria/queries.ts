import { conEmpresa, sinEmpresa } from '@/lib/tenant'

/**
 * Bitácora de actividad (AuditLog).
 *
 * TODA acción registrable de la app queda en `audit_logs` con `createdAt`
 * completo (fecha Y HORA, hasta el segundo, en UTC — se muestra en la zona
 * horaria de la empresa). Este módulo solo LEE: quien escribe es cada acción
 * en su propio flujo. Multi-tenant: `companyId` filtra siempre, salvo el
 * superadmin que puede ver todas las empresas.
 */

/** Etiquetas legibles de cada acción registrada. */
export const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  PAGO_APROBADO: 'Pago aprobado',
  PAGO_RECHAZADO: 'Pago rechazado',
  MEMBRESIA_CANCELADA: 'Membresía cancelada',
  MEMBRESIA_RENOVADA: 'Membresía renovada',
  QR_GENERADO: 'QR generado',
  QR_USADO: 'QR usado',
  QR_COMPARTIDO: 'QR compartido',
  CAJA_ABIERTA: 'Caja abierta',
  CAJA_CERRADA: 'Caja cerrada',
  CAJA_MOVIMIENTO: 'Movimiento de caja',
  COBRO_REGISTRADO: 'Cobro registrado',
  COMPROBANTE_IMPRESO: 'Comprobante impreso',
  TRANSACCION_ANULADA: 'Transacción anulada',
  REFERIDO_COMPLETADO: 'Referido completado',
  RECOMPENSA_OTORGADA: 'Recompensa otorgada',
  NOTA_INTERNA: 'Nota interna',
  PLANTILLA_RECIBO_ACTUALIZADA: 'Plantilla de recibo actualizada',
  CUENTA_ELIMINADA: 'Cuenta eliminada',
}

/**
 * Sub-tipos guardados en `payload.tipo` para las acciones que reutilizan
 * NOTA_INTERNA como contenedor genérico. Permite leer la bitácora sin
 * adivinar qué pasó.
 */
export const SUBTIPO_LABEL: Record<string, string> = {
  CAPACIDADES_ACTUALIZADAS: 'Capacidades del negocio actualizadas',
  COLA_REGISTRO: 'Vehículo agregado a la cola',
  COLA_TRANSICION: 'Vehículo avanzó de estado',
  INVENTARIO_MOVIMIENTO: 'Movimiento de inventario',
  EVIDENCIA_SUBIDA: 'Foto de evidencia subida',
  AJUSTE_LAVADOS: 'Ajuste de lavados de membresía',
  RECORDATORIO_SEGUIMIENTO: 'Recordatorio de recompensa enviado',
}

export interface AuditoriaFiltro {
  accion?: string
  empresa?: string
  q?: string
  desde?: string
  hasta?: string
}

export interface AuditoriaItem {
  id: string
  /** Momento EXACTO de la acción (fecha y hora, hasta el segundo). */
  fecha: Date
  accion: string
  accionLabel: string
  /** Sub-tipo legible cuando el payload lo trae (NOTA_INTERNA genérica). */
  detalle: string | null
  entidadTipo: string
  entidadId: string
  usuario: string | null
  usuarioEmail: string | null
  empresa: string | null
  ip: string | null
  payload: Record<string, unknown>
}

/** Convierte 'YYYY-MM-DD' a Date; `fin` toma el final del día. */
function limiteDia(fecha: string, fin: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  return new Date(`${fecha}T${fin ? '23:59:59.999' : '00:00:00.000'}Z`)
}

/** Resumen corto de lo que pasó, leído del payload de cada acción. */
function describir(payload: Record<string, unknown>): string | null {
  const tipo = typeof payload.tipo === 'string' ? payload.tipo : null
  const base = tipo ? (SUBTIPO_LABEL[tipo] ?? tipo) : null

  const partes: string[] = []
  if (base) partes.push(base)
  if (typeof payload.motivo === 'string' && payload.motivo) {
    partes.push(payload.motivo)
  }
  if (payload.antes != null && payload.despues != null) {
    partes.push(`${String(payload.antes)} → ${String(payload.despues)}`)
  }
  if (typeof payload.de === 'string' && typeof payload.a === 'string') {
    partes.push(`${payload.de} → ${payload.a}`)
  }
  if (typeof payload.placa === 'string' && payload.placa) {
    partes.push(`placa ${payload.placa}`)
  }
  if (typeof payload.cliente === 'string' && payload.cliente) {
    partes.push(payload.cliente)
  }
  if (typeof payload.nota === 'string' && payload.nota) {
    partes.push(payload.nota)
  }
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * Lee la bitácora. `companyId` null = vista global (solo superadmin).
 * Devuelve como máximo `take` entradas, de la más reciente a la más antigua.
 */
export async function getAuditoria(
  companyId: string | null,
  filtro: AuditoriaFiltro = {},
  take = 200
): Promise<AuditoriaItem[]> {
  const desde = filtro.desde ? limiteDia(filtro.desde, false) : null
  const hasta = filtro.hasta ? limiteDia(filtro.hasta, true) : null
  const q = filtro.q?.trim()

  const fn = (tx: Parameters<typeof conEmpresa>[1]) =>
    tx.auditLog.findMany({
      where: {
        ...(companyId ? { companyId } : filtro.empresa ? { companyId: filtro.empresa } : {}),
        ...(filtro.accion ? { accion: filtro.accion as never } : {}),
        ...(desde || hasta
          ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
          : {}),
        ...(q
          ? {
              OR: [
                { entidadId: { contains: q, mode: 'insensitive' } },
                { entidadTipo: { contains: q, mode: 'insensitive' } },
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        createdAt: true,
        accion: true,
        entidadTipo: true,
        entidadId: true,
        ipAddress: true,
        payload: true,
        user: { select: { name: true, email: true } },
        company: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    })

  const logs = companyId
    ? await conEmpresa(companyId, fn)
    : await sinEmpresa('auditoría: bitácora global (superadmin sin empresa)', fn)

  return logs.map((l) => {
    const payload = (l.payload ?? {}) as Record<string, unknown>
    return {
      id: l.id,
      fecha: l.createdAt,
      accion: l.accion,
      accionLabel: ACCION_LABEL[l.accion] ?? l.accion,
      detalle: describir(payload),
      entidadTipo: l.entidadTipo,
      entidadId: l.entidadId,
      usuario: l.user?.name ?? null,
      usuarioEmail: l.user?.email ?? null,
      empresa: l.company?.name ?? null,
      ip: l.ipAddress,
      payload,
    }
  })
}

/** Serializa la bitácora a CSV (con BOM para que Excel respete los acentos). */
export function auditoriaToCsv(items: AuditoriaItem[], timeZone: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(d)

  const esc = (v: string | null) => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const encabezados = [
    'Fecha y hora',
    'Accion',
    'Detalle',
    'Usuario',
    'Correo',
    'Empresa',
    'Entidad',
    'ID entidad',
    'IP',
  ]
  const lineas = items.map((i) =>
    [
      fmt(i.fecha),
      i.accionLabel,
      i.detalle,
      i.usuario,
      i.usuarioEmail,
      i.empresa,
      i.entidadTipo,
      i.entidadId,
      i.ip,
    ]
      .map(esc)
      .join(';')
  )
  return `﻿${[encabezados.join(';'), ...lineas].join('\n')}`
}
