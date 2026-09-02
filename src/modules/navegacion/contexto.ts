import { getCapacidadesEmpresa } from '@/modules/capacidades/resolver'
import type { PermisosUsuario } from '@/lib/auth/permissions'
import type {
  CapacidadNav,
  ContextoNav,
  TipoEmpresaNav,
} from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * EL PUENTE entre lo que sabe el servidor y lo que necesita el menú.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CRUZA Y QUÉ NO
 *
 * Cruza cuatro cosas: el rol, las capacidades ENCENDIDAS, el vertical y las
 * rutas ya negadas por permisos. Nada más.
 *
 * NO cruza la sesión, ni el correo, ni el identificador de la empresa, ni el
 * objeto de permisos completo. El menú no los necesita para decidir qué
 * ofrecer, y todo lo que se manda al navegador es información que alguien
 * puede leer. Un contexto de navegación que lleva la sesión entera es una
 * fuga esperando a que alguien mire el HTML.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FAIL-OPEN, IGUAL QUE EL RESOLUTOR
 *
 * Si las capacidades no se pueden leer, `capacidades` viaja como `undefined` y
 * el menú NO filtra por capacidad. Es deliberado y es la misma regla del
 * resolutor del servidor: una empresa viva no puede perder módulos de su menú
 * porque una consulta falló. Y no abre ninguna puerta — quien pulse un módulo
 * apagado se encuentra con `requireSection`, que es la barrera de verdad.
 */

/** Las capacidades que el menú consulta. El resto no le afecta. */
const CAPACIDADES_DEL_MENU: readonly CapacidadNav[] = [
  'CITAS',
  'SEGUIMIENTO',
  'RULETA',
  'EXCURSIONES',
  'POS_CAJA',
]

const VERTICALES: readonly TipoEmpresaNav[] = [
  'CAR_WASH',
  'BARBERIA',
  'RESTAURANTE',
  'GYM',
  'EXCURSIONES',
]

function comoVertical(codigo: string): TipoEmpresaNav | null {
  return (VERTICALES as readonly string[]).includes(codigo)
    ? (codigo as TipoEmpresaNav)
    : null
}

export async function contextoDeNavegacion({
  role,
  companyId,
  permisos = null,
  ocultas = [],
}: {
  role: AppRole
  companyId: string | null | undefined
  permisos?: PermisosUsuario | null
  /** Rutas ya descartadas (p. ej. las negadas por los ajustes del empleado). */
  ocultas?: string[]
}): Promise<ContextoNav> {
  // Sin empresa (superadmin en su panel de plataforma) no hay capacidades que
  // aplicar: sus módulos no dependen de lo que contrate nadie.
  if (!companyId) {
    return { role, permisos, ocultas }
  }

  try {
    const { categoria, activas } = await getCapacidadesEmpresa(companyId)
    return {
      role,
      capacidades: CAPACIDADES_DEL_MENU.filter((c) =>
        (activas as readonly string[]).includes(c)
      ),
      tipoEmpresa: comoVertical(categoria),
      permisos,
      ocultas,
    }
  } catch {
    // Ver la nota de cabecera: sin capacidades, no se filtra por capacidad.
    return { role, permisos, ocultas }
  }
}
