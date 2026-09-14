import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { generarJuego } from './demo/imagenes.mjs'

/**
 * CINCO EMPRESAS DEMO CON TODO LLENO — para ver el marketplace como será.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SIEMBRA
 *
 * Cinco negocios de rubros distintos, cada uno con su perfil público completo
 * (sin un campo visible vacío), 3 membresías, 5 promociones, 1 oferta
 * relámpago, 5 reseñas con comentario, galería e imágenes generadas con su
 * paleta. El de tours trae además 3 excursiones con variantes. Con esto, cada
 * sección del Inicio y cada perfil tienen contenido real que mirar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DECISIONES QUE CONVIENE SABER
 *
 * · `esDemo: false` A PROPÓSITO. La vitrina pública excluye `esDemo: true`
 *   (EMPRESA_PUBLICA), así que marcarlas demo las haría invisibles — y verlas
 *   es el único motivo de que existan. El sello de reconocimiento es el slug:
 *   todas empiezan por `demo-`, y `--limpiar` las retira por ese prefijo.
 *   Esto SOLO es aceptable porque la base es desechable (confirmado por el
 *   usuario); en producción estas filas serían contenido falso.
 *
 * · Idempotente: correrlo dos veces deja lo mismo, no lo duplica. La empresa
 *   se upserta por slug y sus hijos se recrean de cero en cada corrida.
 *
 * · Los contadores denormalizados (miembros, promos activas, valoración) se
 *   escriben con valores coherentes con lo sembrado: son los que las tarjetas
 *   públicas leen.
 *
 * USO
 *   node --env-file=.env.local --import tsx scripts/sembrar-demo.mts
 *   node --env-file=.env.local --import tsx scripts/sembrar-demo.mts --limpiar
 */

const ref = 'ybzhvfmybyyomwpjpaud'
const direct = process.env.DIRECT_URL ?? ''
assert.ok(new URL(direct).username.endsWith(`.${ref}`), 'Solo contra la base desechable confirmada.')
const db = new PrismaClient({ datasourceUrl: direct, log: [] })

const DIR_PUBLICO = join(process.cwd(), 'public', 'demo')
const TZ = 'America/Santo_Domingo'
const dias = (n: number) => new Date(Date.now() + n * 86_400_000)
const horas = (n: number) => new Date(Date.now() + n * 3_600_000)

// ── Personas que reseñan (compartidas entre negocios) ───────────────────────
const PERSONAS = [
  'Starlin Paulino', 'María Rodríguez', 'Carlos Guzmán', 'Yolanda Peña',
  'Luis Alberto Cedeño', 'Rosanna Martínez', 'Pedro Castillo', 'Karina Santana',
]

interface PromoDemo {
  slug: string
  titulo: string
  descripcion: string
  tipo: string
  descuento: number | null
  codigo: string | null
  tags: string[]
  destacada?: number
  comprable?: { precio: number; usosPorCompra: number; limitePorCliente: number | null; maxCanjes: number | null; canjes: number }
  vistas: number
  compartidas: number
}

interface EmpresaDemo {
  slug: string
  nombre: string
  iniciales: string
  tipo: string
  rubro: string
  categoriaSlug: string
  descripcion: string
  paleta: { c1: string; c2: string }
  ciudad: string
  provincia: string
  direccion: string
  codigoPostal: string
  lat: number
  lng: number
  telefono: string
  whatsapp: string
  email: string
  website: string
  instagram: string
  facebook: string
  tiktok: string
  horario: string
  zonaCobertura: string
  razonSocial: string
  featuredOrder: number
  miembros: number
  bienvenida: { tipo: 'PORCENTAJE' | 'MONTO'; valor: number }
  galeria: string[]
  planes: { nombre: string; precio: number; descripcion: string; beneficios: string[]; esIlimitado: boolean; lavadosIncluidos: number; condiciones: string; color: string; vigenciaDias: number }[]
  promos: PromoDemo[]
  relampago: { slug: string; titulo: string; descripcion: string; descuento: number; precio: number; horasRestantes: number; maxCanjes: number; canjes: number }
  resenas: { persona: number; rating: number; comentario: string }[]
}

const EMPRESAS: EmpresaDemo[] = [
  {
    slug: 'demo-aquashine', nombre: 'AquaShine Car Spa', iniciales: 'AS', tipo: 'carwash',
    rubro: 'Lavado y detailing automotriz', categoriaSlug: 'lavados',
    descripcion:
      'Centro de lavado y estética automotriz con tecnología de agua reciclada y productos cerámicos. Doce años cuidando los vehículos de Higüey con equipo certificado y bahías techadas.',
    paleta: { c1: '#0284c7', c2: '#06b6d4' },
    ciudad: 'Higüey', provincia: 'La Altagracia',
    direccion: 'Av. Trejo #45, sector La Malena', codigoPostal: '23000',
    lat: 18.6152, lng: -68.708, telefono: '809-555-0134', whatsapp: '8095550134',
    email: 'contacto@aquashine.demo', website: 'https://aquashine.demo',
    instagram: '@aquashine.rd', facebook: 'AquaShineRD', tiktok: '@aquashine.rd',
    horario: 'Lun-Sáb 7:30-18:30 · Dom 8:00-13:00',
    zonaCobertura: 'Higüey centro y La Malena (a domicilio para flotas)',
    razonSocial: 'AquaShine Detailing SRL', featuredOrder: 1, miembros: 148,
    bienvenida: { tipo: 'PORCENTAJE', valor: 20 },
    galeria: ['Nuestras bahías techadas', 'Detailing cerámico', 'Equipo certificado'],
    planes: [
      { nombre: 'Silver Ilimitado', precio: 1850, descripcion: 'Lavados exteriores sin límite todo el mes, con secado a mano y aros brillados.', beneficios: ['Lavados exteriores ilimitados', 'Secado a microfibra', 'Brillado de aros', 'Aromatización de cortesía'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Un vehículo por membresía. Uso personal, no comercial.', color: '#94a3b8', vigenciaDias: 30 },
      { nombre: 'Gold Interior + Exterior', precio: 2900, descripcion: 'Todo lo de Silver más aspirado profundo, cristales interiores y tablero hidratado en cada visita.', beneficios: ['Todo lo del plan Silver', 'Aspirado profundo', 'Cristales por dentro', 'Hidratación de tablero', '1 lavado de motor al mes'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'SUV grandes con suplemento según tarifario.', color: '#f59e0b', vigenciaDias: 30 },
      { nombre: 'Platinum Cerámico', precio: 4500, descripcion: 'El cuidado completo: sellado cerámico mensual, prioridad en bahía y retiro a domicilio en el casco urbano.', beneficios: ['Todo lo del plan Gold', 'Sellado cerámico mensual', 'Turno prioritario', 'Retiro y entrega a domicilio', 'Descuento 15% en detailing premium'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Retiro a domicilio sujeto a agenda del día.', color: '#0ea5e9', vigenciaDias: 30 },
    ],
    promos: [
      { slug: 'demo-lavado-motor', titulo: 'Lavado de motor al vapor', descripcion: 'Desengrase completo al vapor con protección de conectores eléctricos. Ideal antes de vender tu vehículo o tras un viaje largo.', tipo: 'descuento', descuento: 25, codigo: 'MOTOR25', tags: ['motor', 'vapor', 'detailing'], destacada: 1, vistas: 412, compartidas: 38, comprable: { precio: 900, usosPorCompra: 1, limitePorCliente: null, maxCanjes: null, canjes: 63 } },
      { slug: 'demo-cera-2x1', titulo: '2×1 en encerado premium', descripcion: 'Trae un segundo vehículo el mismo día y el encerado del segundo va por la casa. Cera de carnauba aplicada a mano.', tipo: '2x1', descuento: null, codigo: null, tags: ['cera', 'brillo'], vistas: 355, compartidas: 22 },
      { slug: 'demo-martes-taxi', titulo: 'Happy hour de choferes', descripcion: 'Martes y miércoles de 7:30 a 10:00, lavado completo con precio especial para taxis y conductores de plataforma.', tipo: 'happy_hour', descuento: 30, codigo: null, tags: ['taxi', 'happy hour'], vistas: 264, compartidas: 15 },
      { slug: 'demo-primer-lavado', titulo: 'Primer lavado gratis', descripcion: 'Si es tu primera visita, el lavado exterior corre por nosotros. Conócenos sin compromiso.', tipo: 'servicio_gratis', descuento: null, codigo: 'BIENVENIDO', tags: ['bienvenida'], destacada: 4, vistas: 588, compartidas: 71, comprable: { precio: 0, usosPorCompra: 1, limitePorCliente: 1, maxCanjes: null, canjes: 112 } },
      { slug: 'demo-aros-gratis', titulo: 'Brillado de aros de regalo', descripcion: 'Con cualquier lavado Gold de fin de semana, el tratamiento de aros con sellante va de regalo.', tipo: 'regalo', descuento: null, codigo: null, tags: ['aros', 'fin de semana'], vistas: 198, compartidas: 9 },
    ],
    relampago: { slug: 'demo-flash-ceramico', titulo: 'Sellado cerámico -40%', descripcion: 'Solo por 36 horas: sellado cerámico de carrocería completa con garantía de 6 meses. Cupos limitados de bahía.', descuento: 40, precio: 3300, horasRestantes: 36, maxCanjes: 40, canjes: 26 },
    resenas: [
      { persona: 0, rating: 5, comentario: 'El plan ilimitado me cambió la vida, paso dos veces por semana y el carro siempre impecable.' },
      { persona: 1, rating: 5, comentario: 'El detailing cerámico quedó espectacular. Se nota que usan productos buenos.' },
      { persona: 2, rating: 4, comentario: 'Muy buen servicio, a veces hay fila los sábados pero vale la pena.' },
      { persona: 3, rating: 5, comentario: 'Me retiran el carro en casa con el plan Platinum. Comodidad total.' },
      { persona: 4, rating: 5, comentario: 'Atención de primera y el QR del pase funciona rapidísimo en caja.' },
    ],
  },
  {
    slug: 'demo-labraza', nombre: 'La Braza Grill House', iniciales: 'LB', tipo: 'restaurante',
    rubro: 'Parrilla y cocina criolla', categoriaSlug: 'gastronomia',
    descripcion:
      'Parrillada a carbón con cortes madurados y sazón criolla. Terraza al aire libre, música en vivo los viernes y el mejor mofongo de la zona este, según nuestros clientes.',
    paleta: { c1: '#dc2626', c2: '#f59e0b' },
    ciudad: 'Higüey', provincia: 'La Altagracia',
    direccion: 'C/ Duvergé #12, casi esq. Colón', codigoPostal: '23000',
    lat: 18.6139, lng: -68.7003, telefono: '809-555-0177', whatsapp: '8095550177',
    email: 'reservas@labraza.demo', website: 'https://labraza.demo',
    instagram: '@labraza.rd', facebook: 'LaBrazaGrill', tiktok: '@labraza.rd',
    horario: 'Mar-Dom 12:00-23:00 · Viernes música en vivo',
    zonaCobertura: 'Salón, terraza y delivery en Higüey centro',
    razonSocial: 'Gastronómica La Braza EIRL', featuredOrder: 2, miembros: 96,
    bienvenida: { tipo: 'MONTO', valor: 500 },
    galeria: ['La terraza', 'Cortes a la parrilla', 'Viernes en vivo'],
    planes: [
      { nombre: 'Club Foodie', precio: 950, descripcion: 'Descuento fijo en tu cuenta y una bebida de la casa en cada visita.', beneficios: ['15% de descuento en el total', 'Bebida de bienvenida', 'Acumulas puntos por visita'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Válido en consumo en salón y terraza.', color: '#f59e0b', vigenciaDias: 30 },
      { nombre: 'Parrillero VIP', precio: 1800, descripcion: 'Mesa preferente, 20% en cortes premium y postre de cortesía por pareja.', beneficios: ['Todo lo del Club Foodie', '20% en cortes premium', 'Mesa preferente sin fila', 'Postre por pareja'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Reserva con 2 horas de antelación los viernes.', color: '#dc2626', vigenciaDias: 30 },
      { nombre: 'Mesa Corporativa', precio: 5200, descripcion: 'Para equipos: hasta 6 personas con 20% fijo, factura con comprobante fiscal y menú ejecutivo entre semana.', beneficios: ['Hasta 6 comensales por visita', '20% fijo en el total', 'Menú ejecutivo Lun-Jue', 'Comprobante fiscal automático'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Titular presente en cada visita.', color: '#7c2d12', vigenciaDias: 30 },
    ],
    promos: [
      { slug: 'demo-combo-pareja', titulo: 'Combo pareja 2×1', descripcion: 'Dos platos fuertes al precio de uno, lunes a jueves. Incluye tostones o yuca frita para compartir.', tipo: '2x1', descuento: null, codigo: null, tags: ['pareja', 'combo'], destacada: 2, vistas: 690, compartidas: 84, comprable: { precio: 690, usosPorCompra: 1, limitePorCliente: null, maxCanjes: null, canjes: 145 } },
      { slug: 'demo-taco-cumple', titulo: 'Postre gratis por cumpleaños', descripcion: 'Presenta tu cédula el mes de tu cumpleaños y el postre insignia de la casa va por nosotros.', tipo: 'regalo', descuento: null, codigo: null, tags: ['cumpleaños'], vistas: 305, compartidas: 41 },
      { slug: 'demo-happy-braza', titulo: 'Happy hour de cervezas', descripcion: 'Miércoles y jueves de 5 a 8: cervezas nacionales al 2×1 en la terraza.', tipo: 'happy_hour', descuento: 50, codigo: null, tags: ['happy hour', 'terraza'], vistas: 421, compartidas: 33 },
      { slug: 'demo-mofongo-lunes', titulo: 'Lunes de mofongo -30%', descripcion: 'Nuestro mofongo con chicharrón o camarones, todos los lunes con 30% de descuento.', tipo: 'descuento', descuento: 30, codigo: 'MOFONGO', tags: ['criolla', 'lunes'], vistas: 377, compartidas: 29 },
      { slug: 'demo-chinola-refill', titulo: 'Refill de jugo de chinola', descripcion: 'Con cualquier plato fuerte, el jugo natural de chinola tiene refill ilimitado.', tipo: 'general', descuento: null, codigo: null, tags: ['jugos'], vistas: 168, compartidas: 12 },
    ],
    relampago: { slug: 'demo-flash-parrillada', titulo: 'Parrillada familiar -35%', descripcion: 'Hoy y mañana: parrillada para 4 con entrada y jarra de sangría incluida. Solo 30 mesas.', descuento: 35, precio: 2470, horasRestantes: 40, maxCanjes: 30, canjes: 19 },
    resenas: [
      { persona: 5, rating: 5, comentario: 'El corte madurado es otra cosa. Y con la membresía VIP ni fila hago.' },
      { persona: 0, rating: 4, comentario: 'La terraza los viernes con música en vivo es un plan seguro.' },
      { persona: 6, rating: 5, comentario: 'El combo pareja rinde muchísimo, salimos llenos los dos.' },
      { persona: 3, rating: 5, comentario: 'Probé el mofongo de camarones y ya no pido otra cosa.' },
      { persona: 7, rating: 4, comentario: 'Buen ambiente familiar, el refill de chinola es un golazo.' },
    ],
  },
  {
    slug: 'demo-caribeaventura', nombre: 'Caribe Aventura Tours', iniciales: 'CA', tipo: 'excursiones',
    rubro: 'Excursiones y experiencias', categoriaSlug: 'tours',
    descripcion:
      'Operador local de excursiones con guías bilingües certificados y transporte propio. Catamarán, buggies y cenotes: la zona este como la vivimos los de aquí, con tarifa de socio para residentes.',
    paleta: { c1: '#059669', c2: '#34d399' },
    ciudad: 'Punta Cana', provincia: 'La Altagracia',
    direccion: 'Plaza Turquesa, local 8, Bávaro', codigoPostal: '23301',
    lat: 18.6822, lng: -68.4055, telefono: '809-555-0242', whatsapp: '8095550242',
    email: 'hola@caribeaventura.demo', website: 'https://caribeaventura.demo',
    instagram: '@caribeaventura', facebook: 'CaribeAventuraRD', tiktok: '@caribeaventura',
    horario: 'Todos los días 7:00-19:00 · Salidas desde Bávaro e Higüey',
    zonaCobertura: 'Recogida en hoteles de Bávaro, Punta Cana y Higüey',
    razonSocial: 'Caribe Aventura Operadora SRL', featuredOrder: 3, miembros: 210,
    bienvenida: { tipo: 'PORCENTAJE', valor: 10 },
    galeria: ['Catamarán a Saona', 'Ruta en buggy', 'Cenote Hoyo Azul'],
    planes: [
      { nombre: 'Pasaporte Local', precio: 1200, descripcion: 'Tarifa de residente en todas las excursiones y prioridad en cupos de fin de semana.', beneficios: ['Tarifa residente siempre', 'Prioridad en cupos', 'Cancelación flexible 24h'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Requiere documento de residencia dominicana.', color: '#34d399', vigenciaDias: 30 },
      { nombre: 'Aventurero Plus', precio: 2400, descripcion: 'Una excursión de catálogo al mes incluida y 15% en las demás para ti y un acompañante.', beneficios: ['1 excursión mensual incluida', '15% para el acompañante', 'Fotos digitales de regalo', 'Recogida en tu zona'], esIlimitado: false, lavadosIncluidos: 1, condiciones: 'La excursión incluida se agenda con 72h.', color: '#059669', vigenciaDias: 30 },
      { nombre: 'Familia Exploradora', precio: 4900, descripcion: 'Para 2 adultos y 2 niños: dos salidas al mes con transporte y meriendas incluidas.', beneficios: ['2 salidas familiares al mes', 'Transporte puerta a puerta', 'Meriendas y aguas incluidas', 'Seguro de excursión'], esIlimitado: false, lavadosIncluidos: 2, condiciones: 'Niños hasta 12 años.', color: '#065f46', vigenciaDias: 30 },
    ],
    promos: [
      { slug: 'demo-saona-jueves', titulo: 'Saona entre semana -25%', descripcion: 'De martes a jueves el catamarán a Isla Saona baja 25% para socios. Buffet dominicano y barra incluidos.', tipo: 'descuento', descuento: 25, codigo: 'SAONA25', tags: ['saona', 'catamarán'], destacada: 3, vistas: 842, compartidas: 122, comprable: { precio: 2890, usosPorCompra: 1, limitePorCliente: null, maxCanjes: null, canjes: 87 } },
      { slug: 'demo-buggy-duo', titulo: 'Buggy doble 2×1 en asiento', descripcion: 'Comparte el buggy y el segundo asiento va gratis. Ruta por dunas, playa Macao y cueva de agua dulce.', tipo: '2x1', descuento: null, codigo: null, tags: ['buggy', 'macao'], vistas: 511, compartidas: 63 },
      { slug: 'demo-hoyo-azul-upgrade', titulo: 'Upgrade a VIP en Hoyo Azul', descripcion: 'Reservando con 7 días, tu entrada estándar sube a VIP: acceso a tirolesas y almuerzo mejorado.', tipo: 'upgrade', descuento: null, codigo: null, tags: ['cenote', 'vip'], vistas: 298, compartidas: 24 },
      { slug: 'demo-foto-drone', titulo: 'Fotos con drone de regalo', descripcion: 'En cualquier salida de catamarán, el paquete de fotos aéreas queda incluido para socios.', tipo: 'regalo', descuento: null, codigo: null, tags: ['fotos', 'drone'], vistas: 233, compartidas: 31 },
      { slug: 'demo-temporada-ballenas', titulo: 'Temporada de ballenas -15%', descripcion: 'De enero a marzo, la salida a Samaná para ver ballenas jorobadas con descuento de temporada.', tipo: 'temporada', descuento: 15, codigo: null, tags: ['samana', 'ballenas'], vistas: 187, compartidas: 18 },
    ],
    relampago: { slug: 'demo-flash-saona', titulo: 'Últimos cupos: Saona sábado', descripcion: 'Quedan cupos para el catamarán de este sábado. Precio relámpago por 30 horas con buffet y barra libre.', descuento: 30, precio: 2450, horasRestantes: 30, maxCanjes: 24, canjes: 17 },
    resenas: [
      { persona: 2, rating: 5, comentario: 'Los guías se saben cada rincón. La ruta en buggy fue lo mejor del año.' },
      { persona: 4, rating: 5, comentario: 'Con el Pasaporte Local por fin pago precio de dominicano en mi propia provincia.' },
      { persona: 1, rating: 4, comentario: 'Saona preciosa y todo puntual. El buffet podría tener más variedad.' },
      { persona: 6, rating: 5, comentario: 'Las fotos con drone que regalan quedaron de película.' },
      { persona: 0, rating: 5, comentario: 'Fuimos en familia con el plan Exploradora y los niños no paran de hablar de eso.' },
    ],
  },
  {
    slug: 'demo-bellavita', nombre: 'Bella Vita Spa & Wellness', iniciales: 'BV', tipo: 'spa',
    rubro: 'Spa, masajes y bienestar', categoriaSlug: 'bienestar',
    descripcion:
      'Spa boutique con cabinas privadas, terapeutas certificadas y línea propia de aceites. Masajes, faciales, rituales de pareja y un jardín interior para desconectarte del ruido.',
    paleta: { c1: '#9333ea', c2: '#ec4899' },
    ciudad: 'Higüey', provincia: 'La Altagracia',
    direccion: 'Av. La Altagracia #88, plaza Jardín, 2do nivel', codigoPostal: '23000',
    lat: 18.617, lng: -68.712, telefono: '809-555-0310', whatsapp: '8095550310',
    email: 'citas@bellavita.demo', website: 'https://bellavita.demo',
    instagram: '@bellavita.spa', facebook: 'BellaVitaSpaRD', tiktok: '@bellavita.spa',
    horario: 'Lun-Sáb 9:00-20:00 · Domingos solo rituales de pareja',
    zonaCobertura: 'Spa en plaza Jardín y masajes a domicilio en Higüey',
    razonSocial: 'Bella Vita Wellness SRL', featuredOrder: 4, miembros: 74,
    bienvenida: { tipo: 'PORCENTAJE', valor: 15 },
    galeria: ['Cabinas privadas', 'Ritual de aromaterapia', 'Jardín interior'],
    planes: [
      { nombre: 'Relax Mensual', precio: 2200, descripcion: 'Un masaje relajante de 60 minutos al mes y descuento en cabina para tus acompañantes.', beneficios: ['1 masaje 60 min al mes', '10% para acompañantes', 'Té de bienvenida'], esIlimitado: false, lavadosIncluidos: 1, condiciones: 'Cita previa por WhatsApp.', color: '#ec4899', vigenciaDias: 30 },
      { nombre: 'Glow Facial Club', precio: 3400, descripcion: 'Facial profundo mensual con limpieza, hidratación y máscara LED, más kit de mantenimiento.', beneficios: ['1 facial profundo al mes', 'Máscara LED incluida', 'Kit de productos mensual', '15% en tratamientos extra'], esIlimitado: false, lavadosIncluidos: 1, condiciones: 'Evaluación de piel en la primera visita.', color: '#9333ea', vigenciaDias: 30 },
      { nombre: 'Ritual Pareja', precio: 5600, descripcion: 'Ritual completo de pareja cada mes: masaje a cuatro manos, jacuzzi y copa de vino en el jardín.', beneficios: ['Ritual de pareja mensual', 'Jacuzzi privado 30 min', 'Copa de vino y fresas', 'Prioridad de domingo'], esIlimitado: false, lavadosIncluidos: 1, condiciones: 'Domingos solo con reserva de 48h.', color: '#6b21a8', vigenciaDias: 30 },
    ],
    promos: [
      { slug: 'demo-martes-spa', titulo: 'Martes de spa -30%', descripcion: 'Todos los martes, masajes descontracturantes y de piedras calientes con 30% para socias y socios.', tipo: 'descuento', descuento: 30, codigo: 'MARTES30', tags: ['masaje', 'martes'], destacada: 5, vistas: 456, compartidas: 52, comprable: { precio: 1540, usosPorCompra: 1, limitePorCliente: null, maxCanjes: null, canjes: 48 } },
      { slug: 'demo-facial-primera', titulo: 'Primer facial a mitad de precio', descripcion: 'Tu primera limpieza facial profunda al 50%, con diagnóstico de piel incluido.', tipo: 'descuento', descuento: 50, codigo: null, tags: ['facial', 'bienvenida'], vistas: 389, compartidas: 47 },
      { slug: 'demo-manicure-regalo', titulo: 'Manicure de regalo', descripcion: 'Con cualquier ritual de pareja, una sesión de manicure spa queda de regalo para cada uno.', tipo: 'regalo', descuento: null, codigo: null, tags: ['pareja', 'manicure'], vistas: 214, compartidas: 19 },
      { slug: 'demo-happy-sauna', titulo: 'Happy hour de sauna', descripcion: 'Lunes a jueves de 9 a 12, acceso al circuito de sauna y vapor con precio especial.', tipo: 'happy_hour', descuento: 40, codigo: null, tags: ['sauna', 'mañanas'], vistas: 176, compartidas: 8 },
      { slug: 'demo-cupon-madre', titulo: 'Cupón regalo Día de las Madres', descripcion: 'Compra un cupón de regalo y llévate 500 pesos extra en saldo para quien tú quieras consentir.', tipo: 'cupon', descuento: null, codigo: 'MAMA500', tags: ['regalo', 'madres'], vistas: 342, compartidas: 66 },
    ],
    relampago: { slug: 'demo-flash-piedras', titulo: 'Piedras calientes -45%', descripcion: 'Hoy: masaje de piedras volcánicas de 75 minutos a precio relámpago. Solo 12 cabinas disponibles.', descuento: 45, precio: 1650, horasRestantes: 24, maxCanjes: 12, canjes: 7 },
    resenas: [
      { persona: 1, rating: 5, comentario: 'El ritual de pareja es una experiencia completa, el jardín interior es bellísimo.' },
      { persona: 3, rating: 5, comentario: 'Salgo del facial mensual con la piel nueva. El kit que regalan es de calidad.' },
      { persona: 7, rating: 5, comentario: 'Las terapeutas saben lo que hacen. El de piedras calientes me quitó un dolor de meses.' },
      { persona: 5, rating: 4, comentario: 'Todo impecable, solo que los sábados conviene reservar temprano.' },
      { persona: 2, rating: 4, comentario: 'El happy hour de sauna entre semana es un lujo a buen precio.' },
    ],
  },
  {
    slug: 'demo-fademasters', nombre: 'Fade Masters Barbershop', iniciales: 'FM', tipo: 'barberia',
    rubro: 'Barbería y cuidado masculino', categoriaSlug: 'barberia',
    descripcion:
      'Barbería de barrio elevada a otro nivel: fades de competencia, toalla caliente, ritual de barba y una silla que no te quieres levantar. Café colao gratis mientras esperas.',
    paleta: { c1: '#1e293b', c2: '#f59e0b' },
    ciudad: 'Higüey', provincia: 'La Altagracia',
    direccion: 'C/ Agustín Guerrero #27', codigoPostal: '23000',
    lat: 18.6118, lng: -68.7042, telefono: '809-555-0455', whatsapp: '8095550455',
    email: 'citas@fademasters.demo', website: 'https://fademasters.demo',
    instagram: '@fademasters.rd', facebook: 'FadeMastersRD', tiktok: '@fademasters.rd',
    horario: 'Lun-Sáb 8:00-20:00 · Dom 9:00-14:00',
    zonaCobertura: 'Barbería en el centro; servicio a domicilio para novios y eventos',
    razonSocial: 'Fade Masters Grooming EIRL', featuredOrder: 5, miembros: 132,
    bienvenida: { tipo: 'PORCENTAJE', valor: 25 },
    galeria: ['Las sillas', 'Ritual de barba', 'El equipo de barberos'],
    planes: [
      { nombre: 'Corte Mensual', precio: 1100, descripcion: 'Dos cortes al mes con toalla caliente y perfilado de cejas incluido.', beneficios: ['2 cortes al mes', 'Toalla caliente siempre', 'Perfilado de cejas', 'Café colao de la casa'], esIlimitado: false, lavadosIncluidos: 2, condiciones: 'Cita por WhatsApp o walk-in según fila.', color: '#f59e0b', vigenciaDias: 30 },
      { nombre: 'Fade Ilimitado', precio: 1950, descripcion: 'Pásate cuando quieras: cortes ilimitados y retoque de línea entre semana sin costo.', beneficios: ['Cortes ilimitados', 'Retoques de línea gratis', 'Prioridad en fila', '10% en productos'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Uso personal e intransferible.', color: '#1e293b', vigenciaDias: 30 },
      { nombre: 'Caballero Completo', precio: 2800, descripcion: 'Ilimitado más ritual de barba quincenal, mascarilla negra y descuento en el servicio a domicilio.', beneficios: ['Todo lo del Fade Ilimitado', 'Ritual de barba quincenal', 'Mascarilla facial negra', '20% en domicilio y eventos'], esIlimitado: true, lavadosIncluidos: 0, condiciones: 'Ritual de barba con cita previa.', color: '#78350f', vigenciaDias: 30 },
    ],
    promos: [
      { slug: 'demo-fade-miercoles', titulo: 'Miércoles de fade -20%', descripcion: 'El día del barrio: todos los cortes con 20% menos, sin cita, por orden de llegada.', tipo: 'descuento', descuento: 20, codigo: null, tags: ['fade', 'miercoles'], destacada: 6, vistas: 528, compartidas: 74, comprable: { precio: 480, usosPorCompra: 1, limitePorCliente: null, maxCanjes: null, canjes: 96 } },
      { slug: 'demo-padre-hijo', titulo: 'Combo padre e hijo', descripcion: 'Corte para ti y para el muchacho el mismo día: el de él queda a mitad de precio.', tipo: 'general', descuento: null, codigo: null, tags: ['familia'], vistas: 344, compartidas: 39 },
      { slug: 'demo-barba-gratis', titulo: 'Barba gratis con tu corte', descripcion: 'Los lunes, el perfilado de barba con navaja y toalla caliente va incluido con cualquier corte.', tipo: 'servicio_gratis', descuento: null, codigo: null, tags: ['barba', 'lunes'], vistas: 402, compartidas: 45 },
      { slug: 'demo-novio-vip', titulo: 'Paquete novio VIP', descripcion: 'Para tu boda: corte, barba, facial y traslado a domicilio el día del evento, con ensayo previo.', tipo: 'vip', descuento: null, codigo: 'NOVIO', tags: ['bodas', 'domicilio'], vistas: 156, compartidas: 27 },
      { slug: 'demo-cera-upgrade', titulo: 'Upgrade de peinado con cera', descripcion: 'Con cualquier corte, sube a acabado premium con cera mate importada sin costo extra.', tipo: 'upgrade', descuento: null, codigo: null, tags: ['acabado'], vistas: 189, compartidas: 11 },
    ],
    relampago: { slug: 'demo-flash-viernes', titulo: 'Viernes de línea -50%', descripcion: 'Solo hoy: retoque de línea y cejas a mitad de precio para llegar afilado al fin de semana.', descuento: 50, precio: 250, horasRestantes: 20, maxCanjes: 50, canjes: 31 },
    resenas: [
      { persona: 6, rating: 5, comentario: 'El mejor fade de Higüey, punto. Y el café colao mientras esperas es un detalle.' },
      { persona: 0, rating: 5, comentario: 'Con el plan ilimitado voy hasta dos veces por semana. Se paga solo.' },
      { persona: 4, rating: 4, comentario: 'Los miércoles se llena, pero el descuento lo vale.' },
      { persona: 5, rating: 5, comentario: 'Contraté el paquete de novio para mi boda y quedaron todos afilados.' },
      { persona: 7, rating: 5, comentario: 'El ritual de barba con toalla caliente es otra experiencia.' },
    ],
  },
]


const CATEGORIAS = [
  { slug: 'lavados', name: 'Lavados', icon: 'local_car_wash', description: 'Car wash y detailing', order: 1 },
  { slug: 'gastronomia', name: 'Gastronomía', icon: 'restaurant', description: 'Restaurantes y cocina', order: 2 },
  { slug: 'tours', name: 'Tours', icon: 'travel_explore', description: 'Excursiones y experiencias', order: 3 },
  { slug: 'bienestar', name: 'Bienestar', icon: 'spa', description: 'Spa, salud y relax', order: 4 },
  { slug: 'barberia', name: 'Barbería', icon: 'content_cut', description: 'Cuidado masculino', order: 5 },
]

const EXCURSIONES = [
  {
    slug: 'demo-catamaran-saona', nombre: 'Catamarán a Isla Saona', duracionMin: 480,
    descripcion: 'Día completo en catamarán con parada en la piscina natural, buffet dominicano en la playa y barra de ron incluida.',
    ubicacion: 'Bayahíbe · Isla Saona', categoria: 'Catamarán', capacidad: 60,
    puntoSalida: 'Muelle de Bayahíbe (transporte desde tu hotel incluido)', horaSalida: '08:30', horaRegreso: '17:30',
    incluye: 'Transporte, buffet, barra nacional, chaleco y guía bilingüe', noIncluye: 'Fotos impresas y propinas',
    politicas: 'Cancelación gratis hasta 24 horas antes. Menores siempre con chaleco.',
    variantes: [
      { nombre: 'Estándar', precioAdulto: 3850, precioNino: 1900, capacidad: 48 },
      { nombre: 'VIP proa', precioAdulto: 5200, precioNino: 2600, capacidad: 12 },
    ],
  },
  {
    slug: 'demo-buggy-macao', nombre: 'Buggy por dunas y playa Macao', duracionMin: 240,
    descripcion: 'Ruta guiada en buggy doble por caminos rurales, cueva de agua dulce y parada para nadar en playa Macao.',
    ubicacion: 'Macao · Punta Cana', categoria: 'Aventura', capacidad: 30,
    puntoSalida: 'Base Caribe Aventura, carretera Macao km 4', horaSalida: '09:00', horaRegreso: '13:00',
    incluye: 'Buggy doble, casco, guía y agua', noIncluye: 'Bandana (a la venta en base) y consumos en Macao',
    politicas: 'Conductor con licencia vigente. Se maneja en caravana.',
    variantes: [
      { nombre: 'Buggy doble', precioAdulto: 2200, precioNino: 1100, capacidad: 24 },
      { nombre: 'Buggy familiar (4)', precioAdulto: 3900, precioNino: null, capacidad: 6 },
    ],
  },
  {
    slug: 'demo-hoyo-azul', nombre: 'Cenote Hoyo Azul y tirolesas', duracionMin: 360,
    descripcion: 'Caminata ecológica hasta el cenote de agua turquesa al pie del farallón, con circuito opcional de tirolesas.',
    ubicacion: 'Cap Cana', categoria: 'Naturaleza', capacidad: 40,
    puntoSalida: 'Entrada Scape Park, Cap Cana', horaSalida: '10:00', horaRegreso: '16:00',
    incluye: 'Entrada al cenote, guía ecológico y chaleco', noIncluye: 'Almuerzo (disponible como upgrade VIP)',
    politicas: 'Calzado cerrado obligatorio para el sendero.',
    variantes: [
      { nombre: 'Cenote', precioAdulto: 2900, precioNino: 1450, capacidad: 30 },
      { nombre: 'Cenote + tirolesas', precioAdulto: 4100, precioNino: 2050, capacidad: 10 },
    ],
  },
]

async function limpiar() {
  const empresas = await db.company.findMany({ where: { slug: { startsWith: 'demo-' } }, select: { id: true, slug: true } })
  const ids = empresas.map((e) => e.id)
  if (ids.length === 0) {
    console.log('No hay empresas demo que retirar.')
    return
  }
  await db.companyRating.deleteMany({ where: { companyId: { in: ids } } })
  // Compras (sus QR y transiciones caen en cascada), publicaciones,
  // sucursales y seguimientos: nacieron en la auditoría de datos demo y
  // referencian promos/empresas — caen ANTES que ellas.
  await db.productoCompra.deleteMany({ where: { companyId: { in: ids } } })
  await db.companyPost.deleteMany({ where: { companyId: { in: ids } } })
  await db.cita.deleteMany({ where: { companyId: { in: ids } } })
  await db.agendaConfig.deleteMany({ where: { companyId: { in: ids } } })
  await db.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await db.companyFollow.deleteMany({ where: { companyId: { in: ids } } })
  await db.cliente.deleteMany({ where: { companyId: { in: ids }, supabaseId: { startsWith: 'demo-persona-' } } })
  await db.promocion.deleteMany({ where: { companyId: { in: ids } } })
  await db.plan.deleteMany({ where: { companyId: { in: ids } } })
  await db.excursionVariante.deleteMany({ where: { companyId: { in: ids } } })
  await db.excursion.deleteMany({ where: { companyId: { in: ids } } })
  await db.companyToCategory.deleteMany({ where: { companyId: { in: ids } } })
  await db.homeRevision.deleteMany({ where: { companyId: { in: ids } } })
  await db.company.deleteMany({ where: { id: { in: ids } } })
  console.log(`Retiradas ${ids.length} empresas demo:`, empresas.map((e) => e.slug).join(', '))
}

async function sembrar() {
  // Categorías primero: las tarjetas y las píldoras del Inicio las leen.
  const categorias = new Map<string, string>()
  for (const c of CATEGORIAS) {
    const fila = await db.businessCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon, description: c.description, order: c.order, active: true },
      create: { ...c, active: true },
    })
    categorias.set(c.slug, fila.id)
  }

  for (const e of EMPRESAS) {
    // 1) Su juego de imágenes, con la paleta del negocio.
    const artes = await generarJuego({
      dir: DIR_PUBLICO,
      slug: e.slug,
      nombre: e.nombre,
      iniciales: e.iniciales,
      rubro: e.rubro,
      paleta: e.paleta,
      galeria: e.galeria,
      promos: [
        ...e.promos.map((p) => ({
          archivo: p.slug,
          titulo: p.titulo,
          sello: p.descuento ? (p.tipo === 'monto_fijo' ? `RD$${p.descuento}` : `-${p.descuento}%`) : null,
        })),
        { archivo: e.relampago.slug, titulo: e.relampago.titulo, sello: `-${e.relampago.descuento}%` },
        // Dos láminas extra por promoción destacada, para la galería del perfil.
        ...e.promos.slice(0, 5).flatMap((p) => [
          { archivo: `${p.slug}-b`, titulo: 'Así se ve', sello: null },
          { archivo: `${p.slug}-c`, titulo: 'En el local', sello: null },
        ]),
      ],
    })

    const promedio = e.resenas.reduce((s, r) => s + r.rating, 0) / e.resenas.length

    // 2) La empresa, con TODO el perfil lleno.
    const datosEmpresa = {
      name: e.nombre,
      type: e.tipo,
      description: e.descripcion,
      categoria: e.rubro,
      logoUrl: artes.logo,
      bannerUrl: artes.banner,
      galleryImages: artes.galeria,
      colorPrimario: e.paleta.c1,
      isActive: true,
      isPublished: true,
      // esDemo: false a propósito — ver la cabecera del archivo.
      esDemo: false,
      isFeatured: true,
      featuredOrder: e.featuredOrder,
      email: e.email,
      telefono: e.telefono,
      whatsapp: e.whatsapp,
      website: e.website,
      instagram: e.instagram,
      facebook: e.facebook,
      tiktok: e.tiktok,
      direccion: e.direccion,
      ciudad: e.ciudad,
      provincia: e.provincia,
      pais: 'República Dominicana',
      codigoPostal: e.codigoPostal,
      latitud: e.lat,
      longitud: e.lng,
      googleMapsUrl: `https://maps.google.com/?q=${e.lat},${e.lng}`,
      horario: e.horario,
      zonaCobertura: e.zonaCobertura,
      razonSocial: e.razonSocial,
      moneda: 'DOP',
      idioma: 'es-DO',
      zonaHoraria: TZ,
      politicaCancelacion: 'Cancela o reagenda sin costo hasta 24 horas antes de tu cita o reserva.',
      politicaPrivacidad: 'Usamos tus datos solo para operar tu membresía y avisarte de tus beneficios. Nunca los vendemos.',
      terminosEmpresa: 'Las membresías son personales. Los beneficios aplican presentando el QR activo en caja.',
      bienvenidaActiva: true,
      bienvenidaTipo: e.bienvenida.tipo,
      bienvenidaValor: e.bienvenida.valor,
      totalMembersCount: e.miembros,
      activePromotionsCount: e.promos.length + 1,
      averageRating: Number(promedio.toFixed(2)),
    }
    const empresa = await db.company.upsert({
      where: { slug: e.slug },
      update: datosEmpresa,
      create: { slug: e.slug, ...datosEmpresa },
    })

    await db.companyToCategory.deleteMany({ where: { companyId: empresa.id } })
    await db.companyToCategory.create({
      data: { companyId: empresa.id, categoryId: categorias.get(e.categoriaSlug)! },
    })

    // 3) Hijos: se recrean de cero para que la corrida sea reproducible.
    await db.companyRating.deleteMany({ where: { companyId: empresa.id } })
    await db.productoCompra.deleteMany({ where: { companyId: empresa.id } })
    await db.companyPost.deleteMany({ where: { companyId: empresa.id } })
    await db.cita.deleteMany({ where: { companyId: empresa.id } })
    await db.sucursal.deleteMany({ where: { companyId: empresa.id } })
    await db.companyFollow.deleteMany({ where: { companyId: empresa.id } })
    await db.cliente.deleteMany({ where: { companyId: empresa.id, supabaseId: { startsWith: 'demo-persona-' } } })
    await db.promocion.deleteMany({ where: { companyId: empresa.id } })
    // Los planes NO se recrean: las membresías reales que el equipo activa al
    // probar los referencian (FK) y borrarlos revienta la corrida. Se
    // actualizan por nombre, conservando el id.
    await db.excursionVariante.deleteMany({ where: { companyId: empresa.id } })
    await db.excursion.deleteMany({ where: { companyId: empresa.id } })

    for (const [i, plan] of e.planes.entries()) {
      const datosPlan = {
        precio: plan.precio,
        descripcion: plan.descripcion,
        beneficios: plan.beneficios,
        esIlimitado: plan.esIlimitado,
        lavadosIncluidos: plan.lavadosIncluidos,
        vigenciaDias: plan.vigenciaDias,
        condiciones: plan.condiciones,
        color: plan.color,
        orden: i,
        activo: true,
      }
      const previo = await db.plan.findFirst({
        where: { companyId: empresa.id, nombre: plan.nombre },
        select: { id: true },
      })
      if (previo) {
        await db.plan.update({ where: { id: previo.id }, data: datosPlan })
      } else {
        await db.plan.create({ data: { companyId: empresa.id, nombre: plan.nombre, ...datosPlan } })
      }
    }

    for (const [i, p] of e.promos.entries()) {
      await db.promocion.create({
        data: {
          companyId: empresa.id,
          slug: p.slug,
          titulo: p.titulo,
          descripcion: p.descripcion,
          tipo: p.tipo,
          descuento: p.descuento,
          codigo: p.codigo,
          tags: p.tags,
          visibilidad: 'publica',
          activo: true,
          archivada: false,
          publicadaEn: dias(-14 + i),
          vigenciaDesde: dias(-14),
          vigenciaHasta: dias(45 + i * 5),
          imagenUrl: artes.promos.get(p.slug)!,
          imagenes: [artes.promos.get(`${p.slug}-b`)!, artes.promos.get(`${p.slug}-c`)!].filter(Boolean),
          isFeatured: p.destacada != null,
          featuredOrder: p.destacada ?? null,
          prioridad: i,
          viewCount: p.vistas,
          shareCount: p.compartidas,
          ...(p.comprable
            ? {
                esComprable: true,
                precio: p.comprable.precio,
                usosPorCompra: p.comprable.usosPorCompra,
                limitePorCliente: p.comprable.limitePorCliente,
                maxCanjes: p.comprable.maxCanjes,
                canjes: p.comprable.canjes,
                beneficioVigenciaDias: 30,
              }
            : {}),
        },
      })
    }

    // La relámpago: destacada, comprable y con vigencia corta — es lo que la
    // franja del Inicio busca para encender la cuenta atrás.
    await db.promocion.create({
      data: {
        companyId: empresa.id,
        slug: e.relampago.slug,
        titulo: e.relampago.titulo,
        descripcion: e.relampago.descripcion,
        tipo: 'descuento',
        descuento: e.relampago.descuento,
        tags: ['relampago'],
        visibilidad: 'publica',
        activo: true,
        archivada: false,
        publicadaEn: horas(-6),
        vigenciaDesde: horas(-6),
        vigenciaHasta: horas(e.relampago.horasRestantes),
        imagenUrl: artes.promos.get(e.relampago.slug)!,
        imagenes: [],
        isFeatured: true,
        featuredOrder: 90 + e.featuredOrder,
        prioridad: 99,
        viewCount: 120 + e.featuredOrder * 17,
        shareCount: 14,
        esComprable: true,
        precio: e.relampago.precio,
        usosPorCompra: 1,
        limitePorCliente: 2,
        maxCanjes: e.relampago.maxCanjes,
        canjes: e.relampago.canjes,
        beneficioVigenciaDias: 15,
      },
    })

    for (const [i, r] of e.resenas.entries()) {
      const persona = PERSONAS[r.persona]!
      const cliente = await db.cliente.create({
        data: {
          companyId: empresa.id,
          supabaseId: `demo-persona-${r.persona}`,
          nombre: persona,
          email: `persona${r.persona}@demo.membego.local`,
          telefono: `809-555-9${String(r.persona).padStart(2, '0')}${i}`,
        },
      })
      await db.companyRating.create({
        data: {
          companyId: empresa.id,
          clienteId: cliente.id,
          rating: r.rating,
          comment: r.comentario,
          visible: true,
          createdAt: dias(-3 - i * 9),
        },
      })
    }

    // 4b) Publicaciones del negocio: llenan Beneficios, Eventos y Noticias
    // del perfil y alimentan las Novedades. Plantillas con los datos reales
    // de cada empresa — nada de lorem.
    const artesGaleria = artes.galeria
    const posts = [
      { tipo: 'BENEFICIO' as const, titulo: 'Prioridad de turno para miembros', contenido: `En ${e.nombre}, tu membresía te da paso preferente: enseña tu QR al llegar y el equipo te atiende antes que la fila general.`, publicadaEn: dias(-2), imagenUrl: artesGaleria[0] ?? null },
      { tipo: 'BENEFICIO' as const, titulo: 'Precio de socio todo el año', contenido: `Cada visita a ${e.nombre} con membresía activa aplica la tarifa de socio automáticamente. Sin cupones ni trámites: el QR lo hace todo.`, publicadaEn: dias(-6), imagenUrl: artesGaleria[1] ?? null },
      { tipo: 'EVENTO' as const, titulo: `Jornada de puertas abiertas en ${e.ciudad}`, contenido: `Ven a conocer ${e.nombre} por dentro: recorrido guiado, demostraciones del equipo y una sorpresa para quien active su membresía ese día.`, fechaEvento: dias(4), lugar: e.direccion, publicadaEn: dias(-3), imagenUrl: artesGaleria[2] ?? null },
      { tipo: 'EVENTO' as const, titulo: 'Noche exclusiva de socios', contenido: `Solo con membresía: una velada privada en ${e.nombre} con atención personalizada y beneficios que no publicamos en ningún otro lado.`, fechaEvento: dias(11), lugar: `${e.nombre}, ${e.ciudad}`, publicadaEn: dias(-1), imagenUrl: artesGaleria[3] ?? null },
      { tipo: 'NOTICIA' as const, titulo: 'Ampliamos horario los fines de semana', contenido: `Por la demanda de nuestros socios, ${e.nombre} extiende su horario: ${e.horario}. Reserva tu espacio con tiempo.`, publicadaEn: dias(-4), imagenUrl: null },
      { tipo: 'NOTICIA' as const, titulo: 'Nuevo equipo y mejores instalaciones', contenido: `Renovamos ${e.nombre} para atenderte mejor: instalaciones actualizadas y personal certificado en ${e.rubro.toLowerCase()}.`, publicadaEn: dias(-9), imagenUrl: null },
    ]
    for (const post of posts) {
      await db.companyPost.create({ data: { companyId: empresa.id, activo: true, ...post } })
    }

    // 4c) Sucursales: la principal (las coordenadas del perfil) y una
    // segunda en la misma zona. Llenan la sección Sucursales del perfil y
    // las fichas del mapa «cerca de mí».
    const sucursales = [
      { nombre: `${e.nombre} — Centro`, direccion: e.direccion, lat: e.lat, lng: e.lng },
      { nombre: `${e.nombre} — Plaza ${e.ciudad}`, direccion: `Plaza comercial de ${e.ciudad}, local 2B`, lat: e.lat + 0.012, lng: e.lng - 0.009 },
    ]
    for (const su of sucursales) {
      await db.sucursal.create({
        data: {
          companyId: empresa.id,
          nombre: su.nombre,
          direccion: su.direccion,
          telefono: e.telefono,
          activa: true,
          ciudadTexto: e.ciudad,
          sectorTexto: 'Centro',
          latitud: su.lat,
          longitud: su.lng,
          mostrarEnMapa: true,
          radioServicioKm: 10,
        },
      })
    }

    // 4d) Agenda de citas: el módulo se enciende con horarios del rubro.
    // Horario semanal { "dia": [{desde,hasta}] } — 0=domingo … 6=sábado.
    const AGENDA: Record<string, { duracionMin: number; horarios: Record<string, { desde: string; hasta: string }[]> }> = {
      'demo-aquashine': { duracionMin: 45, horarios: { '1': [{ desde: '08:00', hasta: '18:00' }], '2': [{ desde: '08:00', hasta: '18:00' }], '3': [{ desde: '08:00', hasta: '18:00' }], '4': [{ desde: '08:00', hasta: '18:00' }], '5': [{ desde: '08:00', hasta: '18:00' }], '6': [{ desde: '08:00', hasta: '17:00' }] } },
      'demo-labraza': { duracionMin: 60, horarios: { '0': [{ desde: '12:00', hasta: '22:00' }], '2': [{ desde: '12:00', hasta: '22:00' }], '3': [{ desde: '12:00', hasta: '22:00' }], '4': [{ desde: '12:00', hasta: '22:00' }], '5': [{ desde: '12:00', hasta: '23:00' }], '6': [{ desde: '12:00', hasta: '23:00' }] } },
      'demo-caribeaventura': { duracionMin: 30, horarios: { '1': [{ desde: '08:00', hasta: '16:00' }], '2': [{ desde: '08:00', hasta: '16:00' }], '3': [{ desde: '08:00', hasta: '16:00' }], '4': [{ desde: '08:00', hasta: '16:00' }], '5': [{ desde: '08:00', hasta: '16:00' }], '6': [{ desde: '08:00', hasta: '13:00' }] } },
      'demo-bellavita': { duracionMin: 60, horarios: { '1': [{ desde: '09:00', hasta: '19:00' }], '2': [{ desde: '09:00', hasta: '19:00' }], '3': [{ desde: '09:00', hasta: '19:00' }], '4': [{ desde: '09:00', hasta: '19:00' }], '5': [{ desde: '09:00', hasta: '19:00' }], '6': [{ desde: '09:00', hasta: '18:00' }] } },
      'demo-fademasters': { duracionMin: 30, horarios: { '0': [{ desde: '10:00', hasta: '15:00' }], '2': [{ desde: '09:00', hasta: '20:00' }], '3': [{ desde: '09:00', hasta: '20:00' }], '4': [{ desde: '09:00', hasta: '20:00' }], '5': [{ desde: '09:00', hasta: '21:00' }], '6': [{ desde: '09:00', hasta: '21:00' }] } },
    }
    const agenda = AGENDA[e.slug]!
    await db.agendaConfig.upsert({
      where: { companyId: empresa.id },
      update: { activa: true, duracionMin: agenda.duracionMin, maxPorSlot: 2, maxPorDia: 0, anticipacionHoras: 2, ventanaDias: 14, autoConfirmar: true, notas: 'Llega 10 minutos antes con tu QR listo.', horarios: agenda.horarios },
      create: { companyId: empresa.id, activa: true, duracionMin: agenda.duracionMin, maxPorSlot: 2, maxPorDia: 0, anticipacionHoras: 2, ventanaDias: 14, autoConfirmar: true, notas: 'Llega 10 minutos antes con tu QR listo.', horarios: agenda.horarios },
    })

    if (e.slug === 'demo-caribeaventura') {
      for (const x of EXCURSIONES) {
        const arte = await generarJuego({
          dir: DIR_PUBLICO,
          slug: e.slug,
          nombre: e.nombre,
          iniciales: e.iniciales,
          rubro: x.categoria,
          paleta: e.paleta,
          galeria: [],
          promos: [{ archivo: x.slug, titulo: x.nombre, sello: null }],
        })
        const excursion = await db.excursion.create({
          data: {
            companyId: empresa.id,
            slug: x.slug,
            nombre: x.nombre,
            codigo: x.slug.replace('demo-', 'EXC-').toUpperCase(),
            descripcion: x.descripcion,
            portadaUrl: arte.promos.get(x.slug)!,
            galeria: e.galeria.length ? [arte.promos.get(x.slug)!] : [],
            duracionMin: x.duracionMin,
            ubicacion: x.ubicacion,
            categoria: x.categoria,
            moneda: 'DOP',
            impuestoPct: 18,
            capacidad: x.capacidad,
            puntoSalida: x.puntoSalida,
            horaSalida: x.horaSalida,
            horaRegreso: x.horaRegreso,
            incluye: x.incluye,
            noIncluye: x.noIncluye,
            politicas: x.politicas,
            estado: 'ACTIVA',
          },
        })
        for (const v of x.variantes) {
          await db.excursionVariante.create({
            data: {
              excursionId: excursion.id,
              companyId: empresa.id,
              nombre: v.nombre,
              precioAdulto: v.precioAdulto,
              precioNino: v.precioNino,
              capacidad: v.capacidad,
              activa: true,
            },
          })
        }
      }
    }

    console.log(`✓ ${e.nombre} — 3 planes, ${e.promos.length}+1 promos, ${e.resenas.length} reseñas`)
  }

  // ── Beneficios activos y seguimientos ─────────────────────────────────
  // Para CADA cliente de las empresas demo (los demo-persona y también los
  // clientes reales que el equipo cree al probar): dos compras ACTIVAS con
  // su QR — llenan «Tus beneficios y cupones» y /cliente/mis-promociones —
  // y, si el cliente tiene usuario, seguimiento a su empresa y a dos demo
  // más, para que /cliente/novedades tenga materia.
  const demoEmpresas = await db.company.findMany({
    where: { slug: { startsWith: 'demo-' } },
    select: { id: true, slug: true },
  })
  const demoIds = demoEmpresas.map((c) => c.id)
  const slugDe = new Map(demoEmpresas.map((c) => [c.id, c.slug]))
  const sucursalDe = new Map(
    (
      await db.sucursal.findMany({
        where: { companyId: { in: demoIds }, activa: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, companyId: true },
      })
    )
      .reverse()
      .map((su) => [su.companyId, su.id])
  )
  const agendaDe = new Map(
    (
      await db.agendaConfig.findMany({
        where: { companyId: { in: demoIds } },
        select: { companyId: true, duracionMin: true },
      })
    ).map((a) => [a.companyId, a.duracionMin])
  )
  // Servicio típico del rubro para el texto de la cita.
  const SERVICIO: Record<string, string> = {
    'demo-aquashine': 'Lavado completo con cera',
    'demo-labraza': 'Mesa para dos · parrillada',
    'demo-caribeaventura': 'Asesoría de reserva de excursión',
    'demo-bellavita': 'Masaje descontracturante',
    'demo-fademasters': 'Corte fade + perfilado de barba',
  }
  // 10:00 y 15:00 de Santo Domingo (UTC−4) = 14:00 y 19:00 UTC.
  const enHoraUtc = (d: Date, hora: number) => {
    const copia = new Date(d)
    copia.setUTCHours(hora, 0, 0, 0)
    return copia
  }
  const clientes = await db.cliente.findMany({
    where: { companyId: { in: demoIds } },
    select: { id: true, companyId: true, supabaseId: true },
  })
  const comprables = await db.promocion.findMany({
    where: { companyId: { in: demoIds }, esComprable: true, activo: true },
    orderBy: { prioridad: 'asc' },
    select: { id: true, companyId: true, precio: true, usosPorCompra: true },
  })
  let compras = 0
  let seguimientos = 0
  let citas = 0
  for (const cliente of clientes) {
    const suyas = comprables.filter((p) => p.companyId === cliente.companyId).slice(0, 2)
    for (const [i, promo] of suyas.entries()) {
      const compra = await db.productoCompra.create({
        data: {
          tipo: 'PROMOCION',
          estado: 'ACTIVA',
          companyId: cliente.companyId,
          clienteId: cliente.id,
          promocionId: promo.id,
          precioCongelado: promo.precio ?? 0,
          montoPagado: promo.precio ?? 0,
          pagoConfirmado: true,
          usosIncluidos: promo.usosPorCompra,
          usosRestantes: promo.usosPorCompra,
          fechaActivacion: dias(-1 - i),
          fechaVencimiento: dias(21 + i * 7),
        },
      })
      await db.qrToken.create({
        data: {
          clienteId: cliente.id,
          compraId: compra.id,
          token: `demo-${randomUUID().replaceAll('-', '')}`,
          activo: true,
          expiraAt: dias(21 + i * 7),
        },
      })
      compras++
    }
    if (!cliente.supabaseId.startsWith('demo-persona-')) {
      const usuario = await db.user.findUnique({
        where: { supabaseId: cliente.supabaseId },
        select: { id: true },
      })
      if (usuario) {
        const otras = demoIds.filter((id) => id !== cliente.companyId).slice(0, 2)
        await db.companyFollow.createMany({
          data: [cliente.companyId, ...otras].map((companyId) => ({ userId: usuario.id, companyId })),
          skipDuplicates: true,
        })
        seguimientos++
      }
    }
    // Citas: una próxima confirmada (el módulo con vida) y una completada
    // en el historial. Horas dentro del horario sembrado del negocio.
    const duracion = agendaDe.get(cliente.companyId) ?? 45
    const servicio = SERVICIO[slugDe.get(cliente.companyId) ?? ''] ?? 'Visita de socio'
    await db.cita.create({
      data: {
        companyId: cliente.companyId,
        clienteId: cliente.id,
        sucursalId: sucursalDe.get(cliente.companyId) ?? null,
        inicio: enHoraUtc(dias(2), 14),
        duracionMin: duracion,
        servicio,
        estado: 'CONFIRMADA',
        notaCliente: 'Reserva de demostración.',
      },
    })
    await db.cita.create({
      data: {
        companyId: cliente.companyId,
        clienteId: cliente.id,
        sucursalId: sucursalDe.get(cliente.companyId) ?? null,
        inicio: enHoraUtc(dias(-6), 19),
        duracionMin: duracion,
        servicio,
        estado: 'COMPLETADA',
      },
    })
    citas += 2
  }
  console.log(`✓ ${compras} beneficios activos con QR, ${citas} citas y ${seguimientos} clientes reales siguiendo empresas demo`)
}

try {
  if (process.argv.includes('--limpiar')) {
    await limpiar()
  } else {
    await sembrar()
    console.log('\nListo. Cinco empresas demo con perfil completo, imágenes y contenido en todas las secciones.')
    console.log('Para retirarlas: node --env-file=.env.local --import tsx scripts/sembrar-demo.mts --limpiar')
  }
} finally {
  await db.$disconnect()
}
