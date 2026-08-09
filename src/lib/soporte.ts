/**
 * Utilidades compartidas del módulo de Comunicación y Soporte.
 * Sin dependencias de servidor: se puede importar desde componentes cliente.
 */

export const MENSAJE_DEFAULT =
  'Hola, soy {cliente}. Necesito ayuda con mi membresía.'

/**
 * Contacto de soporte de la PLATAFORMA: respaldo cuando la empresa no ha
 * configurado el suyo en /admin/comunicacion, y contacto de la landing
 * pública. Un solo lugar para cambiarlo.
 */
export const SOPORTE_PLATAFORMA = {
  email: 'contacto@membego.com',
  whatsappCodigoPais: '1',
  whatsappNumero: '8299618220',
  whatsappDisplay: '+1 829 961 8220',
} as const

export const DIAS_SEMANA = [
  { value: 0, label: 'Dom', full: 'Domingo' },
  { value: 1, label: 'Lun', full: 'Lunes' },
  { value: 2, label: 'Mar', full: 'Martes' },
  { value: 3, label: 'Mié', full: 'Miércoles' },
  { value: 4, label: 'Jue', full: 'Jueves' },
  { value: 5, label: 'Vie', full: 'Viernes' },
  { value: 6, label: 'Sáb', full: 'Sábado' },
] as const

export interface PlantillaVars {
  cliente?: string
  empresa?: string
  membresia?: string
  fecha?: string
}

/** Reemplaza las variables {cliente} {empresa} {membresia} {fecha} en el texto. */
export function renderPlantilla(texto: string, vars: PlantillaVars): string {
  const fecha = vars.fecha ?? new Date().toLocaleDateString('es-DO')
  return texto
    .replace(/\{cliente\}/g, vars.cliente ?? 'cliente')
    .replace(/\{empresa\}/g, vars.empresa ?? 'la empresa')
    .replace(/\{membresia\}/g, vars.membresia ?? 'mi membresía')
    .replace(/\{fecha\}/g, fecha)
}

/** Normaliza el código de país a formato +NN (solo dígitos precedidos de +). */
export function normalizarCodigoPais(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? `+${digits}` : ''
}

/** Deja solo dígitos del número nacional. */
export function normalizarNumero(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Construye el enlace https://wa.me/ a partir de código de país + número. */
export function buildWaLink(
  codigoPais: string,
  numero: string,
  mensaje?: string
): string {
  const full = `${normalizarCodigoPais(codigoPais)}${normalizarNumero(numero)}`.replace(
    /^\+/,
    ''
  )
  const base = `https://wa.me/${full}`
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base
}

/** Formatea el número para mostrar: "+52 5512345678". */
export function formatNumeroPreview(codigoPais: string, numero: string): string {
  const cp = normalizarCodigoPais(codigoPais)
  const n = normalizarNumero(numero)
  if (!cp && !n) return '—'
  return `${cp} ${n}`.trim()
}

/** Parsea la CSV de días laborales a un arreglo de índices. */
export function parseDias(csv: string | null | undefined): number[] {
  if (!csv) return [1, 2, 3, 4, 5]
  return csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
}

/** Texto legible del horario para el cliente. */
export function horarioLegible(
  horaInicio?: string | null,
  horaCierre?: string | null,
  diasCsv?: string | null
): string | null {
  if (!horaInicio || !horaCierre) return null
  const dias = parseDias(diasCsv)
  if (dias.length === 0) return null
  const sorted = [...dias].sort((a, b) => a - b)
  // Rango contiguo → "Lun a Vie", si no lista
  const contiguo = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  const label = (v: number) => DIAS_SEMANA[v].label
  const diasTxt =
    sorted.length > 1 && contiguo
      ? `${label(sorted[0])} a ${label(sorted[sorted.length - 1])}`
      : sorted.map(label).join(', ')
  return `${diasTxt} · ${horaInicio} – ${horaCierre}`
}

// ── Tickets: etiquetas y colores ────────────────────────────────────────────

export const TICKET_ESTADOS = [
  'NUEVO',
  'EN_PROCESO',
  'ESPERANDO_CLIENTE',
  'RESUELTO',
  'CERRADO',
] as const
export type TicketEstadoT = (typeof TICKET_ESTADOS)[number]

export const TICKET_CATEGORIAS = [
  'PAGO',
  'MEMBRESIA',
  'BENEFICIOS',
  'APP',
  'OTRO',
] as const
export type TicketCategoriaT = (typeof TICKET_CATEGORIAS)[number]

export function estadoLabel(e: string): string {
  return (
    {
      NUEVO: 'Nuevo',
      EN_PROCESO: 'En proceso',
      ESPERANDO_CLIENTE: 'Esperando cliente',
      RESUELTO: 'Resuelto',
      CERRADO: 'Cerrado',
    } as Record<string, string>
  )[e] ?? e
}

/** Clases de color para el badge de estado (tokens semánticos del design system). */
export function estadoBadgeClass(e: string): string {
  return (
    {
      NUEVO: 'bg-info/10 text-info',
      EN_PROCESO: 'bg-warning/15 text-warning-foreground',
      ESPERANDO_CLIENTE: 'bg-primary/10 text-primary',
      RESUELTO: 'bg-success/10 text-success',
      CERRADO: 'bg-muted text-muted-foreground',
    } as Record<string, string>
  )[e] ?? 'bg-muted text-muted-foreground'
}

/**
 * COLAS DE TRABAJO — la bandeja de soporte no es un histograma de estados.
 *
 * Los cinco estados existen y siguen siendo útiles dentro de un ticket, pero un
 * administrador que abre esta pantalla tiene UNA pregunta: *¿qué está esperando
 * por mí?* Cinco números repartidos por igual no la contestan; obligan a hacer
 * la suma mentalmente cada vez.
 *
 * Las tres colas responden por quién tiene la pelota:
 *
 *  · PENDIENTES  — le toca al negocio (nuevo o ya en proceso). Es el trabajo.
 *  · ESPERANDO   — le toca al cliente. No es trabajo, pero se vigila: un ticket
 *                  que lleva semanas aquí normalmente es un cliente que se fue.
 *  · CERRADOS    — resuelto o cerrado. Historial.
 *
 * Mismo criterio que la Fase 12 aplicó a los pagos. Y cubren los CINCO estados:
 * las tarjetas anteriores contaban tres, así que un ticket en
 * ESPERANDO_CLIENTE no aparecía en ninguna y los números no cuadraban con el
 * total.
 */
export const COLAS_TICKET = {
  pendientes: ['NUEVO', 'EN_PROCESO'],
  esperando: ['ESPERANDO_CLIENTE'],
  cerrados: ['RESUELTO', 'CERRADO'],
} as const satisfies Record<string, readonly TicketEstadoT[]>

export type ColaTicket = keyof typeof COLAS_TICKET

export const COLA_LABEL: Record<ColaTicket, string> = {
  pendientes: 'Te toca a ti',
  esperando: 'Esperando al cliente',
  cerrados: 'Cerrados',
}

/** A qué cola pertenece un estado. */
export function colaDeEstado(estado: string): ColaTicket | null {
  for (const [cola, estados] of Object.entries(COLAS_TICKET)) {
    if ((estados as readonly string[]).includes(estado)) return cola as ColaTicket
  }
  return null
}

export function categoriaLabel(c: string): string {
  return (
    {
      PAGO: 'Pago',
      MEMBRESIA: 'Membresía',
      BENEFICIOS: 'Beneficios',
      APP: 'App',
      OTRO: 'Otro',
    } as Record<string, string>
  )[c] ?? c
}
