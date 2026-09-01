'use client'

import { Users, Clock, TrendingUp } from 'lucide-react'
import { StatCard } from '@/components/ui/stat-card'

const mockData = {
  totalLeads: 24,
  pendingFollowUps: 8,
  conversionRate: 32,
}

export default function CrmDashboard() {
  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="text-overline">CRM</p>
        <h1 className="text-h1 mt-1 text-foreground">Panel de Seguimiento</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Leads"
          value={mockData.totalLeads}
          icon={Users}
          accent="brand"
        />
        <StatCard
          label="Seguimientos Pendientes"
          value={mockData.pendingFollowUps}
          icon={Clock}
          accent="warning"
        />
        <StatCard
          label="Tasa de Conversión"
          value={`${mockData.conversionRate}%`}
          icon={TrendingUp}
          accent="success"
        />
      </div>
    </div>
  )
}
