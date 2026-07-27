'use client'

/**
 * App Car Wash · Fase 2 — alta y edición de cuentas corporativas (flotillas).
 *
 * Formulario y lista en la misma pantalla: dar de alta una flota es algo que
 * se hace una vez por cliente, y mandar a otra página para eso solo agrega un
 * paso. El estado de cuenta sí vive aparte, porque ahí se entra a trabajar.
 */

import { useActionState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Building2, Loader2, Pencil, Power, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { guardarCuenta, alternarCuenta, type Fase2State } from '@/modules/carwash/fase2-actions'
import type { CuentaResumen } from '@/modules/carwash/cuentas'

const initial: Fase2State = {}

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2,
  }).format(n)
}

const input =
  'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-muted-foreground'

export function CuentasPanel({
  cuentas,
  editando,
}: {
  cuentas: CuentaResumen[]
  editando: CuentaResumen | null
}) {
  const [state, formAction, pending] = useActionState(guardarCuenta, initial)

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        key={editando?.id ?? 'nueva'}
        className="space-y-4 rounded-2xl border border-border/70 bg-card p-5"
      >
        <input type="hidden" name="id" value={editando?.id ?? ''} />
        <h2 className="text-sm font-bold text-foreground">
          {editando ? `Editar ${editando.nombre}` : 'Nueva cuenta corporativa'}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Empresa</span>
            <input
              name="nombre"
              required
              maxLength={80}
              defaultValue={editando?.nombre ?? ''}
              placeholder="Transporte El Sol, S.R.L."
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">RNC</span>
            <input name="rnc" maxLength={20} defaultValue={editando?.rnc ?? ''} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Contacto</span>
            <input
              name="contacto"
              maxLength={80}
              defaultValue={editando?.contacto ?? ''}
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Teléfono</span>
            <input
              name="telefono"
              maxLength={30}
              defaultValue={editando?.telefono ?? ''}
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Límite de crédito (RD$)
            </span>
            <input
              name="limiteCredito"
              inputMode="decimal"
              defaultValue={editando?.limiteCredito ?? ''}
              placeholder="Vacío = sin tope"
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Días de crédito
            </span>
            <input
              name="diasCredito"
              inputMode="numeric"
              defaultValue={editando?.diasCredito ?? 30}
              className={input}
            />
          </label>
        </div>

        {/* El límite AVISA, no bloquea: dejar un camión sin lavar por un tope
            administrativo es peor negocio que cobrarlo después. */}
        <p className="text-xs text-muted-foreground">
          El límite de crédito solo genera un aviso cuando se pasa. Nunca impide atender un
          vehículo: eso lo decide quien está en la pista, no el sistema.
        </p>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editando ? 'Guardar cambios' : 'Crear cuenta'}
          </Button>
          {editando && (
            <Button asChild variant="ghost">
              <Link href="/admin/app/carwash/cuentas">Cancelar</Link>
            </Button>
          )}
        </div>
      </form>

      {cuentas.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Empresa</th>
                <th className="px-4 py-3 font-semibold">Vehículos</th>
                <th className="px-4 py-3 font-semibold">Por facturar</th>
                <th className="px-4 py-3 font-semibold">Deuda viva</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {cuentas.map((c) => (
                <tr key={c.id} className={c.activa ? '' : 'opacity-55'}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/app/carwash/cuentas/${c.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {c.nombre}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[c.rnc, c.contacto, c.telefono].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{c.vehiculos}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{fmtRD(c.porFacturar)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold tabular-nums ${
                        c.excedeLimite ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {fmtRD(c.saldo)}
                    </span>
                    {c.excedeLimite && (
                      <p className="flex items-center gap-1 text-[11px] text-destructive">
                        <TriangleAlert className="h-3 w-3" /> pasó el límite de{' '}
                        {fmtRD(c.limiteCredito ?? 0)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/app/carwash/cuentas?editar=${c.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <BotonActivar id={c.id} activa={c.activa} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cuentas.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          <Building2 className="mx-auto mb-2 h-7 w-7 opacity-40" />
          Todavía no tienes flotas. Crea una arriba y agrégale las placas: desde entonces, cada vez
          que una de esas placas se entregue, el servicio se carga a su cuenta en vez de cobrarse en
          caja.
        </p>
      )}
    </div>
  )
}

function BotonActivar({ id, activa }: { id: string; activa: boolean }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title={activa ? 'Desactivar' : 'Activar'}
      onClick={() =>
        start(async () => {
          const r = await alternarCuenta(id)
          if (r.error) toast.error(r.error)
          else if (r.success) toast.success(r.success)
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
    </Button>
  )
}
