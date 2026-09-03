import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import {
  ROLES_EXENTOS_PERMISOS,
  resolverPermisosUsuario,
  type PermisosUsuario,
} from '@/lib/auth/permissions'
import { hrefsNegadosPorPermisos } from '@/components/layout/nav-config'
import { AppShell } from '@/components/layout/AppShell'
import { AdminCompanySwitcher } from '@/components/admin/AdminCompanySwitcher'
import { SentryUserSync } from '@/components/SentryUserSync'
import { ADMIN_ROLES } from '@/types'
import { getUnreadCount } from '@/modules/notificaciones/actions'
import { BannerDemo } from '@/components/system/BannerDemo'
import { nombreSiEsDemo } from '@/modules/demo'
import { sistemasParaLanzador } from '@/modules/integraciones/sso'
import { contextoDeNavegacion } from '@/modules/navegacion/contexto'
import { badgesDeNavegacion } from '@/modules/navegacion/badges'

/**
 * Empresas entre las que este usuario puede cambiar: superadmin ve todas;
 * el staff multi-empresa ve su empresa actual + las de UserCompanyAccess.
 * Con 0-1 opciones el selector no se muestra (caso común).
 */
async function empresasDisponibles(
  role: string,
  dbUserId: string,
  companyId: string | null
) {
  // El conmutador de empresas cruza inquilinos POR DEFINICIÓN: su trabajo es
  // enseñar a cuáles puede cambiar esta persona, así que ninguna de estas
  // consultas cabe dentro de una sola empresa. Va con `sinEmpresa` y con el
  // motivo escrito, que es como debe leerse una renuncia al aislamiento.
  try {
    return await sinEmpresa(
      'conmutador de empresas: por definición enseña a cuáles puede cambiar el usuario',
      async (tx) => {
        if (role === 'SUPERADMIN') {
          return await tx.company.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          })
        }
        const accesos = await tx.userCompanyAccess.findMany({
          where: { userId: dbUserId },
          select: { company: { select: { id: true, name: true } } },
        })
        const mapa = new Map(accesos.map((a) => [a.company.id, a.company]))
        if (companyId && !mapa.has(companyId)) {
          const propia = await tx.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true },
          })
          if (propia) mapa.set(propia.id, propia)
        }
        return [...mapa.values()].sort((a, b) => a.name.localeCompare(b.name))
      }
    )
  } catch {
    return []
  }
}

/** Ajustes de permisos del empleado (null = hereda su rol tal cual). */
async function permisosDelUsuario(
  role: string,
  dbUserId: string
): Promise<PermisosUsuario | null> {
  if (ROLES_EXENTOS_PERMISOS.includes(role as (typeof ROLES_EXENTOS_PERMISOS)[number])) {
    return null
  }
  try {
    const fila = await sinEmpresa('permisos: ajustes del propio usuario (users es global)', (tx) =>
      tx.user.findUnique({ where: { id: dbUserId }, select: { permisos: true } })
    )
    return resolverPermisosUsuario(fila?.permisos)
  } catch {
    return null
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireRole(ADMIN_ROLES)
  // `hiddenNav` ya no lo alimenta nada aquí.
  //
  // Había una función que escondía del menú lateral las entradas «que ya viven
  // dentro de la app Car Wash»: Escanear QR, Citas, Seguimiento y Sucursales.
  // Tenía sentido mientras esos módulos fueran de una app construida dentro de
  // MembeGo. Ya no lo son —los sistemas de cada oficio se construyen aparte—, y
  // esas cuatro pantallas son de MembeGo: escanear un QR, agendar una cita o
  // ver quién no ha venido no dependen de que el negocio sea un lavadero.
  //
  // Escondidas, quien retiraba el launcher se quedaba sin ellas por ningún
  // sitio. Vuelven al menú, que es de donde salieron.
  const [notifCount, empresas, demo, sistemasExternos, permisos] = await Promise.all([
    getUnreadCount().catch(() => 0),
    empresasDisponibles(
      user.metadata.role,
      user.metadata.dbUserId,
      user.metadata.companyId ?? null
    ),
    nombreSiEsDemo(user.metadata.companyId),
    sistemasParaLanzador(user),
    // Módulo de PERMISOS: ajustes del empleado, leídos VIVOS (el menú se
    // renderiza en el servidor en cada request, así que negar una sección la
    // quita de todas las superficies de navegación de inmediato).
    permisosDelUsuario(user.metadata.role, user.metadata.dbUserId),
  ])
  const negadas = hrefsNegadosPorPermisos(user.metadata.role, permisos)

  // EL MENU YA SABE QUE HAY CAPACIDADES. No lo sabia: una empresa sin CITAS
  // veia «Citas» en el menu, la pulsaba y `requireSection` la echaba. El menu
  // ofrecia una puerta que la plataforma tenia cerrada, y quien la pulsaba no
  // entendia por que. Ahora el contexto lleva lo que la empresa tiene
  // contratado y su vertical, y esos modulos dejan de ofrecerse.
  //
  // La autorizacion NO cambia ni un apice: `requireSection` sigue negando
  // exactamente lo mismo. Lo que cambia es que ya no se ofrece lo que niega.
  const [ctx, badges] = await Promise.all([
    contextoDeNavegacion({
      role: user.metadata.role,
      companyId: user.metadata.companyId,
      // ÁMBITO EMPRESA, también para el SUPERADMIN que entre aquí: en /admin/*
      // se opera UNA empresa y el riel solo ofrece sus módulos. Volver a la
      // plataforma es una navegación explícita (píldora del header), nunca un
      // icono mezclado con los de la empresa.
      scope: 'COMPANY',
      permisos,
      ocultas: negadas,
    }),
    badgesDeNavegacion(user.metadata.role, user.metadata.companyId).catch(() => ({})),
  ])
  const nombreEmpresaActiva =
    empresas.find((e) => e.id === (user.metadata.companyId ?? null))?.name ?? null

  return (
    <AppShell
      // El menú se resuelve por el rol REAL del usuario dentro del ámbito
      // COMPANY: un SUPERADMIN aquí ve el panel de la empresa (sin quedar
      // bloqueado por permisos de empleado) y vuelve a Plataforma con la
      // píldora del header. Los roles de empresa ven lo suyo.
      ctx={ctx}
      title="MembeGo"
      userEmail={user.email}
      notifCount={notifCount}
      badges={badges}
      sistemasExternos={sistemasExternos}
      nombreEmpresa={nombreEmpresaActiva}
    >
      <SentryUserSync userId={user.metadata.dbUserId} email={user.email} role={user.metadata.role} companyId={user.metadata.companyId} />
      {/* Antes que nada: si esta empresa es de práctica, que se sepa desde el
          primer vistazo y en todas las pantallas del panel. */}
      {demo && <BannerDemo nombreEmpresa={demo} />}
      <AdminCompanySwitcher
        empresas={empresas}
        activaId={user.metadata.companyId ?? null}
      />
      {children}
    </AppShell>
  )
}
