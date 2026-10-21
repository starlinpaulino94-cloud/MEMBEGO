import { validarImagenPlan } from '@/modules/planes/imagen'

/**
 * LO QUE EL FORMULARIO DE UN PLAN ENVÍA, LEÍDO Y VALIDADO (auditoría admin · fase 7, tarea 7.2; 04 · F-01, F-06, F-10).
 *
 * Vivía dentro de `planActions.ts` como `parsePlan`, que devolvía UN mensaje y nada más: cuando fallaba, la pantalla ponía un
 * aviso arriba y la persona tenía que adivinar qué campo era. Ahora cada fallo dice QUÉ CAMPO falló (`campos`), que es lo que
 * permite enlazarlo con `aria-describedby` (el componente `Campo`), y sigue habiendo un resumen en `error` para quien lo lea
 * arriba. Es una función pura —sin base, sin sesión— para poder probar cada regla.
 *
 * Las reglas son LAS MISMAS que tenía `parsePlan`: nombre y precio obligatorios, precio ≥ 0, vigencia ≥ 1 día (30 si no se
 * escribe), orden numérico y la imagen comprobada en el servidor (un formulario enviado a mano podría poner cualquier origen, y
 * esa URL acaba en un `<img>` de la pantalla de cada cliente).
 */

export interface DatosPlan {
  nombre: string
  precio: number
  lavados: number
  esIlimitado: boolean
  descripcion: string | null
  beneficios: string[]
  vigenciaDias: number
  condiciones: string | null
  color: string | null
  imagenUrl: string | null
  orden: number
}

/** Qué campo falló y qué se le dice. Las claves son los `name` del formulario. */
export type ErroresPlan = Partial<Record<'nombre' | 'precio' | 'vigenciaDias' | 'orden' | 'imagenUrl' | 'companyId', string>>

/**
 * Lo que se pinta en cada campo, TAL CUAL se escribió (texto, no números ya convertidos). Es el estado del formulario: sirve para
 * abrir un plan que existe, para precargar una plantilla y, sobre todo, para DEVOLVER lo enviado cuando algo falla. React 19
 * vacía los campos no controlados al terminar la acción aunque haya fallado: sin devolver lo escrito, un error en el precio
 * borraba también el nombre, la descripción y los beneficios que la persona acababa de teclear.
 */
export interface ValoresPlan {
  companyId: string
  nombre: string
  descripcion: string
  precio: string
  vigenciaDias: string
  lavados: string
  esIlimitado: boolean
  beneficios: string
  condiciones: string
  /** `''` = sin color. */
  color: string
  orden: string
  activo: boolean
  /** `''` = sin imagen. */
  imagenUrl: string
}

export type ResultadoPlan =
  | { ok: true; plan: DatosPlan }
  | { ok: false; error: string; campos: ErroresPlan; valores: ValoresPlan }

const texto = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const crudo = (f: FormData, k: string) => String(f.get(k) ?? '')

/** Los campos de un plan nuevo: 30 días de vigencia, orden 0 y activo. */
export function valoresDePlanNuevo(): ValoresPlan {
  return {
    companyId: '',
    nombre: '',
    descripcion: '',
    precio: '',
    vigenciaDias: '30',
    lavados: '',
    esIlimitado: false,
    beneficios: '',
    condiciones: '',
    color: '',
    orden: '0',
    activo: true,
    imagenUrl: '',
  }
}

/** Una plantilla copiada como valores iniciales: editable antes de guardar, la plantilla no cambia. */
export function valoresDePlantilla(p: {
  nombre: string
  descripcion: string
  precio: number
  vigenciaDias: number
  lavados: number
  esIlimitado: boolean
  beneficios: string
  condiciones: string
}): ValoresPlan {
  return {
    ...valoresDePlanNuevo(),
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: String(p.precio),
    vigenciaDias: String(p.vigenciaDias),
    lavados: p.lavados ? String(p.lavados) : '',
    esIlimitado: p.esIlimitado,
    beneficios: p.beneficios,
    condiciones: p.condiciones,
  }
}

/** Un plan que ya existe, tal como está guardado. */
export function valoresDePlanGuardado(p: {
  companyId: string
  nombre: string
  precio: unknown
  lavadosIncluidos: number
  esIlimitado: boolean
  descripcion: string | null
  beneficios: string[]
  activo: boolean
  vigenciaDias: number
  condiciones: string | null
  color: string | null
  imagenUrl: string | null
  orden: number
}): ValoresPlan {
  return {
    companyId: p.companyId,
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    precio: String(p.precio),
    vigenciaDias: String(p.vigenciaDias),
    lavados: String(p.lavadosIncluidos),
    esIlimitado: p.esIlimitado,
    beneficios: p.beneficios.join('\n'),
    condiciones: p.condiciones ?? '',
    color: p.color ?? '',
    orden: String(p.orden),
    activo: p.activo,
    imagenUrl: p.imagenUrl ?? '',
  }
}

/** Lo que llegó en el formulario, para devolverlo si hay que corregir algo. */
function valoresEnviados(f: FormData): ValoresPlan {
  return {
    companyId: texto(f, 'companyId'),
    nombre: crudo(f, 'nombre'),
    descripcion: crudo(f, 'descripcion'),
    precio: crudo(f, 'precio'),
    vigenciaDias: crudo(f, 'vigenciaDias'),
    lavados: crudo(f, 'lavados'),
    esIlimitado: f.get('esIlimitado') === 'on',
    beneficios: crudo(f, 'beneficios'),
    condiciones: crudo(f, 'condiciones'),
    color: texto(f, 'color'),
    orden: crudo(f, 'orden'),
    activo: f.get('activo') === 'on',
    imagenUrl: texto(f, 'imagenUrl'),
  }
}

export function leerPlanDeFormulario(formData: FormData): ResultadoPlan {
  const nombre = texto(formData, 'nombre')
  const precioRaw = texto(formData, 'precio')
  const lavadosRaw = texto(formData, 'lavados')
  const esIlimitado = formData.get('esIlimitado') === 'on'
  const descripcion = texto(formData, 'descripcion')
  const beneficiosRaw = texto(formData, 'beneficios')
  const vigenciaRaw = texto(formData, 'vigenciaDias')
  const condiciones = texto(formData, 'condiciones')
  const color = texto(formData, 'color')
  const imagenUrl = texto(formData, 'imagenUrl')
  const ordenRaw = texto(formData, 'orden')

  const campos: ErroresPlan = {}

  if (!nombre) campos.nombre = 'Escribe el nombre del plan.'

  const precio = Number(precioRaw)
  if (!precioRaw) campos.precio = 'Escribe el precio (puede ser 0).'
  else if (Number.isNaN(precio) || precio < 0) campos.precio = 'El precio no es válido: usa un número desde 0.'

  const vigenciaDias = vigenciaRaw ? Number(vigenciaRaw) : 30
  if (Number.isNaN(vigenciaDias) || vigenciaDias < 1) campos.vigenciaDias = 'La vigencia debe ser al menos 1 día.'

  const orden = ordenRaw ? Number(ordenRaw) : 0
  if (Number.isNaN(orden)) campos.orden = 'El orden debe ser un número.'

  const errorImagen = validarImagenPlan(imagenUrl)
  if (errorImagen) campos.imagenUrl = errorImagen

  const fallos = Object.values(campos)
  if (fallos.length > 0) {
    // El resumen de arriba: el primero si es uno solo, y cuántos son si hay varios. Cada mensaje vive bajo SU campo.
    const error = fallos.length === 1 ? fallos[0]! : `Hay ${fallos.length} campos por corregir.`
    return { ok: false, error, campos, valores: valoresEnviados(formData) }
  }

  return {
    ok: true,
    plan: {
      nombre,
      precio,
      lavados: Number(lavadosRaw) || 0,
      esIlimitado,
      descripcion: descripcion || null,
      beneficios: beneficiosRaw
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean),
      vigenciaDias,
      condiciones: condiciones || null,
      color: color || null,
      imagenUrl: imagenUrl || null,
      orden,
    },
  }
}
