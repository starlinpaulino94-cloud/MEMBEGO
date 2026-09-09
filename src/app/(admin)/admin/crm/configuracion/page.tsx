import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Cable, MessageSquare } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getOrCreatePipelineConfig } from '@/modules/crm/queries'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StagesSection } from './stages-section'
import { CampoSection } from './campo-section'
import { AutomatizacionSection } from './automatizacion-section'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Configuración del CRM' }

/**
 * CONFIGURACIÓN DEL CRM. Dos planos distintos:
 *
 * 1. Canales e integraciones: por dónde llegan los prospectos (WhatsApp,
 *    Messenger, Instagram). Se conectan en Integraciones; las respuestas
 *    automáticas de cada canal se editan en la subpágina Auto-reply.
 * 2. Pipeline de leads: etapas, campos personalizados y automatizaciones de
 *    los leads manuales (PipelineConfig por empresa, usado por /admin/crm/leads).
 */
export default async function ConfiguracionPage() {
  const user = await requireSection('leads')
  if (!user) redirect('/login')

  const companyId = companyFilter(user)
  if (!companyId) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Selecciona una empresa desde el panel de superadmin para usar el CRM.
        </p>
      </div>
    )
  }

  const config = await getOrCreatePipelineConfig(companyId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2 text-foreground">Configuración</h2>
        <Button variant="outline" asChild>
          <Link href="/admin/crm/configuracion/auto-reply">
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden />
            Auto-reply
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-h4">
            <Cable className="h-4 w-4 text-muted-foreground" aria-hidden />
            Canales e integraciones
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Los prospectos nacen del primer mensaje de quien no es cliente. Los
            canales por los que llegan se conectan y administran desde
            Integraciones; sus respuestas automáticas se configuran en
            Auto-reply.
          </p>
          <Button variant="outline" asChild>
            <Link href="/admin/integraciones">Ver canales conectados</Link>
          </Button>
        </CardContent>
      </Card>

      <StagesSection companyId={companyId} initialStages={config.stages} />
      <CampoSection companyId={companyId} initialCampos={config.camposCustom} />
      <AutomatizacionSection companyId={companyId} initialAutomatizaciones={config.automatizaciones} />
    </div>
  )
}
