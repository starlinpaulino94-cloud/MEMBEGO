'use client'

import { Card, CardContent } from '@/components/ui/card'
import { GripVertical } from 'lucide-react'

type Lead = {
  id: string
  nombre: string
  empresa: string
  fecha: string
}

const mockLeads: Record<string, Lead[]> = {
  nuevo: [
    { id: '1', nombre: 'María García', empresa: 'AutoLavado Express', fecha: '2024-01-15' },
    { id: '2', nombre: 'Carlos Rodríguez', empresa: 'Lavado Rápido', fecha: '2024-01-14' },
  ],
  contactado: [
    { id: '3', nombre: 'Ana Martínez', empresa: 'Premium Car Wash', fecha: '2024-01-13' },
    { id: '4', nombre: 'Pedro López', empresa: 'El Brillo', fecha: '2024-01-12' },
  ],
  cotizacion: [
    { id: '5', nombre: 'Laura Sánchez', empresa: 'SuperClean', fecha: '2024-01-11' },
  ],
  negociacion: [
    { id: '6', nombre: 'Roberto Díaz', empresa: 'CarSpa', fecha: '2024-01-10' },
    { id: '7', nombre: 'Sofía Hernández', empresa: 'LavadoTotal', fecha: '2024-01-09' },
  ],
  cerrado: [
    { id: '8', nombre: 'Miguel Fernández', empresa: 'QuickWash', fecha: '2024-01-08' },
  ],
}

const columns = [
  { key: 'nuevo', label: 'Nuevo', color: 'bg-blue-100 text-blue-800' },
  { key: 'contactado', label: 'Contactado', color: 'bg-yellow-100 text-yellow-800' },
  { key: 'cotizacion', label: 'Cotización', color: 'bg-orange-100 text-orange-800' },
  { key: 'negociacion', label: 'Negociación', color: 'bg-purple-100 text-purple-800' },
  { key: 'cerrado', label: 'Cerrado', color: 'bg-green-100 text-green-800' },
]

const fmtFecha = (f: string) =>
  new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short' }).format(new Date(f))

export default function PipelinePage() {
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="text-overline">CRM</p>
        <h1 className="text-h1 mt-1">Pipeline</h1>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const leads = mockLeads[col.key] ?? []
          return (
            <div key={col.key} className="min-w-[280px] flex-1">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-small font-medium">{col.label}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${col.color}`}>
                    {leads.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {leads.map((lead) => (
                    <Card key={lead.id} className="cursor-grab select-none hover:shadow-md transition-shadow">
                      <CardContent className="flex items-start gap-2 p-3">
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-small font-medium">{lead.nombre}</p>
                          <p className="text-caption text-muted-foreground">{lead.empresa}</p>
                          <p className="text-caption text-muted-foreground mt-1">{fmtFecha(lead.fecha)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
