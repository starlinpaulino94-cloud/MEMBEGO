'use client'

import { useActionState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { marcarPedidoListoAction } from '@/modules/supply/actions'
import type { PedidoDeHoy } from '@/modules/supply/reservas'

/**
 * LO QUE HAY QUE PREPARAR HOY (Fase 40).
 *
 * Era la única pieza de los avisos que no se pudo hacer en su día: el modelo
 * guardaba la hora que el cliente eligió, pero nadie en el comercio marcaba
 * «ya está hecho», así que el cliente no tenía forma de saber si pasar ya o
 * esperar. Este botón es ese dato.
 *
 * Se ordena por HORA y no por estado: quien está en la cocina mira el reloj, no
 * una lista agrupada. Los ya preparados se quedan en su sitio con su etiqueta
 * para que se vea de un vistazo qué falta y qué está esperando al cliente.
 */
export function PedidosDeHoy({ companyId, pedidos }: { companyId: string; pedidos: PedidoDeHoy[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Para preparar hoy</CardTitle>
        {pedidos.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {pedidos.filter((p) => p.estado === 'LISTA').length} de {pedidos.length} listos
          </span>
        )}
      </CardHeader>
      <CardContent>
        {pedidos.length === 0 ? (
          <EmptyState
            title="Nadie reservó para hoy"
            description="Cuando un cliente aparte día y hora para recoger un beneficio de Membego, aparecerá aquí."
          />
        ) : (
          <ul className="divide-y">
            {pedidos.map((p) => (
              <Fila key={p.reservaId} companyId={companyId} pedido={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Fila({ companyId, pedido }: { companyId: string; pedido: PedidoDeHoy }) {
  const [estado, accion, enviando] = useActionState(marcarPedidoListoAction, {})
  // El estado de la fila es el del servidor hasta que ESTA acción confirme. Sin
  // el `success`, marcar uno dejaba el botón igual hasta que la página se
  // revalidara, y en una cocina eso se traduce en pulsarlo dos veces.
  const listo = pedido.estado === 'LISTA' || Boolean(estado.success)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium">
          {pedido.item}
          {pedido.sucursal && (
            <span className="font-normal text-muted-foreground"> · {pedido.sucursal}</span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {pedido.cliente} ·{' '}
          {pedido.inicioAt.toLocaleTimeString('es-DO', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Santo_Domingo',
          })}
        </p>
        {estado.error && <p className="mt-1 text-sm text-destructive">{estado.error}</p>}
      </div>

      {listo ? (
        <Badge variant="secondary">Listo, esperando al cliente</Badge>
      ) : (
        <form action={accion}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="reservaId" value={pedido.reservaId} />
          <button
            type="submit"
            disabled={enviando}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {enviando ? 'Avisando…' : 'Marcar listo'}
          </button>
        </form>
      )}
    </li>
  )
}
