import type { NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { autenticar, esFallo, exigeSistema } from '@/modules/plataforma/api'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/systems/me — quién soy y qué puedo hacer.
 *
 * Es el primer endpoint que llama un satélite recién configurado, y el que
 * contesta la pregunta que más tiempo hace perder al integrar: «¿estas
 * credenciales son las buenas, y con qué permisos?».
 *
 * Sin scope: describe la relación del sistema con MembeGo, no un recurso de
 * ninguna empresa. Devuelve los scopes EFECTIVOS de este token —no los de la
 * credencial—, que es justo lo que hace falta para diagnosticar un 403.
 */
export async function GET(req: NextRequest) {
  const ctx = await autenticar(req, null)
  if (esFallo(ctx)) return ctx.fallo
  // Recurso de SATÉLITE: describe la relación de un sistema con MembeGo, así
  // que necesita saber cuál. Una clave de API de empresa no llega aquí — la
  // guardia la rechaza antes con API_KEY_NOT_SUPPORTED.
  const llamante = exigeSistema(ctx)

  const sistema = await sinEmpresa(
    'api de plataforma: ficha del sistema llamante (catálogo global)',
    (tx) =>
      tx.sistemaConectado.findUnique({
        where: { id: llamante.sistemaId },
        select: {
          slug: true,
          nombre: true,
          estado: true,
          tiposNegocio: { select: { tipo: { select: { codigo: true } } } },
        },
      })
  ).catch(() => null)

  if (!sistema) {
    // La credencial existe pero su sistema no: solo pasa si alguien borró la
    // fila a mano. Se responde con lo que sí se sabe en vez de un 500.
    return respuestaApi(
      { slug: llamante.sistemaSlug, nombre: llamante.sistemaSlug, estado: 'UNKNOWN', businessTypes: [], scopes: ctx.scopes },
      ctx.requestId
    )
  }

  return respuestaApi(
    {
      slug: sistema.slug,
      nombre: sistema.nombre,
      estado: sistema.estado,
      businessTypes: sistema.tiposNegocio.map((t) => t.tipo.codigo),
      scopes: ctx.scopes,
    },
    ctx.requestId
  )
}
