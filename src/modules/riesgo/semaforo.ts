/**
 * SEMÁFORO DEL CLIENTE — una sola definición de «cómo va esta relación».
 *
 * El panel tenía media docena de formas de decir lo mismo, ninguna comparable
 * con las otras: «clientes activos» contaba membresías, «clientes en riesgo»
 * cruzaba visitas, el segmento `inactivos` usaba otro umbral y las
 * automatizaciones un tercero. Cada pantalla respondía a su manera a la única
 * pregunta que de verdad importa: **¿este cliente sigue con nosotros?**
 *
 * Aquí se responde una vez. La tabla, la ficha, el reporte de riesgo y las
 * automatizaciones consumen esta función; ninguna vuelve a decidirlo.
 *
 * PURO: sin Prisma, sin fechas del sistema (el `ahora` se pasa). Se prueba al
 * milímetro, que es lo que corresponde a algo que va a decidir a quién se llama.
 */

export const ESTADOS_CLIENTE = [
  'ACTIVO',
  'EN_RIESGO',
  'DORMIDO',
  'PERDIDO',
  'SIN_MEMBRESIA',
] as const
export type EstadoCliente = (typeof ESTADOS_CLIENTE)[number]

export const ESTADO_CLIENTE_LABEL: Record<EstadoCliente, string> = {
  ACTIVO: 'Activo',
  EN_RIESGO: 'En riesgo',
  DORMIDO: 'Dormido',
  PERDIDO: 'Perdido',
  SIN_MEMBRESIA: 'Sin membresía',
}

/** Tono visual. No se guardan clases aquí: el color lo elige quien pinta. */
export const ESTADO_CLIENTE_TONO: Record<EstadoCliente, 'success' | 'warning' | 'danger' | 'muted'> =
  {
    ACTIVO: 'success',
    EN_RIESGO: 'warning',
    DORMIDO: 'warning',
    PERDIDO: 'danger',
    SIN_MEMBRESIA: 'muted',
  }

/**
 * Umbrales, en días. Configurables por empresa porque un car wash y un
 * restaurante no tienen la misma frecuencia normal de visita: treinta días sin
 * lavar el carro es raro; treinta días sin cenar fuera, no.
 */
export interface UmbralesRetencion {
  /** Con membresía vigente y sin venir más de esto → EN_RIESGO. */
  riesgoDias: number
  /** Sin venir más de esto → DORMIDO, aunque la membresía siga vigente. */
  dormidoDias: number
  /** Vencida hace más de esto y sin renovar → PERDIDO. */
  perdidoDias: number
  /** Vence dentro de esto (con usos sin consumir) → EN_RIESGO. */
  venceDias: number
}

export const UMBRALES_POR_DEFECTO: UmbralesRetencion = {
  riesgoDias: 30,
  dormidoDias: 60,
  perdidoDias: 60,
  venceDias: 7,
}

/** Rango admitido de cada umbral. Fuera de aquí, se ignora y vale el defecto. */
const LIMITES = { min: 1, max: 365 }

/**
 * Normaliza los umbrales guardados (JSON tolerante a null/basura).
 *
 * Además corrige un orden imposible: si alguien pone «dormido» antes que
 * «riesgo», el estado DORMIDO se comería al EN_RIESGO y este último no
 * existiría nunca. En vez de fallar, se separan — un formulario mal rellenado
 * no debería apagar un estado entero sin que nadie se entere.
 */
export function resolverUmbrales(raw: unknown): UmbralesRetencion {
  const cfg = (raw ?? {}) as Record<string, unknown>
  const leer = (clave: keyof UmbralesRetencion): number => {
    const v = Number(cfg[clave])
    return Number.isFinite(v) && v >= LIMITES.min && v <= LIMITES.max
      ? Math.trunc(v)
      : UMBRALES_POR_DEFECTO[clave]
  }
  const riesgoDias = leer('riesgoDias')
  const dormidoDias = Math.max(leer('dormidoDias'), riesgoDias + 1)
  return {
    riesgoDias,
    dormidoDias,
    perdidoDias: leer('perdidoDias'),
    venceDias: leer('venceDias'),
  }
}

/** Lo que el semáforo necesita saber de un cliente (datos planos). */
export interface DatosCliente {
  /** ¿Tiene hoy una membresía activa y sin vencer? */
  tieneVigente: boolean
  /** Vencimiento de esa membresía vigente (null = perpetua o sin membresía). */
  fechaVencimiento: Date | null
  /** Usos sin consumir de la membresía vigente. */
  usosRestantes: number
  esIlimitado: boolean
  /** Última visita al negocio. null = nunca vino. */
  ultimaVisita: Date | null
  /** Cuándo venció la última membresía que tuvo. null = nunca tuvo o sigue vigente. */
  ultimoVencimiento: Date | null
  /** ¿Llegó a comprar alguna vez? Distingue «se fue» de «nunca entró». */
  tuvoMembresia: boolean
}

export interface Semaforo {
  estado: EstadoCliente
  /** Por qué está en ese estado, en una frase que se puede enseñar tal cual. */
  motivo: string
  /** Días desde la última visita. null = nunca vino. */
  diasSinVenir: number | null
}

const dias = (desde: Date, hasta: Date) =>
  Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000)

/**
 * Clasifica a un cliente.
 *
 * EL ORDEN DE LAS REGLAS ES LA REGLA. Se evalúa de lo más definitivo a lo más
 * recuperable: quien ya se fue no puede estar «en riesgo» de irse, y quien
 * nunca compró no está dormido — no ha llegado a despertarse.
 */
export function clasificarCliente(
  datos: DatosCliente,
  umbrales: UmbralesRetencion = UMBRALES_POR_DEFECTO,
  ahora: Date = new Date()
): Semaforo {
  const diasSinVenir = datos.ultimaVisita ? dias(datos.ultimaVisita, ahora) : null

  // 1 · Nunca compró. No es una relación deteriorada: es una que no empezó.
  if (!datos.tuvoMembresia) {
    return {
      estado: 'SIN_MEMBRESIA',
      motivo: 'Se registró pero nunca compró una membresía.',
      diasSinVenir,
    }
  }

  // 2 · Sin membresía vigente: se fue. Cuánto hace decide si aún se recupera.
  if (!datos.tieneVigente) {
    const desdeVencimiento = datos.ultimoVencimiento
      ? dias(datos.ultimoVencimiento, ahora)
      : null
    if (desdeVencimiento != null && desdeVencimiento > umbrales.perdidoDias) {
      return {
        estado: 'PERDIDO',
        motivo: `Su membresía venció hace ${desdeVencimiento} días y no ha renovado.`,
        diasSinVenir,
      }
    }
    return {
      estado: 'DORMIDO',
      motivo:
        desdeVencimiento != null
          ? `Su membresía venció hace ${desdeVencimiento} días. Todavía está a tiempo de volver.`
          : 'No tiene ninguna membresía vigente.',
      diasSinVenir,
    }
  }

  // 3 · Vigente pero lleva demasiado sin aparecer.
  if (diasSinVenir == null) {
    // Pagó y NUNCA ha venido. Es el peor caso y el más fácil de perder de
    // vista: no aparece en ningún informe de visitas porque no tiene ninguna.
    return {
      estado: 'EN_RIESGO',
      motivo: 'Pagó su membresía y todavía no ha venido ni una vez.',
      diasSinVenir,
    }
  }
  if (diasSinVenir > umbrales.dormidoDias) {
    return {
      estado: 'DORMIDO',
      motivo: `Su membresía sigue vigente, pero lleva ${diasSinVenir} días sin venir.`,
      diasSinVenir,
    }
  }
  if (diasSinVenir > umbrales.riesgoDias) {
    return {
      estado: 'EN_RIESGO',
      motivo: `Lleva ${diasSinVenir} días sin venir.`,
      diasSinVenir,
    }
  }

  // 4 · Viene con normalidad, pero se le acaba el tiempo con cosas dentro.
  if (datos.fechaVencimiento) {
    const paraVencer = Math.ceil(
      (datos.fechaVencimiento.getTime() - ahora.getTime()) / 86_400_000
    )
    const conSaldo = datos.esIlimitado || datos.usosRestantes > 0
    if (paraVencer <= umbrales.venceDias && conSaldo) {
      return {
        estado: 'EN_RIESGO',
        motivo: datos.esIlimitado
          ? `Su membresía vence en ${paraVencer} días.`
          : `Su membresía vence en ${paraVencer} días y le quedan ${datos.usosRestantes} usos sin consumir.`,
        diasSinVenir,
      }
    }
  }

  return {
    estado: 'ACTIVO',
    motivo: `Vino hace ${diasSinVenir} días y su membresía está vigente.`,
    diasSinVenir,
  }
}
