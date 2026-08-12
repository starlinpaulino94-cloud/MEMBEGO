import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { Pencil, Shield, UserCog, Users, UserX } from 'lucide-react'
import { ROL_LABEL } from '@/types'
import { desdeHace, plural } from '@/lib/plural'
import { listarUsuarios, type UsuarioFila } from '@/modules/usuarios/lista'
import {
  DIAS_INACTIVO,
  POR_PAGINA,
  hrefPagina,
  leerFiltroUsuarios,
  type FiltroUsuarios,
} from '@/modules/usuarios/filtros'
import { FiltrosUsuarios } from '@/components/superadmin/FiltrosUsuarios'
import { EmpresasDeUsuario } from '@/components/superadmin/EmpresasDeUsuario'
import { EntrarComoCard } from '@/components/superadmin/EntrarComoCard'
import { SuperadminToggle } from '@/components/superadmin/SuperadminToggle'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Usuarios y accesos' }

const BASE = '/superadmin/usuarios'

function TarjetaUsuario({ u, esYo }: { u: UsuarioFila; esYo: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`rounded-lg p-2 ${u.esSuperadmin ? 'bg-warning/15' : 'bg-info/15'}`}
            >
              {u.esSuperadmin ? (
                <Shield aria-hidden className="h-5 w-5 text-warning" />
              ) : (
                <UserCog aria-hidden className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{u.name}</p>
              <p className="truncate text-caption text-muted-foreground">{u.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/*
              EL LÁPIZ, TAMBIÉN PARA LOS SUPERADMIN.
              Se ocultaba si el rol era SUPERADMIN, así que corregirle una letra
              al nombre de un superadmin exigía entrar en la base de datos. Lo
              que hay que proteger es el RANGO —y se protege en el servidor y se
              cambia con el botón de al lado, con su confirmación—, no el nombre.
            */}
            <Link href={`${BASE}/${u.id}`}>
              <Button size="icon" variant="ghost" aria-label={`Editar a ${u.name}`}>
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <SuperadminToggle
              userId={u.id}
              nombre={u.name}
              esSuperadmin={u.esSuperadmin}
              esYo={esYo}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Badge
            variant={u.esSuperadmin ? 'outline' : 'secondary'}
            className={
              u.esSuperadmin
                ? 'border-warning/40 bg-warning/10 text-caption font-medium text-warning'
                : 'text-caption'
            }
          >
            {ROL_LABEL[u.role] ?? u.role}
          </Badge>
          <EmpresasDeUsuario empresas={u.empresas} />
        </div>

        {/*
          «Actividad», no «último acceso», y la diferencia no es de estilo: la
          bitácora registra lo que se HACE, no que se entre a mirar. Llamarlo
          «último acceso» prometería una precisión que este dato no tiene.
        */}
        <p className="mt-3 border-t border-border/50 pt-3 text-caption text-muted-foreground">
          Actividad: {desdeHace(u.desdeUltimaActividad)}
        </p>
      </CardContent>
    </Card>
  )
}

function Paginacion({ f, total }: { f: FiltroUsuarios; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (paginas <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Paginación">
      <Link
        href={hrefPagina(f, BASE, Math.max(1, f.pagina - 1))}
        aria-disabled={f.pagina <= 1}
        className={`rounded-xl border border-input px-3 py-2 text-sm ${
          f.pagina <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
        }`}
      >
        Anterior
      </Link>
      <span className="text-small text-muted-foreground">
        Página {f.pagina} de {paginas}
      </span>
      <Link
        href={hrefPagina(f, BASE, Math.min(paginas, f.pagina + 1))}
        aria-disabled={f.pagina >= paginas}
        className={`rounded-xl border border-input px-3 py-2 text-sm ${
          f.pagina >= paginas ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
        }`}
      >
        Siguiente
      </Link>
    </nav>
  )
}

/**
 * CONTROL DE ACCESOS DE LA PLATAFORMA.
 *
 * Se llamaba «Usuarios de staff» y justo debajo tenía una caja que acepta
 * CLIENTES. Dos alcances distintos en la misma pantalla, y el título describía
 * solo uno de los dos.
 *
 * Y el orden estaba invertido: lo PRIMERO que se veía al abrir el control de
 * accesos era la herramienta de suplantar a alguien. Lo que se viene a hacer
 * aquí el 95 % de las veces es buscar a una persona; suplantarla es la
 * excepción, y las excepciones no van arriba del todo.
 */
export default async function UsuariosYAccesosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sesion = await requireRole('SUPERADMIN')
  const f = leerFiltroUsuarios(await searchParams)
  const d = await listarUsuarios(f)

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-h1 text-foreground">Usuarios y accesos</h1>
        <p className="text-small text-muted-foreground">
          Quién es staff, qué rol tiene y qué empresas puede gestionar. Desde
          aquí también se otorga el rango de superadmin y se entra como
          cualquier usuario.
        </p>
      </div>

      {/*
        TRES CIFRAS, Y LAS DOS ÚLTIMAS SON PREGUNTAS DE SEGURIDAD, no adorno.
        «Superadmins» es la cifra que hay que poder mirar de un vistazo —cuántas
        personas tienen control total— y antes no se podía ni preguntar.
        «Sin actividad» es la otra: qué accesos siguen abiertos sin usarse.
        Las dos llevan a la lista YA FILTRADA, no a una pantalla que hay que
        volver a acotar a mano.
      */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Usuarios de staff" value={d.totalSinFiltro} icon={Users} accent="brand" />
        <StatCard
          label="Superadmins"
          value={d.superadmins}
          icon={Shield}
          accent={d.superadmins > 3 ? 'warning' : 'brand'}
          sub="Control total de la plataforma"
          href={`${BASE}?rol=SUPERADMIN`}
          hrefLabel="Ver solo los superadmins"
        />
        <StatCard
          label={`Sin actividad en ${DIAS_INACTIVO} días`}
          value={d.inactivos}
          icon={UserX}
          accent={d.inactivos > 0 ? 'warning' : 'success'}
          sub="Accesos que quizá sobran"
          href={`${BASE}?inactivos=1`}
          hrefLabel="Ver las cuentas sin actividad reciente"
        />
      </div>

      <FiltrosUsuarios f={f} empresas={d.empresas} />

      <p className="text-caption text-muted-foreground">
        {d.total} de {plural(d.totalSinFiltro, 'usuario', 'usuarios')}
      </p>

      {d.filas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users aria-hidden className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">
              {d.totalSinFiltro === 0 ? 'Sin usuarios de staff' : 'Sin resultados'}
            </p>
            <p className="text-sm">
              {d.totalSinFiltro === 0
                ? 'Crea una empresa con su administrador desde el panel de empresas.'
                : 'Ajusta los filtros o la búsqueda.'}
            </p>
            {d.totalSinFiltro > 0 && (
              <Link href={BASE} className="mt-3 inline-block text-small text-primary hover:underline">
                Limpiar filtros
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.filas.map((u) => (
            <TarjetaUsuario key={u.id} u={u} esYo={u.id === sesion.metadata.dbUserId} />
          ))}
        </div>
      )}

      <Paginacion f={f} total={d.total} />

      {/* La excepción, al final. Ver la nota del componente de la página. */}
      <EntrarComoCard />
    </div>
  )
}
