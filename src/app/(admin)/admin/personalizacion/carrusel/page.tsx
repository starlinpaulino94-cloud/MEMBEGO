import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { PageHeader } from '@/components/ui/page-header'
import { CarruselLista } from '@/components/admin/CarruselLista'
import { BannersAMedida } from '@/components/admin/BannersAMedida'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { bannersAMedida } from '@/modules/home/banners-medida'
import { rutaDeEdicionDePieza } from '@/modules/home/banner-hero'
import { filasDeCarrusel } from '@/modules/home/novedades-auto'
import { MAX_CARRUSEL, FORMATOS_BANNER_INFO, plantillasDisponibles } from '@/modules/home/banner-formatos'
import type { FilaDeCarruselVista } from '@/modules/home/banners-acciones'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Carrusel del inicio' }

/**
 * EL CARRUSEL DEL INICIO COMO LISTA (aprobado 2026-10-29).
 *
 * Lo que la empresa publica entra solo al carrusel de sus clientes, de lo más
 * reciente a lo más viejo. Aquí NO se arma nada: se ve qué está dentro y qué no,
 * y se decide sobre cada pieza —fijarla arriba, ocultarla, cambiarle la
 * plantilla—. Los banners a medida (imagen propia, titular, destino) se listan
 * arriba, con editar y quitar; se arman en el editor de inicio.
 */
export default async function CarruselPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const [filas, medida, puedeEditar] = await Promise.all([
    filasDeCarrusel(companyId),
    bannersAMedida(companyId),
    tieneCapacidad(companyId, 'HOME_BUILDER'),
  ])

  const vista: FilaDeCarruselVista[] = filas.map((f) => ({
    clave: f.pieza.clave,
    origen: f.pieza.origen,
    id: f.pieza.id,
    hrefEditar: rutaDeEdicionDePieza(f.pieza.origen, f.pieza.id),
    titulo: f.pieza.titulo,
    imagen: f.pieza.imagen,
    precio: f.pieza.precio,
    publicadoEn: f.pieza.publicadoEn.toISOString(),
    vence: f.pieza.vence ? f.pieza.vence.toISOString() : null,
    plantilla: f.plantilla,
    plantillaManual: f.ajuste.plantilla != null,
    plantillas: plantillasDisponibles({ origen: f.pieza.origen, nImagenes: f.pieza.imagenes.length, vence: !!f.pieza.vence }).map((id) => ({
      id,
      nombre: FORMATOS_BANNER_INFO[id].nombre,
    })),
    fijado: f.ajuste.fijado,
    oculto: f.ajuste.oculto,
    enCarrusel: f.enCarrusel,
    motivoFuera: f.motivoFuera,
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Carrusel del inicio"
        description="Todos los banners de tu negocio: los que armaste tú y los que se crean solos con lo que publicas. Desde aquí los editas, los quitas o decides cuáles van primero."
      />
      <BannersAMedida
        banners={medida.publicados}
        puedeEditar={puedeEditar}
        hayBorrador={medida.hayBorrador}
        bloqueApagado={medida.bloqueApagado}
      />
      <section className="space-y-3" aria-labelledby="banners-auto-titulo">
        <div>
          <h2 id="banners-auto-titulo" className="text-h4 text-foreground">
            Banners automáticos
          </h2>
          <p className="text-small text-muted-foreground">
            {`Lo que publicas entra solo al inicio, de lo más reciente a lo más viejo (hasta ${MAX_CARRUSEL} tarjetas). Fija arriba, oculta o cambia la plantilla; para cambiar el contenido, usa Editar.`}
          </p>
        </div>
        <CarruselLista filas={vista} />
      </section>
    </div>
  )
}
