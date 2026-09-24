import type { SupplyTipo } from '@prisma/client'
import { usaCapacidad } from './catalogo'

/**
 * MEMBEGO SUPPLY · CAPACITY ENGINE (Fases 17-18).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * Comprar 1.000 pizzas y dejar que aparezcan 700 personas el mismo sábado no
 * es cumplir un contrato: es hundir a un proveedor con su propio acuerdo. El
 * contrato dice 1.000 en total, 50 por día, 10 por hora, y el sistema tiene
 * que hacer valer esos tres números.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * GENÉRICO, NO "PARA PIZZAS"
 *
 * Los mismos tres límites describen un car wash (bahías por hora), una
 * barbería (sillas), una excursión (asientos del autobús) y un café. Lo único
 * específico de cada industria es qué números se pactan, y eso vive en el
 * acuerdo, no en el código.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DÍA ES EL DEL COMERCIO
 *
 * `dia` es una cadena `yyyy-mm-dd` en la zona del proveedor, no un rango UTC.
 * Con `DateTime`, una recogida a las 22:30 en Santo Domingo (UTC-4) cae en el
 * día siguiente en UTC y consume el cupo del martes estando el lunes. El cupo
 * diario de una cocina se cuenta por la jornada de esa cocina.
 *
 * PURO: recibe los conteos ya leídos y dice si cabe.
 */

export interface LimitesCapacidad {
  /** Máximo por día. Null = sin límite diario. */
  diaria?: number | null
  /** Máximo por hora. Null = sin límite horario. */
  horaria?: number | null
  /** Fechas bloqueadas, en `yyyy-mm-dd`. */
  diasBloqueados?: readonly string[]
}

export interface OcupacionActual {
  /** Reservas y entregas ya comprometidas ese día. */
  delDia: number
  /** Las de esa hora concreta. */
  deLaHora: number
}

export const MOTIVOS_CAPACIDAD = [
  'DIA_BLOQUEADO',
  'CUPO_DIARIO_LLENO',
  'CUPO_HORARIO_LLENO',
  'HORA_INVALIDA',
  'FECHA_PASADA',
  'FUERA_DE_VIGENCIA',
] as const
export type MotivoCapacidad = (typeof MOTIVOS_CAPACIDAD)[number]

export const MOTIVO_CAPACIDAD_LABELS: Record<MotivoCapacidad, string> = {
  DIA_BLOQUEADO: 'Ese día el comercio no atiende beneficios de Membego.',
  CUPO_DIARIO_LLENO: 'Ese día ya no quedan cupos.',
  CUPO_HORARIO_LLENO: 'Esa hora ya está llena. Elige otra.',
  HORA_INVALIDA: 'La hora indicada no es válida.',
  FECHA_PASADA: 'Esa fecha ya pasó.',
  FUERA_DE_VIGENCIA: 'Esa fecha está fuera de la vigencia del beneficio.',
}

export type VeredictoCapacidad =
  | { cabe: true; cupoDiarioRestante: number | null; cupoHorarioRestante: number | null }
  | { cabe: false; motivo: MotivoCapacidad; mensaje: string }

function noCabe(motivo: MotivoCapacidad): VeredictoCapacidad {
  return { cabe: false, motivo, mensaje: MOTIVO_CAPACIDAD_LABELS[motivo] }
}

export interface ConsultaCapacidad {
  dia: string
  hora?: number | null
  tipo: SupplyTipo
  limites: LimitesCapacidad
  ocupacion: OcupacionActual
  /** Vigencia del lote, para no reservar fuera de contrato. */
  vigenteDesde?: Date | null
  vigenteHasta?: Date | null
  hoy?: string
}

/** `yyyy-mm-dd` de una fecha en una zona horaria concreta. */
export function diaLocal(fecha: Date, zona = 'America/Santo_Domingo'): string {
  // `en-CA` da directamente `yyyy-mm-dd`, que es lo que se guarda y lo que
  // ordena bien como texto. Construirlo a mano con getFullYear/getMonth daría
  // la zona del SERVIDOR, que en Vercel es UTC y no la del comercio.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha)
}

/** Hora local 0-23 en una zona concreta. */
export function horaLocal(fecha: Date, zona = 'America/Santo_Domingo'): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    hour12: false,
  }).format(fecha)
  return Number(h)
}

/**
 * ¿Cabe una unidad más en ese día y esa hora?
 *
 * Cuando un límite no está pactado, no se inventa: `null` significa «el
 * contrato no lo limita», no «cero». Tratar un límite ausente como cero dejaría
 * sin reservar todos los acuerdos que solo pactaron cupo diario.
 */
export function evaluarCapacidad(c: ConsultaCapacidad): VeredictoCapacidad {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dia)) return noCabe('FECHA_PASADA')

  const hoy = c.hoy ?? diaLocal(new Date())
  if (c.dia < hoy) return noCabe('FECHA_PASADA')

  if (c.vigenteDesde && c.dia < diaLocal(c.vigenteDesde)) return noCabe('FUERA_DE_VIGENCIA')
  if (c.vigenteHasta && c.dia > diaLocal(c.vigenteHasta)) return noCabe('FUERA_DE_VIGENCIA')

  if ((c.limites.diasBloqueados ?? []).includes(c.dia)) return noCabe('DIA_BLOQUEADO')

  if (c.hora != null && (!Number.isInteger(c.hora) || c.hora < 0 || c.hora > 23)) {
    return noCabe('HORA_INVALIDA')
  }

  // El stock físico reservado no consume cupo: no se "prepara", se entrega.
  if (!usaCapacidad(c.tipo)) {
    return { cabe: true, cupoDiarioRestante: null, cupoHorarioRestante: null }
  }

  const diaria = c.limites.diaria ?? null
  const horaria = c.limites.horaria ?? null

  if (diaria != null && c.ocupacion.delDia >= diaria) return noCabe('CUPO_DIARIO_LLENO')
  if (horaria != null && c.hora != null && c.ocupacion.deLaHora >= horaria) {
    return noCabe('CUPO_HORARIO_LLENO')
  }

  return {
    cabe: true,
    cupoDiarioRestante: diaria == null ? null : diaria - c.ocupacion.delDia,
    cupoHorarioRestante:
      horaria == null || c.hora == null ? null : horaria - c.ocupacion.deLaHora,
  }
}

export interface FranjaDisponible {
  hora: number
  restante: number | null
  libre: boolean
}

/**
 * Franjas horarias de un día con su cupo restante, para pintar el selector.
 *
 * Devuelve TODAS las horas de la ventana con `libre: false` cuando están
 * llenas, en vez de esconderlas: una lista que se encoge sin explicación hace
 * que la persona crea que el sitio está roto. Ver «6:30 PM — completo» le dice
 * que elija otra.
 */
export function franjasDelDia(
  horaDesde: number,
  horaHasta: number,
  limites: LimitesCapacidad,
  ocupacionPorHora: Readonly<Record<number, number>>,
  cupoDiarioRestante: number | null
): FranjaDisponible[] {
  const franjas: FranjaDisponible[] = []
  for (let h = horaDesde; h <= horaHasta; h++) {
    const ocupada = ocupacionPorHora[h] ?? 0
    const horaria = limites.horaria ?? null
    const restanteHora = horaria == null ? null : Math.max(0, horaria - ocupada)
    const sinCupoDiario = cupoDiarioRestante != null && cupoDiarioRestante <= 0
    franjas.push({
      hora: h,
      restante: restanteHora,
      libre: !sinCupoDiario && (restanteHora == null || restanteHora > 0),
    })
  }
  return franjas
}

/** Ventana de atención por defecto cuando el acuerdo no la pacta. */
export const VENTANA_POR_DEFECTO = { desde: 9, hasta: 21 } as const

/**
 * Interpreta un `horarioTexto` del acuerdo ("11:00-22:00") como ventana.
 *
 * Texto libre porque así se firma en los contratos, pero el selector necesita
 * números. Si no se entiende, se usa la ventana por defecto en vez de fallar:
 * un formato raro en un campo de texto no puede dejar a un cliente sin poder
 * reservar.
 */
export function ventanaDeTexto(texto: string | null | undefined): { desde: number; hasta: number } {
  const m = /(\d{1,2})\s*:?\d{0,2}\s*[-–a]\s*(\d{1,2})/.exec(texto ?? '')
  if (!m) return { ...VENTANA_POR_DEFECTO }
  const desde = Number(m[1])
  const hasta = Number(m[2])
  if (!Number.isInteger(desde) || !Number.isInteger(hasta)) return { ...VENTANA_POR_DEFECTO }
  if (desde < 0 || desde > 23 || hasta < 0 || hasta > 23 || hasta <= desde) {
    return { ...VENTANA_POR_DEFECTO }
  }
  return { desde, hasta }
}
