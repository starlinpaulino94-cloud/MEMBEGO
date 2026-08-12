import 'server-only'
import { crearTokenSSO } from '@/modules/integraciones/nucleo'
import { conEmpresa } from '@/lib/tenant'
import { mensajeDenegado } from '@/modules/plataforma/acceso'
import { accesoASistema, sistemasDeEmpresa } from '@/modules/plataforma/registro'
import {
  TTL_SSO_SEGUNDOS,
  accesoDeUsuario,
  nuevoJti,
  returnUrlValida,
} from '@/modules/plataforma/sso'
import type { SessionUser } from '@/types'

/**
 * SSO hacia los sistemas satélite: MembeGo actúa como proveedor de identidad.
 * Un empleado/admin abre el satélite desde MembeGo con un token firmado de
 * vida corta; el satélite lo verifica con el secreto compartido y crea SU
 * propia sesión. El token lleva la empresa (tenant) — el satélite acota todo
 * a esa empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ AÑADIÓ LA FASE 5
 *
 * · `jti` — identificador único, para que el token pueda ser de un solo uso.
 * · `systemRole` — el puesto DENTRO del vertical, que el Core transporta sin
 *   interpretar.
 * · `returnUrl` — validada contra la `urlBase` del sistema y firmada con el
 *   resto. Suelta en la query, cualquiera podría cambiarla.
 *
 * Los tres son OPCIONALES en el payload: un satélite que no los mire funciona
 * exactamente igual que antes, que es lo que permite desplegar esto sin
 * coordinar una fecha con nadie.
 */

/**
 * Empresa con la que el usuario entra al satélite. El SUPERADMIN de la
 * plataforma no siempre carga `companyId` en su sesión; en modo marca única
 * opera sobre la empresa principal, y con ese tenant entra.
 */
async function empresaDelUsuario(user: SessionUser): Promise<string | null> {
  if (user.metadata.companyId) return user.metadata.companyId
  if (user.metadata.role !== 'SUPERADMIN') return null
  const { getEmpresaPrincipal } = await import('@/modules/marketplace/marcaUnica')
  return (await getEmpresaPrincipal())?.id ?? null
}

export async function urlAperturaSSO(
  slug: string,
  user: SessionUser,
  opciones: { returnUrl?: string | null } = {}
): Promise<{ url: string } | { error: string }> {
  const companyId = await empresaDelUsuario(user)
  if (!companyId) return { error: 'Tu cuenta no tiene empresa activa.' }

  // Una sola pregunta al registro: estado del sistema, compatibilidad de
  // vertical y habilitación de la empresa se deciden juntas en `acceso.ts`.
  const { decision, sistema } = await accesoASistema(slug, companyId, { conSecreto: true })
  if (!decision.permitido) {
    console.warn('[sso] acceso denegado:', slug, decision.motivo, 'empresa:', companyId)
    return { error: mensajeDenegado(decision.motivo) }
  }
  if (!sistema?.secreto) return { error: 'Sistema no disponible.' }

  // La empresa puede tener el sistema y ESTA persona no. Con `accesoPorUsuario`
  // en false —el caso de Car Wash— nadie pierde nada: entra igual que hoy.
  const acceso = await accesoDeUsuario({
    userId: user.metadata.dbUserId ?? null,
    companyId,
    sistemaId: sistema.id,
    accesoPorUsuario: sistema.accesoPorUsuario,
  })
  if (!acceso.permitido) {
    console.warn('[sso] usuario sin acceso:', slug, acceso.motivo, 'empresa:', companyId)
    return { error: 'Tu cuenta no tiene acceso a este sistema.' }
  }

  const jti = nuevoJti()
  // El nombre viaja para la AUTO-VINCULACIÓN del satélite: si la empresa no
  // existe allá, nace con su nombre real y no con un marcador. Best-effort —
  // sin nombre, el token sale igual que siempre.
  const nombreEmpresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId }, select: { name: true } })
  ).catch(() => null)
  const token = crearTokenSSO(sistema.secreto, {
    sub: user.supabaseId,
    email: user.email,
    rol: user.metadata.role,
    companyId,
    ...(nombreEmpresa?.name ? { companyName: nombreEmpresa.name } : {}),
    exp: Math.floor(Date.now() / 1000) + TTL_SSO_SEGUNDOS,
    jti,
    ...(acceso.systemRole ? { systemRole: acceso.systemRole } : {}),
    ...(acceso.permisos ? { permisos: acceso.permisos } : {}),
    // Una `returnUrl` que no apunte al propio sistema se DESCARTA en silencio
    // en vez de rechazar la apertura: lo que el usuario quería era entrar, y
    // negarle la entrada por un parámetro manipulado castiga a la víctima.
    ...(() => {
      const destino = returnUrlValida(opciones.returnUrl, sistema.urlBase)
      return destino ? { returnUrl: destino } : {}
    })(),
  })

  const base = sistema.urlBase.replace(/\/$/, '')
  return { url: `${base}/sso/membego?token=${encodeURIComponent(token)}` }
}

export interface SistemaExterno {
  slug: string
  nombre: string
}

/**
 * Sistemas que este usuario puede abrir desde la cabecera: los que su empresa
 * tiene habilitados Y a los que él tiene acceso.
 *
 * Devuelve una LISTA. Con un solo vertical la cabecera enseña un botón; con
 * varios, un menú. Que la función devuelva uno solo era la limitación que
 * obligaba a elegir por él —y con dos sistemas habilitados, elegir por él es
 * esconderle uno.
 *
 * Nunca lanza: un fallo aquí no puede tumbar el layout.
 */
export async function sistemasParaLanzador(user: SessionUser): Promise<SistemaExterno[]> {
  try {
    const companyId = await empresaDelUsuario(user)
    if (!companyId) return []

    const sistemas = await sistemasDeEmpresa(companyId)
    const accesibles: SistemaExterno[] = []
    for (const s of sistemas) {
      const acceso = await accesoDeUsuario({
        userId: user.metadata.dbUserId ?? null,
        companyId,
        sistemaId: s.id,
        accesoPorUsuario: s.accesoPorUsuario,
      })
      if (acceso.permitido) accesibles.push({ slug: s.slug, nombre: s.nombre })
    }
    return accesibles
  } catch (e) {
    console.error('[sso] sistemasParaLanzador:', e)
    return []
  }
}
