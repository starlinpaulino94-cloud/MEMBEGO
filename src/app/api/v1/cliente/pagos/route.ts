import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClientePagos } from '@/modules/cliente/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKET_COMPROBANTES } from '@/modules/storage/tipos'

export const dynamic = 'force-dynamic'

/** Misma ventana que la web: la URL firmada de lectura vive cinco minutos. */
const VIGENCIA_LECTURA_S = 300

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * Firma una ruta guardada de comprobante, si la hay.
 *
 * `urlComprobante` (modules/storage/comprobantes.ts) NO se puede reutilizar
 * aquí: comprueba el permiso con `getUser()`, que lee la cookie de sesión de
 * Supabase, y la app RN autentica por `Authorization: Bearer` (sin cookies).
 * La propiedad ya está garantizada en este punto: los pagos salen de
 * `getClientePagos(user.supabaseId)`, o sea solo membresías de ESTA persona.
 * Si mañana `urlComprobante` admite el usuario de la petición, esta firma debe
 * delegarse en ella para no duplicar el modelo de permiso.
 */
async function firmarComprobante(valor: string | null | undefined): Promise<string | null> {
  if (!valor) return null
  try {
    const path = valor.startsWith('http')
      ? (() => {
          const marca = `/object/public/${BUCKET_COMPROBANTES}/`
          const i = valor.indexOf(marca)
          if (i === -1) return valor
          return decodeURIComponent(valor.slice(i + marca.length).split('?')[0])
        })()
      : valor
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET_COMPROBANTES)
      .createSignedUrl(path, VIGENCIA_LECTURA_S)
    if (error || !data) return null
    return data.signedUrl
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    // Sin ficha de cliente no hay pagos: misma salida que la web.
    if (!user.metadata.clienteId) {
      return NextResponse.json(
        { membership: null, historial: [] },
        { headers: corsHeaders(request) }
      )
    }

    const data = await getClientePagos(user.supabaseId)

    const membership = data.membership
      ? { ...data.membership, comprobanteUrl: await firmarComprobante(data.membership.comprobanteUrl) }
      : null

    const historial = await Promise.all(
      data.historial.map(async (item) => ({
        ...item,
        comprobanteUrl: await firmarComprobante(item.comprobanteUrl),
      }))
    )

    return NextResponse.json({ membership, historial }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/pagos] Error cargando pagos:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar pagos' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
