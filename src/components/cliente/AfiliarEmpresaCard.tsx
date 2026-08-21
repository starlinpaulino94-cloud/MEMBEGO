'use client'

import { useActionState, useEffect } from 'react'
import { ArrowRight, Loader2, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { afiliarmeAEmpresa, type AfiliacionState } from '@/modules/cliente/actions'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const initial: AfiliacionState = {}

/**
 * Tarjeta de "un clic" para que un cliente ya registrado en MembeGo se afilie
 * a otra empresa sin volver a crear una cuenta.
 */
export function AfiliarEmpresaCard({
  companySlug,
  companyName,
  yaEsMiembro,
  enlaceSlug,
}: {
  companySlug: string
  companyName: string
  yaEsMiembro: boolean
  enlaceSlug?: string | null
}) {
  const [state, formAction, pending] = useActionState(afiliarmeAEmpresa, initial)

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  return (
    <Card className="border-white/10 bg-white/5 text-white">
      <CardHeader>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <BadgeCheck className="h-6 w-6" />
        </div>
        <CardTitle className="mt-3 text-2xl">
          {yaEsMiembro ? `Ya eres miembro de ${companyName}` : `Únete a ${companyName}`}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {yaEsMiembro
            ? 'Continúa para elegir o revisar tu membresía.'
            : 'Ya tienes cuenta en MembeGo. Únete con un clic — sin registrarte de nuevo.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <form action={formAction}>
          <input type="hidden" name="companySlug" value={companySlug} />
          {enlaceSlug && <input type="hidden" name="enlaceSlug" value={enlaceSlug} />}
          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-primary hover:bg-primary/90"
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {yaEsMiembro ? 'Elegir mi plan' : `Unirme a ${companyName}`}
            {!pending && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          ¿No eres tú?{' '}
          <a href="/login" className="text-primary hover:underline">
            Cambiar de cuenta
          </a>
        </p>
      </CardContent>
    </Card>
  )
}
