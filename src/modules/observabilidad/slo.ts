/**
 * SLO Y PRESUPUESTO DE ERROR (auditoría de producción · A-09, Fase 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * Sin un SLO, "la app va lenta" es una discusión de opiniones y "hubo unos
 * errores" es una frase que no obliga a nada. Un SLO convierte las dos cosas en
 * un número que se puede mirar y que se agota.
 *
 * Y sobre todo: el presupuesto de error es lo que hace posible decir que **no**.
 * Cuando el presupuesto del mes está gastado, la respuesta a "subamos esta
 * funcionalidad el viernes" deja de depender de quién insista más.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO 99,99%
 *
 * El instinto es pedir cuatro nueves. Cada nueve cuesta un orden de magnitud
 * más y aquí no lo pagaría nadie:
 *
 *   99,0%  →  7 h 12 min de caída al mes
 *   99,5%  →  3 h 36 min          ← el elegido
 *   99,9%  →      43 min
 *   99,99% →       4 min          ← imposible con una persona y un proveedor
 *
 * 99,99% mensual significa que un incidente de cinco minutos ya rompe el
 * objetivo del mes. Con un equipo de una persona, sin guardia y con toda la
 * infraestructura en un solo proveedor (docs/RECUPERACION.md § 6), prometer eso
 * sería un número decorativo. Un SLO que se incumple todos los meses no informa
 * de nada: se ignora igual que una alerta que salta siempre.
 *
 * 99,5% es exigente pero alcanzable, y deja margen para el mantenimiento
 * planificado que necesitan las restauraciones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTADO: los objetivos de abajo son una PROPUESTA. Nadie los ha aceptado
 * todavía y no hay un mes completo de datos para saber si se cumplen. Hasta que
 * lo haya, son la hipótesis de trabajo, no una promesa a nadie.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface Slo {
  id: string
  /** Qué se promete, en lenguaje de negocio. */
  nombre: string
  /** Fracción entre 0 y 1. 0.995 = 99,5%. */
  objetivo: number
  /** Días de la ventana. 30 = mensual. */
  ventanaDias: number
  /** Qué cuenta como "bueno". Sin esto, un SLO no se puede medir. */
  sli: string
  /** Por qué ese número y no otro. */
  razon: string
}

export const SLOS: Slo[] = [
  {
    id: 'disponibilidad',
    nombre: 'La aplicación responde',
    objetivo: 0.995,
    ventanaDias: 30,
    sli: 'Proporción de comprobaciones de /api/health que devuelven `ok`.',
    razon:
      '3 h 36 min de caída al mes. Con una persona y sin guardia nocturna, ' +
      'un objetivo más alto sería una promesa que la estructura no puede sostener.',
  },
  {
    id: 'escaneo',
    nombre: 'El escaneo del QR es rápido',
    objetivo: 0.95,
    ventanaDias: 30,
    sli: 'Proporción de canjes servidos en menos de 1,5 s.',
    razon:
      'Es el único momento en que un cliente está esperando de pie, con el ' +
      'coche detenido y alguien detrás. Por encima de ~1,5 s el empleado ' +
      'vuelve a pulsar, y un doble canje es peor que una espera.',
  },
  {
    id: 'canje',
    nombre: 'Un canje válido no falla',
    objetivo: 0.995,
    ventanaDias: 30,
    sli: 'Proporción de canjes de QR vigentes que terminan en visita registrada.',
    razon:
      'Un canje que falla se resuelve regalando el lavado: es dinero perdido ' +
      'y, peor, un cliente que deja de confiar en su propio QR.',
  },
  {
    id: 'trabajos',
    nombre: 'Los trabajos en segundo plano se ejecutan',
    objetivo: 0.99,
    ventanaDias: 30,
    sli: 'Proporción de trabajos encolados que terminan sin fallo definitivo.',
    razon:
      'QStash reintenta, así que un fallo puntual se recupera solo. Lo que ' +
      'este SLO vigila es que la cadena de lotes no se corte a la mitad y ' +
      'media base de clientes se quede sin la notificación.',
  },
]

export function sloPorId(id: string): Slo | undefined {
  return SLOS.find((s) => s.id === id)
}

/** Minutos de fallo permitidos en la ventana. Este es el presupuesto. */
export function minutosPresupuesto(slo: Slo): number {
  return slo.ventanaDias * 24 * 60 * (1 - slo.objetivo)
}

export interface ConsumoPresupuesto {
  /** Fracción del presupuesto gastada. 1 = agotado; >1 = SLO incumplido. */
  consumido: number
  /** Fracción que queda. Nunca baja de 0. */
  restante: number
  /** Cuántas veces más rápido se está gastando de lo sostenible. */
  tasaQuema: number
  estado: EstadoPresupuesto
}

export type EstadoPresupuesto = 'sano' | 'atencion' | 'critico' | 'agotado'

/**
 * Cuánto presupuesto se ha gastado con `bueno` de `total` eventos correctos.
 *
 * La cuenta que importa: lo que se gasta no es el porcentaje de fallo, sino el
 * porcentaje de fallo DIVIDIDO entre el que el SLO permite. Con un objetivo del
 * 99,5%, un 0,25% de errores no es "casi nada": es la mitad del mes gastada.
 *
 * `total = 0` devuelve un consumo de 0. No es lo mismo que "todo va bien" —es
 * "no hay datos"— pero cualquier otro valor sería inventarse una conclusión.
 * Quien lo muestre debe distinguir los dos casos; ver `hayDatos`.
 */
export function consumoPresupuesto(slo: Slo, bueno: number, total: number): ConsumoPresupuesto {
  if (total <= 0) {
    return { consumido: 0, restante: 1, tasaQuema: 0, estado: 'sano' }
  }

  // COMA FLOTANTE, dos veces.
  //
  // Primera: `(total - bueno) / total` y no `1 - bueno / total`. Son lo mismo
  // en álgebra y no en binario.
  //
  // Segunda: `1 - 0.995` no es 0,005, es 0,0050000000000000044. Con eso, un
  // 0,25% exacto de fallos da un consumo de 0,4999999999999996 y cae del lado
  // equivocado del umbral de "atención"; y agotar el presupuesto justo da
  // 0,9999999999999991, que no llega a "agotado". Los dos casos los encontró
  // una prueba, no un razonamiento.
  //
  // Se redondea a seis decimales antes de clasificar. La igualdad exacta en un
  // borde no significa nada aquí —nadie tiene 9.975 aciertos de 10.000 al
  // milímetro— pero el estado que se muestra sí tiene que ser predecible.
  const tasaFallo = Math.max(0, (total - bueno) / total)
  const permitido = 1 - slo.objetivo
  const crudo = permitido === 0 ? (tasaFallo > 0 ? Infinity : 0) : tasaFallo / permitido
  const consumido = Number.isFinite(crudo) ? Math.round(crudo * 1e6) / 1e6 : crudo

  return {
    consumido,
    restante: Math.max(0, 1 - consumido),
    // La tasa de quema es el mismo número visto de otra forma: cuántas veces
    // más rápido se gasta de lo que la ventana permite. Se conserva aparte
    // porque es lo que usan los umbrales de alerta.
    tasaQuema: consumido,
    estado: estadoDeConsumo(consumido),
  }
}

/** ¿Hay suficientes eventos para que el número signifique algo? */
export function hayDatos(total: number): boolean {
  // Por debajo de 20 eventos, un solo fallo mueve el porcentaje entre 0% y 5%.
  // Mostrar "SLO incumplido" porque falló uno de tres es ruido, no información.
  return total >= 20
}

export function estadoDeConsumo(consumido: number): EstadoPresupuesto {
  if (consumido >= 1) return 'agotado'
  if (consumido >= 0.75) return 'critico'
  if (consumido >= 0.5) return 'atencion'
  return 'sano'
}

/**
 * VENTANAS DE ALERTA POR TASA DE QUEMA.
 *
 * El error clásico al montar alertas sobre un SLO es alertar cuando el
 * presupuesto llega a cierto porcentaje. Eso avisa TARDE —cuando ya se gastó—
 * y encima avisa por un incidente de hace tres semanas que ya se resolvió.
 *
 * Lo que se alerta es la VELOCIDAD a la que se gasta, medida en dos ventanas a
 * la vez: una larga que confirma que el problema es real, y una corta que
 * confirma que SIGUE pasando ahora. Sin la ventana corta, la alerta se queda
 * disparada durante horas después de que todo volvió a la normalidad, y la
 * gente aprende a silenciarla.
 *
 * Los multiplicadores vienen de la práctica estándar de SRE (SRE Workbook,
 * cap. 5): 14,4× durante 1 h gasta un 2% del presupuesto mensual, que ya
 * merece una llamada; 6× durante 6 h gasta un 5%, que merece mirarlo mañana.
 */
export interface VentanaAlerta {
  /** Cuántas veces por encima del gasto sostenible. */
  factor: number
  ventanaHoras: number
  /** Ventana corta que confirma que el problema sigue ocurriendo. */
  ventanaCortaHoras: number
  severidad: 'llamada' | 'revisar'
  /** Qué porcentaje del presupuesto mensual se gasta si se mantiene. */
  gastoPresupuesto: string
}

export const VENTANAS_ALERTA: VentanaAlerta[] = [
  {
    factor: 14.4,
    ventanaHoras: 1,
    ventanaCortaHoras: 5 / 60,
    severidad: 'llamada',
    gastoPresupuesto: '2% en 1 h',
  },
  {
    factor: 6,
    ventanaHoras: 6,
    ventanaCortaHoras: 0.5,
    severidad: 'llamada',
    gastoPresupuesto: '5% en 6 h',
  },
  {
    factor: 3,
    ventanaHoras: 24,
    ventanaCortaHoras: 2,
    severidad: 'revisar',
    gastoPresupuesto: '10% en 1 día',
  },
  {
    factor: 1,
    ventanaHoras: 72,
    ventanaCortaHoras: 6,
    severidad: 'revisar',
    gastoPresupuesto: '10% en 3 días',
  },
]

/**
 * Tasa de error a partir de la cual hay que alertar, para un SLO y un factor.
 *
 * Con el SLO de disponibilidad (99,5%) y factor 14,4, salta al 7,2% de fallos
 * sostenido durante una hora. Ese número es el que se copia al monitor.
 */
export function umbralDeAlerta(slo: Slo, factor: number): number {
  return Math.min(1, (1 - slo.objetivo) * factor)
}

/** Formatea el presupuesto en algo que se entienda de un vistazo. */
export function presupuestoLegible(slo: Slo): string {
  const min = minutosPresupuesto(slo)
  if (min < 60) return `${Math.round(min)} min al mes`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} h al mes` : `${h} h ${m} min al mes`
}
