/**
 * Solicitudes de alta de empresa — NÚCLEO PURO (sin Prisma, sin red).
 *
 * Etapa concierge del onboarding B2B: el negocio llena el formulario público
 * y el superadmin crea la empresa cuando la solicitud está lista. Aquí viven
 * los tipos del formulario versionado, su validación y los mapeos — lo
 * probable con pruebas unitarias.
 */

// ── Tipos del negocio en el formulario ───────────────────────────────────────

/** Opciones visibles del formulario. 'Otro' abre el campo libre. */
export const TIPOS_NEGOCIO_SOLICITUD = [
  'Car Wash',
  'Restaurante',
  'Barbería / Salón',
  'Gimnasio',
  'Excursiones / Tours',
  'Otro',
] as const
export type TipoNegocioSolicitud = (typeof TIPOS_NEGOCIO_SOLICITUD)[number]

/**
 * Del tipo elegido en el formulario al CÓDIGO del vertical de la plataforma
 * (`tipos_negocio.codigo`). 'Otro' no afirma vertical: la empresa se crea sin
 * él y el superadmin lo asigna después si aparece uno que aplique.
 */
export const VERTICAL_POR_TIPO: Partial<Record<TipoNegocioSolicitud, string>> = {
  'Car Wash': 'CAR_WASH',
  Restaurante: 'RESTAURANTE',
  'Barbería / Salón': 'BARBERIA',
  Gimnasio: 'GYM',
  'Excursiones / Tours': 'EXCURSIONES',
}

// ── Estados de la solicitud ──────────────────────────────────────────────────

export const ESTADOS_SOLICITUD = [
  'NUEVA',
  'EN_REVISION',
  'CONTACTADA',
  'CREADA',
  'DESCARTADA',
] as const
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number]

export const ESTADO_SOLICITUD_LABEL: Record<EstadoSolicitud, string> = {
  NUEVA: 'Nueva',
  EN_REVISION: 'En revisión',
  CONTACTADA: 'Contactada',
  CREADA: 'Empresa creada',
  DESCARTADA: 'Descartada',
}

/** Tono semántico por estado, para StatusChip (cambia con el tema). */
export const TONO_SOLICITUD: Record<
  EstadoSolicitud,
  'info' | 'warning' | 'success' | 'neutral' | 'danger'
> = {
  NUEVA: 'info',
  EN_REVISION: 'warning',
  CONTACTADA: 'info',
  CREADA: 'success',
  DESCARTADA: 'neutral',
}

// ── El formulario versionado (companies.solicitudes_empresa.datos) ───────────

export interface HorarioDia {
  dia: string
  cerrado: boolean
  desde: string
  hasta: string
}

export interface SolicitudPlan {
  nombre: string
  precio: string
  incluye: string
  notas?: string
}

export interface SolicitudPromo {
  titulo: string
  oferta: string
  tipo?: string
  vigencia?: string
  condiciones?: string
}

export interface SolicitudDatos {
  v: 1
  negocio: {
    nombre: string
    tipo: TipoNegocioSolicitud
    tipoOtro?: string
    descripcion: string
    telefono: string
    correo: string
    rnc?: string
    instagram?: string
    web?: string
  }
  ubicacion: {
    direccion: string
    ciudad: string
    maps?: string
  }
  horario: HorarioDia[]
  sucursales: { nombre?: string; direccion?: string; telefono?: string }[]
  marca: { color?: string }
  admin: { nombre: string; correo: string; telefono: string }
  planes: SolicitudPlan[]
  promos: SolicitudPromo[]
  cobros: {
    efectivo: boolean
    transferencia: boolean
    tarjeta: boolean
    banco?: string
    cuentaTipo?: string
    cuentaNum?: string
    cuentaTitular?: string
    usaCitas: boolean
    vehiculos?: string
  }
  extras: {
    ruleta: boolean
    gift: boolean
    referidos: boolean
    sellos: boolean
    comentarios?: string
  }
}

// ── Validación (tolerante a basura: el payload llega del navegador) ──────────

const MAX_TEXTO = 2000
const MAX_LISTA = 10

function texto(v: unknown, max = MAX_TEXTO): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function booleano(v: unknown): boolean {
  return v === true
}
function correoValido(v: string): boolean {
  return /^\S+@\S+\.\S+$/.test(v)
}

/**
 * Normaliza y valida el JSON del formulario. Devuelve los datos LIMPIOS
 * (todo recortado y con límites) o el primer error en lenguaje del negocio.
 * La regla es la de siempre: nada que venga del navegador se guarda crudo.
 */
export function validarDatosSolicitud(
  raw: unknown
): { ok: true; datos: SolicitudDatos } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'El formulario llegó vacío.' }
  const r = raw as Record<string, Record<string, unknown>>
  const negocio = r.negocio ?? {}
  const ubicacion = r.ubicacion ?? {}
  const admin = r.admin ?? {}

  const tipoCrudo = texto(negocio.tipo, 40)
  const tipo = (TIPOS_NEGOCIO_SOLICITUD as readonly string[]).includes(tipoCrudo)
    ? (tipoCrudo as TipoNegocioSolicitud)
    : null

  const datos: SolicitudDatos = {
    v: 1,
    negocio: {
      nombre: texto(negocio.nombre, 120),
      tipo: tipo ?? 'Otro',
      tipoOtro: texto(negocio.tipoOtro, 80) || undefined,
      descripcion: texto(negocio.descripcion),
      telefono: texto(negocio.telefono, 40),
      correo: texto(negocio.correo, 160).toLowerCase(),
      rnc: texto(negocio.rnc, 40) || undefined,
      instagram: texto(negocio.instagram, 120) || undefined,
      web: texto(negocio.web, 300) || undefined,
    },
    ubicacion: {
      direccion: texto(ubicacion.direccion, 300),
      ciudad: texto(ubicacion.ciudad, 120),
      maps: texto(ubicacion.maps, 500) || undefined,
    },
    horario: Array.isArray(r.horario)
      ? (r.horario as unknown[]).slice(0, 7).map((h) => {
          const d = (h ?? {}) as Record<string, unknown>
          return {
            dia: texto(d.dia, 12),
            cerrado: booleano(d.cerrado),
            desde: texto(d.desde, 8),
            hasta: texto(d.hasta, 8),
          }
        })
      : [],
    sucursales: Array.isArray(r.sucursales)
      ? (r.sucursales as unknown[]).slice(0, MAX_LISTA).map((s) => {
          const d = (s ?? {}) as Record<string, unknown>
          return {
            nombre: texto(d.nombre, 120) || undefined,
            direccion: texto(d.direccion, 300) || undefined,
            telefono: texto(d.telefono, 40) || undefined,
          }
        })
      : [],
    marca: { color: /^#[0-9a-fA-F]{6}$/.test(texto((r.marca ?? {}).color, 7)) ? texto((r.marca ?? {}).color, 7) : undefined },
    admin: {
      nombre: texto(admin.nombre, 120),
      correo: texto(admin.correo, 160).toLowerCase(),
      telefono: texto(admin.telefono, 40),
    },
    planes: Array.isArray(r.planes)
      ? (r.planes as unknown[]).slice(0, MAX_LISTA).map((p) => {
          const d = (p ?? {}) as Record<string, unknown>
          return {
            nombre: texto(d.nombre, 120),
            precio: texto(d.precio, 20),
            incluye: texto(d.incluye),
            notas: texto(d.notas, 300) || undefined,
          }
        })
      : [],
    promos: Array.isArray(r.promos)
      ? (r.promos as unknown[]).slice(0, MAX_LISTA).map((p) => {
          const d = (p ?? {}) as Record<string, unknown>
          return {
            titulo: texto(d.titulo, 160),
            oferta: texto(d.oferta),
            tipo: texto(d.tipo, 40) || undefined,
            vigencia: texto(d.vigencia, 120) || undefined,
            condiciones: texto(d.condiciones, 300) || undefined,
          }
        })
      : [],
    cobros: {
      efectivo: booleano((r.cobros ?? {}).efectivo),
      transferencia: booleano((r.cobros ?? {}).transferencia),
      tarjeta: booleano((r.cobros ?? {}).tarjeta),
      banco: texto((r.cobros ?? {}).banco, 80) || undefined,
      cuentaTipo: texto((r.cobros ?? {}).cuentaTipo, 40) || undefined,
      cuentaNum: texto((r.cobros ?? {}).cuentaNum, 60) || undefined,
      cuentaTitular: texto((r.cobros ?? {}).cuentaTitular, 120) || undefined,
      usaCitas: booleano((r.cobros ?? {}).usaCitas),
      vehiculos: texto((r.cobros ?? {}).vehiculos) || undefined,
    },
    extras: {
      ruleta: booleano((r.extras ?? {}).ruleta),
      gift: booleano((r.extras ?? {}).gift),
      referidos: booleano((r.extras ?? {}).referidos),
      sellos: booleano((r.extras ?? {}).sellos),
      comentarios: texto((r.extras ?? {}).comentarios) || undefined,
    },
  }

  // Requeridos, en el orden del formulario (el primer faltante guía al negocio).
  if (!datos.negocio.nombre) return { ok: false, error: 'Falta el nombre comercial del negocio.' }
  if (!tipo) return { ok: false, error: 'Elige el tipo de negocio.' }
  if (!datos.negocio.descripcion) return { ok: false, error: 'Falta la descripción del negocio.' }
  if (!datos.negocio.telefono) return { ok: false, error: 'Falta el teléfono del negocio.' }
  if (!correoValido(datos.negocio.correo)) return { ok: false, error: 'El correo del negocio no es válido.' }
  if (!datos.ubicacion.direccion) return { ok: false, error: 'Falta la dirección del local.' }
  if (!datos.ubicacion.ciudad) return { ok: false, error: 'Falta la ciudad.' }
  if (!datos.admin.nombre) return { ok: false, error: 'Falta el nombre del administrador.' }
  if (!correoValido(datos.admin.correo)) return { ok: false, error: 'El correo del administrador no es válido.' }
  if (!datos.admin.telefono) return { ok: false, error: 'Falta el teléfono del administrador.' }

  return { ok: true, datos }
}

// ── Utilidades de presentación ───────────────────────────────────────────────

/** Horario semanal como el texto libre que guarda `Company.horario`. */
export function horarioComoTexto(horario: HorarioDia[]): string {
  return horario
    .filter((h) => h.dia)
    .map((h) => `${h.dia}: ${h.cerrado ? 'cerrado' : `${h.desde}–${h.hasta}`}`)
    .join(' · ')
}

// ── Adjuntos ─────────────────────────────────────────────────────────────────

export interface ImagenSolicitud {
  tipo: 'logo' | 'portada' | 'promo'
  /** Índice de la promoción a la que pertenece (solo tipo 'promo'). */
  promoIndice?: number
  url: string
  path: string
}

export const IMG_TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMG_MAX_BYTES = 5 * 1024 * 1024 // 5 MB por imagen

/** Extensión de archivo segura a partir del MIME (ya validado). */
export function extensionDeMime(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}
