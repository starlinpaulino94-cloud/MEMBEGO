'use client'

import { Suspense, useCallback, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppHeader } from '@/components/layout/AppHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import { NavProgress } from '@/components/layout/NavProgress'
import type { BadgesNav } from '@/components/layout/NavPanel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import type { CompanyOption } from '@/components/cliente/CompanySwitcher'
import type { ContextoNav } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA CARCASA DE LA APLICACIÓN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA GEOMETRÍA, Y POR QUÉ ES ASÍ EXACTAMENTE
 *
 * Raíz en `flex` con `overflow-x-clip`; el menú es un hijo `sticky top-0
 * h-screen self-start`; el contenido es el otro hijo y hace scroll con la
 * página.
 *
 * `overflow-x-clip` y NO `overflow-x-hidden`. Parecen sinónimos y no lo son:
 * `hidden` convierte al elemento en un contenedor de scroll, y un contenedor
 * de scroll intermedio ROMPE `position: sticky` de sus descendientes — el menú
 * se despega y sube con la página. `clip` recorta sin crear contenedor, que es
 * lo único que aquí hace falta (evitar la barra horizontal que provoca una
 * tabla ancha).
 *
 * `self-start` en el menú. Un hijo de flex se estira a la altura del
 * contenedor por defecto; con `align-self: stretch` el menú mediría lo que
 * mide la página entera y `sticky` no tendría contra qué pegarse. Con
 * `self-start` mide `h-screen` y se queda quieto mientras el contenido corre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MODO COMPACTO NO PARPADEA
 *
 * La preferencia vive en `localStorage`, que el servidor no puede leer: si se
 * aplicara al hidratar, todo el mundo con el menú plegado vería el panel
 * ancho durante un instante y luego encogerse. Es el mismo problema del tema
 * claro/oscuro y se resuelve igual — un script diminuto que corre ANTES de
 * pintar y marca `<html data-nav-compacto>`, más una regla CSS que oculta el
 * panel. React sigue renderizando lo mismo en servidor y cliente (así que no
 * hay desajuste de hidratación) y el estado de React se pone al día justo
 * después, que es cuando empieza a hacer falta para el flyout.
 */

const CLAVE_COMPACTO = 'membego.nav.compacto.v1'

/** Roles con navegación inferior en móvil (experiencia principalmente táctil). */
const BOTTOM_NAV_ROLES: readonly AppRole[] = ['CLIENTE']

/**
 * Se ejecuta antes del primer pintado. Va en texto plano y sin dependencias a
 * propósito: cualquier import lo retrasaría hasta después del pintado, que es
 * exactamente lo que intenta evitar.
 */
const SCRIPT_COMPACTO = `try{document.documentElement.dataset.navCompacto=localStorage.getItem('${CLAVE_COMPACTO}')==='1'?'1':'0'}catch(e){}`

/**
 * LA PREFERENCIA SE LEE, NO SE COPIA A UN ESTADO.
 *
 * `localStorage` es una fuente externa: con `useSyncExternalStore`, React la
 * consulta en cada render y devuelve `false` en el servidor, que es lo correcto
 * —el servidor no puede saberlo— sin que haya un efecto copiando el valor a un
 * `useState`. Un efecto que hace `setState` al montar encadena un render extra
 * y abre una ventana en la que el estado de React y el almacenamiento dicen
 * cosas distintas.
 *
 * El parpadeo visual no lo evita esto, sino el script de arriba: aquí solo se
 * asegura que la LÓGICA (el flyout) sepa lo mismo que ya se está pintando.
 */
const oyentes = new Set<() => void>()

function suscribirCompacto(alCambiar: () => void) {
  oyentes.add(alCambiar)
  return () => {
    oyentes.delete(alCambiar)
  }
}

function leerCompacto(): boolean {
  try {
    return localStorage.getItem(CLAVE_COMPACTO) === '1'
  } catch {
    // Sin almacenamiento (modo privado, permisos): el menú funciona, solo no
    // recuerda. Nunca es un error que valga la pena reportar.
    return false
  }
}

/** En el servidor no hay preferencia que leer: se pinta expandido. */
const compactoEnServidor = () => false

function guardarCompacto(valor: boolean) {
  try {
    localStorage.setItem(CLAVE_COMPACTO, valor ? '1' : '0')
  } catch {
    /* idem */
  }
  document.documentElement.dataset.navCompacto = valor ? '1' : '0'
  for (const oyente of oyentes) oyente()
}

/**
 * Destino de "Ayuda" en el menú de usuario, por rol. Solo el cliente tiene
 * hoy una pantalla de ayuda propia; el personal la pide por Soporte, que ya
 * está en su menú. Sin destino, la entrada no se pinta.
 */
function ayudaParaRol(role: AppRole): string | null {
  return role === 'CLIENTE' ? '/cliente/ayuda' : null
}

export function AppShell({
  ctx,
  title,
  userEmail,
  userName,
  notifCount = 0,
  badges,
  companies,
  qrHref,
  sistemasExternos,
  nombreEmpresa,
  children,
}: {
  /**
   * Rol, capacidades encendidas, vertical y rutas negadas. Se arma en el
   * servidor y viaja como datos planos: aquí NO llega la sesión ni nada
   * sensible, solo lo que hace falta para decidir qué se ofrece.
   */
  ctx: ContextoNav
  title: string
  userEmail: string
  /** Nombre de la persona cuando se conoce; si no, manda el correo. */
  userName?: string | null
  notifCount?: number
  /** Contadores REALES del menú. Los que fallaron no vienen y no se pintan. */
  badges?: BadgesNav
  companies?: CompanyOption[]
  /** Destino del dock central "Mi QR" en la barra inferior (cliente). */
  qrHref?: string | null
  /** Sistema satélite conectado: el header ofrece el acceso directo por SSO. */
  sistemasExternos?: { slug: string; nombre: string }[]
  /** Nombre de la empresa activa para la píldora de ámbito (solo texto). */
  nombreEmpresa?: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const hasBottomNav = BOTTOM_NAV_ROLES.includes(ctx.role)

  const compacto = useSyncExternalStore(
    suscribirCompacto,
    leerCompacto,
    compactoEnServidor
  )
  const alternarCompacto = useCallback(() => guardarCompacto(!leerCompacto()), [])

  /**
   * EL CAJÓN MÓVIL SE CIERRA SOLO AL CAMBIAR DE RUTA, SIN UN EFECTO QUE LO
   * CIERRE.
   *
   * Lo que se guarda no es «abierto/cerrado» sino LA RUTA EN LA QUE SE ABRIÓ.
   * Está abierto mientras esa ruta siga siendo la actual; en cuanto el
   * enrutador aterriza en otra, la condición deja de cumplirse y se cierra en
   * el mismo render.
   *
   * Cerrarlo por cambio de ruta y no en el `onClick` del enlace importa por
   * dos motivos: así se cierra también cuando la navegación sale de las migas
   * o de un botón de la pantalla, y NUNCA se cierra antes de tiempo si la
   * navegación falla —el usuario se queda donde estaba, con su menú abierto.
   */
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null)
  const movilAbierto = abiertoEn !== null && abiertoEn === pathname
  const setMovilAbierto = useCallback(
    (abierto: boolean) => setAbiertoEn(abierto ? pathname : null),
    [pathname]
  )

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_COMPACTO }} />

      {/* `useSearchParams` obliga a un límite de suspensión; la barra es
          decorativa, así que su respaldo es nada. */}
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>

      <div className="flex min-h-screen w-full overflow-x-clip bg-background">
        {/* Menú de escritorio. `self-start` + `h-screen` es lo que hace que
            `sticky` funcione dentro de un contenedor flex (ver cabecera). */}
        <aside
          aria-label="Navegación principal"
          className="sticky top-0 hidden h-screen shrink-0 self-start lg:block"
        >
          <AppSidebar
            ctx={ctx}
            badges={badges}
            compacto={compacto}
            onToggleCompacto={alternarCompacto}
            userEmail={userEmail}
            userName={userName}
            ayudaHref={ayudaParaRol(ctx.role)}
          />
        </aside>

        {/* Cajón móvil. Es el Sheet del sistema de diseño —Radix Dialog por
            dentro—, así que el foco entra, se queda dentro, Escape cierra y al
            cerrar vuelve al botón que lo abrió. Todo eso estaba escrito a mano
            aquí y era ~60 líneas de gestión de foco que nadie probaba. */}
        <Sheet open={movilAbierto} onOpenChange={setMovilAbierto}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-auto max-w-[calc(100vw-3rem)] gap-0 border-r-0 bg-sidebar-rail p-0 sm:max-w-none lg:hidden"
          >
            {/* Radix exige título y descripción accesibles; se anuncian al
                lector de pantalla y no se pintan. */}
            <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
            <SheetDescription className="sr-only">
              Espacios de trabajo y módulos disponibles para tu cuenta.
            </SheetDescription>
            {/* MISMA navegación filtrada que el escritorio: no hay una segunda
                lista de módulos que se quede atrás. */}
            <AppSidebar
              ctx={ctx}
              badges={badges}
              variante="movil"
              userEmail={userEmail}
              userName={userName}
              ayudaHref={ayudaParaRol(ctx.role)}
            />
          </SheetContent>
        </Sheet>

        {/* Columna de contenido. `min-w-0` para que una tabla ancha empuje su
            propio scroll y no el de la página. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            ctx={ctx}
            title={title}
            notifCount={notifCount}
            companies={companies}
            onMenuClick={() => setMovilAbierto(true)}
            sistemasExternos={sistemasExternos}
            nombreEmpresa={nombreEmpresa}
            userEmail={userEmail}
            userName={userName}
            ayudaHref={ayudaParaRol(ctx.role)}
          />

          {/* Contenedor de página — la convención de espaciado vive AQUÍ, no
              en cada pantalla. Ancho máximo 1280px y padding 16/24/32 según
              tamaño. Una página no debe volver a declarar su propio `max-w-*`
              ni su padding lateral: si lo hace, se desalinea del resto. Lo que
              sí decide cada pantalla es la separación entre SUS secciones. */}
          <main
            className={cn(
              'mx-auto w-full max-w-7xl px-4 py-8 md:px-6 lg:px-8',
              // Hueco para la barra inferior. La clase vive en `globals.css`
              // porque necesita `env(safe-area-inset-bottom)`.
              hasBottomNav && 'con-dock-inferior'
            )}
          >
            {children}
          </main>
        </div>

        {hasBottomNav && (
          <BottomNav role={ctx.role} qrHref={qrHref} hiddenNav={[...(ctx.ocultas ?? [])]} />
        )}
      </div>
    </>
  )
}
