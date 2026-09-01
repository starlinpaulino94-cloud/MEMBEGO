'use client'

import { Phone, Mail, MessageCircle, Clock, CheckCircle2 } from 'lucide-react'

const mockFollowUps = [
  { id: '1', lead: 'María García', tipo: 'Llamada', fecha: '2024-01-20', estado: 'Pendiente' },
  { id: '2', lead: 'Carlos Rodríguez', tipo: 'Email', fecha: '2024-01-19', estado: 'Completado' },
  { id: '3', lead: 'Ana Martínez', tipo: 'WhatsApp', fecha: '2024-01-18', estado: 'Pendiente' },
  { id: '4', lead: 'Pedro López', tipo: 'Llamada', fecha: '2024-01-17', estado: 'Completado' },
  { id: '5', lead: 'Laura Sánchez', tipo: 'Email', fecha: '2024-01-16', estado: 'Pendiente' },
]

const tipoIcon: Record<string, typeof Phone> = {
  Llamada: Phone,
  Email: Mail,
  WhatsApp: MessageCircle,
}

const estadoStyles: Record<string, string> = {
  Pendiente: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  Completado: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
}

export default function SeguimientosPage() {
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="text-overline">Seguimientos</p>
        <h1 className="text-h1 mt-1 text-foreground">Seguimientos Programados</h1>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {mockFollowUps.map((item) => {
            const Icon = tipoIcon[item.tipo]
            return (
              <li key={item.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-small font-medium text-foreground">{item.lead}</p>
                    <p className="truncate text-caption text-muted-foreground">{item.tipo}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <span className="hidden text-caption text-muted-foreground sm:block">{item.fecha}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${estadoStyles[item.estado]}`}
                  >
                    {item.estado === 'Pendiente' ? (
                      <Clock className="h-3 w-3" aria-hidden />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                    )}
                    {item.estado}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
