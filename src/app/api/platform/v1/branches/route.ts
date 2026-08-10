import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { autenticarSobreEmpresa, esFallo } from '@/modules/plataforma/api'
import { branchDTO } from '@/modules/plataforma/dto'
import { respuestaApi } from '@/modules/plataforma/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/v1/branches?companyId=… — sucursales de una empresa.
 *
 * Alimenta el selector de sucursal del satélite y la cabecera de sus impresos.
 *
 * Devuelve también las INACTIVAS, con su bandera. Un informe del satélite sobre
 * el mes pasado tiene que poder nombrar la sucursal que cerró la semana pasada;
 * filtrarlas aquí convertiría esas filas en «sucursal desconocida» sin que nadie
 * entendiera por qué.
 *
 * `direccion` y nada más de geo: ni coordenadas, ni claves del catálogo
 * geográfico, ni teléfono. Un satélite imprime una dirección; no necesita poder
 * dibujar el mapa de MembeGo (§69).
 */
export async function GET(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(
    req,
    'branches:read',
    req.nextUrl.searchParams.get('companyId')
  )
  if (esFallo(auth)) return auth.fallo

  const sucursales = await conEmpresa(auth.companyId, (tx) =>
    tx.sucursal.findMany({
      where: { companyId: auth.companyId },
      select: { id: true, companyId: true, nombre: true, direccion: true, activa: true },
      orderBy: { nombre: 'asc' },
    })
  ).catch(() => [])

  return respuestaApi({ branches: sucursales.map(branchDTO) }, auth.ctx.requestId)
}
