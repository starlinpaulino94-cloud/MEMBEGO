'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Loader2, Lock, Settings2, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { asentarMovimiento, cambiarEstadoDeCuenta, emitirCortesDeEmpresa, guardarConfigDeCobro } from '@/modules/billing/actions'
import { ETIQUETA_CICLO, ETIQUETA_MODELO } from '@/modules/billing/formato'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
const MODELOS = ['HYBRID', 'CPA_FIXED', 'PERCENTAGE'] as const
const CICLOS = ['MONTHLY', 'BIWEEKLY', 'WEEKLY'] as const
const TIPOS = [
  { valor: 'PAYMENT', etiqueta: 'Pago recibido de la empresa', ayuda: 'Baja lo que debe. Pide la referencia del depósito o la transferencia.' },
  { valor: 'ADJUSTMENT', etiqueta: 'Ajuste (+ debe más, − debe menos)', ayuda: 'Corrige un error. Exige un motivo; no se edita el asiento original, este lo contraría.' },
  { valor: 'CREDIT', etiqueta: 'Crédito a favor', ayuda: 'Concede un crédito (monto positivo). Exige un motivo.' },
  { valor: 'PROMOTIONAL_CREDIT', etiqueta: 'Crédito promocional', ayuda: 'Crédito de una promoción (monto positivo). Exige un motivo.' },
] as const

interface Props {
  companyId: string
  moneda: string
  config: { feeModel: string; cpaAmount: string; percentageRate: string; creditLimit: string; billingCycle: string }
  status: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED'
  holdManual: boolean
}

/**
 * Lo que el superadmin hace sobre la cuenta de una empresa: asentar un movimiento,
 * cambiar cómo se le cobra y suspenderla o liberarla. Cada acción de servidor
 * comprueba el rol otra vez: ocultar esto a quien no es superadmin no es seguridad.
 */
export function CuentaAcciones({ companyId, moneda, config, status, holdManual }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Una clave por formulario cargado: reenviar el mismo formulario no duplica el asiento.
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['valor']>('PAYMENT')
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [cfg, setCfg] = useState(config)
  const [motivoEstado, setMotivoEstado] = useState('')

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string, despues?: () => void) {
    start(async () => {
      const r = await accion()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(exito)
      despues?.()
      router.refresh()
    })
  }

  const spinner = pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null
  const ayudaTipo = TIPOS.find((t) => t.valor === tipo)?.ayuda

  return (
    <div className="space-y-4" aria-label="Acciones sobre la cuenta">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" />
            Asentar un movimiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            aria-label="Asentar un movimiento en la cuenta"
            onSubmit={(e) => {
              e.preventDefault()
              const n = monto.trim().replace(',', '.')
              if (n === '' || !Number.isFinite(Number(n))) {
                toast.error('Escribe el monto como número, por ejemplo 250 o -20.50.')
                return
              }
              ejecutar(
                () => asentarMovimiento({ companyId, tipo, monto: n, motivo: motivo.trim() || null, referencia: referencia.trim() || null, idempotencyKey: clave }),
                'Movimiento asentado.',
                () => {
                  setMonto('')
                  setMotivo('')
                  setReferencia('')
                  setClave(crypto.randomUUID())
                }
              )
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mv-tipo">Tipo</Label>
                <select id="mv-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={campoSelector}>
                  {TIPOS.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-monto">Monto ({moneda})</Label>
                <Input id="mv-monto" name="monto" inputMode="decimal" autoComplete="off" required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={tipo === 'ADJUSTMENT' ? '25 o -25' : '250'} />
              </div>
              {tipo === 'PAYMENT' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="mv-ref">Referencia del pago</Label>
                  <Input id="mv-ref" name="referencia" maxLength={120} autoComplete="off" required value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N.º de depósito o transferencia" />
                </div>
              ) : (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="mv-motivo">Motivo</Label>
                  <Input id="mv-motivo" name="motivo" maxLength={300} autoComplete="off" required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué se corrige o por qué se concede" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{ayudaTipo} El libro no se edita: cada movimiento es un asiento nuevo.</p>
            <Button type="submit" size="sm" disabled={pending}>
              {spinner}
              Asentar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" />
            Cómo se le cobra
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            aria-label="Configuración de cobro"
            onSubmit={(e) => {
              e.preventDefault()
              ejecutar(
                () => guardarConfigDeCobro({ companyId, feeModel: cfg.feeModel, cpaAmount: cfg.cpaAmount.replace(',', '.'), percentageRate: cfg.percentageRate.replace(',', '.'), creditLimit: cfg.creditLimit.replace(',', '.'), billingCycle: cfg.billingCycle }),
                'Configuración guardada. Rige para los pedidos que se completen de ahora en adelante.'
              )
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cf-modelo">Modelo de cobro</Label>
                <select id="cf-modelo" value={cfg.feeModel} onChange={(e) => setCfg({ ...cfg, feeModel: e.target.value })} className={campoSelector}>
                  {MODELOS.map((m) => (
                    <option key={m} value={m}>
                      {ETIQUETA_MODELO[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-cpa">CPA por pedido ({moneda})</Label>
                <Input id="cf-cpa" inputMode="decimal" autoComplete="off" required value={cfg.cpaAmount} onChange={(e) => setCfg({ ...cfg, cpaAmount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-pct">Porcentaje (%)</Label>
                <Input id="cf-pct" inputMode="decimal" autoComplete="off" required value={cfg.percentageRate} onChange={(e) => setCfg({ ...cfg, percentageRate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-limite">Límite de crédito ({moneda})</Label>
                <Input id="cf-limite" inputMode="decimal" autoComplete="off" required value={cfg.creditLimit} onChange={(e) => setCfg({ ...cfg, creditLimit: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-ciclo">Ciclo de estados de cuenta</Label>
                <select id="cf-ciclo" value={cfg.billingCycle} onChange={(e) => setCfg({ ...cfg, billingCycle: e.target.value })} className={campoSelector}>
                  {CICLOS.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETA_CICLO[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Los cambios rigen hacia adelante: las comisiones ya cobradas conservan la tarifa con la que se cobraron. Con el modelo mixto se cobra el CPA mientras el pedido no tenga el pago verificado y el porcentaje cuando sí.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {spinner}
                Guardar configuración
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => ejecutar(async () => { const r = await emitirCortesDeEmpresa(companyId); return r.ok ? { ok: true as const } : r }, 'Estados de cuenta al día.')}>
                Emitir estados de cuenta pendientes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className={status === 'SUSPENDED' ? 'border-destructive/30' : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {holdManual ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {holdManual ? 'Liberar la cuenta' : 'Suspender la cuenta'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            aria-label={holdManual ? 'Liberar la cuenta' : 'Suspender la cuenta'}
            onSubmit={(e) => {
              e.preventDefault()
              ejecutar(() => cambiarEstadoDeCuenta({ companyId, accion: holdManual ? 'LIBERAR' : 'SUSPENDER', motivo: motivoEstado }), holdManual ? 'Cuenta liberada.' : 'Cuenta suspendida.', () => setMotivoEstado(''))
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="es-motivo">Motivo</Label>
              <Input id="es-motivo" name="motivo" maxLength={300} autoComplete="off" required value={motivoEstado} onChange={(e) => setMotivoEstado(e.target.value)} placeholder={holdManual ? 'Ej: disputa resuelta' : 'Ej: disputa abierta con la empresa'} />
            </div>
            <p className="text-xs text-muted-foreground">
              {holdManual
                ? 'La cuenta está retenida a mano: ni un pago ni el paso del tiempo la reactivan. Al liberarla, el sistema vuelve a evaluarla contra su saldo y su límite.'
                : 'Una cuenta suspendida a mano no se reactiva sola, ni siquiera al pagar: solo tú la liberas. Una suspensión no frena los pedidos ni los cobros; impide crear campañas con presupuesto.'}
            </p>
            <Button type="submit" size="sm" variant={holdManual ? 'outline' : 'destructive'} disabled={pending}>
              {spinner}
              {holdManual ? 'Liberar' : 'Suspender'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
