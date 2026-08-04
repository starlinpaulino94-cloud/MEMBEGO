import { unstable_cache } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getGrowthConfig } from '@/modules/growth/config'

/**
 * Navegación consciente del contenido (cliente).
 *
 * Un módulo del menú se OCULTA mientras no tenga nada que mostrar, para que la
 * app no se sienta "a medio terminar". En cuanto el negocio agrega contenido
 * (o el cliente obtiene un beneficio), el módulo aparece solo. Las rutas
 * siguen accesibles por URL (con su estado vacío), esto solo controla el menú.
 *
 * Devuelve la lista de `href` que deben ocultarse en sidebar, barra inferior,
 * buscador (Ctrl+K) y breadcrumb.
 */
export async function getNavOcultoCliente(
  clienteId: string | null | undefined,
  companyId: string | null | undefined
): Promise<string[]> {
  if (!clienteId || !companyId) return []
  const now = new Date()

  try {
    const [promos, beneficios, regalos, ruletaPremios] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        // Promociones: activas y vigentes de la empresa (públicas o privadas).
        //
        // Sin `isPublished`: esto cuenta las promociones de la empresa DE ESTE
        // cliente, no las de la vitrina. Exigir que el negocio estuviera
        // publicado le escondía el menú de Promociones a los clientes de una
        // empresa que aún no se publicó — y a los de una empresa de práctica,
        // que nunca se publica. `isActive` sí se mantiene: una empresa apagada
        // no tiene nada que ofrecer.
        tx.promocion.count({
          where: {
            companyId,
            activo: true,
            archivada: false,
            vigenciaDesde: { lte: now },
            OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
            company: { isActive: true },
          },
        }),
        // Mis beneficios: compras de promociones del cliente (cualquier estado).
        tx.productoCompra.count({ where: { clienteId } }),
        // Mis beneficios: también cuentan los regalos VIP recibidos.
        tx.ofertaInvitado.count({ where: { clienteId } }),
        // Ruleta: premios activos configurados por la empresa.
        tx.ruletaPremio.count({ where: { companyId, activo: true } }),
      ])
    )
    // Invita y Gana: el programa de referidos de la empresa. Se consulta fuera
    // de la transacción: getGrowthConfig abre su propio contexto.
    const growth = await getGrowthConfig(companyId)

    const ocultos: string[] = []
    if (promos === 0) ocultos.push('/cliente/promociones')
    if (beneficios + regalos === 0) ocultos.push('/cliente/mis-promociones')
    if (ruletaPremios === 0) ocultos.push('/cliente/ruleta')
    // Referidos: se oculta solo si el negocio apagó TODAS las recompensas
    // (por defecto el programa premia registro/membresía/compra → visible).
    const programaActivo =
      growth.premiaClic ||
      growth.premiaRegistro ||
      growth.premiaMembresia ||
      growth.premiaCompra ||
      growth.premiaRenovacion
    if (!programaActivo) ocultos.push('/cliente/invita-y-gana')

    return ocultos
  } catch (e) {
    console.error('[navDisponible]', e)
    // Ante un fallo, no ocultamos nada (mejor mostrar de más que romper el menú).
    return []
  }
}

/**
 * Versión cacheada para el LAYOUT del cliente (corre en cada navegación).
 *
 * Estas 5 consultas son pura cosmética del menú: cachearlas 5 minutos por
 * cliente elimina ~5 queries de CADA clic sin cambiar nada funcional (si el
 * negocio publica una promo, el módulo aparece en el menú a los pocos minutos;
 * las rutas siguen accesibles por URL desde el instante cero).
 */
export const getNavOcultoClienteCached = unstable_cache(
  async (clienteId: string | null | undefined, companyId: string | null | undefined) =>
    getNavOcultoCliente(clienteId, companyId),
  ['nav-oculto-cliente'],
  { revalidate: 300 }
)
