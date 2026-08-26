import type {
  AppointmentDTO,
  BranchDTO,
  CompanyDTO,
  CustomerDTO,
  MembershipSummaryDTO,
  PromotionDTO,
} from '@membego/contracts'
import { camposPermitidos } from '@/modules/plataforma/proyecciones'

/**
 * PLATAFORMA · Fase 2 — DTOs DE LA API v1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NUNCA SE DEVUELVE UN MODELO DE PRISMA
 *
 * `Cliente` tiene cuarenta columnas. Entre ellas `cardnetCustomerId`,
 * `fechaNacimiento`, `canalOrigen` y el `supabaseId` que identifica la cuenta
 * en el proveedor de identidad. Un restaurante necesita el nombre para pintar
 * la comanda; lo demás es superficie de fuga a cambio de nada.
 *
 * Devolver la fila entera es además el fallo que no se ve: funciona, nadie se
 * queja, y el día que se añade una columna sensible al modelo empieza a salir
 * por la API sin que nadie tome la decisión. Un DTO explícito convierte «qué
 * sale» en algo que hay que escribir a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS CAMPOS SON LOS DEL CONTRATO DE PROYECCIÓN, NO OTROS
 *
 * La Fase 1a declaró en `proyecciones.ts` qué campos puede COPIAR un vertical
 * de cada entidad. Este archivo emite exactamente esos, y
 * `tests/platform-api.test.ts` lo comprueba campo por campo.
 *
 * Sin esa atadura serían dos listas escritas por separado que empiezan iguales
 * y se separan a la tercera semana: la API devolvería un campo que el contrato
 * prohíbe proyectar, y el satélite lo guardaría sin saber que no debía.
 */

/**
 * Las FORMAS viven en `@membego/contracts` —son lo que el satélite recibe— y
 * los MAPEADORES se quedan aquí, porque traducen filas de Prisma y eso es
 * asunto del Core. El paquete no debe saber que existe una columna `name`.
 */
export type { CompanyDTO, BranchDTO, CustomerDTO, MembershipSummaryDTO, PromotionDTO, AppointmentDTO }


// ── Company ─────────────────────────────────────────────────────────────────


export function companyDTO(c: {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  moneda: string
  zonaHoraria: string
  idioma: string
}): CompanyDTO {
  return {
    id: c.id,
    nombre: c.name,
    slug: c.slug,
    logoUrl: c.logoUrl,
    moneda: c.moneda,
    zonaHoraria: c.zonaHoraria,
    idioma: c.idioma,
  }
}

// ── Branch ──────────────────────────────────────────────────────────────────


export function branchDTO(s: {
  id: string
  companyId: string
  nombre: string
  direccion: string | null
  activa: boolean
}): BranchDTO {
  return {
    id: s.id,
    companyId: s.companyId,
    nombre: s.nombre,
    direccion: s.direccion,
    activa: s.activa,
  }
}

// ── Customer ────────────────────────────────────────────────────────────────


/**
 * Sin `supabaseId`, sin `cardnetCustomerId`, sin fecha de nacimiento, sin canal
 * de origen y sin vehículos. Un vertical opera con esto; lo demás es de MembeGo
 * y no tiene por qué salir (§69).
 *
 * `email` puede venir vacío: los clientes de mostrador no tienen correo. Se
 * devuelve la cadena vacía y no `null` para que el tipo no obligue a ramificar
 * en cada satélite por un caso que no cambia nada.
 */
export function customerDTO(c: {
  id: string
  nombre: string
  email: string
  telefono: string | null
}): CustomerDTO {
  return { id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono }
}

// ── MembershipSummary ───────────────────────────────────────────────────────


/**
 * RESUMEN, y el nombre es la advertencia: sirve para PINTAR «cliente con
 * membresía activa». No autoriza nada.
 *
 * Quien quiera saber si se puede canjear un beneficio pregunta a
 * `POST /benefits/evaluate`, que decide en el momento. Es la regla que la Fase
 * 1a dejó escrita: una proyección es una caché, nunca una autoridad.
 */
export function membershipSummaryDTO(m: {
  id: string
  clienteId: string
  companyId: string
  plan: { nombre: string }
  estado: string
  fechaVencimiento: Date | null
}): MembershipSummaryDTO {
  return {
    id: m.id,
    customerId: m.clienteId,
    companyId: m.companyId,
    planNombre: m.plan.nombre,
    estado: m.estado,
    vigenteHasta: m.fechaVencimiento?.toISOString() ?? null,
  }
}

// ── Promotion ───────────────────────────────────────────────────────────────


/**
 * Sin el motor de reglas ni la contabilidad de canjes: el satélite pinta la
 * oferta —título, vigencia, si sigue activa—; si un cliente la puede canjear lo
 * decide `benefits.evaluate`, no esta proyección.
 */
export function promotionDTO(p: {
  id: string
  titulo: string
  descripcion: string
  imagenUrl: string | null
  activo: boolean
  vigenciaDesde: Date
  vigenciaHasta: Date | null
}): PromotionDTO {
  return {
    id: p.id,
    titulo: p.titulo,
    descripcion: p.descripcion,
    imagenUrl: p.imagenUrl,
    activo: p.activo,
    vigenciaDesde: p.vigenciaDesde.toISOString(),
    vigenciaHasta: p.vigenciaHasta?.toISOString() ?? null,
  }
}

// ── Appointment ─────────────────────────────────────────────────────────────


/**
 * Sin `notaCliente`, `notaInterna` ni `atendidaPor`: el satélite arma la agenda
 * con la hora, la duración, el cliente, la sucursal y el vehículo. Lo demás es
 * de MembeGo (§69).
 */
export function appointmentDTO(c: {
  id: string
  clienteId: string
  sucursalId: string | null
  vehiculoId: string | null
  inicio: Date
  duracionMin: number
  servicio: string | null
  estado: string
}): AppointmentDTO {
  return {
    id: c.id,
    customerId: c.clienteId,
    branchId: c.sucursalId,
    vehicleId: c.vehiculoId,
    inicio: c.inicio.toISOString(),
    duracionMin: c.duracionMin,
    servicio: c.servicio,
    estado: c.estado,
  }
}

// ── Comprobación de coherencia con el contrato ──────────────────────────────

/**
 * Qué campos emite cada DTO. Existe para que la prueba pueda comparar contra
 * `camposPermitidos()` sin construir objetos de ejemplo — y para que quien
 * añada un campo tenga que declararlo aquí, que es donde se nota.
 */
export const CAMPOS_DTO = {
  Company: ['id', 'nombre', 'slug', 'logoUrl', 'moneda', 'zonaHoraria', 'idioma'],
  Branch: ['id', 'companyId', 'nombre', 'direccion', 'activa'],
  Customer: ['id', 'nombre', 'email', 'telefono'],
  MembershipSummary: ['id', 'customerId', 'companyId', 'planNombre', 'estado', 'vigenteHasta'],
  Promotion: ['id', 'titulo', 'descripcion', 'imagenUrl', 'activo', 'vigenciaDesde', 'vigenciaHasta'],
  Appointment: ['id', 'customerId', 'branchId', 'vehicleId', 'inicio', 'duracionMin', 'servicio', 'estado'],
} as const satisfies Record<string, readonly string[]>

/** Entidades cuyo DTO debe coincidir con el contrato de proyección. */
export function desviacionesDelContrato(): string[] {
  const problemas: string[] = []
  for (const [entidad, campos] of Object.entries(CAMPOS_DTO)) {
    const permitidos = [...camposPermitidos(entidad)].sort()
    const emitidos = [...campos].sort()
    if (permitidos.join(',') !== emitidos.join(',')) {
      problemas.push(`${entidad}: contrato [${permitidos}] · DTO [${emitidos}]`)
    }
  }
  return problemas
}
