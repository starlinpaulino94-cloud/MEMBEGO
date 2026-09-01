import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { getRequestMeta } from '@/lib/server-utils'
import { ESTADOS_CONECTOR, type EstadoConector } from '@/modules/connect/nucleo'
import { slugsDisponibles } from '@/modules/connect/conectores'
import { FEATURES_CONNECT, type FeatureConnect } from '@/modules/connect/entitlements'

/**
 * PANEL DEL SUPERADMIN de Membego Connect (Fase 9).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA FASE VIENE A ARREGLAR
 *
 * Las fases 3 a 8 construyeron claves de API, webhooks, OAuth, conectores y
 * documentación. Todo eso vive detrás de un ENTITLEMENT cuyo valor por defecto
 * es CERO (`api_keys.max`, `webhooks.max`), y hasta hoy no había forma de
 * concederlo: `asignarEntitlement` existía sin un solo llamador.
 *
 * O sea que ninguna empresa podía usar nada de lo construido. La puerta estaba
 * puesta, con su cerradura, y no existía la llave. Esto es la llave.
 *
 * Todo `sinEmpresa` con motivo: el superadmin administra la plataforma entera,
 * y estas lecturas cruzan inquilinos por definición.
 */

export interface ConectorAdmin {
  id: string
  slug: string
  nombre: string
  categoria: string
  authTipo: string
  estado: string
  /** ¿Está configurado en ESTE despliegue? Un ACTIVE sin config no se ofrece. */
  disponible: boolean
  conexionesTotales: number
  conexionesVivas: number
}

/** El catálogo completo, con su adopción real. */
export async function catalogoAdmin(): Promise<ConectorAdmin[]> {
  const disponibles = new Set(slugsDisponibles())
  const filas = await sinEmpresa('connect: catálogo completo con adopción (superadmin)', (tx) =>
    tx.conector.findMany({
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        slug: true,
        nombre: true,
        categoria: true,
        authTipo: true,
        estado: true,
        conexiones: { select: { estado: true } },
      },
    })
  )

  return filas.map((c) => ({
    id: c.id,
    slug: c.slug,
    nombre: c.nombre,
    categoria: c.categoria,
    authTipo: c.authTipo,
    estado: c.estado,
    disponible: disponibles.has(c.slug),
    conexionesTotales: c.conexiones.length,
    // «Vivas» es lo que importa para decidir si un conector sirve: una empresa
    // que lo conectó y lo desconectó cuenta en el total y no en la adopción.
    conexionesVivas: c.conexiones.filter((x) => x.estado === 'CONNECTED').length,
  }))
}

export interface AdopcionConnect {
  empresasConConexion: number
  clavesActivas: number
  webhooksActivos: number
  entregasUltimos7d: number
}

/** Cuánto se usa Connect, en cuatro números. */
export async function adopcionConnect(): Promise<AdopcionConnect> {
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  return sinEmpresa('connect: métricas de adopción (superadmin)', async (tx) => {
    const [conexiones, clavesActivas, webhooksActivos, entregasUltimos7d] = await Promise.all([
      tx.conexionEmpresa.findMany({
        where: { estado: 'CONNECTED' },
        select: { companyId: true },
        distinct: ['companyId'],
      }),
      tx.claveApiEmpresa.count({ where: { estado: 'ACTIVE' } }),
      tx.suscripcionWebhook.count({ where: { estado: 'ACTIVE' } }),
      tx.entregaWebhook.count({ where: { createdAt: { gte: hace7d } } }),
    ])
    return {
      empresasConConexion: conexiones.length,
      clavesActivas,
      webhooksActivos,
      entregasUltimos7d,
    }
  })
}

export interface EmpresaConnect {
  companyId: string
  nombre: string
  /** Límite efectivo por feature: el concedido, o el default si no hay fila. */
  limites: Record<FeatureConnect, number | null>
  conexionesVivas: number
  clavesActivas: number
  webhooksActivos: number
}

/**
 * Las empresas con su estado de Connect. Se listan TODAS —no solo las que ya
 * usan algo— porque la pregunta del superadmin es «¿a quién se lo habilito?»,
 * y para contestarla hacen falta las que todavía no lo tienen.
 */
export async function empresasConnect(limite = 100): Promise<EmpresaConnect[]> {
  return sinEmpresa('connect: empresas y sus concesiones (superadmin)', async (tx) => {
    const empresas = await tx.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limite,
    })
    if (empresas.length === 0) return []
    const ids = empresas.map((e) => e.id)

    const [entitlements, conexiones, claves, webhooks] = await Promise.all([
      tx.entitlementEmpresa.findMany({ where: { companyId: { in: ids } } }),
      tx.conexionEmpresa.findMany({
        where: { companyId: { in: ids }, estado: 'CONNECTED' },
        select: { companyId: true },
      }),
      tx.claveApiEmpresa.findMany({
        where: { companyId: { in: ids }, estado: 'ACTIVE' },
        select: { companyId: true },
      }),
      tx.suscripcionWebhook.findMany({
        where: { companyId: { in: ids }, estado: 'ACTIVE' },
        select: { companyId: true },
      }),
    ])

    const contar = (filas: { companyId: string }[], id: string) =>
      filas.filter((f) => f.companyId === id).length

    return empresas.map((e) => {
      const suyos = entitlements.filter((x) => x.companyId === e.id)
      const limites = {} as Record<FeatureConnect, number | null>
      for (const feature of Object.keys(FEATURES_CONNECT) as FeatureConnect[]) {
        const fila = suyos.find((x) => x.feature === feature)
        limites[feature] = fila ? fila.limite : FEATURES_CONNECT[feature].default
      }
      return {
        companyId: e.id,
        nombre: e.name,
        limites,
        conexionesVivas: contar(conexiones, e.id),
        clavesActivas: contar(claves, e.id),
        webhooksActivos: contar(webhooks, e.id),
      }
    })
  })
}

/**
 * Cambia el estado de un conector del catálogo.
 *
 * RETIRED no borra nada: las conexiones existentes conservan su historial y
 * sus credenciales. Es la misma doctrina que `SistemaConectado` — borrar una
 * fila del catálogo arrastraría en cascada lo que las empresas construyeron
 * encima.
 */
export async function cambiarEstadoConector(
  id: string,
  estado: EstadoConector
): Promise<{ ok: boolean }> {
  if (!ESTADOS_CONECTOR.includes(estado)) return { ok: false }
  const r = await sinEmpresa('connect: cambiar estado de un conector (superadmin)', (tx) =>
    tx.conector.updateMany({ where: { id }, data: { estado } })
  ).catch(anotarFallo('connect:superadmin:estado-conector', { id }))
  return { ok: (r?.count ?? 0) > 0 }
}

/**
 * Rastro de lo que el superadmin concede.
 *
 * Conceder claves de API a una empresa le abre sus datos a terceros. Es una
 * decisión comercial con consecuencias de seguridad, y no puede quedar sin
 * nombre y sin fecha. FAIL-OPEN como el resto de la auditoría de plataforma:
 * no poder anotar no puede impedir conceder.
 */
export async function auditarConnect(
  accion: 'CONNECT_CONCEDIDO' | 'CONNECT_CONECTOR_ESTADO',
  entidadId: string,
  userId: string | null,
  payload: Record<string, string | number | boolean | null>
): Promise<void> {
  const meta = await getRequestMeta()
  await sinEmpresa('connect: registrar la decisión del superadmin', (tx) =>
    tx.auditLog.create({
      data: {
        companyId: null,
        userId,
        accion,
        entidadTipo: 'Connect',
        entidadId,
        payload,
        ...meta,
      },
    })
  ).catch(anotarFallo('connect:superadmin:auditLog', { accion, entidadId }))
}
