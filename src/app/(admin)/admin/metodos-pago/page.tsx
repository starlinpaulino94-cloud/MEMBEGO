import Link from 'next/link'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { DeleteMetodoPagoButton } from '@/components/admin/DeleteMetodoPagoButton'
import { CreditCard, Building2, Plus, Pencil } from 'lucide-react'
import { EstadoPasarelas } from '@/components/admin/EstadoPasarelas'
import { getTransferenciasEnVuelo } from '@/modules/pagos/metodosDisponibles'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { cardnetTokensConfigurado } from '@/lib/payments/cardnet-tokens'

export const dynamic = 'force-dynamic'

export default async function MetodosPagoPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)

  let metodos: {
    id: string; nombre: string; tipo: string; titular: string | null;
    numeroCuenta: string | null; tipoCuenta: string | null;
    instrucciones: string | null; activo: boolean;
    company: { name: string }
  }[] = []
  try {
    metodos = await prisma.metodoPago.findMany({
      where: companyId ? { companyId } : {},
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    })
  } catch (e) {
    console.error('[admin-metodos-pago]', e)
  }

  // Estado de los cobros en línea. Solo para una empresa concreta: el
  // superadmin viendo todas las empresas a la vez no tiene un "estado" único.
  const estado = companyId
    ? {
        transferencia: await tieneCapacidad(companyId, 'PAGO_TRANSFERENCIA').catch(() => true),
        cardnet: await tieneCapacidad(companyId, 'PAGO_CARDNET').catch(() => false),
        enVuelo: await getTransferenciasEnVuelo(companyId),
        cuentasCargadas: metodos.filter((m) => m.tipo === 'TRANSFERENCIA' && m.activo).length,
      }
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métodos de pago"
        description="Los clientes verán estas instrucciones al enviar su comprobante."
        action={
          <Link href="/admin/metodos-pago/nuevo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Agregar método
            </Button>
          </Link>
        }
      />

      {estado && (
        <EstadoPasarelas
          transferencia={estado.transferencia}
          cardnet={estado.cardnet}
          cardnetConfigurado={cardnetTokensConfigurado()}
          enVuelo={estado.enVuelo}
          cuentasCargadas={estado.cuentasCargadas}
        />
      )}

      {metodos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CreditCard className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin métodos configurados</p>
            <p className="text-sm">
              Agrega cuentas bancarias o métodos presenciales para que tus
              clientes sepan cómo pagar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {metodos.map((m) => (
            <Card key={m.id} className={m.activo ? '' : 'opacity-60'}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {m.tipo === 'TRANSFERENCIA' ? (
                      <div className="rounded-lg bg-info/10 p-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                      </div>
                    ) : (
                      <div className="rounded-lg bg-warning/15 p-2">
                        <Building2 className="h-5 w-5 text-warning-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-foreground">{m.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.tipo === 'TRANSFERENCIA'
                          ? 'Transferencia bancaria'
                          : 'Pago presencial'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!m.activo && (
                      <Badge variant="secondary" className="text-xs">
                        Inactivo
                      </Badge>
                    )}
                    <Link href={`/admin/metodos-pago/${m.id}/editar`}>
                      <Button size="icon" variant="ghost" aria-label="Editar" title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                    <DeleteMetodoPagoButton id={m.id} nombre={m.nombre} />
                  </div>
                </div>

                <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                  {m.titular && <p><strong>Titular:</strong> {m.titular}</p>}
                  {m.numeroCuenta && (
                    <p>
                      <strong>Cuenta:</strong> {m.numeroCuenta}
                      {m.tipoCuenta ? ` (${m.tipoCuenta})` : ''}
                    </p>
                  )}
                  {m.instrucciones && (
                    <p className="whitespace-pre-line text-xs text-muted-foreground">
                      {m.instrucciones}
                    </p>
                  )}
                </div>

                {user.metadata.role === 'SUPERADMIN' && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {m.company.name}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
