/**
 * RUTAS DE LOS BUCKETS DE MEDIOS (`promociones`, `evidencias`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * La ruta se construía a mano dentro de cada componente de subida:
 *
 *     const path = `${folder}/${uniqueFileName(ext)}`            // PromoImagenUpload
 *     const path = `invitaciones/${folder}/${uniqueFileName(ext)}` // CampanaImagenUpload
 *     const path = `${colaId || 'sueltas'}/${uniqueFileName(ext)}` // EvidenciaForm
 *
 * Con `folder = existing?.id ?? 'nueva'`. Eso tenía dos consecuencias:
 *
 *  1. La política de RLS no podía comprobar de quién era el archivo sin
 *     resolver el id de la promoción/campaña/cola hasta su empresa, tabla por
 *     tabla — y al CREAR no había id todavía, así que todas las empresas
 *     escribían en la misma carpeta `nueva/`.
 *  2. La regla vivía repartida en tres componentes de cliente, donde nadie la
 *     puede probar sin montar un navegador.
 *
 * Ahora la empresa va SIEMPRE delante:
 *
 *     <companyId>/<resto…>
 *
 * Con eso la política se reduce a «el primer segmento tiene que ser una de mis
 * empresas», que no necesita consultar ninguna tabla de negocio y no tiene
 * ningún caso en que no se pueda comprobar la propiedad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CARPETA `nueva` NO DESAPARECE, PERO DEJA DE SER COMPARTIDA
 *
 * Sigue haciendo falta un nombre para «todavía no se ha guardado la entidad».
 * La diferencia es que ahora cuelga de la empresa: `<companyId>/nueva/…` en vez
 * de `nueva/…`. Dos empresas ya no comparten carpeta, que era el problema.
 */

/** Segmento para una entidad que aún no se ha guardado. */
export const CARPETA_SIN_GUARDAR = 'nueva'

/** Segmento para una evidencia que no se liga a ninguna entrada de la cola. */
export const CARPETA_SUELTAS = 'sueltas'

/**
 * Un id de empresa nunca lleva `/` ni `..`. Comprobarlo aquí evita que un
 * valor inesperado construya una ruta que se salga de su carpeta — y evita
 * sobre todo que se suba con un prefijo vacío, que es el caso que dejaría el
 * archivo fuera del alcance de cualquier comprobación de propiedad.
 */
function exigirSegmento(valor: string, nombre: string): string {
  const limpio = valor.trim()
  if (!limpio) throw new Error(`storage-rutas: ${nombre} vacío`)
  if (limpio.includes('/') || limpio.includes('\\') || limpio.includes('..')) {
    throw new Error(`storage-rutas: ${nombre} con caracteres no permitidos`)
  }
  return limpio
}

/**
 * Imagen de una promoción: `<companyId>/<promocionId|nueva>/<archivo>`.
 */
export function rutaPromocion(
  companyId: string,
  promocionId: string | null | undefined,
  archivo: string
): string {
  const empresa = exigirSegmento(companyId, 'companyId')
  const carpeta = promocionId ? exigirSegmento(promocionId, 'promocionId') : CARPETA_SIN_GUARDAR
  return `${empresa}/${carpeta}/${exigirSegmento(archivo, 'archivo')}`
}

/**
 * Imagen de una campaña (marketing o invitación):
 * `<companyId>/invitaciones/<campanaId|nueva>/<archivo>`.
 *
 * El segmento `invitaciones/` se conserva aunque ahora sea redundante para la
 * política: es el que distingue estas imágenes de las de promoción dentro del
 * mismo bucket, y cambiarlo obligaría a mover también las ya subidas.
 */
export function rutaCampana(
  companyId: string,
  campanaId: string | null | undefined,
  archivo: string
): string {
  const empresa = exigirSegmento(companyId, 'companyId')
  const carpeta = campanaId ? exigirSegmento(campanaId, 'campanaId') : CARPETA_SIN_GUARDAR
  return `${empresa}/invitaciones/${carpeta}/${exigirSegmento(archivo, 'archivo')}`
}

/**
 * Foto de evidencia: `<companyId>/<colaId|sueltas>/<archivo>`.
 */
export function rutaEvidencia(
  companyId: string,
  colaId: string | null | undefined,
  archivo: string
): string {
  const empresa = exigirSegmento(companyId, 'companyId')
  const carpeta = colaId ? exigirSegmento(colaId, 'colaId') : CARPETA_SUELTAS
  return `${empresa}/${carpeta}/${exigirSegmento(archivo, 'archivo')}`
}

/**
 * ¿Esta ruta lleva ya el prefijo de empresa?
 *
 * Sirve para el script de migración y para distinguir, al leer una URL vieja,
 * si el archivo está en el formato nuevo o en el heredado.
 */
export function tienePrefijoDeEmpresa(ruta: string, companyId: string): boolean {
  return ruta.startsWith(`${companyId}/`)
}
