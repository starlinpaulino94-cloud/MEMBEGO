import { randomBytes } from 'crypto'
import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKET_COMPROBANTES, type TipoComprobante } from '@/modules/storage/tipos'

const EXTENSIONES = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf'])

export interface SubidaFirmada {
  path: string
  token: string
}

export interface ResultadoSubida {
  error?: string
  subida?: SubidaFirmada
}

function prefijoDe(tipo: TipoComprobante, id: string): string {
  return `${tipo}/${id}/`
}

export async function puedeSubirComprobante(tipo: TipoComprobante, id: string, supabaseId: string): Promise<boolean> {
  try {
    if (tipo === 'membresia') {
      const m = await sinEmpresa('comprobantes: membership por id para comprobar permiso (cross-tenant)', (tx) =>
        tx.membership.findUnique({
          where: { id },
          select: { cliente: { select: { supabaseId: true } } },
        })
      )
      return m?.cliente?.supabaseId === supabaseId
    }
    if (tipo === 'compra') {
      const c = await sinEmpresa('comprobantes: compra por id para comprobar permiso (cross-tenant)', (tx) =>
        tx.productoCompra.findUnique({
          where: { id },
          select: { cliente: { select: { supabaseId: true } } },
        })
      )
      return c?.cliente?.supabaseId === supabaseId
    }
    return id === supabaseId
  } catch {
    return false
  }
}

export async function prepararSubidaComprobante(
  tipo: TipoComprobante,
  id: string,
  extension: string,
  supabaseId: string
): Promise<ResultadoSubida> {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!EXTENSIONES.has(ext)) {
    return { error: 'Solo se aceptan imágenes JPG, PNG, WEBP o archivos PDF.' }
  }
  if (!id) return { error: 'Falta la referencia del pago.' }

  const idEfectivo = tipo === 'soporte' ? supabaseId : id
  if (!(await puedeSubirComprobante(tipo, idEfectivo, supabaseId))) {
    return { error: 'No puedes adjuntar un comprobante a este pago.' }
  }

  const path = `${prefijoDe(tipo, idEfectivo)}${randomBytes(16).toString('hex')}.${ext}`
  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET_COMPROBANTES)
      .createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[comprobantes] createSignedUploadUrl:', error)
      return { error: 'No se pudo preparar la subida. Intenta de nuevo.' }
    }
    return { subida: { path: data.path, token: data.token } }
  } catch (error) {
    console.error('[comprobantes] error inesperado:', error)
    return { error: 'No se pudo preparar la subida. Intenta de nuevo.' }
  }
}
