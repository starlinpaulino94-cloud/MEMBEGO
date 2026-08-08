'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { toggleSeguirEmpresa } from '@/modules/social/actions'
import { Button } from '@/components/ui/button'
import { BusinessCard, type BusinessCardData } from '@/components/marketplace/BusinessCard'

/**
 * Los datos que necesita la rejilla son exactamente los de la tarjeta. El
 * alias se conserva porque la página lo importa por este nombre.
 */
export type EmpresaExplorar = BusinessCardData

/**
 * Rejilla del explorador de empresas.
 *
 * DS 2.0 · Fase 4: ya NO dibuja su propia tarjeta. Antes tenía una distinta de
 * la pública —logo cuadrado y precio ancla frente a banner y logo flotante—,
 * así que la misma empresa se veía de dos maneras según por dónde llegaras.
 * Ahora compone `BusinessCard` y solo aporta lo suyo: el botón de seguir, que
 * necesita estado de cliente.
 */
export function ExplorarEmpresasList({
  empresas,
  seguidasIds,
}: {
  empresas: EmpresaExplorar[]
  seguidasIds: string[]
}) {
  const router = useRouter()
  const [seguidas, setSeguidas] = useState<Set<string>>(new Set(seguidasIds))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggleSeguir(company: EmpresaExplorar) {
    setPendingId(company.id)
    startTransition(async () => {
      const res = await toggleSeguirEmpresa(company.id)
      setPendingId(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setSeguidas((prev) => {
        const next = new Set(prev)
        if (res.following) next.add(company.id)
        else next.delete(company.id)
        return next
      })
      toast.success(
        res.following
          ? `Ahora sigues a ${company.name}. Recibirás sus promociones y novedades.`
          : `Dejaste de seguir ${company.name}.`
      )
      router.refresh()
    })
  }

  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {empresas.map((company) => {
        const siguiendo = seguidas.has(company.id)
        const pending = pendingId === company.id

        return (
          <li key={company.id} className="flex">
            <BusinessCard
              company={company}
              hrefBase="/cliente/empresas"
              className="w-full"
              action={
                <Button
                  onClick={() => toggleSeguir(company)}
                  disabled={pending}
                  variant="outline"
                  size="lg"
                  aria-label={
                    siguiendo ? `Dejar de seguir a ${company.name}` : `Seguir a ${company.name}`
                  }
                  className="shrink-0 px-4"
                >
                  {pending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : siguiendo ? (
                    <Check className="text-success" aria-hidden />
                  ) : (
                    <Plus aria-hidden />
                  )}
                </Button>
              }
            />
          </li>
        )
      })}
    </ul>
  )
}
