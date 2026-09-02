/**
 * EXCURSIONES · Comisiones — NÚCLEO PURO (sin Prisma, sin red).
 *
 * Este archivo decide cuánto se le debe a un vendedor. Es la pieza más
 * delicada del vertical, así que vive entera aquí: sin base de datos, sin
 * fechas implícitas, sin estado escondido. Todo lo que necesita llega por
 * parámetro y todo lo que decide se puede probar.
 *
 * Las cuatro reglas que sostienen lo demás:
 *
 * 1. GANA LA REGLA MÁS ESPECÍFICA. «Juan en la excursión a Saona» pesa más
 *    que «Juan», que pesa más que «Saona», que pesa más que la general. Ante
 *    el mismo nivel, la más reciente (§25).
 * 2. LA COMISIÓN NACE CON SU REGLA DENTRO. Se guarda un SNAPSHOT: qué regla
 *    se aplicó, con qué valor y sobre qué base. Cambiar la regla mañana no
 *    reescribe lo que ya se generó — recalcular el pasado es reescribir la
 *    historia (§26).
 * 3. NO SE COMISIONA EL IMPUESTO. La base es lo que la empresa realmente
 *    ingresa: el neto sin ITBIS. Pagar comisión sobre un impuesto que hay que
 *    entregarle al Estado es regalar dinero que no era de la empresa.
 * 4. UNA COMISIÓN PAGADA NO SE ANULA. Se corrige con un AJUSTE firmado, que
 *    deja las dos cifras a la vista (§27).
 */

// ── Ámbitos y su especificidad ───────────────────────────────────────────────

export const AMBITOS_REGLA = [
  'GENERAL',
  'TIPO_VENDEDOR',
  'CATEGORIA',
  'EXCURSION',
  'VENDEDOR',
  'VENDEDOR_EXCURSION',
] as const
export type AmbitoRegla = (typeof AMBITOS_REGLA)[number]

export const AMBITO_REGLA_LABEL: Record<AmbitoRegla, string> = {
  GENERAL: 'Toda la empresa',
  TIPO_VENDEDOR: 'Por tipo de vendedor',
  CATEGORIA: 'Una categoría',
  EXCURSION: 'Una excursión',
  VENDEDOR: 'Un vendedor',
  VENDEDOR_EXCURSION: 'Un vendedor en una excursión',
}

/** Cuanto más alto, más manda. Es el corazón de la jerarquía (§25). */
export const PESO_AMBITO: Record<AmbitoRegla, number> = {
  GENERAL: 1,
  TIPO_VENDEDOR: 2,
  CATEGORIA: 3,
  EXCURSION: 4,
  VENDEDOR: 5,
  VENDEDOR_EXCURSION: 6,
}

// ── Tipos de cálculo ─────────────────────────────────────────────────────────

export const TIPOS_CALCULO = [
  'PORCENTAJE',
  'FIJO_VENTA',
  'FIJO_ADULTO',
  'FIJO_NINO',
  'ESCALON',
  'PAQUETE_REGALO',
] as const
export type TipoCalculo = (typeof TIPOS_CALCULO)[number]

export const TIPO_CALCULO_LABEL: Record<TipoCalculo, string> = {
  PORCENTAJE: 'Porcentaje sobre tarifa por pasajero / venta (%)',
  FIJO_VENTA: 'Monto fijo por venta',
  FIJO_ADULTO: 'Monto fijo por adulto',
  FIJO_NINO: 'Monto fijo por niño',
  ESCALON: 'Por escalones de volumen de pasajeros',
  PAQUETE_REGALO: 'Paquete de regalo cada N ventas',
}

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_COMISION = [
  'ESTIMADA',
  'GENERADA',
  'APROBADA',
  'PENDIENTE_PAGO',
  'PAGADA',
  'ANULADA',
] as const
export type EstadoComision = (typeof ESTADOS_COMISION)[number]

export const ESTADO_COMISION_LABEL: Record<EstadoComision, string> = {
  ESTIMADA: 'Estimada',
  GENERADA: 'Generada',
  APROBADA: 'Aprobada',
  PENDIENTE_PAGO: 'Pendiente de pago',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada',
}

export const TONO_COMISION: Record<EstadoComision, 'success' | 'warning' | 'neutral' | 'info'> = {
  ESTIMADA: 'neutral',
  GENERADA: 'info',
  APROBADA: 'info',
  PENDIENTE_PAGO: 'warning',
  PAGADA: 'success',
  ANULADA: 'neutral',
}

/**
 * Transiciones permitidas. Una comisión PAGADA es terminal: el dinero ya salió
 * y lo que se corrige se corrige con un ajuste, no reescribiendo el estado.
 */
const TRANSICIONES: Record<EstadoComision, EstadoComision[]> = {
  ESTIMADA: ['GENERADA', 'ANULADA'],
  GENERADA: ['APROBADA', 'ANULADA'],
  APROBADA: ['PENDIENTE_PAGO', 'ANULADA'],
  PENDIENTE_PAGO: ['PAGADA', 'ANULADA'],
  PAGADA: [],
  ANULADA: ['GENERADA'],
}

export function puedeTransicionar(desde: EstadoComision, hacia: EstadoComision): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia)
}

/**
 * Transiciones manuales que se pueden ejecutar directamente desde la sección
 * de comisiones. Las transiciones a PENDIENTE_PAGO y PAGADA ocurren
 * exclusivamente durante el proceso de liquidaciones.
 */
export const TRANSICIONES_MANUALES_COMISION: Record<EstadoComision, EstadoComision[]> = {
  ESTIMADA: ['GENERADA', 'ANULADA'],
  GENERADA: ['APROBADA', 'ANULADA'],
  APROBADA: ['ANULADA'],
  PENDIENTE_PAGO: [],
  PAGADA: [],
  ANULADA: ['GENERADA'],
}

export function puedeTransicionarManualComision(
  desde: EstadoComision,
  hacia: EstadoComision
): boolean {
  return (TRANSICIONES_MANUALES_COMISION[desde] ?? []).includes(hacia)
}

/** Motivo legible del rechazo manual para la interfaz y acciones. */
export function motivoTransicionManualInvalida(
  desde: EstadoComision,
  hacia: EstadoComision
): string | null {
  if (puedeTransicionarManualComision(desde, hacia)) return null
  if (hacia === 'PENDIENTE_PAGO' || hacia === 'PAGADA') {
    return 'El estado de pago de las comisiones solo se gestiona a través del proceso de liquidación.'
  }
  if (desde === 'PAGADA') {
    return 'Esta comisión ya se pagó. Lo que haya que corregir se hace con un ajuste, no borrando el pago.'
  }
  if (desde === 'PENDIENTE_PAGO') {
    return 'Esta comisión está incluida en un borrador o pago de liquidación. Se gestiona desde liquidaciones.'
  }
  if (desde === 'ANULADA') {
    return 'Esta comisión está anulada. Si necesitas reactivarla, reanúdala a estado Generada.'
  }
  return `No se puede pasar manualmente de ${ESTADO_COMISION_LABEL[desde]} a ${ESTADO_COMISION_LABEL[hacia]}.`
}

/** Motivo legible del rechazo, para decirle a quien lo intenta POR QUÉ no. */
export function motivoTransicionInvalida(
  desde: EstadoComision,
  hacia: EstadoComision
): string | null {
  if (puedeTransicionar(desde, hacia)) return null
  if (desde === 'PAGADA') {
    return 'Esta comisión ya se pagó. Lo que haya que corregir se hace con un ajuste, no borrando el pago.'
  }
  if (desde === 'ANULADA') return 'Esta comisión está anulada. Si necesitas reactivarla, reanúdala a estado Generada.'
  return `No se puede pasar de ${ESTADO_COMISION_LABEL[desde]} a ${ESTADO_COMISION_LABEL[hacia]}.`
}

// ── Dinero ───────────────────────────────────────────────────────────────────

export function centavos(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export interface Escalon {
  desde: number
  hasta: number | null
  pct: number
}

/** Escalones que llegan como Json: se limpian antes de que decidan dinero. */
export function normalizarEscalones(valor: unknown): Escalon[] {
  if (!Array.isArray(valor)) return []
  return valor
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>
      const desde = Number(o.desde)
      const hastaN = Number(o.hasta)
      const pct = Number(o.pct)
      if (!Number.isFinite(desde) || !Number.isFinite(pct)) return null
      return {
        desde: Math.max(1, Math.trunc(desde)),
        hasta: Number.isFinite(hastaN) && hastaN > 0 ? Math.trunc(hastaN) : null,
        pct: Math.max(0, Math.min(100, pct)),
      }
    })
    .filter((e): e is Escalon => e !== null)
    .sort((a, b) => a.desde - b.desde)
}

export interface ReglaComision {
  id: string
  ambito: string
  tipoCalculo: string
  valor: number
  escalones?: unknown
  activa: boolean
  excursionId?: string | null
  vendedorId?: string | null
  categoria?: string | null
  tipoVendedor?: string | null
  vigenciaDesde?: Date | null
  vigenciaHasta?: Date | null
  createdAt: Date
}

export interface ContextoVenta {
  vendedorId: string
  excursionId: string
  categoria?: string | null
  tipoVendedor?: string | null
  /** Total cobrado, impuestos incluidos (solo informativo para el desglose). */
  total: number
  /** Lo que la empresa ingresa de verdad: sin impuestos. Es la base (§regla 3). */
  baseComisionable: number
  adultos: number
  ninos: number
  fecha: Date
  /** Nombre de la excursión vendida (para paquete de regalo equivalente). */
  excursionNombre?: string | null
  /** Precio base por adulto de la excursión vendida. */
  excursionPrecio?: number | null
  /** Número de ventas previas del vendedor para esta excursión específica. */
  ventasPreviasExcursion?: number
  /** Número de ventas previas del vendedor en general. */
  ventasPreviasVendedor?: number
}

/** ¿Esta regla habla de esta venta? Un ámbito sin su id no aplica a nadie. */
function reglaCorresponde(regla: ReglaComision, ctx: ContextoVenta): boolean {
  switch (regla.ambito as AmbitoRegla) {
    case 'GENERAL':
      return true
    case 'TIPO_VENDEDOR':
      return (
        !!regla.tipoVendedor &&
        !!ctx.tipoVendedor &&
        regla.tipoVendedor.toLowerCase().trim() === ctx.tipoVendedor.toLowerCase().trim()
      )
    case 'CATEGORIA':
      return !!regla.categoria && regla.categoria === ctx.categoria
    case 'EXCURSION':
      return regla.excursionId === ctx.excursionId
    case 'VENDEDOR':
      return regla.vendedorId === ctx.vendedorId
    case 'VENDEDOR_EXCURSION':
      return regla.vendedorId === ctx.vendedorId && regla.excursionId === ctx.excursionId
    default:
      return false
  }
}

function vigente(regla: ReglaComision, fecha: Date): boolean {
  if (!regla.activa) return false
  if (regla.vigenciaDesde && fecha < regla.vigenciaDesde) return false
  if (regla.vigenciaHasta && fecha > regla.vigenciaHasta) return false
  return true
}

/**
 * La regla que gobierna esta venta: la más específica entre las vigentes y, a
 * igual especificidad, la más reciente. Sin regla no hay comisión — y eso es
 * un resultado legítimo, no un error: significa que la empresa no ha definido
 * cuánto paga, y adivinar una cifra sería inventar una deuda.
 */
export function reglaAplicable(
  reglas: ReglaComision[],
  ctx: ContextoVenta
): ReglaComision | null {
  const candidatas = reglas
    .filter((r) => vigente(r, ctx.fecha) && reglaCorresponde(r, ctx))
    .sort((a, b) => {
      const pesoA = PESO_AMBITO[a.ambito as AmbitoRegla] ?? 0
      const pesoB = PESO_AMBITO[b.ambito as AmbitoRegla] ?? 0
      if (pesoA !== pesoB) return pesoB - pesoA
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
  return candidatas[0] ?? null
}

export interface ComisionCalculada {
  base: number
  monto: number
  /** Frase en español que explica la cifra sin abrir el código (§28). */
  desglose: string
  /** Lo que se congela en la comisión: la regla tal como era hoy (§26). */
  snapshot: {
    reglaId: string
    ambito: string
    tipoCalculo: string
    valor: number
    escalones?: Escalon[]
    aplicadaAt: string
  }
}

/**
 * Cuánto se le debe al vendedor por esta venta, con su explicación. El monto
 * nunca supera la base: una comisión mayor que lo que entró es siempre un
 * error de configuración, y se prefiere topar y decirlo a pagar de más.
 */
export function calcularComision(
  regla: ReglaComision,
  ctx: ContextoVenta
): ComisionCalculada {
  const base = centavos(Math.max(0, ctx.baseComisionable))
  const pasajeros = Math.max(0, ctx.adultos + ctx.ninos)
  const valor = centavos(regla.valor)
  const escalones = normalizarEscalones(regla.escalones)

  let monto = 0
  let desglose = ''

  /**
   * `FIJO_PASAJERO` se RETIRÓ del catálogo de tipos, pero su cálculo sigue.
   *
   * El tipo salió de `TIPOS_CALCULO` —ya no se puede elegir al crear una regla
   * nueva— y su `case` se quedó aquí sin compilar. La tentación era borrarlo,
   * y habría sido un error: una regla GUARDADA con ese tipo caería en el
   * `default`, que paga CERO. Es decir, un vendedor con una regla antigua
   * dejaría de cobrar de un despliegue para otro, en silencio y sin que nada
   * lo señale.
   *
   * Regla 2 del núcleo: una comisión nace con su regla dentro. Cambiar hoy lo
   * que vale una regla de ayer es reescribir la historia. Se conserva el
   * cálculo para lo que ya existe; que no se pueda crear más es otra cosa y
   * ya está resuelta arriba.
   */
  switch (regla.tipoCalculo as TipoCalculo | 'FIJO_PASAJERO') {
    case 'PORCENTAJE':
      monto = centavos(base * (valor / 100))
      desglose = `${valor}% sobre ${base} (venta sin impuestos)`
      break
    case 'FIJO_VENTA':
      monto = valor
      desglose = `${valor} fijo por venta`
      break
    // Retirado del catálogo; se mantiene para las reglas ya guardadas.
    case 'FIJO_PASAJERO':
      monto = centavos(valor * pasajeros)
      desglose = `${valor} × ${pasajeros} pasajero${pasajeros === 1 ? '' : 's'}`
      break
    case 'FIJO_ADULTO':
      monto = centavos(valor * ctx.adultos)
      desglose = `${valor} × ${ctx.adultos} adulto${ctx.adultos === 1 ? '' : 's'}`
      break
    case 'FIJO_NINO':
      monto = centavos(valor * ctx.ninos)
      desglose = `${valor} × ${ctx.ninos} niño${ctx.ninos === 1 ? '' : 's'}`
      break
    case 'ESCALON': {
      const escalon = escalones.find(
        (e) => pasajeros >= e.desde && (e.hasta === null || pasajeros <= e.hasta)
      )
      if (!escalon) {
        monto = 0
        desglose = `${pasajeros} pasajeros no caen en ningún escalón definido`
      } else {
        monto = centavos(base * (escalon.pct / 100))
        const hasta = escalon.hasta === null ? 'o más' : `a ${escalon.hasta}`
        desglose = `${escalon.pct}% sobre ${base} (escalón de ${escalon.desde} ${hasta} pasajeros)`
      }
      break
    }
    case 'PAQUETE_REGALO': {
      const cadaVentas = Math.max(1, Math.trunc(valor))
      const ventasPrevias = Math.max(0, ctx.ventasPreviasExcursion ?? ctx.ventasPreviasVendedor ?? 0)
      const conteoActual = (ventasPrevias % cadaVentas) + 1
      const precioPaquete = ctx.excursionPrecio && ctx.excursionPrecio > 0 ? centavos(ctx.excursionPrecio) : base
      const nombrePaquete = ctx.excursionNombre || 'Paquete de Excursión'

      if (conteoActual === cadaVentas) {
        monto = precioPaquete
        desglose = `¡Meta cumplida! Paquete de regalo otorgado: ${nombrePaquete} (Venta ${conteoActual} de ${cadaVentas} completada de esta excursión)`
      } else {
        monto = 0
        desglose = `Progreso: Venta ${conteoActual} de ${cadaVentas} de ${nombrePaquete} para ganar 1 paquete de regalo`
      }
      break
    }
    default:
      monto = 0
      desglose = 'Tipo de cálculo no reconocido: comisión en cero'
  }

  if (base === 0) {
    monto = 0
    desglose = `${desglose} — base cero (venta sin ingreso): comisión en cero`
  } else if (monto > base) {
    monto = base
    desglose = `${desglose} — topado a la base (${base}): la regla daba más de lo que entró`
  }

  return {
    base,
    monto: centavos(Math.max(0, monto)),
    desglose,
    snapshot: {
      reglaId: regla.id,
      ambito: regla.ambito,
      tipoCalculo: regla.tipoCalculo,
      valor,
      ...(escalones.length ? { escalones } : {}),
      aplicadaAt: ctx.fecha.toISOString(),
    },
  }
}

/**
 * Lo que se le debe HOY por una comisión: su monto más los ajustes firmados.
 * Los ajustes pueden ser negativos (una cancelación) y nunca dejan el neto por
 * debajo de cero: una comisión no se convierte en una deuda del vendedor.
 */
export function netoComision(monto: number, ajustes: { monto: number }[]): number {
  const suma = ajustes.reduce((total, a) => total + (Number(a.monto) || 0), 0)
  return centavos(Math.max(0, monto + suma))
}

/**
 * El ajuste que corrige una comisión cuando su venta se cae. Devuelve el monto
 * FIRMADO (negativo) y su motivo. Cancelar una venta nunca borra la comisión:
 * deja las dos cifras a la vista para que el histórico cuadre (§27).
 */
export function ajustePorCancelacion(
  netoActual: number,
  motivo: string
): { monto: number; motivo: string } | null {
  const neto = centavos(netoActual)
  if (neto <= 0) return null
  return { monto: centavos(-neto), motivo: motivo.trim().slice(0, 300) || 'Venta cancelada' }
}

// ── Validación de la regla ───────────────────────────────────────────────────

export interface ReglaDatos {
  ambito: AmbitoRegla
  tipoCalculo: TipoCalculo
  valor: number
  escalones: Escalon[] | null
  excursionId: string | null
  vendedorId: string | null
  categoria: string | null
  tipoVendedor: string | null
  vigenciaDesde: Date | null
  vigenciaHasta: Date | null
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function fechaOpcional(v: unknown): Date | null {
  const s = texto(v, 10)
  if (!FECHA_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Una regla mal definida es dinero mal pagado, así que se rechaza pronto y con
 * un motivo que el negocio entienda.
 */
export function validarRegla(
  form: Record<string, unknown>
): { ok: true; datos: ReglaDatos } | { ok: false; error: string } {
  const ambito = texto(form.ambito, 30).toUpperCase() as AmbitoRegla
  if (!(AMBITOS_REGLA as readonly string[]).includes(ambito)) {
    return { ok: false, error: 'Elige a qué se aplica la regla.' }
  }
  const tipoCalculo = texto(form.tipoCalculo, 30).toUpperCase() as TipoCalculo
  if (!(TIPOS_CALCULO as readonly string[]).includes(tipoCalculo)) {
    return { ok: false, error: 'Elige cómo se calcula la comisión.' }
  }

  const excursionId = texto(form.excursionId, 40) || null
  const vendedorId = texto(form.vendedorId, 40) || null
  const categoria = texto(form.categoria, 80) || null
  const tipoVendedor = texto(form.tipoVendedor, 60) || null

  // Un ámbito sin su referencia no se aplicaría nunca: es una regla muerta.
  if ((ambito === 'EXCURSION' || ambito === 'VENDEDOR_EXCURSION') && !excursionId) {
    return { ok: false, error: 'Elige la excursión a la que se aplica la regla.' }
  }
  if ((ambito === 'VENDEDOR' || ambito === 'VENDEDOR_EXCURSION') && !vendedorId) {
    return { ok: false, error: 'Elige el vendedor al que se aplica la regla.' }
  }
  if (ambito === 'CATEGORIA' && !categoria) {
    return { ok: false, error: 'Escribe la categoría a la que se aplica la regla.' }
  }
  if (ambito === 'TIPO_VENDEDOR' && !tipoVendedor) {
    return { ok: false, error: 'Elige el tipo de vendedor al que se aplica la regla.' }
  }

  const valor = centavos(Number(texto(form.valor, 12)))
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, error: 'El valor de la comisión no es válido.' }
  }
  if (tipoCalculo === 'PORCENTAJE' && valor > 100) {
    return { ok: false, error: 'Un porcentaje de comisión no puede pasar de 100.' }
  }
  if (tipoCalculo === 'PAQUETE_REGALO' && valor < 1) {
    return { ok: false, error: 'Indica cada cuántas ventas se regala el paquete (mínimo 1).' }
  }

  const escalones = tipoCalculo === 'ESCALON' ? normalizarEscalones(form.escalones) : null
  if (tipoCalculo === 'ESCALON' && (!escalones || escalones.length === 0)) {
    return { ok: false, error: 'Define al menos un escalón (desde cuántos pasajeros y qué %).' }
  }

  const vigenciaDesde = fechaOpcional(form.vigenciaDesde)
  const vigenciaHasta = fechaOpcional(form.vigenciaHasta)
  if (vigenciaDesde && vigenciaHasta && vigenciaHasta < vigenciaDesde) {
    return { ok: false, error: 'La vigencia termina antes de empezar.' }
  }

  return {
    ok: true,
    datos: {
      ambito,
      tipoCalculo,
      valor,
      escalones,
      excursionId: ambito === 'EXCURSION' || ambito === 'VENDEDOR_EXCURSION' ? excursionId : null,
      vendedorId: ambito === 'VENDEDOR' || ambito === 'VENDEDOR_EXCURSION' ? vendedorId : null,
      categoria: ambito === 'CATEGORIA' ? categoria : null,
      tipoVendedor: ambito === 'TIPO_VENDEDOR' ? tipoVendedor : null,
      vigenciaDesde,
      vigenciaHasta,
    },
  }
}
