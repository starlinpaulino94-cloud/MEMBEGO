import Link from 'next/link'
import { TabsNav } from '@/components/ui/tabs-nav'

const SECCIONES = [
  { href: '/admin/audiencia', label: 'Resumen' },
  { href: '/admin/audiencia/segmentos', label: 'Segmentos' },
  { href: '/admin/audiencia/campanas', label: 'Campañas segmentadas' },
] as const

export type SeccionAudiencia = (typeof SECCIONES)[number]['href']

/**
 * Navegación de la sección Audiencia (§50).
 *
 * EL PROBLEMA QUE RESUELVE: `/admin/audiencia` no enlazaba a sus propias
 * subrutas. Segmentos y Campañas segmentadas existían como páginas completas
 * pero solo se llegaba a ellas desde el menú lateral — la Fase 0 lo dejó
 * anotado y por eso "Campañas segmentadas" tuvo que quedarse en el menú
 * aunque hiciera ruido junto a "Campañas".
 *
 * Con estas pestañas en las tres páginas, la sección se comporta como una
 * sola cosa y la entrada del menú lateral puede irse sin dejar nada huérfano.
 */
export function NavAudiencia({ activa }: { activa: SeccionAudiencia }) {
  return (
    <TabsNav
      aria-label="Secciones de audiencia"
      items={SECCIONES.map((s) => ({
        label: s.label,
        active: s.href === activa,
        render: ({ className, children }) => (
          <Link href={s.href} className={className}>
            {children}
          </Link>
        ),
      }))}
    />
  )
}
