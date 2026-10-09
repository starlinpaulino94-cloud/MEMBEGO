import Link from 'next/link'
import { ArrowLeft, Compass } from 'lucide-react'
import { rutaDeEmpresa, type Espacio } from '@/modules/comercio/rutas'
import type { ExcursionesDeEmpresaDatos } from '@/modules/comercio/lista-excursiones'
import { ExcursionCard } from '@/components/public/ExcursionCard'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * LA LISTA DE EXCURSIONES DE UNA EMPRESA — SOLO PRESENTACIÓN, para la landing y para la app. Cada tarjeta lleva a la
 * ficha de SU espacio (`ExcursionCard` recibe el `espacio`); aquí no se opera nada.
 */
export function ListaDeExcursionesDeEmpresa({ datos, espacio, enlaceVendedor }: { datos: ExcursionesDeEmpresaDatos; espacio: Espacio; enlaceVendedor?: string }) {
  const { company, excursiones } = datos
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6 py-3.5">
          <Link
            href={rutaDeEmpresa(espacio, company.slug)}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {company.name}
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="border-b bg-card/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
          <div className="w-full">
            <span className="text-caption font-bold uppercase tracking-wider text-primary">Tours y Experiencias</span>
            <h1 className="mt-1 text-h1 text-foreground w-full">
              Próximas excursiones de {company.name}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground w-full">
              {excursiones.length > 0 
                ? `Explora ${excursiones.length} experiencia${excursiones.length !== 1 ? 's' : ''} disponible${excursiones.length !== 1 ? 's' : ''} con salidas confirmadas y cupos abiertos.`
                : 'Descubre y reserva las mejores aventuras.'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Listado de Excursiones Próximas */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
        {excursiones.length === 0 ? (
          <EmptyState
            variant="card"
            icon={<Compass className="h-10 w-10 text-muted-foreground" aria-hidden />}
            title="Sin excursiones próximas disponibles"
            description={`Actualmente ${company.name} no tiene salidas programadas con cupos abiertos. Vuelve a consultar pronto.`}
            action={
              <Link
                href={rutaDeEmpresa(espacio, company.slug)}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs sm:text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Volver al perfil de la empresa
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {excursiones.map((exc) => (
              <div key={exc.id} className="relative">
                <ExcursionCard
                  excursion={exc}
                  espacio={espacio}
                  retorno={enlaceVendedor ? `e=${encodeURIComponent(enlaceVendedor)}` : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
