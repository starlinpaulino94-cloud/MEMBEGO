'use client'

/**
 * Editor de PERMISOS por empleado.
 *
 * El interruptor de cada módulo muestra el estado EFECTIVO (rol + ajuste), y
 * al lado dice qué trae su rol de serie — así se ve de un vistazo qué es
 * herencia y qué es ajuste. Dentro de un módulo permitido, las funciones del
 * catálogo se pueden negar una a una. Al guardar solo viajan las diferencias.
 */

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { AppRole } from '@/types'
import {
  ADMIN_SECTIONS,
  canAccessAdminSection,
  type PermisosUsuario,
} from '@/lib/auth/permissions'
import { FUNCIONES_POR_SECCION, SECCION_LABELS } from '@/lib/auth/funciones'
import { guardarPermisosEmpleado, type PermisosActionState } from '@/modules/permisos/actions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const init: PermisosActionState = {}

/** El resumen nunca se puede quitar: es el aterrizaje del panel. */
const SECCIONES_EDITABLES = ADMIN_SECTIONS.filter((s) => s !== 'dashboard')

export function PermisosEmpleadoForm({
  userId,
  rol,
  permisosActuales,
}: {
  userId: string
  rol: AppRole
  permisosActuales: PermisosUsuario | null
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(guardarPermisosEmpleado, init)

  // Estado EFECTIVO por sección (herencia del rol + ajuste guardado).
  const [secciones, setSecciones] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SECCIONES_EDITABLES.map((s) => [
        s,
        permisosActuales?.secciones?.[s] ?? canAccessAdminSection(rol, s),
      ])
    )
  )
  const [negadas, setNegadas] = useState<Record<string, Set<string>>>(() => {
    const inicial: Record<string, Set<string>> = {}
    for (const [sec, fns] of Object.entries(permisosActuales?.funciones ?? {})) {
      inicial[sec] = new Set(Object.keys(fns))
    }
    return inicial
  })

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state, router])

  const seleccion = useMemo(
    () =>
      JSON.stringify({
        secciones,
        funcionesNegadas: Object.fromEntries(
          Object.entries(negadas)
            .map(([sec, set]) => [sec, [...set]])
            .filter(([, lista]) => (lista as string[]).length > 0)
        ),
      }),
    [secciones, negadas]
  )

  const ajustes = SECCIONES_EDITABLES.filter(
    (s) => secciones[s] !== canAccessAdminSection(rol, s)
  ).length

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="seleccion" value={seleccion} />

      <div className="overflow-hidden rounded-2xl border border-border">
        {SECCIONES_EDITABLES.map((sec) => {
          const delRol = canAccessAdminSection(rol, sec)
          const efectivo = secciones[sec]
          const funciones = FUNCIONES_POR_SECCION[sec] ?? []
          return (
            <div key={sec} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-foreground">{SECCION_LABELS[sec]}</p>
                  <p className="text-caption text-muted-foreground">
                    {efectivo === delRol
                      ? delRol
                        ? 'Heredado del rol: con acceso'
                        : 'Heredado del rol: sin acceso'
                      : efectivo
                        ? 'Concedido (su rol no lo trae)'
                        : 'Negado (su rol sí lo trae)'}
                  </p>
                </div>
                <Switch
                  checked={efectivo}
                  onCheckedChange={(v) => setSecciones((m) => ({ ...m, [sec]: v }))}
                  aria-label={`Acceso a ${SECCION_LABELS[sec]}`}
                />
              </div>
              {efectivo && funciones.length > 0 ? (
                <div className="space-y-1.5 bg-muted/40 px-4 py-3">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    Funciones de este módulo
                  </p>
                  {funciones.map((f) => {
                    const negada = negadas[sec]?.has(f.codigo) ?? false
                    return (
                      <label key={f.codigo} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-foreground">{f.label}</span>
                        <input
                          type="checkbox"
                          checked={!negada}
                          onChange={(e) =>
                            setNegadas((m) => {
                              const set = new Set(m[sec] ?? [])
                              if (e.target.checked) set.delete(f.codigo)
                              else set.add(f.codigo)
                              return { ...m, [sec]: set }
                            })
                          }
                          className="h-4 w-4 accent-primary"
                          aria-label={f.label}
                        />
                      </label>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setSecciones(
              Object.fromEntries(SECCIONES_EDITABLES.map((s) => [s, canAccessAdminSection(rol, s)]))
            )
            setNegadas({})
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" /> Volver a lo que da su rol
        </button>
        <div className="flex items-center gap-3">
          {ajustes > 0 ? (
            <span className="text-caption text-muted-foreground">
              {ajustes} módulo{ajustes !== 1 ? 's' : ''} ajustado{ajustes !== 1 ? 's' : ''}
            </span>
          ) : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar permisos
          </Button>
        </div>
      </div>
    </form>
  )
}
