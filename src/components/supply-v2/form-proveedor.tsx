'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  buscarEmpresasAction,
  crearProveedorExternoAction,
  vincularEmpresaAction,
  type EstadoAccion,
} from '@/modules/supply-v2/actions'
import type { CompanyRef } from '@/modules/supply-v2/contracts/gateways'
import type { ProveedorCreado } from '@/modules/supply-v2/suppliers/service'
import { MONEDAS_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · CREAR PROVEEDOR (§27).
 *
 * Primero pregunta si ya está en Membego. Sí → autocompletar empresas y
 * vincular (no se crea otra `Company`). No → alta de proveedor externo.
 *
 * `onCreado` lo usa el wizard para seguir sin salir; sin él, navega a la
 * ficha del proveedor.
 */
export function FormProveedor({ onCreado, compacto = false }: { onCreado?: (p: ProveedorCreado) => void; compacto?: boolean }) {
  const [registrado, setRegistrado] = useState<boolean | null>(null)

  if (registrado === null) {
    return (
      <div className="space-y-3" data-testid="proveedor-pregunta">
        <p className="text-sm font-medium">¿Ya está registrado en Membego?</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setRegistrado(true)}>
            Sí, es una empresa de Membego
          </Button>
          <Button type="button" onClick={() => setRegistrado(false)}>
            No, es un proveedor externo
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button type="button" className="text-caption text-muted-foreground underline-offset-4 hover:underline" onClick={() => setRegistrado(null)}>
        ← Cambiar respuesta
      </button>
      {registrado ? <VincularEmpresa onCreado={onCreado} /> : <ProveedorExterno onCreado={onCreado} compacto={compacto} />}
    </div>
  )
}

function useAlTerminar(estado: EstadoAccion<ProveedorCreado>, onCreado?: (p: ProveedorCreado) => void) {
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.data || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    if (onCreado) onCreado(estado.data)
    else router.push(`/superadmin/supply-v2/proveedores/${estado.data.id}`)
  }, [estado, onCreado, router])
}

function VincularEmpresa({ onCreado }: { onCreado?: (p: ProveedorCreado) => void }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<ProveedorCreado>, FormData>(vincularEmpresaAction, {})
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<CompanyRef[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegida, setElegida] = useState<CompanyRef | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimaConsulta = useRef('')
  useAlTerminar(estado, onCreado)

  // Búsqueda con retardo desde el propio cambio del campo (no desde un
  // efecto): la respuesta solo se aplica si sigue siendo la última consulta.
  const buscar = (q: string) => {
    setElegida(null)
    setConsulta(q)
    ultimaConsulta.current = q
    if (temporizador.current) clearTimeout(temporizador.current)
    if (q.trim().length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    temporizador.current = setTimeout(() => {
      buscarEmpresasAction(q)
        .then((r) => {
          if (ultimaConsulta.current === q) setResultados(r)
        })
        .catch(() => toast.error('No se pudo buscar empresas.'))
        .finally(() => {
          if (ultimaConsulta.current === q) setBuscando(false)
        })
    }, 250)
  }
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current)
  }, [])

  return (
    <form action={accion} className="space-y-3" data-testid="form-vincular-empresa">
      <input type="hidden" name="companyId" value={elegida?.id ?? ''} />
      <div>
        <Label htmlFor="buscarEmpresa">Empresa de Membego</Label>
        <Input
          id="buscarEmpresa"
          autoComplete="off"
          placeholder="Escribe el nombre de la empresa…"
          value={elegida ? elegida.name : consulta}
          onChange={(e) => buscar(e.target.value)}
        />
        {!elegida && (buscando || resultados.length > 0 || consulta.trim().length >= 2) && (
          <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-background text-sm shadow-sm" role="listbox">
            {buscando && resultados.length === 0 && <li className="px-3 py-2 text-muted-foreground">Buscando…</li>}
            {!buscando && resultados.length === 0 && consulta.trim().length >= 2 && (
              <li className="px-3 py-2 text-muted-foreground">Ninguna empresa coincide. Si no está en Membego, créala como proveedor externo.</li>
            )}
            {resultados.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                  onClick={() => setElegida(c)}
                >
                  <span>
                    <span className="font-medium">{c.name}</span>
                    {c.city && <span className="text-muted-foreground"> · {c.city}</span>}
                  </span>
                  {c.supplierId && <span className="text-caption text-muted-foreground">ya es proveedor</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {elegida && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="contactoVinculo">Contacto comercial</Label>
            <Input id="contactoVinculo" name="contactName" maxLength={120} />
          </div>
          <div>
            <Label htmlFor="whatsappVinculo">WhatsApp</Label>
            <Input id="whatsappVinculo" name="whatsapp" maxLength={40} defaultValue={elegida.whatsapp ?? ''} />
          </div>
          <div>
            <Label htmlFor="plazoVinculo">Días de pago</Label>
            <Input id="plazoVinculo" name="paymentTermsDays" type="number" min={0} step={1} />
          </div>
          <div>
            <Label htmlFor="condicionesVinculo">Condiciones de pago</Label>
            <Input id="condicionesVinculo" name="paymentTermsText" maxLength={500} placeholder="50 % anticipo, resto a 15 días" />
          </div>
        </div>
      )}
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={!elegida || pendiente} loading={pendiente}>
        {elegida?.supplierId ? 'Usar este proveedor' : 'Vincular como proveedor'}
      </Button>
    </form>
  )
}

function ProveedorExterno({ onCreado, compacto }: { onCreado?: (p: ProveedorCreado) => void; compacto: boolean }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion<ProveedorCreado>, FormData>(crearProveedorExternoAction, {})
  useAlTerminar(estado, onCreado)
  const select = 'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

  return (
    <form action={accion} className="space-y-3" data-testid="form-proveedor-externo">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="commercialName">Nombre comercial</Label>
          <Input id="commercialName" name="commercialName" required maxLength={160} placeholder="Little Pizza" autoFocus />
        </div>
        <div>
          <Label htmlFor="legalName">Nombre legal</Label>
          <Input id="legalName" name="legalName" maxLength={200} />
        </div>
        <div>
          <Label htmlFor="taxId">RNC</Label>
          <Input id="taxId" name="taxId" maxLength={40} />
        </div>
        <div>
          <Label htmlFor="contactName">Contacto</Label>
          <Input id="contactName" name="contactName" maxLength={120} />
        </div>
        <div>
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input id="whatsapp" name="whatsapp" maxLength={40} placeholder="809-555-0101" />
        </div>
        <div>
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" maxLength={40} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" maxLength={160} />
        </div>
        {!compacto && (
          <>
            <div>
              <Label htmlFor="city">Ciudad</Label>
              <Input id="city" name="city" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="countryCode">País</Label>
              <select id="countryCode" name="countryCode" defaultValue="DO" className={select}>
                <option value="DO">República Dominicana</option>
                <option value="US">Estados Unidos</option>
                <option value="ES">España</option>
                <option value="MX">México</option>
                <option value="CO">Colombia</option>
              </select>
            </div>
          </>
        )}
        <div>
          <Label htmlFor="currency">Moneda</Label>
          <select id="currency" name="currency" defaultValue="DOP" className={select}>
            {MONEDAS_SUPPLY_V2.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="paymentTermsDays">Días de pago</Label>
          <Input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} step={1} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="paymentTermsText">Condiciones de pago</Label>
          <Input id="paymentTermsText" name="paymentTermsText" maxLength={500} placeholder="50 % anticipo, resto a 15 días" />
        </div>
        {!compacto && (
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
          </div>
        )}
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <Button type="submit" disabled={pendiente} loading={pendiente}>
        {onCreado ? 'Guardar y continuar' : 'Guardar proveedor'}
      </Button>
    </form>
  )
}
