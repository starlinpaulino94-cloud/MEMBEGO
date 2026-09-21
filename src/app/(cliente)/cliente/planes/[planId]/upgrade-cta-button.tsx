'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { solicitarCambioPlan, type SeleccionState } from '@/modules/membresia/actions'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface UpgradeCtaButtonProps {
  membershipId: string
  planId: string
  label: string
}

/**
 * CTA que registra el cambio de plan y redirige a la pantalla de pago existente.
 *
 * El cálculo del importe NO viaja desde el navegador: `solicitarCambioPlan`
 * rechaza cualquier plan que no sea mejora y el cobro se resuelve en servidor
 * con `calcularPagoCambioPlan`. Esta acción solo registra `planIdSolicitado`.
 */
export function UpgradeCtaButton({ membershipId, planId, label }: UpgradeCtaButtonProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, isPending] = useActionState<SeleccionState, FormData>(
    async (prev: SeleccionState, formData: FormData) => {
      const result = await solicitarCambioPlan(prev, formData)
      return result
    },
    {}
  )

  useEffect(() => {
    if (state.success) {
      router.push(`/membresia/${membershipId}`)
      router.refresh()
    }
  }, [state.success, membershipId, router])

  return (
    <form ref={formRef} action={formAction} className="mt-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="planId" value={planId} />
      <Button
        type="submit"
        size="sm"
        className="min-h-11 rounded-full"
        disabled={isPending}
        aria-label={label}
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Registrando...
          </>
        ) : (
          label
        )}
      </Button>
      {state.error && (
        <p className="mt-2 text-small text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}
