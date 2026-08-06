'use server'

import { revalidatePath } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'

// F5.2: intereses del cliente (categorías favoritas). Alimentan las
// recomendaciones del feed y el onboarding B2C.

export interface InteresesState {
  error?: string
  success?: boolean
}

export async function guardarIntereses(
  _prev: InteresesState,
  formData: FormData
): Promise<InteresesState> {
  const user = await getUser()
  if (!user?.metadata.dbUserId || user.metadata.role !== 'CLIENTE') {
    return { error: 'Inicia sesión como cliente.' }
  }
  const userId = user.metadata.dbUserId

  const categoryIds = formData
    .getAll('categoryIds')
    .map(String)
    .filter(Boolean)
    .slice(0, 17)

  try {
    // Solo categorías reales y activas.
    const validas = await sinEmpresa(
      'intereses: validar categorías activas del usuario',
      (tx) =>
        tx.businessCategory.findMany({
          where: { id: { in: categoryIds }, active: true },
          select: { id: true },
        })
    )

    await sinEmpresa(
      'intereses: guardar intereses del usuario (no pertenecen a una empresa)',
      (tx) =>
        Promise.all([
          tx.userInteres.deleteMany({ where: { userId } }),
          ...(validas.length > 0
            ? [
                tx.userInteres.createMany({
                  data: validas.map((c) => ({ userId, categoryId: c.id })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ])
    )

    revalidatePath('/mis-membresias')
    revalidatePath('/cliente/promociones')
    revalidatePath('/cliente/ayuda')
    return { success: true }
  } catch (e) {
    console.error('[intereses] guardar', e)
    return { error: 'No se pudieron guardar. Intenta de nuevo.' }
  }
}
