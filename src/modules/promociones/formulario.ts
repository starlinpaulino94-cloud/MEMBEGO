import { esTipoValido, esVisibilidadValida } from '@/lib/promociones'

/**
 * LO QUE EL FORMULARIO DE UNA PROMOCIÓN ENVÍA, LEÍDO Y VALIDADO (auditoría admin · fase 7, tarea 7.2; 04 · F-01, F-05, F-10).
 *
 * Vivía dentro de `promocionActions.ts` como `parsePromocion`: devolvía UN mensaje en cuanto algo fallaba, así que la pantalla
 * ponía un aviso arriba y la persona tenía que adivinar cuál de los veinticinco campos era. Ahora cada fallo dice QUÉ CAMPO
 * falló (`campos`), que es lo que permite enlazarlo con su control (`Campo`), y se recogen TODOS a la vez: corregir un campo y
 * descubrir otro en el envío siguiente es lo que hace que un formulario largo se sienta interminable.
 *
 * Las reglas son las mismas que tenía `parsePromocion`. Dos endurecimientos, ambos de un fallo que antes llegaba a la base:
 * una fecha ilegible ya no pasa (daba una fecha inválida y un «Ocurrió un error» sin más) y el aviso de campo dice cuál.
 * Función pura: sin base ni sesión, para probar cada regla.
 */

export interface DatosPromocion {
  titulo: string
  descripcion: string
  imagenUrl: string | null
  tipo: string
  descuento: number | null
  codigo: string | null
  visibilidad: string
  vigenciaDesde: Date
  vigenciaHasta: Date | null
  maxCanjes: number | null
  prioridad: number
  campanaId: string | null
  // Fase E5: venta como producto comercial
  esComprable: boolean
  precio: number | null
  usosPorCompra: number
  limitePorCliente: number | null
  beneficioVigenciaDias: number | null
  beneficioVigenciaHasta: Date | null
  diasPermitidos: number[]
  horaDesde: string | null
  horaHasta: string | null
}

/** Share Engine: textos propios al compartir (se guardan aparte). */
export interface TextosAlCompartir {
  shareTitulo: string | null
  shareDescripcion: string | null
}

/** Qué campo falló y qué se le dice. Las claves son los `name` del formulario. */
export type ErroresPromocion = Partial<
  Record<
    | 'titulo'
    | 'descripcion'
    | 'tipo'
    | 'descuento'
    | 'visibilidad'
    | 'maxCanjes'
    | 'prioridad'
    | 'vigenciaDesde'
    | 'vigenciaHasta'
    | 'precio'
    | 'usosPorCompra'
    | 'limitePorCliente'
    | 'beneficioVigenciaDias'
    | 'beneficioVigenciaHasta'
    | 'horaHasta'
    | 'campanaId',
    string
  >
>

/**
 * Lo que se pinta en cada campo, TAL CUAL se escribió. Es el estado del formulario: sirve para abrir una promoción, para
 * precargar una plantilla y para DEVOLVER lo enviado cuando algo falla (React 19 vacía los campos no controlados al terminar la
 * acción aunque haya fallado: sin esto, un error en el precio borraba el título y la descripción recién escritos).
 */
export interface ValoresPromocion {
  tipo: string
  descuento: string
  titulo: string
  descripcion: string
  codigo: string
  imagenUrl: string
  shareTitulo: string
  shareDescripcion: string
  vigenciaDesde: string
  vigenciaHasta: string
  maxCanjes: string
  prioridad: string
  esComprable: boolean
  precio: string
  usosPorCompra: string
  limitePorCliente: string
  beneficioVigenciaDias: string
  beneficioVigenciaHasta: string
  diasPermitidos: number[]
  horaDesde: string
  horaHasta: string
  visibilidad: string
  /** `'none'` = sin campaña (es lo que envía el selector). */
  campanaId: string
  activo: boolean
}

export type ResultadoPromocion =
  | { ok: true; data: DatosPromocion; share: TextosAlCompartir }
  | { ok: false; error: string; campos: ErroresPromocion; valores: ValoresPromocion }

const texto = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const crudo = (f: FormData, k: string) => String(f.get(k) ?? '')
/** Como lo leía `parsePromocion`: solo si el campo NO viene se usa el valor por defecto; vacío sigue siendo vacío (y falla). */
const conDefecto = (f: FormData, k: string, defecto: string) => String(f.get(k) ?? defecto).trim()

/** Lo que llegó en el formulario, para devolverlo si hay que corregir algo. */
function valoresEnviados(f: FormData): ValoresPromocion {
  return {
    tipo: conDefecto(f, 'tipo', 'general'),
    descuento: crudo(f, 'descuento'),
    titulo: crudo(f, 'titulo'),
    descripcion: crudo(f, 'descripcion'),
    codigo: crudo(f, 'codigo'),
    imagenUrl: texto(f, 'imagenUrl'),
    shareTitulo: crudo(f, 'shareTitulo'),
    shareDescripcion: crudo(f, 'shareDescripcion'),
    vigenciaDesde: crudo(f, 'vigenciaDesde'),
    vigenciaHasta: crudo(f, 'vigenciaHasta'),
    maxCanjes: crudo(f, 'maxCanjes'),
    prioridad: crudo(f, 'prioridad'),
    esComprable: String(f.get('esComprable') ?? 'false') === 'true',
    precio: crudo(f, 'precio'),
    usosPorCompra: crudo(f, 'usosPorCompra'),
    limitePorCliente: crudo(f, 'limitePorCliente'),
    beneficioVigenciaDias: crudo(f, 'beneficioVigenciaDias'),
    beneficioVigenciaHasta: crudo(f, 'beneficioVigenciaHasta'),
    diasPermitidos: f
      .getAll('diasPermitidos')
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    horaDesde: crudo(f, 'horaDesde'),
    horaHasta: crudo(f, 'horaHasta'),
    visibilidad: conDefecto(f, 'visibilidad', 'publica'),
    campanaId: texto(f, 'campanaId') || 'none',
    activo: f.get('activo') !== 'false',
  }
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const fechaValida = (d: Date) => !Number.isNaN(d.getTime())

export function leerPromocionDeFormulario(formData: FormData): ResultadoPromocion {
  const titulo = texto(formData, 'titulo')
  const descripcion = texto(formData, 'descripcion')
  const imagenUrl = texto(formData, 'imagenUrl') || null
  const tipo = conDefecto(formData, 'tipo', 'general')
  const codigo = texto(formData, 'codigo') || null
  // Share Engine: textos propios al compartir (vacío = usar título/descripción).
  const shareTitulo = texto(formData, 'shareTitulo').slice(0, 120) || null
  const shareDescripcion = texto(formData, 'shareDescripcion').slice(0, 200) || null
  const visibilidad = conDefecto(formData, 'visibilidad', 'publica')
  const campanaRaw = texto(formData, 'campanaId')
  const campanaId = campanaRaw && campanaRaw !== 'none' ? campanaRaw : null

  const descuentoRaw = texto(formData, 'descuento')
  const descuento = descuentoRaw ? Number(descuentoRaw) : null
  const maxCanjesRaw = texto(formData, 'maxCanjes')
  const maxCanjes = maxCanjesRaw ? Number(maxCanjesRaw) : null
  const prioridadRaw = texto(formData, 'prioridad')
  const prioridad = prioridadRaw ? Number(prioridadRaw) : 0

  const desdeRaw = texto(formData, 'vigenciaDesde')
  const hastaRaw = texto(formData, 'vigenciaHasta')
  const vigenciaDesde = desdeRaw ? new Date(desdeRaw) : new Date()
  const vigenciaHasta = hastaRaw ? new Date(hastaRaw) : null

  const campos: ErroresPromocion = {}

  if (!titulo) campos.titulo = 'Escribe el título de la promoción.'
  if (!descripcion) campos.descripcion = 'Escribe la descripción: las condiciones y detalles para el cliente.'
  if (!esTipoValido(tipo)) campos.tipo = 'Elige un tipo de promoción de la lista.'
  if (!esVisibilidadValida(visibilidad)) campos.visibilidad = 'Elige una visibilidad de la lista.'
  if (descuento != null && (Number.isNaN(descuento) || descuento < 0)) campos.descuento = 'El descuento debe ser un número desde 0.'
  if (maxCanjes != null && (Number.isNaN(maxCanjes) || maxCanjes < 1)) campos.maxCanjes = 'El límite de canjes debe ser mayor a 0.'
  if (Number.isNaN(prioridad)) campos.prioridad = 'La prioridad debe ser un número.'
  if (!fechaValida(vigenciaDesde)) campos.vigenciaDesde = 'La fecha de inicio no es válida.'
  if (vigenciaHasta && !fechaValida(vigenciaHasta)) campos.vigenciaHasta = 'La fecha de fin no es válida.'
  else if (vigenciaHasta && fechaValida(vigenciaDesde) && vigenciaHasta <= vigenciaDesde) {
    campos.vigenciaHasta = 'La fecha de fin debe ser posterior a la de inicio.'
  }

  // ── Fase E5: venta como producto comercial ─────────────────────────────────
  const esComprable = String(formData.get('esComprable') ?? 'false') === 'true'
  const precioRaw = texto(formData, 'precio')
  const precio = precioRaw ? Number(precioRaw) : null
  const usosRaw = texto(formData, 'usosPorCompra')
  const usosPorCompra = usosRaw ? Number(usosRaw) : 1
  const limiteClienteRaw = texto(formData, 'limitePorCliente')
  const limitePorCliente = limiteClienteRaw ? Number(limiteClienteRaw) : null
  const benefDiasRaw = texto(formData, 'beneficioVigenciaDias')
  const beneficioVigenciaDias = benefDiasRaw ? Number(benefDiasRaw) : null
  const benefHastaRaw = texto(formData, 'beneficioVigenciaHasta')
  const beneficioVigenciaHasta = benefHastaRaw ? new Date(benefHastaRaw) : null
  const diasPermitidos = formData
    .getAll('diasPermitidos')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const horaDesdeRaw = texto(formData, 'horaDesde')
  const horaHastaRaw = texto(formData, 'horaHasta')
  const horaDesde = HORA.test(horaDesdeRaw) ? horaDesdeRaw : null
  const horaHasta = HORA.test(horaHastaRaw) ? horaHastaRaw : null

  if (esComprable) {
    if (precio == null || Number.isNaN(precio) || precio < 0) campos.precio = 'Indica el precio de venta (0 = gratis).'
    if (Number.isNaN(usosPorCompra) || usosPorCompra < 1) campos.usosPorCompra = 'Los usos por compra deben ser al menos 1.'
    if (limitePorCliente != null && (Number.isNaN(limitePorCliente) || limitePorCliente < 1)) {
      campos.limitePorCliente = 'El límite por cliente debe ser al menos 1 (o vacío para sin límite).'
    }
    if (beneficioVigenciaDias != null && (Number.isNaN(beneficioVigenciaDias) || beneficioVigenciaDias < 1)) {
      campos.beneficioVigenciaDias = 'La vigencia del beneficio debe ser al menos 1 día.'
    }
    if (beneficioVigenciaHasta && !fechaValida(beneficioVigenciaHasta)) {
      campos.beneficioVigenciaHasta = 'La fecha fija de vigencia no es válida.'
    }
    if (horaDesde && horaHasta && horaHasta <= horaDesde) campos.horaHasta = 'El horario «hasta» debe ser posterior al «desde».'
  }

  const fallos = Object.values(campos)
  if (fallos.length > 0) {
    // El resumen de arriba: el mensaje si es uno solo, y cuántos son si hay varios. Cada mensaje vive bajo SU campo.
    const error = fallos.length === 1 ? fallos[0]! : `Hay ${fallos.length} campos por corregir.`
    return { ok: false, error, campos, valores: valoresEnviados(formData) }
  }

  return {
    ok: true,
    share: { shareTitulo, shareDescripcion },
    data: {
      titulo,
      descripcion,
      imagenUrl,
      tipo,
      descuento,
      codigo,
      visibilidad,
      vigenciaDesde,
      vigenciaHasta,
      maxCanjes,
      prioridad,
      campanaId,
      esComprable,
      precio: esComprable ? precio : null,
      usosPorCompra: esComprable ? usosPorCompra : 1,
      limitePorCliente: esComprable ? limitePorCliente : null,
      beneficioVigenciaDias: esComprable ? beneficioVigenciaDias : null,
      beneficioVigenciaHasta: esComprable ? beneficioVigenciaHasta : null,
      diasPermitidos: esComprable ? diasPermitidos : [],
      horaDesde: esComprable ? horaDesde : null,
      horaHasta: esComprable ? horaHasta : null,
    },
  }
}
