import { Gift } from 'lucide-react'
import { MarcoDeOferta } from '@/components/ofertas/MarcoDeOferta'
import { TraspasoALaApp } from '@/components/public/TraspasoALaApp'
import { rutaDeOfertaLegada } from '@/modules/comercio/rutas'
import { shareMetadata } from '@/lib/share/metadata'

export const dynamic = 'force-dynamic'

/** OG genérica: el contenido del regalo NO se filtra a terceros por el link. */
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  return shareMetadata({
    title: '🎁 Tienes un regalo',
    description: 'Fuiste seleccionado para un beneficio exclusivo. Ábrelo con tu cuenta para reclamarlo.',
    url: `/oferta/${codigo}`,
  })
}

/**
 * El enlace compartido de un regalo de una empresa: CONSULTA y traspaso. No muestra el contenido del regalo —la
 * elegibilidad se decide por CUENTA— ni lee la sesión: el regalo se abre y se reclama dentro de la app
 * (`/cliente/oferta/[codigo]`), donde se conoce al cliente.
 */
export default async function OfertaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  return (
    <MarcoDeOferta>
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Gift className="h-8 w-8 text-primary" />
      </span>
      <h1 className="mt-4 text-h1 text-foreground">Tienes un regalo esperándote</h1>
      <p className="mt-2 text-muted-foreground">Abre tu cuenta para ver si este beneficio exclusivo es para ti.</p>
      <div className="mt-6 text-left">
        <TraspasoALaApp
          destino={rutaDeOfertaLegada('app', codigo)}
          titulo="Abrir mi regalo"
          descripcion="Los regalos se abren y se reclaman dentro de tu cuenta MembeGo."
          etiquetaCliente="Abrir mi regalo"
        />
      </div>
    </MarcoDeOferta>
  )
}
