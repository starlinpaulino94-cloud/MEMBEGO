'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { eliminarVarianteCatalogo } from '@/modules/catalog/actions'
import { formatearPrecio, ETIQUETA_ESTADO_VARIANTE } from '@/modules/catalog/formato'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DeleteButton } from '@/components/ui/delete-button'
import { VarianteForm, type VarianteVista } from './VarianteForm'

/**
 * Variantes de un ítem.
 *
 *  · UNA sola → se muestra como el precio del producto, sin hablar de
 *    variantes (la persona que vende lavados no necesita saber que existe).
 *  · MÁS de una → tabla con selector de edición.
 */
export function VariantesPanel({
  itemId,
  moneda,
  variantes,
  editable,
}: {
  itemId: string
  moneda: string
  variantes: VarianteVista[]
  editable: boolean
}) {
  const router = useRouter()
  const [agregando, setAgregando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const listo = () => {
    setAgregando(false)
    setEditando(null)
    router.refresh()
  }

  // ── Ítem simple ───────────────────────────────────────────────────────────
  if (variantes.length === 1) {
    const unica = variantes[0]
    return (
      <div className="space-y-4">
        {editable ? (
          <VarianteForm key={unica.id + unica.price} itemId={itemId} variante={unica} ocultarNombre={unica.isDefault} onListo={listo} />
        ) : (
          <p className="text-sm">{formatearPrecio(unica.price, moneda)}</p>
        )}
        {editable && !agregando && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAgregando(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tiene tallas, tamaños u otras opciones
          </Button>
        )}
        {agregando && (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-sm font-medium">Nueva variante</p>
            <VarianteForm itemId={itemId} onListo={listo} />
          </div>
        )}
      </div>
    )
  }

  // ── Con variantes ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {variantes.map((v) => (
          <li key={v.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{v.name}</p>
                <p className="text-xs text-muted-foreground">
                  SKU {v.sku}
                  {Object.keys(v.attributes).length > 0 && ' · ' + Object.values(v.attributes).join(' / ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={v.status === 'ACTIVE' ? 'success' : 'secondary'}>{ETIQUETA_ESTADO_VARIANTE[v.status]}</Badge>
                <span className="font-semibold tabular-nums">{formatearPrecio(v.price, moneda)}</span>
                {editable && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditando(editando === v.id ? null : v.id)}>
                      {editando === v.id ? 'Cerrar' : 'Editar'}
                    </Button>
                    <DeleteButton
                      label={`Quitar la variante ${v.name}`}
                      title={`¿Quitar la variante «${v.name}»?`}
                      successMessage="Variante quitada."
                      action={async () => {
                        const r = await eliminarVarianteCatalogo(v.id)
                        if (r.ok) router.refresh()
                        return r.ok ? undefined : { error: r.error }
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            {editando === v.id && (
              <div className="mt-4 border-t border-border pt-4">
                <VarianteForm key={v.id + v.price} itemId={itemId} variante={v} onListo={listo} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {editable && !agregando && (
        <Button type="button" variant="outline" size="sm" onClick={() => setAgregando(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Agregar variante
        </Button>
      )}
      {agregando && (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-sm font-medium">Nueva variante</p>
          <VarianteForm itemId={itemId} onListo={listo} />
        </div>
      )}
    </div>
  )
}
