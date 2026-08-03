'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'
import {
  TRIGGER_LABEL,
  TIPO_LABEL,
  BENEFICIARIO_LABEL,
} from '@/modules/growth/reglas'
import {
  crearGrowthRuleAction,
  actualizarGrowthRuleAction,
  type ReglaState,
} from '@/modules/growth/actions'

export interface ReglaEditable {
  id: string
  nombre: string
  trigger: string
  valorCondicion: number
  planId: string | null
  beneficiario: string
  recompensaTipo: string
  recompensaValor: number
  recompensaPromocionId: string | null
}

const campo =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'
const etiqueta = 'mb-1 block text-xs font-medium text-muted-foreground'

/**
 * Formulario de una regla de recompensa, en su propia página.
 *
 * Dos detalles que solo se pueden hacer aquí y no en el formulario embebido de
 * antes: los campos que no aplican al tipo elegido se ocultan (un beneficio
 * digital no lleva "valor", un disparador que no sea "N referidos" no lleva
 * umbral), y los errores se ven — antes la acción hacía `return` en silencio.
 */
export function ReglaRecompensaForm({
  promos,
  plans,
  regla,
}: {
  promos: { id: string; titulo: string }[]
  plans: { id: string; nombre: string }[]
  /** Si viene, el formulario edita esa regla; si no, crea una nueva. */
  regla?: ReglaEditable
}) {
  const router = useRouter()
  const [estado, accion, enviando] = useActionState<ReglaState, FormData>(
    regla ? actualizarGrowthRuleAction : crearGrowthRuleAction,
    {}
  )
  const [trigger, setTrigger] = useState(regla?.trigger ?? 'REGISTRO')
  const [tipo, setTipo] = useState(regla?.recompensaTipo ?? 'PUNTOS')

  const esBeneficio = tipo === 'BENEFICIO'
  const pideUmbral = trigger === 'N_REFERIDOS'

  // Al guardar se vuelve a la lista: el trabajo terminó y ahí se ve el efecto.
  useEffect(() => {
    if (estado.ok) router.push('/admin/crecimiento/recompensas')
  }, [estado.ok, router])

  return (
    <form action={accion} className="space-y-5 rounded-2xl border border-border/70 bg-card p-5">
      {regla && <input type="hidden" name="id" value={regla.id} />}

      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo guardar">
          {estado.error}
        </StatusBanner>
      )}

      <div>
        <label htmlFor="nombre" className={etiqueta}>
          Nombre de la regla
        </label>
        <input
          id="nombre"
          name="nombre"
          required
          maxLength={80}
          defaultValue={regla?.nombre}
          placeholder="Ej. Bono por registro"
          className={campo}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Solo lo ves tú, para reconocerla en la lista.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="trigger" className={etiqueta}>
            Cuándo se entrega
          </label>
          <select
            id="trigger"
            name="trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className={campo}
          >
            {Object.entries(TRIGGER_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {pideUmbral && (
          <div>
            <label htmlFor="valorCondicion" className={etiqueta}>
              ¿Cuántos referidos?
            </label>
            <input
              id="valorCondicion"
              name="valorCondicion"
              type="number"
              min={1}
              step={1}
              defaultValue={regla?.valorCondicion ?? 3}
              className={campo}
            />
          </div>
        )}

        <div>
          <label htmlFor="recompensaTipo" className={etiqueta}>
            Qué se entrega
          </label>
          <select
            id="recompensaTipo"
            name="recompensaTipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className={campo}
          >
            {Object.entries(TIPO_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {esBeneficio ? (
          <div>
            <label htmlFor="recompensaPromocionId" className={etiqueta}>
              Cuál beneficio digital
            </label>
            <select
              id="recompensaPromocionId"
              name="recompensaPromocionId"
              defaultValue={regla?.recompensaPromocionId ?? ''}
              className={campo}
            >
              <option value="">Elige uno…</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.titulo}
                </option>
              ))}
            </select>
            {promos.length === 0 && (
              <p className="mt-1 text-xs text-warning-foreground">
                No tienes promociones activas para entregar.{' '}
                <Link href="/admin/promociones" className="font-medium underline">
                  Crea una primero
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor="recompensaValor" className={etiqueta}>
              Cuánto {tipo === 'DESCUENTO_PORCENTAJE' ? '(%)' : ''}
            </label>
            <input
              id="recompensaValor"
              name="recompensaValor"
              type="number"
              step="0.01"
              min={0}
              max={tipo === 'DESCUENTO_PORCENTAJE' ? 100 : undefined}
              defaultValue={regla?.recompensaValor || ''}
              className={campo}
            />
          </div>
        )}

        <div>
          <label htmlFor="beneficiario" className={etiqueta}>
            A quién se recompensa
          </label>
          <select
            id="beneficiario"
            name="beneficiario"
            defaultValue={regla?.beneficiario ?? 'REFERENTE'}
            className={campo}
          >
            {Object.entries(BENEFICIARIO_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="planId" className={etiqueta}>
            Solo si compró este plan (opcional)
          </label>
          <select
            id="planId"
            name="planId"
            defaultValue={regla?.planId ?? ''}
            className={campo}
          >
            <option value="">Cualquier plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : regla ? 'Guardar cambios' : 'Crear regla'}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/crecimiento/recompensas">Cancelar</Link>
        </Button>
      </div>
    </form>
  )
}
