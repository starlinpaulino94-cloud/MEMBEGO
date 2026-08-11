/**
 * QUÉ SIGNIFICA QUE UNA PROMOCIÓN ESTÉ VIGENTE — una sola definición.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO ARREGLA
 *
 * Había dos definiciones distintas conviviendo, y una de ellas era falsa.
 *
 * `vigenciaHasta` es OPCIONAL: `null` significa «no caduca». Así lo entiende
 * el feed del cliente (`src/modules/social/queries.ts`), el menú disponible,
 * el motor de crecimiento y la vista previa para compartir — todos escriben
 * `OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }]`.
 *
 * La vitrina pública del marketplace escribía `vigenciaHasta: { gt: now }`. En
 * SQL, una comparación contra NULL no es verdadera: esa condición **descartaba
 * en silencio todas las promociones sin fecha de fin**. Una oferta permanente
 * salía en el feed del cliente y desaparecía en cuanto alguien la buscaba.
 *
 * Es el peor tipo de fallo: nadie ve un error. El negocio publica su oferta,
 * la ve en su panel, el cliente la ve en su inicio — y la búsqueda dice que no
 * existe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TAMBIÉN FALTABA EL COMIENZO
 *
 * La vitrina no comprobaba `vigenciaDesde`, así que una promoción PROGRAMADA
 * para dentro de un mes ya aparecía en el buscador. Publicar con fecha era una
 * promesa que el buscador no cumplía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUIDADO AL COMBINARLO CON OTRO `OR`
 *
 * Este fragmento usa `OR` en el primer nivel. Prisma no fusiona dos claves
 * iguales: si quien llama añade su propio `OR` (una búsqueda por texto, por
 * ejemplo) en el mismo objeto, **el segundo pisa al primero** y la vigencia
 * deja de aplicarse sin avisar. El otro `OR` va dentro de `AND: [{ OR: … }]`.
 */

/** Condiciones de vigencia comunes a cualquier promoción que se pueda mostrar. */
export function promocionVigente(now: Date = new Date()) {
  return {
    activo: true,
    archivada: false,
    vigenciaDesde: { lte: now },
    // `null` = no caduca. Sin esta rama, las permanentes desaparecen.
    OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
  }
}

/**
 * La empresa detrás de una promoción de la VITRINA pública: publicada, activa
 * y que no sea de práctica.
 *
 * No vale para las promociones de «mis empresas»: quien ya es cliente de un
 * negocio tiene que ver lo suyo aunque el negocio todavía no esté publicado.
 * Esa diferencia es deliberada y está explicada en `promoDeMisEmpresas`.
 */
export const EMPRESA_EN_VITRINA = {
  isPublished: true,
  isActive: true,
  esDemo: false,
} as const
