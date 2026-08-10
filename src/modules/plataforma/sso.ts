import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  TTL_SSO_SEGUNDOS,
  nuevoJti,
  returnUrlValida,
} from '@/modules/plataforma/sso-nucleo'

/**
 * Las partes PURAS —el TTL, el `jti` y la validación de `returnUrl`— viven en
 * `sso-nucleo.ts` y aquí se reexportan: así se pueden probar sin base de datos,
 * que es el mismo reparto que ya usan `integraciones/nucleo.ts` y su despacho.
 */
export { TTL_SSO_SEGUNDOS, nuevoJti, returnUrlValida }

/**
 * PLATAFORMA · Fase 5 — ACCESO POR USUARIO Y USO ÚNICO DEL SSO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL NIVEL QUE FALTABA
 *
 * La Fase 1b contestó «¿tiene esta EMPRESA este sistema?». Faltaba «¿y esta
 * PERSONA, con qué puesto?». Sin eso, un satélite recibe a todo el equipo con
 * el mismo rol de MembeGo y tiene que inventarse quién es camarero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CORE NO SABE QUÉ ES UN CAMARERO, Y NO DEBE SABERLO
 *
 * `systemRole` es una cadena libre. MembeGo la guarda y la mete en el token;
 * interpretarla es del vertical. Un enum obligaría a desplegar el Core cada vez
 * que un vertical inventara un puesto — la dependencia que esta arquitectura
 * existe para eliminar (§50).
 */

export interface AccesoUsuario {
  /** Puesto dentro del vertical, o `null` si no hay fila. */
  systemRole: string | null
  permisos: Record<string, unknown> | null
  /** ¿Puede entrar? Con `accesoPorUsuario` en false, siempre sí. */
  permitido: boolean
  motivo: 'SIN_RESTRICCION' | 'ACCESO_CONCEDIDO' | 'SIN_ACCESO' | 'ACCESO_SUSPENDIDO'
}

/**
 * ¿Puede esta persona entrar a este sistema, y con qué puesto?
 *
 * `accesoPorUsuario` decide si la ausencia de fila abre o cierra la puerta:
 *
 *   false (por defecto) — cualquiera del equipo entra, como hasta hoy. Si hay
 *     fila, se usa su `systemRole`; si no, viaja `null` y el satélite decide.
 *   true               — hace falta fila ACTIVE. Es el modo que un vertical
 *     elige cuando quiere control fino.
 *
 * El default preserva Car Wash: exigir de golpe una fila por persona dejaría a
 * toda la plantilla fuera el día del despliegue.
 */
export async function accesoDeUsuario(args: {
  userId: string | null
  companyId: string
  sistemaId: string
  accesoPorUsuario: boolean
}): Promise<AccesoUsuario> {
  const { userId, companyId, sistemaId, accesoPorUsuario } = args

  const fila = userId
    ? await conEmpresa(companyId, (tx) =>
        tx.usuarioSistema.findUnique({
          where: { userId_sistemaId_companyId: { userId, sistemaId, companyId } },
          select: { systemRole: true, estado: true, permisos: true },
        })
      ).catch(() => null)
    : null

  if (fila?.estado === 'SUSPENDED') {
    // Suspender cierra la puerta SIEMPRE, también en modo abierto. Es una
    // revocación explícita, y lo explícito gana a la política — la misma regla
    // que en las habilitaciones de empresa.
    return { systemRole: null, permisos: null, permitido: false, motivo: 'ACCESO_SUSPENDIDO' }
  }

  if (fila?.estado === 'ACTIVE') {
    return {
      systemRole: fila.systemRole,
      permisos: (fila.permisos as Record<string, unknown> | null) ?? null,
      permitido: true,
      motivo: 'ACCESO_CONCEDIDO',
    }
  }

  if (accesoPorUsuario) {
    return { systemRole: null, permisos: null, permitido: false, motivo: 'SIN_ACCESO' }
  }
  return { systemRole: null, permisos: null, permitido: true, motivo: 'SIN_RESTRICCION' }
}

// ── Uso único ───────────────────────────────────────────────────────────────

export type ResultadoCanjeJti = 'PRIMERO' | 'YA_USADO' | 'NO_COMPROBABLE'

/**
 * Marca el token como canjeado. Devuelve `PRIMERO` solo la primera vez.
 *
 * ES UN INSERT, NO UN «LEER Y ESCRIBIR». El `jti` es la clave primaria: el
 * segundo canje choca. Comprobar antes y marcar después dejaría la ventana en
 * la que dos peticiones leen «sin usar» y las dos entran — y con un token que
 * abre una sesión, eso es exactamente el ataque que el uso único evita.
 *
 * `NO_COMPROBABLE` cuando la escritura falla por algo que no es un duplicado
 * (la tabla aún no existe, la base no responde). Quien llama decide: el SSO de
 * salida sigue —no empeora nada respecto de hoy, donde no había uso único— y
 * se deja constancia.
 */
export async function marcarTokenUsado(args: {
  jti: string
  sistemaId: string
  companyId: string
  direccion: 'SALIENTE' | 'ENTRANTE'
  expiraAt: Date
}): Promise<ResultadoCanjeJti> {
  try {
    await sinEmpresa('sso: registrar el canje de un token (catálogo de integración)', (tx) =>
      tx.tokenSSOUsado.create({ data: args })
    )
    return 'PRIMERO'
  } catch (e) {
    const codigo = (e as { code?: string })?.code
    if (codigo === 'P2002') return 'YA_USADO'
    void anotarFallo('sso:marcar-token', { jti: args.jti })(e)
    return 'NO_COMPROBABLE'
  }
}

/**
 * Purga los tokens ya caducados (cron). Una fila solo protege mientras el token
 * pudiera valer; después es historial de quién entró y cuándo, que no es lo que
 * esta tabla viene a guardar.
 */
export async function purgarTokensSSO(): Promise<number> {
  const r = await sinEmpresa('sso: purgar tokens caducados (cron global)', (tx) =>
    tx.tokenSSOUsado.deleteMany({ where: { expiraAt: { lte: new Date() } } })
  ).catch(() => ({ count: 0 }))
  return r.count
}
