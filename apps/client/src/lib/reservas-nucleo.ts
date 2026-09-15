/**
 * RESERVAS — Lógica pura (port desde src/modules/excursiones/reservas/nucleo.ts).
 *
 * Funciones y tipos necesarios para la app RN. Sin dependencias de Prisma ni servidor.
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_RESERVA = [
  'PENDIENTE',
  'CONFIRMADA',
  'PARCIALMENTE_PAGADA',
  'PAGADA',
  'COMPLETADA',
  'CANCELADA',
  'NO_SHOW',
] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

export const ESTADO_RESERVA_LABEL: Record<EstadoReserva, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  PARCIALMENTE_PAGADA: 'Abonada',
  PAGADA: 'Pagada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  NO_SHOW: 'No se presentó',
};

export const TONO_RESERVA: Record<
  EstadoReserva,
  'success' | 'warning' | 'neutral' | 'info' | 'danger'
> = {
  PENDIENTE: 'warning',
  CONFIRMADA: 'info',
  PARCIALMENTE_PAGADA: 'warning',
  PAGADA: 'success',
  COMPLETADA: 'success',
  CANCELADA: 'neutral',
  NO_SHOW: 'danger',
};

export const ESTADOS_CERRADOS: EstadoReserva[] = [
  'COMPLETADA',
  'CANCELADA',
  'NO_SHOW',
];

// ── Dinero ───────────────────────────────────────────────────────────────────

export function centavos(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

// ── Tiempo ───────────────────────────────────────────────────────────────────

export function minutosDesdeMedianoche(hora: string): number {
  if (!hora || !hora.includes(':')) return 0;
  const [h, m] = hora.trim().slice(0, 5).split(':').map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

export function formatoMinutosAHora(minutos: number): string {
  const norm = ((minutos % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Modificación ─────────────────────────────────────────────────────────────

export interface PoliticaReembolso {
  permitirReduccionPasajeros: boolean;
  permitirCancelacion: boolean;
  anticipacionMinimaHoras: number;
  anticipacionCancelacionHoras: number;
  penalizacionCancelacionPct: number;
  permitirReembolsoTotal: boolean;
  permitirReembolsoParcial: boolean;
  tipoReembolso: 'COMPLETO' | 'PARCIAL' | 'CREDITO' | 'NINGUNO';
  horasLimiteReembolso: number;
}

export interface ResultadoModificacion {
  permitido: boolean;
  razon: string | null;
  nuevoTotal: number;
  montoReembolso: number;
  montoCobrar: number;
}

export function esModificable(
  fechaExcursion: Date,
  horaExcursion: string | null,
  ahora: Date,
  anticipacionMinHoras: number
): { modificable: boolean; horasRestantes: number } {
  const fechaBase = new Date(fechaExcursion);
  if (horaExcursion) {
    const [hh, mm] = horaExcursion.split(':').map(Number);
    fechaBase.setUTCHours(hh, mm, 0, 0);
  } else {
    fechaBase.setUTCHours(8, 0, 0, 0);
  }
  const horasRestantes = (fechaBase.getTime() - ahora.getTime()) / (1000 * 60 * 60);
  return {
    modificable: horasRestantes >= anticipacionMinHoras,
    horasRestantes: Math.round(horasRestantes * 10) / 10,
  };
}

export function calcularModificacion(params: {
  adultosOriginales: number;
  ninosOriginales: number;
  adultosNuevos: number;
  ninosNuevos: number;
  precioAdulto: number;
  precioNino: number | null;
  impuestoPct: number | null;
  descuentoActual: number;
  pagado: number;
  politica: PoliticaReembolso;
  horasRestantes: number;
}): ResultadoModificacion {
  const { adultosOriginales, ninosOriginales, adultosNuevos, ninosNuevos } = params;
  const totalNuevos = adultosNuevos + ninosNuevos;
  const totalOriginales = adultosOriginales + ninosOriginales;

  if (totalNuevos > totalOriginales) {
    return {
      permitido: false,
      razon: 'No se pueden agregar pasajeros. Crea una nueva reserva para pasajeros adicionales.',
      nuevoTotal: 0,
      montoReembolso: 0,
      montoCobrar: 0,
    };
  }

  if (totalNuevos === 0) {
    if (!params.politica.permitirCancelacion) {
      return {
        permitido: false,
        razon: 'Este negocio no permite cancelaciones.',
        nuevoTotal: 0,
        montoReembolso: 0,
        montoCobrar: 0,
      };
    }
    if (params.horasRestantes < params.politica.anticipacionCancelacionHoras) {
      return {
        permitido: false,
        razon: `Las cancelaciones requieren al menos ${params.politica.anticipacionCancelacionHoras} horas de anticipación.`,
        nuevoTotal: 0,
        montoReembolso: 0,
        montoCobrar: 0,
      };
    }
  } else {
    if (!params.politica.permitirReduccionPasajeros) {
      return {
        permitido: false,
        razon: 'Este negocio no permite reducir pasajeros.',
        nuevoTotal: 0,
        montoReembolso: 0,
        montoCobrar: 0,
      };
    }
    if (params.horasRestantes < params.politica.anticipacionMinimaHoras) {
      return {
        permitido: false,
        razon: `Las modificaciones requieren al menos ${params.politica.anticipacionMinimaHoras} horas de anticipación.`,
        nuevoTotal: 0,
        montoReembolso: 0,
        montoCobrar: 0,
      };
    }
  }

  const pNino = params.precioNino ?? params.precioAdulto;
  const nuevoSubtotal = centavos(adultosNuevos * params.precioAdulto + ninosNuevos * pNino);
  const base = centavos(Math.max(0, nuevoSubtotal - params.descuentoActual));
  const pct = params.impuestoPct ?? 0;
  const nuevosImpuestos = pct > 0 ? centavos(base * (pct / 100)) : 0;
  const nuevoTotal = centavos(base + nuevosImpuestos);

  const diferencia = centavos(params.pagado - nuevoTotal);
  const montoReembolso = diferencia > 0 ? diferencia : 0;
  const montoCobrar = diferencia < 0 ? Math.abs(diferencia) : 0;

  let reembolsoFinal = montoReembolso;
  if (reembolsoFinal > 0 && params.politica.penalizacionCancelacionPct > 0 && totalNuevos === 0) {
    reembolsoFinal = centavos(reembolsoFinal * (1 - params.politica.penalizacionCancelacionPct / 100));
  }

  if (reembolsoFinal > 0) {
    if (params.politica.tipoReembolso === 'NINGUNO') {
      return { permitido: true, razon: null, nuevoTotal, montoReembolso: 0, montoCobrar };
    }
    if (params.politica.tipoReembolso === 'CREDITO') {
      return {
        permitido: true,
        razon: 'El reembolso se otorga como crédito para futuras reservas.',
        nuevoTotal,
        montoReembolso: reembolsoFinal,
        montoCobrar,
      };
    }
    if (params.politica.tipoReembolso === 'PARCIAL' && !params.politica.permitirReembolsoParcial) {
      return { permitido: true, razon: null, nuevoTotal, montoReembolso: 0, montoCobrar };
    }
  }

  return { permitido: true, razon: null, nuevoTotal, montoReembolso: reembolsoFinal, montoCobrar };
}
