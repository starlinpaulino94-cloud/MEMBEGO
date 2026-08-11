import { Sparkles } from 'lucide-react'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { getActiveCategories } from '@/modules/empresas/queries'
import { InteresesForm } from '@/components/cliente/InteresesForm'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function InteresesPage() {
  const user = await requireRole('CLIENTE')

  let categories: Awaited<ReturnType<typeof getActiveCategories>> = []
  let selected: string[] = []
  try {
    const [cats, intereses] = await Promise.all([
      getActiveCategories(),
      // Los intereses son de la PERSONA, no de una empresa: la misma cuenta
      // los conserva aunque cambie de negocio, y por eso no caben dentro de
      // un contexto de inquilino.
      sinEmpresa('intereses: son de la persona y no de ninguna empresa', (tx) =>
        tx.userInteres.findMany({
          where: { userId: user.metadata.dbUserId },
          select: { categoryId: true },
        })
      ),
    ])
    categories = cats
    selected = intereses.map((i) => i.categoryId)
  } catch (e) {
    console.error('[cliente-intereses]', e)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Sparkles className="h-6 w-6 text-primary" /> Tus intereses
        </h1>
        <p className="text-muted-foreground">
          Elige las categorías que te interesan. Usaremos esto para
          recomendarte empresas y promociones que realmente te gusten.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <InteresesForm categories={categories} selected={selected} />
        </CardContent>
      </Card>
    </div>
  )
}
