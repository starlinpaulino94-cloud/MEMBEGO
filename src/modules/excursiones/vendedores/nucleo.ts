/**
 * EXCURSIONES · Vendedores — NÚCLEO PURO.
 *
 * El vendedor es una entidad COMERCIAL: hoteles, taxistas y promotores no
 * necesitan cuenta de MembeGo (userId se enlaza solo si usará su panel). Su
 * identidad estable es el CÓDIGO (RAF-00125) — jamás derivado del nombre,
 * porque el nombre cambia y el código viaja impreso en QRs y volantes (§10).
 */

// ── Estados ──────────────────────────────────────────────────────────────────

export const ESTADOS_VENDEDOR = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO'] as const
export type EstadoVendedor = (typeof ESTADOS_VENDEDOR)[number]

export const ESTADO_VENDEDOR_LABEL: Record<EstadoVendedor, string> = {
  ACTIVO: 'Activo',
  SUSPENDIDO: 'Suspendido',
  INACTIVO: 'Inactivo',
}

export const TONO_VENDEDOR: Record<EstadoVendedor, 'success' | 'warning' | 'neutral'> = {
  ACTIVO: 'success',
  SUSPENDIDO: 'warning',
  INACTIVO: 'neutral',
}

/** Tipos sembrados; cada empresa puede añadir los suyos (§8). */
export const TIPOS_VENDEDOR_SEMILLA = [
  'Touroperador',
  'Agencia',
  'Rep Hotel',
  'Promotor',
  'Hotel',
  'Empleado',
  'Taxi',
  'Freelancer',
  'Referidor',
  'Vendedor externo',
] as const

// ── Código comercial ─────────────────────────────────────────────────────────

/**
 * Prefijo de 3 letras desde el nombre de la empresa («Rafael IslandQuest» →
 * RAF). Si el nombre no da letras, cae a 'VND'.
 */
export function prefijoDeEmpresa(nombre: string): string {
  const letras = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
  return (letras.slice(0, 3) || 'VND').padEnd(3, 'X')
}

/** RAF-00125: prefijo + correlativo de 5 dígitos. */
export function codigoVendedor(prefijo: string, n: number): string {
  return `${prefijo}-${String(Math.max(1, Math.trunc(n))).padStart(5, '0')}`
}

// ── Validación ───────────────────────────────────────────────────────────────

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function entero(v: unknown, min = 0, max = 365, porDefecto = 0): number {
  const n = parseInt(String(v ?? ''), 10)
  return isNaN(n) ? porDefecto : Math.max(min, Math.min(max, n))
}

function decimalOpcional(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = parseFloat(String(v))
  return isNaN(n) ? null : Math.max(0, Math.round(n * 100) / 100)
}

export interface VendedorDatos {
  nombre: string
  apellido: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  documento: string | null
  direccion: string | null
  tipo: string | null
  supervisorId: string | null
  razonSocial: string | null
  rnc: string | null
  diasCredito: number
  limiteCredito: number | null
  emailFacturacion: string | null
  prefijoVoucher: string | null
  modeloComercial: string
}

export function validarVendedor(
  form: Record<string, unknown>
): { ok: true; datos: VendedorDatos } | { ok: false; error: string } {
  const nombre = texto(form.nombre, 80)
  if (nombre.length < 2) return { ok: false, error: 'Escribe el nombre del vendedor.' }
  const email = texto(form.email, 160).toLowerCase()
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'El correo del vendedor no es válido.' }
  }
  const emailFacturacion = texto(form.emailFacturacion, 160).toLowerCase()
  if (emailFacturacion && !/^\S+@\S+\.\S+$/.test(emailFacturacion)) {
    return { ok: false, error: 'El correo de facturación no es válido.' }
  }
  const telefono = texto(form.telefono, 40)
  if (!telefono) return { ok: false, error: 'El teléfono es obligatorio: es como se le contacta y se detectan duplicados.' }
  
  const diasCredito = entero(form.diasCredito, 0, 180, 0)
  const limiteCredito = decimalOpcional(form.limiteCredito)
  const modeloComercial = String(form.modeloComercial ?? 'COMISION').toUpperCase() === 'TARIFA_NETA' ? 'TARIFA_NETA' : 'COMISION'

  return {
    ok: true,
    datos: {
      nombre,
      apellido: texto(form.apellido, 80) || null,
      telefono,
      whatsapp: texto(form.whatsapp, 40) || null,
      email: email || null,
      documento: texto(form.documento, 40) || null,
      direccion: texto(form.direccion, 300) || null,
      tipo: texto(form.tipo, 60) || null,
      supervisorId: texto(form.supervisorId, 40) || null,
      razonSocial: texto(form.razonSocial, 150) || null,
      rnc: texto(form.rnc, 40) || null,
      diasCredito,
      limiteCredito,
      emailFacturacion: emailFacturacion || null,
      prefijoVoucher: texto(form.prefijoVoucher, 20).toUpperCase() || null,
      modeloComercial,
    },
  }
}

/** URL pública del enlace de un vendedor (la que se copia y se comparte). */
export function urlDeEnlace(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://membego.com').replace(/\/$/, '')
  return `${base}/e/${slug}`
}

/**
 * La misma URL, marcada como QR. El servidor no puede distinguir un escaneo de
 * un clic en WhatsApp; declararlo en el enlace impreso es lo que permite decir
 * después «esto vino del QR» sin adivinar.
 */
export function urlDeQr(slug: string): string {
  return `${urlDeEnlace(slug)}?c=qr`
}
