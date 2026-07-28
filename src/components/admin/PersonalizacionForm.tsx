'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trophy, Users, Megaphone, LayoutGrid, Bell } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarPersonalizacion,
  type PersonalizacionState,
} from '@/modules/admin/personalizacionActions'
import type { EngagementConfig } from '@/lib/engagementConfig'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: PersonalizacionState = {}

const MODULOS = [
  {
    key: 'gamificacion' as const,
    icon: Trophy,
    titulo: 'Gamificación y ruleta',
    desc: 'Nivel, puntos, logros y ruleta de premios en el inicio del cliente.',
  },
  {
    key: 'pruebaSocial' as const,
    icon: Users,
    titulo: 'Prueba social',
    desc: 'Miembros, registros de la semana y actividad reciente “en vivo”.',
  },
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
    <form action={formAction} className="max-w-2xl space-y-6">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Color de marca */}
      <div className="space-y-3 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">Color de acento</h3>
        <p className="text-sm text-muted-foreground">
          Se usa en los realces del inicio del cliente (gamificación, prueba social).
        </p>
        <div className="flex items-center gap-3">
          <Input
            name="color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-11 w-20 p-1"
          />
          <span
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            <Trophy className="h-4 w-4" />
            Vista previa
          </span>
        </div>
      </div>

      {/* Módulos */}
      <div className="space-y-3 rounded-xl border border-border p-5">
        <h3 className="font-semibold text-foreground">¿Qué mostrar en el inicio?</h3>
        <div className="space-y-2">
          {MODULOS.map((m) => (
            <label
              key={m.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                name={m.key}
                defaultChecked={config[m.key]}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span className="flex items-start gap-2.5">
                <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium text-foreground">{m.titulo}</span>
                  <span className="block text-xs text-muted-foreground">{m.desc}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar personalización
        </Button>
      </div>
    </form>
  )
}
