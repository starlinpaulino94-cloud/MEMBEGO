'use server'

import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

export async function establecerContrasenaCliente(
  token: string,
  password: string
): Promise<{ success?: string; error?: string }> {
  try {
    const user = await sinEmpresa('establecer-contrasena-cliente', (tx) =>
      tx.user.findFirst({
        where: { establecerContrasenaToken: token },
        select: { id: true, supabaseId: true, establecerContrasenaExpira: true },
      })
    )

    if (!user) {
      return { error: 'Token inválido. Solicita un nuevo enlace de acceso.' }
    }

    if (!user.establecerContrasenaExpira || user.establecerContrasenaExpira < new Date()) {
      return { error: 'El enlace ha expirado. Solicita un nuevo enlace de acceso.' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase.auth.admin.updateUserById(user.supabaseId, {
      password: password,
    })

    if (error) {
      console.error('[excursiones] establecerContrasenaCliente:', error)
      return { error: 'No se pudo actualizar la contraseña. Intenta de nuevo.' }
    }

    await sinEmpresa('establecer-contrasena-cliente:limpiar-token', (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { establecerContrasenaToken: null, establecerContrasenaExpira: null },
      })
    )

    return { success: 'Contraseña establecida. Ahora puedes iniciar sesión.' }
  } catch (e) {
    console.error('[excursiones] establecerContrasenaCliente:', e)
    return { error: 'Error al procesar la solicitud. Intenta de nuevo.' }
  }
}
