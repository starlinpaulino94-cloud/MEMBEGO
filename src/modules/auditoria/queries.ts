import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { armarCsv } from '@/lib/csv'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'

/**
 * Bitácora de actividad (AuditLog).
 *
 * TODA acción registrable de la app queda en `audit_logs` con `createdAt`
 * completo (fecha Y HORA, hasta el segundo, en UTC — se muestra en la zona
 * horaria de la empresa). Este módulo solo LEE: quien escribe es cada acción
 * en su propio flujo. Multi-tenant: `companyId` filtra siempre, salvo el
 * superadmin que puede ver todas las empresas.
 */

/**
 * A QUÉ se le hizo. Los nombres de modelo son de la base, no del negocio:
 * «Membership» no significa nada para quien lee la bitácora, y sin esto una
 * línea dice qué pasó pero no sobre qué. Lo que no esté aquí sale tal cual —
 * peor que traducido, mejor que oculto.
 */
export const ENTIDAD_LABEL: Record<string, string> = {
  CajaSesion: 'Caja',
  CampanaGlobal: 'Campaña conjunta',
  Cliente: 'Cliente',
  ColaVehiculo: 'Cola',
  Company: 'Empresa',
  EvidenciaFoto: 'Foto',
  Membership: 'Membresía',
  Plan: 'Plan',
  MovimientoCaja: 'Movimiento de caja',
  ProductoCompra: 'Compra',
  ProductoInventario: 'Inventario',
  QrToken: 'QR',
  ReceiptTemplate: 'Plantilla de recibo',
  Referido: 'Referido',
  ReferralRecompensa: 'Recompensa',
  Sucursal: 'Sucursal',
  Transaction: 'Transacción',
  User: 'Usuario',
  Visit: 'Visita',
}

/**
 * Etiquetas legibles de cada acción registrada.
 *
 * TIENE QUE ESTAR COMPLETO, y `tests/bitacora-etiquetas.test.ts` lo obliga:
 * compara este mapa contra el enum `AuditAccion` del esquema y falla si sobra o
 * falta uno. Sin esa guardia el mapa se quedaba atrás en silencio — trece de
 * los treinta y tres valores no estaban, y entre ellos los TRES que registran
 * privilegio: `ENTRAR_COMO_GENERADO`, `SUPERADMIN_OTORGADO` y
 * `SUPERADMIN_RETIRADO`. Salían en crudo, en mayúsculas con guiones bajos,
 * justo las líneas que alguien busca cuando investiga algo.
 *
 * Y no es solo cosmético: la pantalla de Auditoría construye su desplegable de
 * filtros con `Object.entries(ACCION_LABEL)`. Una acción sin etiqueta no se
 * podía FILTRAR.
 */
export const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  VISITA_REVERTIDA: 'Visita revertida',
  PAGO_APROBADO: 'Pago aprobado',
  PAGO_RECHAZADO: 'Pago rechazado',
  MEMBRESIA_CANCELADA: 'Membresía cancelada',
  MEMBRESIA_DESACTIVADA: 'Membresía desactivada',
  MEMBRESIA_RENOVADA: 'Membresía renovada',
  MEMBRESIA_ELIMINADA: 'Membresía eliminada',
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
  // Empresas de práctica.
  EMPRESA_DEMO_CAMBIADA: 'Empresa de práctica: cambió su condición',
  EMPRESA_DEMO_REINICIADA: 'Empresa de práctica reiniciada',
  // Privilegio y suplantación. Los nombres dicen QUÉ PASÓ, no qué se guardó:
  // «Entró como otro usuario» es lo que busca quien investiga; «enlace
  // generado» es un paso intermedio y por eso lleva su propia etiqueta.
  SUPERADMIN_OTORGADO: 'Superadmin otorgado',
  SUPERADMIN_RETIRADO: 'Superadmin retirado',
  ENTRAR_COMO_GENERADO: 'Enlace para entrar como otro usuario',
  ENTRAR_COMO_USADO: 'Entró como otro usuario',
  // Qué módulos tiene encendidos cada empresa: decide a qué secciones entra.
  CAPACIDADES_ACTUALIZADAS: 'Módulos de la empresa actualizados',
  // Catálogo de planes: lo que los clientes compran.
  PLAN_CREADO: 'Plan creado',
  PROMOCION_CREADA: 'Promoción creada',
  PLAN_ACTUALIZADO: 'Plan actualizado',
  PLAN_PAUSADO: 'Plan pausado',
  PLAN_REANUDADO: 'Plan reanudado',
  PLAN_ELIMINADO: 'Plan eliminado',
  // Geolocalización (docs/GEOLOCALIZACION.md).
  UBICACION_GUARDADA: 'Ubicación guardada',
  UBICACION_ELIMINADA: 'Ubicación eliminada',
  CONSENTIMIENTO_GEO_OTORGADO: 'Permiso de ubicación otorgado',
  CONSENTIMIENTO_GEO_REVOCADO: 'Permiso de ubicación revocado',
  SUCURSAL_UBICACION_GUARDADA: 'Ubicación de sucursal guardada',
  SUCURSAL_UBICACION_VERIFICADA: 'Ubicación de sucursal verificada',
  CATALOGO_GEO_APROBADO: 'Sector o ciudad aprobado',
  // Membego Connect (Fase 9): concesiones y catálogo.
  CONNECT_CONCEDIDO: 'Límite de integraciones concedido',
  CONNECT_CONECTOR_ESTADO: 'Estado de un conector cambiado',
  // Cola de trabajos (Connect · Fase 2): decisiones sobre difuntos.
  COLA_REENCOLADA: 'Trabajo de la cola reencolado',
  COLA_DESCARTADA: 'Trabajo de la cola descartado',
  // Campañas por segmento.
  SEGMENTO_EVALUADO: 'Segmento evaluado',
  CAMPANA_DIRIGIDA_ENVIADA: 'Campaña dirigida enviada',
  // Campañas conjuntas: reparto y retirada en varias empresas a la vez.
  CAMPANA_APLICADA: 'Campaña conjunta aplicada',
  CAMPANA_ARCHIVADA: 'Campaña conjunta archivada',
  // Integraciones: lo que sale hacia sistemas de terceros.
  INTEGRACION_SONDEADA: 'Webhook probado',
  INTEGRACION_REINTENTADA: 'Cola de eventos reenviada',
  INTEGRACION_REENCOLADA: 'Eventos agotados devueltos a la cola',
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

  const fn = (tx: Tx) =>
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
                { user: { nombreBusqueda: { contains: normalizarBusqueda(q) } } },
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

/**
 * Serializa la bitácora a CSV, por `armarCsv` (`lib/csv.ts`), que es la única
 * puerta: este archivo tenía su propio escapado, y un dialecto por módulo es
 * exactamente lo que hizo que cuatro exportaciones del panel se abrieran mal.
 *
 * La hora va con SEGUNDOS: en un registro de auditoría, el orden exacto de dos
 * acciones seguidas es a menudo lo único que importa.
 */
export function auditoriaToCsv(items: AuditoriaItem[], timeZone: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(d)

  return armarCsv(
    [
      'Fecha y hora',
      'Accion',
      'Detalle',
      'Usuario',
      'Correo',
      'Empresa',
      'Entidad',
      'ID entidad',
      'IP',
    ],
    items.map((i) => [
      fmt(i.fecha),
      i.accionLabel,
      i.detalle,
      i.usuario,
      i.usuarioEmail,
      i.empresa,
      i.entidadTipo,
      i.entidadId,
      i.ip,
    ])
  )
}
