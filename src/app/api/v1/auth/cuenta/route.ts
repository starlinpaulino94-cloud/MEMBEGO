import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { sinEmpresa } from '@/lib/tenant'
import { purgarClienteRow } from '@/modules/superadmin/purgar'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function DELETE(request: Request) {
  const user = await getApiClientUser(request)
  if (!user || user.metadata.role !== 'CLIENTE') {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const fichas = await sinEmpresa('cuenta: buscar fichas propias para purga', (tx) =>
      tx.cliente.findMany({
        where: { supabaseId: user.supabaseId },
        select: { id: true },
      })
    )

    for (const ficha of fichas) await purgarClienteRow(ficha.id)

    const userRow = await sinEmpresa('cuenta: localizar usuario propio', (tx) =>
      tx.user.findUnique({ where: { supabaseId: user.supabaseId }, select: { id: true } })
    )
    if (userRow) {
      await sinEmpresa('cuenta: borrar notificaciones y usuario propio', async (tx) => {
        await tx.notificacion.deleteMany({ where: { userId: userRow.id } })
        await tx.user.delete({ where: { id: userRow.id } })
      })
    }

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.deleteUser(user.supabaseId)
    if (error) throw error

    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/auth/cuenta] Error eliminando cuenta:', error)
    return NextResponse.json(
      { error: 'No se pudo completar la eliminación. Contacta a soporte.' },
      { status: 500, headers: corsHeaders(request) },
    )
  }
}
