import { unstable_cache } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getGrowthConfig } from '@/modules/growth/config'
import {
  capacidadesDeEmpresa,
  rutasOcultasCliente,
  CATEGORIAS_CON_VEHICULO,
  type ModuloCliente,
} from '@/modules/capacidades/catalogo'
import { CAPACIDADES_TAG } from '@/modules/capacidades/resolver'

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
 *
 * DOS CAPAS, EN ESTE ORDEN:
 *
 * 1. AUTOMÁTICA — ¿hay algo dentro? Es la que evita el peor caso: hablarle de
 *    membresías a alguien cuyo negocio todavía no publicó ni un plan, o
 *    enseñarle "Mis vehículos" al cliente de un restaurante.
 * 2. FORZADA — lo que el negocio decidió a mano en el panel de capacidades
 *    (MOSTRAR / OCULTAR). Gana sobre la automática, porque el dato no sabe lo
 *    que se lanza mañana ni lo que se quiere guardar para después.
 *
 * Regla de fallo: si una consulta se cae, el módulo se considera disponible.
 * Un menú con un módulo de más es un defecto; un cliente sin acceso a su
 * membresía es una avería.
 */
export async function getNavOcultoCliente(
  clienteId: string | null | undefined,
  companyId: string | null | undefined
): Promise<string[]> {
  if (!clienteId || !companyId) return []
  const now = new Date()

  try {
    const [
      promos,
      beneficios,
      regalosVip,
      ruletaPremios,
      planes,
      membresias,
      vehiculos,
      citas,
      regalosP2P,
      giftCards,
      campanasInvitacion,
      empresa,
    ] = await conEmpresa(companyId, (tx) =>
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
        // Membresías: lo que la empresa VENDE hoy.
        tx.plan.count({ where: { companyId, activo: true } }),
        // …y lo que este cliente ya tiene (aunque el negocio despublicara todo,
        // quien pagó no puede perder de vista su membresía).
        tx.membership.count({ where: { clienteId } }),
        tx.vehiculo.count({ where: { clienteId } }),
        tx.cita.count({ where: { clienteId } }),
        // Regalos P2P: enviados o recibidos por este cliente.
        tx.regalo.count({
          where: { OR: [{ remitenteId: clienteId }, { destinatarioId: clienteId }] },
        }),
        tx.giftCard.count({
          where: {
            OR: [{ compradorClienteId: clienteId }, { destinatarioClienteId: clienteId }],
          },
        }),
        // Invita y Gana vive ENTERO dentro de una campaña: sin una activa, la
        // pantalla es un cartel de "vuelve pronto" y nada más.
        tx.campanaInvitacion.count({
          where: {
            companyId,
            estado: 'ACTIVA',
            fechaInicio: { lte: now },
            fechaFin: { gte: now },
          },
        }),
        tx.company.findUnique({
          where: { id: companyId },
          // `tipoNegocioCodigo` incluido: sin él, el menú del cliente decidía
          // si enseñar «Vehículos» con el `type` heredado, así que a los
          // clientes de un restaurante mal tipado se les ofrecía cargar carro.
          select: { type: true, tipoNegocioCodigo: true, capacidades: true },
        }),
      ])
    )
    // Invita y Gana: el programa de referidos de la empresa. Se consulta fuera
    // de la transacción: getGrowthConfig abre su propio contexto.
    const growth = await getGrowthConfig(companyId)

    const { categoriaExplicita, activas, modulosCliente } = capacidadesDeEmpresa({
      type: empresa?.type ?? null,
      tipoNegocioCodigo: empresa?.tipoNegocioCodigo ?? null,
      capacidades: empresa?.capacidades ?? null,
    })

    // Referidos: se oculta solo si el negocio apagó TODAS las recompensas
    // (por defecto el programa premia registro/membresía/compra → visible).
    const programaActivo =
      growth.premiaClic ||
      growth.premiaRegistro ||
      growth.premiaMembresia ||
      growth.premiaCompra ||
      growth.premiaRenovacion

    const disponible: Partial<Record<ModuloCliente, boolean>> = {
      OFERTAS: promos > 0,
      BENEFICIOS: beneficios + regalosVip > 0,
      RULETA: ruletaPremios > 0,
      // Las dos condiciones son necesarias: el programa define si se premia
      // algo y la campaña es lo único que la pantalla sabe renderizar.
      INVITA_Y_GANA: programaActivo && campanasInvitacion > 0,
      MEMBRESIAS: planes > 0 || membresias > 0,
      // Regalar exige tener algo que regalar: el negocio lo habilita con la
      // capacidad, y quien ya envió o recibió uno conserva su historial.
      REGALOS: activas.has('GIFT_CARDS') || regalosP2P + giftCards > 0,
      CITAS: activas.has('CITAS') || citas > 0,
      // El vehículo es del oficio, no del cliente: solo lo ve quien está en un
      // negocio que trabaja con vehículos (o quien ya registró alguno).
      VEHICULOS:
        (categoriaExplicita != null && CATEGORIAS_CON_VEHICULO.includes(categoriaExplicita)) ||
        vehiculos > 0,
    }

    return rutasOcultasCliente(disponible, modulosCliente)
  } catch (e) {
    console.error('[navDisponible]', e)
    // Ante un fallo, no ocultamos nada (mejor mostrar de más que romper el menú).
    return []
  }
}

/**
 * Versión cacheada para el LAYOUT del cliente (corre en cada navegación).
 *
 * Estas consultas son pura cosmética del menú: cachearlas 5 minutos por
 * cliente elimina las queries de CADA clic sin cambiar nada funcional (si el
 * negocio publica una promo, el módulo aparece en el menú a los pocos minutos;
 * las rutas siguen accesibles por URL desde el instante cero).
 */
export const getNavOcultoClienteCached = unstable_cache(
  async (clienteId: string | null | undefined, companyId: string | null | undefined) =>
    getNavOcultoCliente(clienteId, companyId),
  ['nav-oculto-cliente'],
  // Con el tag de capacidades: cuando alguien fuerza un módulo en el panel, el
  // cambio se ve en el menú al instante y no dentro de cinco minutos.
  { revalidate: 300, tags: [CAPACIDADES_TAG] }
)
