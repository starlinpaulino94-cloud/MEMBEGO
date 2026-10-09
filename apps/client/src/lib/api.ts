import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { z } from 'zod'
import {
  cardnetCaptureSessionSchema,
  cardnetPaymentStatusSchema,
  cardnetProcessingSessionSchema,
  cardnetPromotionPurchaseSchema,
  type CardnetSessionTarget,
} from './cardnet-api-contracts'
import { supabase } from './supabase'
import { resolveApiBaseUrl } from './runtimeUrls'

export type {
  CardnetCaptureSession,
  CardnetPaymentStatus,
  CardnetPromotionPurchaseResult,
  CardnetSessionStartResult,
  CardnetSessionTarget,
} from './cardnet-api-contracts'

function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    configuredUrl: process.env.EXPO_PUBLIC_API_URL,
    platform: Platform.OS === 'web' ? 'web' : 'native',
    hostUri: Constants.expoConfig?.hostUri,
    nativeHost: process.env.EXPO_PUBLIC_DEVICE_HOST,
    browserOrigin:
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : undefined,
  })
}

export async function fetchBff<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const url = `${baseUrl}${cleanPath}`

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(errorBody.error || `HTTP error ${res.status}`)
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Tipos de los shapes BFF /api/v1/cliente/* (fuente: notepad cliente-rn-parity
// secciones L2-15 a L2-19). Campos no documentados se tipan como `unknown` o
// index signature — no inventar campos.
// ---------------------------------------------------------------------------

export type JsonObject = Record<string, unknown>

async function parseCardnetResponse<T>(request: Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request)
}

const cardnetProcessingSessionResponseSchema = z
  .object({ status: z.literal('processing') })
  .passthrough()
  .refine(
    (response) =>
      ![
        'captureNonce',
        'expiresAt',
        'amount',
        'currency',
        'captureUrl',
        'scriptUrl',
        'publicKey',
        'uniqueId',
      ].every((field) => Object.prototype.hasOwnProperty.call(response, field)),
    { message: 'Processing CardNET response cannot carry a capture session' }
  )
  .pipe(cardnetProcessingSessionSchema)

export const cardnetSessionStartResponseSchema = z.union([
  cardnetProcessingSessionResponseSchema,
  cardnetCaptureSessionSchema,
])

// --- Marketplace / catálogo ---
export interface CompanyPublic {
  id: string
  name: string
  slug: string
  type: string
  colorPrimario?: string | null
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
  galleryImages: string[]
  ciudad: string | null
  provincia: string | null
  pais: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  googleMapsUrl: string | null
  horario: unknown
  totalMembersCount: number
  activePromotionsCount: number
  averageRating: number | null
  isFeatured: boolean
  categories: string[]
  desdePlan: unknown
  esDemo?: boolean
  createdAt: string
}

export interface CompanyStats {
  totalMembers: number
  activePromotions: number
  averageRating: number | null
  totalRatings: number
}

export interface CategoryPublic {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  order: number
  companyCount: number
}

export interface CategoryOption {
  id: string
  name: string
  icon: string | null
}

export interface PlanPublic {
  id: string
  nombre: string
  precio: number
  esIlimitado: boolean
  lavadosIncluidos: number | null
  descripcion: string | null
  beneficios: string[]
  vigenciaDias: number
  imagenUrl?: string | null
  color?: string | null
}

export interface PlanGlobalItem extends PlanPublic {
  company: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    colorPrimario?: string | null
    ciudad: string | null
    moneda: string
    idioma: string
    averageRating: number | null
  }
}

export interface PlanEmpresaItem extends PlanPublic {
  precioBase?: number
  condiciones: string | null
  comprable: boolean
  nivelSuperior: string | null
  precioDeCategoria: number | null
}

export interface PromotionVenta {
  precio: number
  usosPorCompra: number
  agotada: boolean
  beneficioVigenciaDias: number | null
  beneficioVigenciaHasta: string | null
  limitePorCliente: number | null
}

export interface PromotionPublic {
  id: string
  titulo: string
  slug: string | null
  descripcion: string | null
  precio: number | null
  tipo: string
  descuento: string | null
  codigo: string | null
  vigenciaDesde: string
  vigenciaHasta: string | null
  imagenUrl: string | null
  isFeatured: boolean
  viewCount: number
  shareCount: number
  tags: string[]
  createdAt: string
  company: { id: string; slug: string; name: string; logoUrl: string | null; colorPrimario?: string | null; tienePlanes?: boolean }
  imagenes?: string[]
  venta?: PromotionVenta | null
}

export interface PromoFeed {
  misEmpresas: PromotionPublic[]
  destacadas: PromotionPublic[]
  nuevas: PromotionPublic[]
  expiranPronto: PromotionPublic[]
  recomendadas: PromotionPublic[]
  empresasRecomendadas: CompanyPublic[]
}

export interface CompanyPostPublic {
  readonly id: string
  readonly tipo: string
  readonly titulo: string
  readonly contenido: string
  readonly imagenUrl: string | null
  readonly fechaEvento: string | null
  readonly lugar: string | null
  readonly publicadaEn: string
}

export interface CompanyPostsPublic {
  readonly beneficios: readonly CompanyPostPublic[]
  readonly eventos: readonly CompanyPostPublic[]
  readonly noticias: readonly CompanyPostPublic[]
}

export interface CompanyReviewPublic {
  readonly id: string
  readonly rating: number
  readonly comment: string | null
  readonly fecha: string
  readonly clienteNombre: string
}

export interface CompanyReviewsPublic {
  readonly promedio: number | null
  readonly total: number
  readonly items: readonly CompanyReviewPublic[]
}

export interface CompanyOwnReview {
  readonly rating: number
  readonly comment: string | null
}

export interface CompanyExcursionPublic {
  readonly id: string
  readonly nombre: string
  readonly slug: string
  readonly portadaUrl: string | null
  readonly categoria: string | null
  readonly moneda: string
  readonly duracionMin: number | null
  readonly ubicacion: string | null
  readonly precioDesde: number | null
  readonly agotadaGlobal: boolean
  readonly todasFechasPasadas: boolean
}

export interface SucursalPublic {
  id: string
  nombre: string
  direccion: string
  telefono: string | null
  latitud: number | null
  longitud: number | null
  ciudadTexto: string | null
  sectorTexto: string | null
  ubicacionVerificada: boolean
  horarioDetallado: unknown
}

export interface EvaluacionRequisitos {
  canProceed: boolean
  missingRequirements: unknown[]
  nextAction: string | null
}

// --- Exploración ---
export interface ExplorarResponse {
  empresas: CompanyPublic[]
  categorias: CategoryPublic[]
  seguidasIds: string[]
}

export interface EmpresaResumen {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  colorPrimario?: string | null
  type: string
  bannerUrl: string | null
  ciudad: string | null
  descripcion: string | null
  totalMembersCount: number
  activePromotionsCount: number
  isFeatured: boolean
  desdePlan: unknown
  [key: string]: unknown
}

export interface NovedadInicio {
  id: string
  tipo: 'PROMOCION' | 'EVENTO' | 'NOTICIA' | 'BENEFICIO'
  titulo: string
  companyName: string
  companySlug: string
  fecha: string
  href: string
  imagenUrl: string | null
  resumen: string | null
  descuento: string | null
  vence: string | null
}

export interface InteresesResponse {
  categorias: CategoryOption[]
  seleccion: string[]
}

export interface PerfilClienteResponse {
  readonly cliente: {
    readonly id: string
    readonly nombre: string
    readonly email: string | null
    readonly telefono: string | null
    readonly companyId: string
  } | null
  readonly email: string
  readonly vehiculos: readonly unknown[]
  readonly memberships: readonly unknown[]
  readonly resumen: {
    readonly activas: number
    readonly vencidas: number
    readonly total: number
  }
}

export interface CuentaMembresia {
  readonly id: string
  readonly companyId: string
  readonly companyName: string
  readonly companySlug: string
  readonly companyLogoUrl: string | null
  readonly companyColorPrimario: string | null
  readonly planId: string
  readonly planNombre: string
  readonly planPrecio?: number
  readonly planEsIlimitado: boolean
  readonly planLavadosIncluidos: number | null
  readonly estado: string
  readonly fechaInicio: string
  readonly fechaVencimiento: string | null
  readonly lavadosRestantes: number | null
  readonly qrToken: string | null
}

export interface MembresiasResponse {
  readonly membresias: readonly CuentaMembresia[]
  readonly activas: readonly CuentaMembresia[]
  readonly porVencer: readonly CuentaMembresia[]
  readonly vencidas: readonly CuentaMembresia[]
  readonly puntos: number | null
}

export interface CuentaPagoDetalle {
  readonly id: string
  readonly estado: string
  readonly fechaVencimiento: string | null
  readonly plan: { id: string; nombre: string; precio: number; vigenciaDias: number }
  readonly planSolicitado: { id: string; nombre: string; precio: number; vigenciaDias: number } | null
  readonly company: { id: string; name: string; logoUrl: string | null; colorPrimario: string | null }
  readonly tieneComprobante: boolean
  readonly comprobanteNota: string | null
  readonly rechazadoReason: string | null
  readonly metodoPago: { id: string; nombre: string; tipo: string } | null
}

export interface CuentaPagoResponse {
  readonly membresia: CuentaPagoDetalle
  readonly pago: {
    importeAPagar: number
    descuentoBienvenida: number
    transferenciaActiva: boolean
    cuentas: {
      id: string
      nombre: string
      titular: string | null
      numeroCuenta: string | null
      tipoCuenta: string | null
      instrucciones: string | null
    }[]
    metodosDisponibles: string[]
  } | null
}

export interface SolicitarMembresiaBody {
  readonly planId: string
  readonly vehicleId?: string
}

export interface SolicitarMembresiaResponse {
  readonly success: true
  readonly membershipId: string
}

export interface CambioPlanResponse {
  readonly success: true
  readonly membershipId: string
  readonly importeAPagar: number
}

export interface SubidaComprobanteResponse {
  readonly subida: { readonly path: string; readonly token: string }
}

export type CercanoItem = JsonObject
export interface ResultadoCercanos {
  resultados: CercanoItem[]
  hayMas: boolean
  total: number
  ubicacion: {
    contexto: string
    lat: number
    lng: number
    etiqueta: string
    radioKm: number
    cityId: string | null
    sectorId: string | null
  }
}

export interface SugerenciaUbicacion {
  id: string
  tipo: 'ciudad' | 'sector' | 'direccion'
  etiqueta: string
  contexto: string
  lat: number | null
  lng: number | null
  cityId?: string
  sectorId?: string
}

export interface BuscarParams {
  q?: string
  cat?: string
  emp?: string
  fd?: string
  fh?: string
  stock?: string | number
  p?: string | number
}

export interface BuscadorUnificadoResult {
  promociones: PromotionPublic[]
  excursiones: ExcursionCardData[]
  empresas: EmpresaResumen[]
}

// --- Empresa detalle ---
export interface EmpresaDetalleResponse {
  company: CompanyPublic
  stats: CompanyStats | null
  planes: PlanPublic[]
  promotions: PromotionPublic[]
  posts: CompanyPostsPublic | null
  resenas: CompanyReviewsPublic
  puedeOpinar: boolean
  miResena: CompanyOwnReview | null
  excursiones: readonly CompanyExcursionPublic[]
  sucursales: SucursalPublic[]
  esCliente: boolean
  sigo: boolean
  esFavorita?: boolean
}

// --- Promociones ---
export interface PromocionesParams {
  q?: string
  categoria?: string
  empresa?: string
}

export interface PromocionesResponse {
  feed: PromoFeed | null
  guardadas: PromotionPublic[]
  categorias: CategoryPublic[]
  resultados: PromotionPublic[]
  buscando: boolean
  guardadasIds: string[]
}

export interface PromocionDetalleResponse {
  promotion: PromotionPublic
  esMiEmpresa: boolean
  limite: { limite: number | null; adquiridas: number; alcanzado: boolean }
}

// --- Planes ---
export interface PlanesGlobalResponse {
  modo: 'global'
  planes: PlanGlobalItem[]
  categorias: CategoryPublic[]
}

export interface PlanesEmpresaResponse {
  modo: 'empresa'
  planes: PlanEmpresaItem[]
  requisitos: EvaluacionRequisitos
  vitrina: boolean
  planesPublicados: number
  requiereVehiculo: boolean
  empresa?: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    colorPrimario: string | null
    ciudad: string | null
    moneda: string
    idioma: string
    averageRating: number | null
  }
  cliente: {
    nombre: string | null
    empresaNombre: string
    membership: {
      id: string
      estado: string
      planId: string
      planIdSolicitado: string | null
      plan: { id: string; nombre: string; precio: number; vigenciaDias: number }
      planSolicitado: { nombre: string } | null
    } | null
  } | null
}

export type PlanesResponse = PlanesGlobalResponse | PlanesEmpresaResponse

// --- Mis promociones ---
export interface CompraItem {
  id: string
  estado: string
  usosRestantes: number
  usosIncluidos: number
  createdAt: string
  promocion: { titulo: string; imagenUrl: string | null; tipo: string } | null
  company: { name: string; colorPrimario: string | null } | null
}

export interface RegaloClienteItem {
  invitadoId: string
  codigo: string
  titulo: string
  usosPorPeriodo: number
  periodo: string
  vigenciaHasta: string | null
  usosPeriodo: number
  empresaColorPrimario: string | null
}

export interface MisPromocionesResponse {
  compras: CompraItem[]
  regalos: RegaloClienteItem[]
  historial: CompraItem[]
  resumen: { activas: number; pendientes: number; usosDisponibles: number }
}

export interface MisPromocionDetalle {
  id: string
  clienteId: string
  companyId: string
  estado: string
  usosRestantes: number
  usosIncluidos: number
  precioCongelado: number
  createdAt: string
  fechaActivacion: string | null
  fechaVencimiento: string | null
  comprobanteUrl: string | null
  comprobanteNota: string | null
  rechazadoReason: string | null
  promocion: PromotionPublic | null
  company: { name: string; zonaHoraria: string; colorPrimario: string | null }
  metodoPago: unknown | null
  transiciones: unknown[]
  qr: unknown | null
  campanaPaso: { orden: number; campanaId: string; campana: { nombre: string } } | null
}

export interface AgendarPromocionBody {
  fecha: string
  hora: string
  vehiculoId?: string
  servicio?: string
}

export interface AgendarPromocionResponse {
  success: true
  cita: { id: string; estado: string }
  mensaje: string
}

export interface RegaloInvitadoResponse {
  invitadoId: string
  titulo: string
  descripcion: string
  empresa: string
  empresaColorPrimario: string | null
  vigente: boolean
  periodo: string
  periodoLabel: string
  usosPorPeriodo: number
  usosPeriodo: number
  restantes: number
  vigenciaHasta: string | null
  qrToken: string | null
  reclamadaAt: string | null
}

// --- Citas ---
export interface CitaItem {
  id: string
  inicio: string
  estado: string
  servicio: string | null
  vehiculo: { marca: string; modelo: string } | null
  sucursal: { nombre: string } | null
  company: { name: string; zonaHoraria: string; idioma: string }
}

export interface AgendaConfigData {
  id: string
  activa: boolean
  duracionMin: number
  maxPorSlot: number
  maxPorDia: number
  anticipacionHoras: number
  ventanaDias: number
  autoConfirmar: boolean
  notas: string | null
  horarios: unknown
}

export interface DisponibilidadDia {
  ymd: string
  cerrado: boolean
  limiteDiaAlcanzado: boolean
  slots: { hm: string; inicioIso: string; libres: number; vencido: boolean }[]
}

export interface CitasResponse {
  citas: CitaItem[]
  agenda: AgendaConfigData | null
  dias: { ymd: string; etiquetaCerrado: string }[]
  disponibilidad: DisponibilidadDia | null
  vehiculos: { id: string; marca: string; modelo: string }[]
  empresa: { name: string; zonaHoraria: string }
}

export interface CrearCitaBody {
  fecha: string
  hora: string
  vehiculoId?: string
  servicio?: string
  compraId?: string
}

export interface CrearCitaResponse {
  success: true
  mensaje: string
  cita: { id: string; estado: string }
}

// --- Excursiones ---
export interface ExcursionCardData {
  id: string
  nombre: string
  slug: string
  descripcion: string | null
  portadaUrl: string | null
  categoria: string | null
  duracionMin: number | null
  ubicacion: string | null
  precioDesde: number | null
  moneda: string
  agotadaGlobal: boolean
  todasFechasPasadas: boolean
  cupoDisponible: number | null
  proximasSalidas: { fecha: string; cupoDisponible: number | null; fechaPasada: boolean; agotada: boolean }[]
  empresa: { id: string; slug: string; name: string; logoUrl: string | null }
}

export interface ExcursionFeed {
  misEmpresas: ExcursionCardData[]
  destacadas: ExcursionCardData[]
  nuevas: ExcursionCardData[]
  proximasSalidas: ExcursionCardData[]
}

export interface ExcursionesParams {
  q?: string
  categoria?: string
  empresa?: string
  stock?: string | number
}

export interface ExcursionesResponse {
  categorias: { slug: string; name: string }[]
  feed: ExcursionFeed | null
  resultados: ExcursionCardData[] | null
}

export type ExcursionPublica = JsonObject
export interface BuscarExcursionesResponse {
  excursiones: ExcursionPublica[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
  categorias: string[]
  empresas: { id: string; slug: string; name: string; logoUrl: string | null }[]
}

export interface ReservaExcursionItem {
  id: string
  numero: string
  estado: string
  fecha: string
  hora: string
  adultos: number
  ninos: number
  total: number
  moneda: string
  excursion: { id: string; nombre: string; slug: string; portadaUrl: string | null }
}

export interface MisExcursionesResponse {
  reservas: ReservaExcursionItem[]
}

export interface MiExcursionDetalle {
  reserva: unknown
  excursion: unknown
  variante: unknown
  saldo: { pagado: number; saldo: number; liquidada: boolean }
  checkinToken: string | null
  checkinAt: string | null
  checkinPorId: string | null
}

// --- Cuenta: pagos ---
export interface PagoMembership {
  id: string
  estado: string
  planNombre: string
  montoPagado: number
  fechaInicio: string
  fechaVencimiento: string
  createdAt: string
  comprobanteUrl: string | null
  comprobanteNota: string | null
  rechazadoReason: string | null
  metodoPagoNombre: string | null
  planSolicitadoNombre: string | null
}

export interface PagoHistorialItem {
  id: string
  tipo: 'APROBADO' | 'RECHAZADO'
  fecha: string
  monto: number
  motivo: string | null
  planNombre: string | null
  metodoPagoNombre: string | null
  comprobanteUrl: string | null
  validadoPor: string | null
}

export interface PagosResponse {
  membership: PagoMembership | null
  historial: PagoHistorialItem[]
}

// --- Cuenta: vehículos ---
export interface VehiculoItem {
  id: string
  marca: string
  modelo: string
  anio: number
  color: string
  placa: string
  esPrincipal: boolean
  categoria: string | null
  empresaNombre: string | null
  membresias: { id: string; planNombre: string; empresaNombre: string }[]
}

export interface VehiculosResponse {
  vehiculos: VehiculoItem[]
}

export interface VehiculoTipo {
  id: string
  nombre: string
  descripcion: string | null
  iconoUrl: string | null
}

export interface VehiculoTiposResponse {
  empresas: {
    id: string
    nombre: string
    tipos: VehiculoTipo[]
  }[]
  empresaActualId: string | null
}

export interface CrearVehiculoBody {
  companyId: string
  tipoVehiculoId: string
  marca: string
  modelo: string
  anio: number
  color: string
  placa: string
  pais?: string
}

export interface CrearVehiculoResponse {
  success: true
  vehiculoId: string
}

// --- Cuenta: ajustes ---
export interface AjustesCliente {
  id: string
  nombre: string
  email: string | null
  telefono: string | null
  avatarUrl: string | null
  fechaNacimiento: string | null
  ciudad: string | null
  genero: string | null
  notifPromos: boolean
  notifRecordatorios: boolean
  companyId: string
  company: { id: string; name: string; slug: string; type: string; logoUrl: string | null } | null
  vehiculos: unknown[]
}

export interface AjustesResponse {
  cliente: AjustesCliente | null
  prefs: { moneda: string; idioma: string; zonaHoraria: string } | null
  ubicacion: { zona: string | null } | null
  idMembego: string | null
}

export interface ActualizarAjustesBody {
  nombre: string
  telefono?: string
  avatarUrl?: string
  fechaNacimiento?: string
  ciudad?: string
  genero?: string
  notifPromos?: boolean
  notifRecordatorios?: boolean
}

// --- Cuenta: ayuda ---
export interface AyudaResponse {
  temas: { id: string; pregunta: string; respuesta: string; orden: number }[]
  tickets: {
    id: string
    asunto: string
    estado: string
    categoria: string | null
    updatedAt: string
    mensajes: unknown
    empresaNombre: string | null
  }[]
  contacto: {
    empresaNombre: string
    whatsappUrl: string | null
    whatsappNumero: string | null
    correo: string | null
    horario: string | null
  }
  onboarding: {
    items: { key: string; label: string; done: boolean; href: string; cta: string }[]
    completados: number
    total: number
  } | null
}

export interface TicketAyudaResponse {
  ticket: {
    id: string
    asunto: string
    estado: string
    categoria: string | null
    adjuntoUrl: string | null
    createdAt: string
    updatedAt: string
    empresa: { id: string; name: string } | null
    mensajes: { id: string; autorTipo: string; autorNombre: string; cuerpo: string; createdAt: string }[]
  }
}

export interface CrearTicketAyudaBody {
  asunto: string
  descripcion: string
  categoria: string
}

export interface CrearTicketAyudaResponse {
  success: true
  ticketId: string
  message: string
}

// --- Social: referidos ---
export interface CampanaInfo {
  id: string
  titulo: string
  slug: string
  bannerUrl: string | null
  imagenUrl: string | null
  beneficioInvitado: string | null
  fechaFin: string | null
}

export interface ReferidosResponse {
  campanas: {
    company: { id: string; name: string; slug: string; logoUrl: string | null }
    campana: CampanaInfo
  }[]
  elegida: {
    company: { id: string; name: string; slug: string; logoUrl: string | null }
    campana: CampanaInfo
    codigo: string
    inviteUrl: string
    mensajeCompartir: string
    stats: {
      invitacionesEnviadas: number
      personasRegistradas: number
      recompensasObtenidas: number
      beneficiosActivos: number
    }
    invitados: {
      id: string
      estado: string
      recompensaAplicada: boolean
      createdAt: string
      nombre: string
    }[]
  } | null
}

// --- Social: regalos ---
export interface RegaloItem {
  id: string
  tipo: string
  estado: string
  usos: number
  mensaje: string | null
  beneficio: string | null
  contraparte: string | null
  espera: 'RESPUESTA' | 'PAGO' | null
  pago: { referencia: string; href: string; estado: string; pagado: boolean } | null
  expiraAt: string | null
  createdAt: string
  resueltoAt: string | null
}

export interface GiftCardItem {
  id: string
  codigo: string
  estado: string
  monto: number
  saldo: number
  rol: 'RECIBIDA' | 'COMPRADA'
  contraparte: string | null
  mensaje: string | null
  createdAt: string
  activadaAt: string | null
}

export interface RegalosResponse {
  recibidos: RegaloItem[]
  enviados: RegaloItem[]
  pendientesRecibidos: number
  giftCards: GiftCardItem[]
}

export interface RegaloActionBody {
  regaloId: string
  decision: 'aceptar' | 'rechazar' | 'cancelar'
}

export interface RegaloActionResponse {
  success: true
  detalle?: string
}

export interface EnviarRegaloBody {
  origen: 'COMPRA' | 'MEMBRESIA'
  origenId: string
  destinatarioId?: string
  destinatarioContacto?: string
  usos: number
  mensaje?: string
}

export interface EnviarRegaloResponse {
  success: true
  detalle: string
}

export interface GiftcardConfigResponse {
  permitirGiftCards: boolean
  giftCardMontoMin: number
  giftCardMontoMax: number
}

export interface RegalarBody {
  tipo: 'PROMOCION' | 'PLAN'
  promocionId?: string
  planId?: string
  destinatarioId: string
  mensaje?: string
}

export interface RegalarResponse {
  success: true
  compraId?: string
  referencia?: string
  detalle: string
}

// --- Social: ruleta ---
export interface RuletaResponse {
  saldo: number
  costo: number
  premios: { id: string; nombre: string; tipo: 'PROMOCION' | 'NADA'; color: string }[]
  jugadas: { id: string; premioNombre: string; gano: boolean; createdAt: string }[]
  gamificacion: {
    puntos: number
    gastados: number
    saldo: number
    hayRuleta: boolean
    nivel: { nivel: number; nombre: string; color: string }
    siguiente: { nombre: string; min: number } | null
    progreso: number
    faltan: number
    logros: unknown[]
    stats: unknown
  }
  color: string
}

export interface GirarRuletaResponse {
  ok: boolean
  gano?: boolean
  premioId?: string
  premioNombre?: string
  enWallet?: boolean
  saldoRestante?: number
  error?: string
}

// --- Social: celebración / bienvenida ---
export interface CelebracionResponse {
  beneficio: string | null
  compraId: string | null
}

export interface BienvenidaResponse {
  onboarding: {
    items: { key: string; label: string; done: boolean; href: string; cta: string }[]
    completados: number
    total: number
  }
  nombre: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | undefined | null

function qs(params?: object): string {
  if (!params) return ''
  const entries = Object.entries(params as Record<string, QueryValue>).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (entries.length === 0) return ''
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchBff<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const api = {
  // --- Base (existentes) ---
  getInicio: (categoria?: string | null) =>
    fetchBff<any>(`/api/v1/cliente/inicio${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ''}`),
  getQr: (id?: string) => fetchBff<any>(`/api/v1/cliente/qr${id ? `?id=${encodeURIComponent(id)}` : ''}`),
  getPerfil: () => fetchBff<PerfilClienteResponse>('/api/v1/cliente/perfil'),
  getMenu: () => fetchBff<any>('/api/v1/cliente/menu'),
  getMembresias: () => fetchBff<MembresiasResponse>('/api/v1/cliente/membresias'),
  getMembresiaPago: (membershipId: string) =>
    fetchBff<CuentaPagoResponse>(`/api/v1/cliente/membresias/${encodeURIComponent(membershipId)}`),
  solicitarMembresia: (body: SolicitarMembresiaBody) =>
    postJson<SolicitarMembresiaResponse>('/api/v1/cliente/membresias', body),
  solicitarCambioPlan: (membershipId: string, planId: string) =>
    postJson<CambioPlanResponse>(
      `/api/v1/cliente/membresias/${encodeURIComponent(membershipId)}/cambios-plan`,
      { planId }
    ),
  prepararSubidaComprobante: (membershipId: string, extension: string) =>
    postJson<SubidaComprobanteResponse>(
      `/api/v1/cliente/membresias/${encodeURIComponent(membershipId)}/comprobante`,
      { extension }
    ),
  enviarComprobanteMembresia: (
    membershipId: string,
    body: { path: string; metodoPagoId?: string; nota?: string }
  ) =>
    postJson<{ success: true }>(
      `/api/v1/cliente/membresias/${encodeURIComponent(membershipId)}/comprobante`,
      body
    ),
  getHistorial: (page?: number) => fetchBff<any>(`/api/v1/cliente/historial?page=${page ?? 1}`),

  // --- Exploración ---
  getExplorar: (params?: { q?: string; category?: string }) =>
    fetchBff<ExplorarResponse>(`/api/v1/cliente/explorar${qs(params)}`),
  getBuscar: (params?: BuscarParams) =>
    fetchBff<BuscadorUnificadoResult>(`/api/v1/cliente/buscar${qs(params)}`),
  getNovedades: () => fetchBff<{ novedades: NovedadInicio[] }>('/api/v1/cliente/novedades'),
  getIntereses: () => fetchBff<InteresesResponse>('/api/v1/cliente/intereses'),
  guardarIntereses: (categoryIds: string[]) =>
    postJson<{ success: true }>('/api/v1/cliente/intereses', { categoryIds }),
  getGeoCercanos: (params?: Record<string, QueryValue>) =>
    fetchBff<ResultadoCercanos>(`/api/v1/cliente/geo/cercanos${qs(params)}`),
  getGeoAutocompletar: (params?: { q?: string; cityId?: string }) =>
    fetchBff<{ sugerencias: SugerenciaUbicacion[] }>(`/api/v1/cliente/geo/autocompletar${qs(params)}`),

  // --- Empresa / catálogo ---
  getEmpresa: (slug: string) =>
    fetchBff<EmpresaDetalleResponse>(`/api/v1/cliente/empresas/${encodeURIComponent(slug)}`),
  guardarResenaEmpresa: (slug: string, body: CompanyOwnReview) =>
    postJson<{ success: true }>(
      `/api/v1/cliente/empresas/${encodeURIComponent(slug)}/resena`,
      body
    ),
  toggleFavoritaEmpresa: (slug: string) =>
    postJson<{ following?: boolean; esFavorita?: boolean; error?: string }>(
      `/api/v1/cliente/empresas/${encodeURIComponent(slug)}`,
      { accion: 'favorita' }
    ),
  toggleSeguirEmpresa: (slug: string) =>
    postJson<{ following?: boolean; esFavorita?: boolean; error?: string }>(
      `/api/v1/cliente/empresas/${encodeURIComponent(slug)}`,
      { accion: 'seguir' }
    ),
  getPromociones: (params?: PromocionesParams) =>
    fetchBff<PromocionesResponse>(`/api/v1/cliente/promociones${qs(params)}`),
  getPromocion: (id: string) =>
    fetchBff<PromocionDetalleResponse>(`/api/v1/cliente/promociones/${encodeURIComponent(id)}`),
  getPlanes: (params?: { todos?: string | number; q?: string; categoria?: string; membershipId?: string }) =>
    fetchBff<PlanesResponse>(`/api/v1/cliente/planes${qs(params)}`),

  // --- Mis promociones ---
  getMisPromociones: () => fetchBff<MisPromocionesResponse>('/api/v1/cliente/mis-promociones'),
  getMisPromocion: (id: string) =>
    fetchBff<MisPromocionDetalle>(`/api/v1/cliente/mis-promociones/${encodeURIComponent(id)}`),
  agendarPromocion: (id: string, body: AgendarPromocionBody) =>
    postJson<AgendarPromocionResponse>(`/api/v1/cliente/mis-promociones/${encodeURIComponent(id)}/agendar`, body),
  getRegaloInvitado: (invitadoId: string) =>
    fetchBff<RegaloInvitadoResponse>(`/api/v1/cliente/mis-promociones/regalo/${encodeURIComponent(invitadoId)}`),
  reclamarRegaloInvitado: (invitadoId: string) =>
    postJson<RegaloInvitadoResponse>(`/api/v1/cliente/mis-promociones/regalo/${encodeURIComponent(invitadoId)}`, {}),

  // --- Citas ---
  getCitas: (fecha?: string) =>
    fetchBff<CitasResponse>(`/api/v1/cliente/citas${qs({ fecha })}`),
  crearCita: (body: CrearCitaBody) => postJson<CrearCitaResponse>('/api/v1/cliente/citas', body),
  cancelarCita: (citaId: string) =>
    fetchBff<{ success: true; mensaje: string }>('/api/v1/cliente/citas', {
      method: 'DELETE',
      body: JSON.stringify({ citaId }),
    }),

  // --- Excursiones ---
  getExcursiones: (params?: ExcursionesParams) =>
    fetchBff<ExcursionesResponse>(`/api/v1/cliente/excursiones${qs(params)}`),
  buscarExcursiones: (params?: BuscarParams) =>
    fetchBff<BuscarExcursionesResponse>(`/api/v1/cliente/excursiones/buscar${qs(params)}`),
  getMisExcursiones: () => fetchBff<MisExcursionesResponse>('/api/v1/cliente/mis-excursiones'),
  getMiExcursion: (reservaId: string) =>
    fetchBff<MiExcursionDetalle>(`/api/v1/cliente/mis-excursiones/${encodeURIComponent(reservaId)}`),

  // --- Cuenta: pagos ---
  getPagos: () => fetchBff<PagosResponse>('/api/v1/cliente/pagos'),
  comprarPromocion: (promotionId: string) =>
    parseCardnetResponse(
      postJson<unknown>(`/api/v1/cliente/promociones/${encodeURIComponent(promotionId)}/comprar`, {}),
      cardnetPromotionPurchaseSchema
    ),
  startCardnetSession: (input: CardnetSessionTarget) => {
    const body =
      input.kind === 'membership'
        ? {
            membershipId: input.membershipId,
            ...(input.guardarParaRenovacion === undefined
              ? {}
              : { guardarParaRenovacion: input.guardarParaRenovacion }),
          }
        : { compraId: input.compraId }

    return parseCardnetResponse(
      postJson<unknown>('/api/v1/cliente/pagos/cardnet/sesion', body),
      cardnetSessionStartResponseSchema
    )
  },
  confirmCardnetCapture: (input: {
    readonly sessionId: string
    readonly captureNonce: string
    readonly token: string
  }) =>
    parseCardnetResponse(
      postJson<unknown>('/api/v1/cliente/pagos/cardnet/confirmar', input),
      cardnetPaymentStatusSchema
    ),
  getCardnetStatus: (sessionId: string) =>
    parseCardnetResponse(
      fetchBff<unknown>(
        `/api/v1/cliente/pagos/cardnet/estado?sessionId=${encodeURIComponent(sessionId)}`
      ),
      cardnetPaymentStatusSchema
    ),
  activateCardnetProfile: (input: { readonly sessionId: string; readonly activationCode: string }) =>
    parseCardnetResponse(
      postJson<unknown>('/api/v1/cliente/pagos/cardnet/activar', input),
      cardnetPaymentStatusSchema
    ),

  // --- Cuenta: vehículos ---
  getVehiculos: () => fetchBff<VehiculosResponse>('/api/v1/cliente/vehiculos'),
  crearVehiculo: (body: CrearVehiculoBody) =>
    postJson<CrearVehiculoResponse>('/api/v1/cliente/vehiculos', body),
  getVehiculoTipos: () => fetchBff<VehiculoTiposResponse>('/api/v1/cliente/vehiculos/tipos'),

  // --- Cuenta: ajustes ---
  getAjustes: () => fetchBff<AjustesResponse>('/api/v1/cliente/ajustes'),
  actualizarAjustes: (body: ActualizarAjustesBody) =>
    postJson<{ success: true }>('/api/v1/cliente/ajustes', body),

  // --- Cuenta: ayuda ---
  getAyuda: () => fetchBff<AyudaResponse>('/api/v1/cliente/ayuda'),
  crearTicketAyuda: (body: CrearTicketAyudaBody) =>
    postJson<CrearTicketAyudaResponse>('/api/v1/cliente/ayuda', body),
  getTicketAyuda: (id: string) =>
    fetchBff<TicketAyudaResponse>(`/api/v1/cliente/ayuda/${encodeURIComponent(id)}`),

  // --- Social: referidos ---
  getReferidos: (empresa?: string) =>
    fetchBff<ReferidosResponse>(`/api/v1/cliente/referidos${qs({ empresa })}`),

  // --- Social: regalos ---
  getRegalos: () => fetchBff<RegalosResponse>('/api/v1/cliente/regalos'),
  procesarRegalo: (body: RegaloActionBody) =>
    postJson<RegaloActionResponse>('/api/v1/cliente/regalos/accion', body),
  enviarRegalo: (body: EnviarRegaloBody) =>
    postJson<EnviarRegaloResponse>('/api/v1/cliente/regalos/enviar', body),
  getGiftcardConfig: () => fetchBff<GiftcardConfigResponse>('/api/v1/cliente/regalos/giftcard'),
  regalar: (body: RegalarBody) => postJson<RegalarResponse>('/api/v1/cliente/regalos/regalar', body),

  // --- Social: ruleta ---
  getRuleta: () => fetchBff<RuletaResponse>('/api/v1/cliente/ruleta'),
  girarRuleta: () => postJson<GirarRuletaResponse>('/api/v1/cliente/ruleta', {}),

  // --- Social: celebración / bienvenida ---
  getCelebracion: () => fetchBff<CelebracionResponse>('/api/v1/cliente/celebracion'),
  getBienvenida: () => fetchBff<BienvenidaResponse>('/api/v1/cliente/bienvenida'),
}
