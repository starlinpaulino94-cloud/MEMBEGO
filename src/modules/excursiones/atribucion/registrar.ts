import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { VISITOR_COOKIE } from '@/lib/referidos'
import {
  VENDEDOR_COOKIE,
  VENTANA_ATRIBUCION_DIAS,
  sanitizarCanalAtribucion,
  type CanalAtribucion,
} from './nucleo'

// Re-exportar para uso externo
export { VENDEDOR_COOKIE } from './nucleo'

/**
 * EXCURSIONES · Atribución — escritura de los hechos.
 *
 * Regla de oro de este archivo: la atribución JAMÁS rompe el flujo principal.
 * Ni una visita perdida ni una tabla que falta pueden impedir que alguien se
 * registre. Todo va envuelto y solo deja rastro en el log.
 *
 * Los hechos son inmutables: se insertan, no se editan (§99). Lo único que se
 * completa después es el `clienteId` de una visita anónima, cuando esa misma
 * persona —identificada por su cookie de visitante— se crea la cuenta.
 */

export interface EnlaceResuelto {
  slug: string
  vendedorId: string
  companyId: string
  companySlug: string
  codigoVendedor: string
  /** Nombre para saludar a quien llega; nunca datos de contacto (§dato mínimo). */
  nombreVendedor: string
}

/**
 * PÚBLICO · Resuelve el enlace /e/[slug] a su vendedor y su empresa. Devuelve
 * null si el enlace está apagado, el vendedor no está activo o la empresa no
 * está operando: en esos casos no se capta ni se cuenta nada.
 */
export async function resolverEnlace(slug: string): Promise<EnlaceResuelto | null> {
  try {
    const enlace = await prisma.vendedorEnlace.findUnique({
      where: { slug },
      select: {
        slug: true,
        activo: true,
        vendedorId: true,
        vendedor: {
          select: { codigo: true, estado: true, companyId: true, nombre: true, apellido: true },
        },
      },
    })
    if (!enlace || !enlace.activo || enlace.vendedor.estado !== 'ACTIVO') return null

    const empresa = await prisma.company.findUnique({
      where: { id: enlace.vendedor.companyId },
      select: { slug: true, isActive: true },
    })
    if (!empresa?.isActive) return null

    return {
      slug: enlace.slug,
      vendedorId: enlace.vendedorId,
      companyId: enlace.vendedor.companyId,
      companySlug: empresa.slug,
      codigoVendedor: enlace.vendedor.codigo,
      nombreVendedor: `${enlace.vendedor.nombre} ${enlace.vendedor.apellido ?? ''}`.trim(),
    }
  } catch (e) {
    console.error('[excursiones] resolverEnlace:', e)
    return null
  }
}

/** Ventana de atribución configurada por la empresa (defecto: 30 días). */
export async function ventanaDeEmpresa(companyId: string): Promise<number> {
  try {
    const config = await conEmpresa(companyId, (tx) =>
      tx.excursionesConfig.findUnique({
        where: { companyId },
        select: { ventanaAtribucionDias: true },
      })
    )
    const dias = config?.ventanaAtribucionDias
    return typeof dias === 'number' && dias > 0 ? dias : VENTANA_ATRIBUCION_DIAS
  } catch {
    return VENTANA_ATRIBUCION_DIAS
  }
}

/**
 * Etapa VISITA: alguien abrió el enlace del vendedor. Se deduplica por
 * visitante y enlace cada 24 h — recargar la página no infla el embudo, y un
 * embudo inflado es peor que no tener embudo.
 */
export async function registrarVisita(params: {
  enlace: EnlaceResuelto
  visitorId: string
  canal: CanalAtribucion
  landing?: string | null
}): Promise<void> {
  try {
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const repetida = await conEmpresa(params.enlace.companyId, (tx) =>
      tx.vendedorAtribucion.findFirst({
        where: {
          companyId: params.enlace.companyId,
          vendedorId: params.enlace.vendedorId,
          etapa: 'VISITA',
          visitorId: params.visitorId,
          enlaceSlug: params.enlace.slug,
          createdAt: { gte: hace24h },
        },
        select: { id: true },
      })
    )
    if (repetida) return

    await conEmpresa(params.enlace.companyId, (tx) =>
      tx.vendedorAtribucion.create({
        data: {
          companyId: params.enlace.companyId,
          vendedorId: params.enlace.vendedorId,
          etapa: 'VISITA',
          visitorId: params.visitorId,
          canal: params.canal,
          enlaceSlug: params.enlace.slug,
          landing: params.landing ?? null,
        },
      })
    )
  } catch (e) {
    console.error('[excursiones] registrarVisita:', e)
  }
}

/**
 * Etapa REGISTRO: la persona que entró por el enlace de un vendedor se creó su
 * cuenta. Se llama desde TODAS las puertas de alta (formulario, asistente,
 * Google y afiliación de una cuenta existente).
 *
 * Aislamiento (regla permanente): el vendedor debe pertenecer a la MISMA
 * empresa en la que el cliente se está registrando. Un enlace de otra empresa
 * guardado en la cookie no atribuye nada aquí — no es un filtro de pantalla,
 * es la condición para escribir el hecho.
 *
 * Nunca lanza y nunca bloquea el registro.
 */
export async function capturarAtribucionVendedor(
  clienteId: string,
  companyId: string,
  opciones?: { enlaceSlug?: string | null }
): Promise<void> {
  try {
    let slug = (opciones?.enlaceSlug ?? '').trim().toLowerCase()
    let visitorId: string | null = null
    try {
      const store = await cookies()
      if (!slug) slug = (store.get(VENDEDOR_COOKIE)?.value ?? '').trim().toLowerCase()
      visitorId = store.get(VISITOR_COOKIE)?.value ?? null
    } catch {
      /* fuera del alcance de la petición: seguimos con lo explícito */
    }
    if (!slug) return

    const enlace = await resolverEnlace(slug)
    if (!enlace) return
    if (enlace.companyId !== companyId) return // otra empresa: no se atribuye

    // Un cliente se registra una sola vez por vendedor: si el hecho ya está,
    // no se duplica (recargas, reintentos del formulario, doble submit).
    const ya = await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.findFirst({
        where: { companyId, vendedorId: enlace.vendedorId, etapa: 'REGISTRO', clienteId },
        select: { id: true },
      })
    )
    if (ya) return

    await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.create({
        data: {
          companyId,
          vendedorId: enlace.vendedorId,
          etapa: 'REGISTRO',
          clienteId,
          visitorId,
          enlaceSlug: enlace.slug,
          canal: sanitizarCanalAtribucion(null),
        },
      })
    )

    // La visita anónima y el registro son la MISMA persona: completar el
    // clienteId de sus visitas previas une el recorrido sin inventar filas.
    if (visitorId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.updateMany({
          where: { companyId, vendedorId: enlace.vendedorId, visitorId, clienteId: null },
          data: { clienteId },
        })
      )
    }
  } catch (e) {
    console.error('[excursiones] capturarAtribucionVendedor:', e)
  }
}
