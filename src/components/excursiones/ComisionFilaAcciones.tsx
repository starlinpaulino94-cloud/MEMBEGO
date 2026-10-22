'use client'

import { useState } from 'react'
import type { EstadoComision } from '@/modules/excursiones/comisiones/nucleo'
import { ComisionAcciones } from '@/components/excursiones/ComisionAcciones'
import { ComisionDetalleSheet, type ComisionDetalleItem } from '@/components/excursiones/ComisionDetalleSheet'
import { Button } from '@/components/ui/button'

/**
 * LO ÚNICO INTERACTIVO DE UNA FILA DE COMISIÓN (auditoría admin · fase 7, tarea 7.1).
 *
 * La tabla es de servidor; lo que necesita el navegador —abrir el detalle, aprobar, anular, ajustar— vive aquí, en una celda. El
 * detalle se monta la primera vez que se pide: una página de 200 filas no carga 200 paneles que nadie abrió.
 */
export function ComisionFilaAcciones({ comision }: { comision: ComisionDetalleItem }) {
  const [abierto, setAbierto] = useState(false)
  const [pedido, setPedido] = useState(false)

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPedido(true)
          setAbierto(true)
        }}
      >
        Ver detalle
        <span className="sr-only"> de la comisión de {comision.vendedor}</span>
      </Button>
      <ComisionAcciones comisionId={comision.id} estado={comision.estado as EstadoComision} />
      {pedido ? <ComisionDetalleSheet comision={comision} open={abierto} onOpenChange={setAbierto} /> : null}
    </div>
  )
}
