import { conEmpresa } from '@/lib/tenant'
import { POLITICAS_REEMBOLSO_DEFAULT, type PoliticaReembolso } from './reservas/nucleo'

/**
 * EXCURSIONES · Configuración por empresa.
 *
 * Se guarda como JSON en la tabla `excursionesConfig`. Lo no definido usa
 * estos defaults, así que una empresa recién activada ya tiene el sistema
 * listo. Fail-open: si la query falla, devuelve defaults.
 */

export interface ExcursionesConfigResuelta {
  /** Cómo se atribuye la venta al vendedor (PRIMERA, ULTIMA, MANUAL). */
  politicaAtribucion: string
  /** Días de ventana para atribuir una venta a un vendedor. */
  ventanaAtribucionDias: number
  /** Moneda por defecto para precios y reportes. */
  monedaDefecto: string
  /** Regla de aprobación de reservas (MANUAL, AUTOMATICA). */
  reglaAprobacion: string
  /** Política de reembolso/cancelación. */
  politica: PoliticaReembolso
  /** Notas libres sobre políticas de la empresa. */
  notasPoliticas: string | null

  // Check-in
  /** Días de gracia después del vencimiento para permitir check-in. */
  diasGraciaCheckin: number
  /** Si se permite check-in sin pago previo. */
  permitirCheckinSinPago: boolean
  /** Prefijo para códigos de check-in. */
  prefijoCheckin: string

  // Reserva
  /** Horas mínimas de anticipación para una reserva. */
  anticipacionMinimaReservaHoras: number
  /** Días máximos de anticipación para una reserva. */
  anticipacionMaximaReservaDias: number
  /** Número máximo de pasajeros por reserva. */
  maxPasajerosPorReserva: number

  // Notificaciones
  /** Si se envía confirmación al crear una reserva. */
  enviarConfirmacionReserva: boolean
  /** Horas antes del viaje para enviar recordatorio. */
  enviarRecordatorioHoras: number
  /** Email destino para notificaciones del sistema. */
  emailNotificaciones: string | null

  // Pago
  /** Métodos de pago habilitados para excursiones. */
  metodosPagoHabilitados: string[]
  /** Tasas de conversión de moneda (ej: {DOP_USD: 0.018, USD_DOP: 55.5}). */
  tasasCambio: Record<string, number>
}

const DEFAULTS: ExcursionesConfigResuelta = {
  politicaAtribucion: 'PRIMERA',
  ventanaAtribucionDias: 30,
  monedaDefecto: 'DOP',
  reglaAprobacion: 'MANUAL',
  politica: POLITICAS_REEMBOLSO_DEFAULT,
  notasPoliticas: null,
  diasGraciaCheckin: 1,
  permitirCheckinSinPago: false,
  prefijoCheckin: 'EXC:',
  anticipacionMinimaReservaHoras: 24,
  anticipacionMaximaReservaDias: 90,
  maxPasajerosPorReserva: 50,
  enviarConfirmacionReserva: true,
  enviarRecordatorioHoras: 24,
  emailNotificaciones: null,
  metodosPagoHabilitados: ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'DEPOSITO', 'LINK'],
  tasasCambio: {},
}

export function resolver(raw: Record<string, unknown> | null): ExcursionesConfigResuelta {
  if (!raw) return DEFAULTS
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : d
  }
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)

  return {
    politicaAtribucion: str(raw.politicaAtribucion, DEFAULTS.politicaAtribucion),
    ventanaAtribucionDias: int(raw.ventanaAtribucionDias, 30, 1, 365),
    monedaDefecto: str(raw.monedaDefecto, 'DOP'),
    reglaAprobacion: str(raw.reglaAprobacion, 'MANUAL'),
    politica: {
      permitirReduccionPasajeros: bool(raw.permitirReduccionPasajeros, true),
      permitirCancelacion: bool(raw.permitirCancelacion, true),
      anticipacionMinimaHoras: int(raw.anticipacionMinimaHoras, 24, 0, 720),
      anticipacionCancelacionHoras: int(raw.anticipacionCancelacionHoras, 48, 0, 720),
      penalizacionCancelacionPct: int(raw.penalizacionCancelacionPct, 0, 0, 100),
      permitirReembolsoTotal: bool(raw.permitirReembolsoTotal, true),
      permitirReembolsoParcial: bool(raw.permitirReembolsoParcial, true),
      tipoReembolso: str(raw.tipoReembolso, 'COMPLETO') as PoliticaReembolso['tipoReembolso'],
      horasLimiteReembolso: int(raw.horasLimiteReembolso, 24, 0, 720),
    },
    notasPoliticas: raw.notasPoliticas != null ? String(raw.notasPoliticas) : null,
    diasGraciaCheckin: int(raw.diasGraciaCheckin, 1, 0, 30),
    permitirCheckinSinPago: bool(raw.permitirCheckinSinPago, false),
    prefijoCheckin: str(raw.prefijoCheckin, 'EXC:'),
    anticipacionMinimaReservaHoras: int(raw.anticipacionMinimaReservaHoras, 24, 0, 720),
    anticipacionMaximaReservaDias: int(raw.anticipacionMaximaReservaDias, 90, 1, 365),
    maxPasajerosPorReserva: int(raw.maxPasajerosPorReserva, 50, 1, 1000),
    enviarConfirmacionReserva: bool(raw.enviarConfirmacionReserva, true),
    enviarRecordatorioHoras: int(raw.enviarRecordatorioHoras, 24, 0, 168),
    emailNotificaciones: raw.emailNotificaciones != null ? String(raw.emailNotificaciones) : null,
    metodosPagoHabilitados: Array.isArray(raw.metodosPagoHabilitados)
      ? (raw.metodosPagoHabilitados as unknown[]).filter((m): m is string => typeof m === 'string' && Boolean(m.trim())).map(m => m.trim())
      : DEFAULTS.metodosPagoHabilitados,
    tasasCambio: (typeof raw.tasasCambio === 'object' && raw.tasasCambio !== null
      ? raw.tasasCambio as Record<string, number>
      : {}),
  }
}

/** Convierte un monto de una moneda a otra usando tasas de cambio. */
export function convertirMoneda(
  monto: number,
  de: string,
  a: string,
  tasas: Record<string, number>
): number {
  if (de === a) return monto
  const key = `${de}_${a}`
  if (tasas[key]) return monto * tasas[key]
  const reverse = `${a}_${de}`
  if (tasas[reverse]) return monto / tasas[reverse]
  return monto // sin tasa disponible, asumir 1:1
}

/** Configuración efectiva de la empresa (defaults si no hay fila/JSON). */
export async function getExcursionesConfig(companyId: string): Promise<ExcursionesConfigResuelta> {
  if (!companyId) return DEFAULTS
  try {
    const cfg = await conEmpresa(companyId, (tx) =>
      (tx as any).excursionesConfig.findUnique({ where: { companyId } })
    )
    return resolver(cfg as Record<string, unknown> | null)
  } catch (e) {
    console.error('[excursiones] getExcursionesConfig', e)
    return DEFAULTS
  }
}
