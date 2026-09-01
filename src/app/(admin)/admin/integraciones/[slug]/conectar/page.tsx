import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { opcionesDelPaso, vistaDelAlta, type OpcionPaso } from '@/modules/connect/alta'
import { asegurarConexion } from '@/modules/connect/registro'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import { StatusBanner } from '@/components/ui/status-banner'
import { AsistenteAlta } from '@/components/connect/AsistenteAlta'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const def = proveedorDe(slug)
  return { title: def ? `Conectar ${def.metadatos.nombre}` : 'Conectar' }
}

/**
 * EL ASISTENTE DE ALTA (Connect · Fase 12).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RUTA PROPIA, Y NO UNA VENTANA FLOTANTE
 *
 * El paso de autorización SE VA DEL NAVEGADOR. El usuario acaba en el dominio
 * de Google y vuelve en una petición nueva; una ventana flotante no sobrevive
 * esa vuelta. Con ruta propia, el callback devuelve exactamente aquí y el
 * asistente recalcula en qué paso está mirando lo que ya está cumplido — no
 * hay ningún progreso guardado en el navegador que se pueda haber perdido.
 *
 * LA FILA SE CREA AL ENTRAR. El `state` firmado de OAuth se ata a una conexión
 * concreta, así que tiene que existir antes de mandar a nadie fuera.
 */
export default async function ConectarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ oauth?: string }>
}) {
  const { slug } = await params
  const { oauth } = await searchParams

  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const def = proveedorDe(slug)
  if (!def || def.clase !== 'NATIVA') notFound()
  if (!def.disponible()) redirect(`/admin/integraciones/${slug}`)

  await asegurarConexion({
    companyId,
    conectorSlug: slug,
    creadoPor: user.metadata.dbUserId ?? undefined,
  })

  const vista = await vistaDelAlta(companyId, slug)
  if (!vista) redirect(`/admin/integraciones/${slug}`)

  // Las opciones solo se piden si el paso las necesita: una llamada al
  // proveedor en cada carga del asistente sería trabajo tirado.
  let opciones: OpcionPaso[] = []
  let errorOpciones: string | null = null
  if (vista.paso?.tipo === 'ELECCION') {
    const res = await opcionesDelPaso({
      companyId,
      slug,
      conexionId: vista.conexionId,
      pasoId: vista.paso.id,
    })
    if (res.ok) opciones = res.opciones
    else errorOpciones = 'Google no respondió. Espera un momento y recarga la página.'
  }

  // A qué paso se puede volver: el anterior al actual, entre los visitables.
  const indiceActual = vista.paso
    ? vista.visitables.findIndex((p) => p.id === vista.paso?.id)
    : vista.visitables.length
  const anterior = indiceActual > 0 ? vista.visitables[indiceActual - 1] : null

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1 text-caption">
        <Link href="/admin/integraciones" className="text-muted-foreground hover:text-foreground">
          Integraciones
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <Link
          href={`/admin/integraciones/${slug}`}
          className="text-muted-foreground hover:text-foreground"
        >
          {def.metadatos.nombre}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Conectar</span>
      </nav>

      <div className="flex items-center gap-3">
        <LogoIntegracion
          slug={slug}
          nombre={def.metadatos.nombre}
          marca={def.metadatos.marca}
          className="h-12 w-12 text-lg"
        />
        <div>
          <h1 className="text-h2 font-bold">Conectar {def.metadatos.nombre}</h1>
          <p className="text-caption text-muted-foreground">{def.metadatos.descripcion}</p>
        </div>
      </div>

      {/* La vuelta del proveedor, contada en el idioma de quien la vive. El
          código de error de OAuth se queda en la bitácora. */}
      {oauth === 'cancelado' && (
        <StatusBanner variant="warning" title={`No se conectó ${def.metadatos.nombre}`}>
          No se realizaron cambios en tu cuenta. Puedes intentarlo de nuevo cuando quieras.
        </StatusBanner>
      )}
      {(oauth === 'invalido' || oauth === 'incompleto' || oauth === 'rechazado') && (
        <StatusBanner variant="destructive" title="La autorización no se completó">
          Algo se interrumpió por el camino y no se guardó nada. Vuelve a intentarlo.
        </StatusBanner>
      )}

      <AsistenteAlta
        slug={slug}
        nombre={def.metadatos.nombre}
        paso={
          vista.paso
            ? {
                id: vista.paso.id,
                titulo: vista.paso.titulo,
                descripcion: vista.paso.descripcion,
                tipo: vista.paso.tipo,
                componente: vista.paso.componente,
              }
            : null
        }
        numero={vista.progreso.numero}
        total={vista.progreso.total}
        completa={vista.completa}
        opciones={opciones}
        errorOpciones={errorOpciones}
        volverA={
          anterior
            ? {
                id: anterior.id,
                titulo: anterior.titulo,
                descripcion: anterior.descripcion,
                tipo: anterior.tipo,
              }
            : null
        }
        urlAutorizacion={`/api/connect/oauth/${encodeURIComponent(slug)}/iniciar?conexionId=${encodeURIComponent(
          vista.conexionId
        )}&volverA=${encodeURIComponent(`/admin/integraciones/${slug}/conectar`)}`}
      />
    </div>
  )
}
