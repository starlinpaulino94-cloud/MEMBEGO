'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, Megaphone, LayoutGrid, Bell } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarPersonalizacion,
  type PersonalizacionState,
} from '@/modules/admin/personalizacionActions'
import type { EngagementConfig } from '@/lib/engagementConfig'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: PersonalizacionState = {}

const MODULOS = [
  {
    key: 'gamificacion' as const,
    icon: Trophy,
    titulo: 'Gamificación y ruleta',
    desc: 'Nivel, puntos, logros y ruleta de premios en el inicio del cliente.',
  },
  // «Prueba social» se retiró del Inicio del cliente (2026-09-09): un
  // interruptor sin sección detrás es un mando muerto, así que también se va.
  {
    key: 'campanas' as const,
    icon: Megaphone,
    titulo: 'Campañas / banners',
    desc: 'Banners rotativos de tus campañas de marketing con contador.',
  },
  {
    key: 'carruseles' as const,
    icon: LayoutGrid,
    titulo: 'Carruseles',
    desc: 'Filas tipo Netflix con ofertas, empresas y recomendaciones.',
  },
  {
    key: 'popups' as const,
    icon: Bell,
    titulo: 'Popups inteligentes',
    desc: 'Aviso oportuno (máx. 1 al día) cuando el cliente tiene un beneficio por vencer o listo para usar.',
  },
]

export function PersonalizacionForm({ config }: { config: EngagementConfig }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(guardarPersonalizacion, init)
  const [color, setColor] = useState(config.color)

  useEffect(() => {
    if (state.success) {
      toast.success('Personalización guardada.')
      router.refresh()
    }
  }, [state.success, router])

  return (
    <form action={formAction} className="max-w-3xl space-y-8">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <FormSection title="Color de acento" description="Es el color de marca del negocio y también se usa en sus membresías y ofertas.">
        <div className="flex items-center gap-3">
          <Input name="color" type="color" aria-label="Color de acento" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-20 p-1" />
          <span
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            <Trophy className="h-4 w-4" />
            Vista previa
          </span>
        </div>
      </FormSection>

      <FormSection title="Qué mostrar en el inicio" description="Los módulos que ven tus clientes al abrir la app. Apaga los que no uses.">
        <div className="space-y-2">
          {MODULOS.map((m) => (
            <label
              key={m.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
            >
              <input type="checkbox" name={m.key} defaultChecked={config[m.key]} className="mt-1 size-4 accent-primary" />
              <span className="flex items-start gap-2.5">
                <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium text-foreground">{m.titulo}</span>
                  <span className="block text-caption text-muted-foreground">{m.desc}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </FormSection>

      <FormActions>
        <Button type="submit" loading={pending}>
          Guardar personalización
        </Button>
      </FormActions>
    </form>
  )
}
