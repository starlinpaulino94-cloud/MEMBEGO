import {
  type CategoriaIntegracion,
  type MetadatosProveedor,
} from '@/modules/connect/proveedores/tipos'

/**
 * METADATOS DEL CATÁLOGO, separados de la implementación (ajuste 4 del
 * rediseño).
 *
 * Aquí vive la identidad de una integración —nombre, para qué sirve, de qué
 * categoría es, de qué color es su marca— y NADA MÁS. Ninguna de estas
 * entradas puede conectar nada: para eso hace falta una definición en
 * `indice.ts`, y son dos archivos distintos a propósito.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS LOGOS (decisión 3, aprobada con condición)
 *
 * Ninguna entrada tiene todavía `logoVerificado: true`. No es un descuido: su
 * condición fue comprobar la compatibilidad de uso y distribución con las
 * guías de cada marca ANTES de guardar el archivo en el repositorio, y esa
 * comprobación no está hecha. Mientras tanto el framework pinta el monograma
 * de la marca con su color, que es un marcador de posición honesto y no un
 * logo redibujado a ojo.
 *
 * Los colores son los públicos de cada marca y se usan solo para ese
 * monograma. Cuando un SVG oficial entre en `public/marcas/<slug>.svg` con su
 * licencia comprobada, se pone el flag a true y el componente lo usa sin
 * tocar nada más.
 */

const marca = (color: string) => ({ color, logoVerificado: false })

/** Lo que ya está implementado. Sus metadatos son los mismos que los del resto. */
export const METADATOS_IMPLEMENTADOS: MetadatosProveedor[] = [
  {
    slug: 'google-calendar',
    nombre: 'Google Calendar',
    descripcion:
      'Lleva las citas confirmadas a la agenda de Google de tu negocio, automáticamente.',
    categoria: 'CALENDARIO',
    marca: marca('#4285F4'),
    sitioUrl: 'https://calendar.google.com',
  },
  {
    slug: 'whatsapp',
    nombre: 'WhatsApp',
    descripcion:
      'Envía mensajes a tus clientes desde tus automatizaciones, con el número de WhatsApp de tu negocio.',
    categoria: 'COMUNICACION',
    marca: marca('#25D366'),
    sitioUrl: 'https://business.whatsapp.com',
  },
  {
    slug: 'cardnet',
    nombre: 'CardNET',
    descripcion:
      'Cobra con tarjeta de crédito y débito. Es la pasarela que ya usa tu negocio para las compras en línea.',
    categoria: 'PAGOS',
    // Color neutro DELIBERADO: no tengo comprobado el color oficial de CardNET
    // y no voy a inventarlo. Se corrige cuando se verifique su guía de marca.
    marca: marca('#475569'),
  },
  // UNA conexión para los dos (Meta · Fase 3): Meta entrega en un login las
  // Páginas y, por cada una, su cuenta de Instagram. La tarjeta de Instagram
  // existe para que quien la busque la encuentre, y lleva a esta conexión.
  {
    slug: 'facebook',
    nombre: 'Facebook e Instagram',
    descripcion:
      'Recibe y responde desde Membego los mensajes de tus Páginas de Facebook y de las cuentas de Instagram enlazadas.',
    categoria: 'COMUNICACION',
    marca: marca('#1877F2'),
    sitioUrl: 'https://www.facebook.com/business',
  },
  {
    slug: 'instagram',
    nombre: 'Instagram',
    descripcion: 'Responde los mensajes directos de tu cuenta profesional desde Membego.',
    categoria: 'COMUNICACION',
    marca: marca('#E4405F'),
  },
]

/**
 * LO PREVISTO. Existen en el catálogo, se pueden buscar y filtrar, y NO se
 * pueden conectar: no hay implementación detrás y el servidor lo comprueba.
 *
 * Que aparezcan es una decisión suya (§35 del rediseño): sirven para que una
 * empresa vea hacia dónde va la plataforma. Que aparezcan SEPARADAS de las
 * disponibles, y nunca mezcladas como si fueran equivalentes, es la condición
 * con la que lo aprobó.
 *
 * Cada una nace en DRAFT en la base: hasta que el superadmin la publique, ni
 * siquiera se enseña.
 */
export const METADATOS_PREVISTOS: MetadatosProveedor[] = [
  {
    slug: 'google',
    nombre: 'Google',
    descripcion: 'Entra con tu cuenta de Google y sincroniza los datos de tu negocio.',
    categoria: 'IDENTIDAD',
    marca: marca('#4285F4'),
  },
  {
    slug: 'paypal',
    nombre: 'PayPal',
    descripcion: 'Cobra a tus clientes con PayPal desde las compras de tu negocio.',
    categoria: 'PAGOS',
    marca: marca('#003087'),
  },
  {
    slug: 'stripe',
    nombre: 'Stripe',
    descripcion: 'Cobra con tarjeta usando Stripe como pasarela.',
    categoria: 'PAGOS',
    marca: marca('#635BFF'),
  },
  {
    slug: 'quickbooks',
    nombre: 'QuickBooks',
    descripcion: 'Lleva tus ventas y pagos a tu contabilidad sin escribirlos dos veces.',
    categoria: 'CONTABILIDAD',
    marca: marca('#2CA01C'),
  },
  {
    slug: 'hubspot',
    nombre: 'HubSpot',
    descripcion: 'Sincroniza tus clientes con tu CRM.',
    categoria: 'CRM',
    marca: marca('#FF7A59'),
  },
  {
    slug: 'mailchimp',
    nombre: 'Mailchimp',
    descripcion: 'Manda tus campañas de correo con las listas de Membego.',
    categoria: 'MARKETING',
    marca: marca('#FFE01B'),
  },
  {
    slug: 'brevo',
    nombre: 'Brevo',
    descripcion: 'Correo y SMS de marketing con los datos de tus clientes.',
    categoria: 'MARKETING',
    marca: marca('#0B996E'),
  },
  {
    slug: 'zapier',
    nombre: 'Zapier',
    descripcion: 'Conecta Membego con miles de aplicaciones sin programar.',
    categoria: 'AUTOMATIZACION',
    marca: marca('#FF4F00'),
  },
  {
    slug: 'make',
    nombre: 'Make',
    descripcion: 'Crea flujos visuales entre Membego y las herramientas que ya usas.',
    categoria: 'AUTOMATIZACION',
    marca: marca('#6D00CC'),
  },
]

export const METADATOS: MetadatosProveedor[] = [
  ...METADATOS_IMPLEMENTADOS,
  ...METADATOS_PREVISTOS,
]

export function metadatosDe(slug: string): MetadatosProveedor | null {
  return METADATOS.find((m) => m.slug === slug) ?? null
}

/**
 * Los metadatos de un proveedor IMPLEMENTADO. Revienta si no existen, y esa
 * es la gracia: un proveedor con código y sin identidad en el catálogo es un
 * error de programación que tiene que salir al construir, no una tarjeta sin
 * nombre en producción.
 */
export function metadatosObligatorios(slug: string): MetadatosProveedor {
  const m = metadatosDe(slug)
  if (!m) throw new Error(`connect: falta la metadata de catálogo del proveedor «${slug}»`)
  return m
}

/** Las categorías que de verdad tienen algo dentro, para los filtros. */
export function categoriasConContenido(): CategoriaIntegracion[] {
  return [...new Set(METADATOS.map((m) => m.categoria))].sort()
}
