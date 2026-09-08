import Image from 'next/image'
import Link from 'next/link'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'
import { RetailSeccionHeader, RetailSeccionPie, RetailValoracion } from './RetailSeccion'

/**
 * Empresas destacadas — carrusel horizontal con la ficha completa del diseño.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * La versión anterior pintaba el nombre de la empresa DOS veces, una como
 * sobretítulo y otra como título, porque compartía un tipo de tarjeta con los
 * planes y las excursiones. Con `EmpresaInicio` cada dato tiene su sitio:
 * el nombre, el rubro, la valoración con sus reseñas, cuántos planes ofrece y
 * el gancho del más barato.
 *
 * Los sellos que el diseño pone sobre la imagen se pintan solo si hay dato:
 * «N planes» desaparece cuando la empresa no tiene ninguno, en vez de decir
 * «0 planes».
 */
export function RetailDestacadas({
  empresas,
  total,
}: {
  empresas: InicioVista['empresas']
  total: number
}) {
  if (empresas.length === 0) {
    return (
      <RetailEmptyState
        title="Empresas destacadas"
        description="No hay empresas destacadas disponibles ahora."
      />
    )
  }

  const restantes = total - empresas.length

  return (
    <section className="bg-background py-5 md:py-6" aria-labelledby="retail-destacadas">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <RetailSeccionHeader
          id="retail-destacadas"
          titulo="Empresas destacadas"
          bajada="Negocios verificados con membresía Membego"
          enlace={{ href: '/cliente/empresas', texto: 'Ver todas' }}
        />
      </div>

      <ul className="no-scrollbar mx-auto mt-3 flex max-w-6xl snap-x snap-mandatory gap-3 overflow-x-auto px-4 md:px-6">
        {empresas.map((empresa) => (
          <li key={empresa.id} className="w-64 shrink-0 snap-start md:w-72">
            <Link
              href={empresa.href}
              className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="relative aspect-16/10 bg-muted">
                {empresa.imagen ? (
                  <Image
                    src={empresa.imagen}
                    alt=""
                    fill
                    sizes="18rem"
                    className="object-cover transition-transform duration-base group-hover:scale-105"
                  />
                ) : null}
                {empresa.ciudad ? (
                  <span className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5 text-label-sm font-semibold text-foreground">
                    {empresa.ciudad}
                  </span>
                ) : null}
                {empresa.planes > 0 ? (
                  <span className="absolute bottom-2 right-2 rounded-full bg-foreground/85 px-2 py-0.5 text-label-sm font-semibold text-background">
                    {empresa.planes} {empresa.planes === 1 ? 'plan' : 'planes'}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <h3 className="line-clamp-1 text-h4 text-foreground">{empresa.nombre}</h3>
                {empresa.rubro ? (
                  <p className="line-clamp-1 text-caption text-muted-foreground">{empresa.rubro}</p>
                ) : null}
                <RetailValoracion valoracion={empresa.valoracion} resenas={empresa.resenas} />

                {empresa.planDesde ? (
                  <span className="mt-2 inline-flex w-fit items-center rounded-full border border-border px-3 py-1 text-label-md text-primary">
                    {empresa.planDesde}
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {restantes > 0 ? (
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <RetailSeccionPie href="/cliente/empresas">
            Explorar más de {restantes} empresas asociadas
          </RetailSeccionPie>
        </div>
      ) : null}
    </section>
  )
}
