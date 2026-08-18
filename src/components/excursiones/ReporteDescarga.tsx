'use client'

/**
 * Elegir el período y descargar. El formulario navega con GET para que el
 * período quede en la URL: así un reporte se puede guardar en favoritos o
 * mandar por chat, y quien lo abra ve exactamente el mismo.
 */

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ReporteDescarga({
  desde,
  hasta,
  etiqueta,
}: {
  desde: string
  hasta: string
  etiqueta: string
}) {
  const [d, setD] = useState(desde)
  const [h, setH] = useState(hasta)
  const query = d && h ? `?desde=${d}&hasta=${h}` : ''

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <form method="GET" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="rep-desde">Desde</Label>
          <Input id="rep-desde" name="desde" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="rep-hasta">Hasta</Label>
          <Input id="rep-hasta" name="hasta" type="date" value={h} onChange={(e) => setH(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">Ver período</Button>
      </form>

      <p className="mt-3 text-caption text-muted-foreground">
        Período seleccionado: {etiqueta}. Sin fechas, el mes en curso.
      </p>

      <Button asChild className="mt-3 gap-2">
        <a href={`/admin/excursiones/reportes/exportar${query}`}>
          <Download className="h-4 w-4" /> Descargar CSV
        </a>
      </Button>
    </section>
  )
}
