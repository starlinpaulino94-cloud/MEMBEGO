import { Landmark } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { MONO, Tarjeta, TarjetaSeccion } from '@/components/supply-v2/resumen/superficie'
import { BotonEstadoCuenta, FormCuentaCobro } from '@/components/supply-v2/finanzas/form-cuenta-cobro'
import { cuentasParaAdministrar } from '@/modules/supply-v2/payment-accounts/cuentas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuentas de cobro · Supply' }

/**
 * MEMBEGO SUPPLY · dónde cobra Membego. Esta pantalla es un INTERRUPTOR DE
 * NEGOCIO disfrazado de configuración: la venta está encendida si —y solo si—
 * existe aquí una cuenta activa. Por eso lo primero que se ve es si Membego
 * está cobrando o no, dicho con esas palabras.
 */
export default async function CuentasCobroPage() {
  await requireRole('SUPERADMIN')
  const cuentas = await cuentasParaAdministrar()
  const activas = cuentas.filter((c) => c.activa)

  return (
    <MarcoSupplyV2 activa="finanzas">
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col gap-1 p-5" data-testid="estado-cobro">
          <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">Cuentas de cobro de Membego</span>
          <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">{activas.length > 0 ? 'Membego está cobrando' : 'Membego no está cobrando'}</h2>
          <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
            {activas.length > 0
              ? `Hay ${activas.length} ${activas.length === 1 ? 'cuenta activa' : 'cuentas activas'}, así que el cliente puede pagar las ofertas de Membego. Son cuentas de la plataforma, no de ninguna empresa.`
              : 'Sin ninguna cuenta activa nadie puede pagar una oferta de Membego. Da de alta una cuenta y actívala. Son cuentas de la plataforma, no de ninguna empresa.'}
          </p>
        </Tarjeta>

        <TarjetaSeccion icono={Landmark} titulo="Dar de alta una cuenta">
          <div className="p-4">
            <FormCuentaCobro />
          </div>
        </TarjetaSeccion>

        <TarjetaSeccion icono={Landmark} titulo={`Cuentas registradas (${cuentas.length})`} data-testid="cuentas-cobro">
          {cuentas.length === 0 ? (
            <p className="p-4 text-[13px] leading-[18px] text-sv2-ink-variant">Todavía no hay ninguna. La primera que actives enciende el cobro.</p>
          ) : (
            <ul className="divide-y divide-sv2-divider">
              {cuentas.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 p-4 @4xl:flex-row @4xl:items-center @4xl:justify-between" data-testid="cuenta-cobro">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold leading-5">
                      {c.nombre}
                      <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4', c.activa ? 'bg-sv2-secondary-container text-sv2-on-secondary-container' : 'bg-sv2-soft text-sv2-ink-variant')}>
                        {c.activa ? 'Activa' : 'Apagada'}
                      </span>
                    </span>
                    <span className="text-[13px] leading-[18px] text-sv2-ink-variant">
                      {[c.titular, c.tipo === 'TRANSFERENCIA' ? 'Transferencia' : 'Presencial', c.tipoCuenta, c.moneda].filter(Boolean).join(' · ')}
                    </span>
                    {c.numeroCuenta && <span className={cn(MONO, 'text-sv2-ink-variant')}>{c.numeroCuenta}</span>}
                    <span className="text-[12px] leading-4 text-sv2-outline">
                      {c.pedidos.toLocaleString('es-DO')} {c.pedidos === 1 ? 'pedido' : 'pedidos'} · alta {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <BotonEstadoCuenta cuentaId={c.id} activa={c.activa} />
                </li>
              ))}
            </ul>
          )}
        </TarjetaSeccion>
      </div>
    </MarcoSupplyV2>
  )
}
