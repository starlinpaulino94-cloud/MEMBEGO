'use client'

import { useActionState, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { concederLimiteAction, type ConnectAdminState } from '@/modules/connect/superadminActions'
import type { EmpresaConnect } from '@/modules/connect/superadmin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Lo que tiene concedido cada empresa, y cómo cambiarlo (rediseño «hub»: como
 * tabla).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VACÍO NO ES CERO
 *
 * El campo distingue tres cosas y la pantalla lo dice: un número concede ese
 * límite; CERO lo prohíbe explícitamente; VACÍO devuelve la empresa al valor
 * por defecto del sistema. Cero y por-defecto coinciden hoy en las claves de
 * API, y dejarán de coincidir el día que el default cambie — quien concedió
 * «cero» quería cero, no «lo que traiga el sistema».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA TABLA, Y LA FILA SE ABRE
 *
 * Cada empresa es una fila con lo que tiene concedido y lo que usa de verdad.
 * «Administrar acceso» despliega debajo los tres campos: la edición vive al
 * lado de la lectura, no en otra pantalla. En un teléfono la tabla desplaza
 * en horizontal dentro de su propio contenedor; nunca la página.
 */

const INIT: ConnectAdminState = {}

const FEATURES: { clave: string; label: string; ayuda: string }[] = [
  {
    clave: 'conexiones.max',
    label: 'Aplicaciones',
    ayuda: 'Cuántas apps (WhatsApp, Google…) puede conectar.',
  },
  {
    clave: 'api_keys.max',
    label: 'Claves de API',
    ayuda: 'Cada clave abre los datos de esta empresa a un tercero.',
  },
  {
    clave: 'webhooks.max',
    label: 'Webhooks',
    ayuda: 'A cuántas direcciones suyas podemos avisar.',
  },
]

/** Las iniciales para el avatar: primera letra de las dos primeras palabras. */
function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

/** Un límite, dicho: el número, o «—» cuando no hay concesión que mostrar. */
function limite(valor: number | null): string {
  return valor === null ? '—' : String(valor)
}

const CELDA = 'px-4 py-3 align-middle'

function FilaEmpresa({ empresa }: { empresa: EmpresaConnect }) {
  const [estado, conceder, guardando] = useActionState(concederLimiteAction, INIT)
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <tr className="border-t border-border/60">
        <td className={CELDA}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-caption font-bold text-muted-foreground"
            >
              {iniciales(empresa.nombre)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{empresa.nombre}</p>
              <p className="truncate font-mono text-caption text-muted-foreground">
                {empresa.companyId.slice(0, 8)}
              </p>
            </div>
          </div>
        </td>
        <td className={cn(CELDA, 'font-mono text-caption')}>{limite(empresa.limites['conexiones.max'])}</td>
        <td className={cn(CELDA, 'font-mono text-caption')}>{limite(empresa.limites['api_keys.max'])}</td>
        <td className={cn(CELDA, 'font-mono text-caption')}>{limite(empresa.limites['webhooks.max'])}</td>
        <td className={cn(CELDA, 'text-caption text-muted-foreground')}>
          {empresa.conexionesVivas} apps · {empresa.clavesActivas} claves ·{' '}
          {empresa.webhooksActivos} webhooks
        </td>
        <td className={cn(CELDA, 'text-right')}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={abierto}
            onClick={() => setAbierto((v) => !v)}
            className="text-primary"
          >
            Administrar acceso
            <ChevronDown
              className={cn(
                'ml-1 h-4 w-4 transition-transform duration-fast',
                abierto && 'rotate-180'
              )}
              aria-hidden
            />
          </Button>
        </td>
      </tr>

      {abierto && (
        <tr className="border-t border-border/60 bg-muted/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-3 md:grid-cols-3">
              {FEATURES.map((f) => {
                const actual = empresa.limites[f.clave as keyof typeof empresa.limites]
                return (
                  <form key={f.clave} action={conceder} className="flex items-end gap-2">
                    <input type="hidden" name="companyId" value={empresa.companyId} />
                    <input type="hidden" name="feature" value={f.clave} />
                    <label className="min-w-0 flex-1 space-y-1">
                      <span className="text-caption font-medium">{f.label}</span>
                      <Input
                        name="limite"
                        inputMode="numeric"
                        defaultValue={actual ?? ''}
                        placeholder="vacío = por defecto"
                        aria-label={`${f.label} para ${empresa.nombre}`}
                      />
                      <span className="block text-caption text-muted-foreground">{f.ayuda}</span>
                    </label>
                    <Button type="submit" size="sm" disabled={guardando}>
                      Guardar
                    </Button>
                  </form>
                )
              })}
            </div>
            {estado.error && (
              <div className="mt-3">
                <StatusBanner variant="destructive" title="No se pudo guardar">
                  {estado.error}
                </StatusBanner>
              </div>
            )}
            {estado.success && (
              <p className="mt-3 text-caption text-success" role="status">
                {estado.success}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export function ConcesionesPanel({ empresas }: { empresas: EmpresaConnect[] }) {
  const [filtro, setFiltro] = useState('')
  const visibles = filtro
    ? empresas.filter((e) => e.nombre.toLowerCase().includes(filtro.toLowerCase()))
    : empresas

  return (
    <div className="space-y-4">
      <p className="text-caption text-muted-foreground">
        Las claves de API y los webhooks nacen en <strong>cero</strong>: se conceden empresa a
        empresa. Un número concede ese límite, cero lo prohíbe, y dejarlo vacío devuelve al valor
        por defecto del sistema.
      </p>

      <div className="rounded-xl border border-border/60 bg-card elevation-1">
        <div className="border-b border-border/60 p-4">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por nombre de empresa…"
              aria-label="Buscar empresa"
              className="pl-9"
            />
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="p-6 text-caption text-muted-foreground">Ninguna empresa coincide.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-muted/40 text-left text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className={CELDA}>Empresa</th>
                  <th scope="col" className={CELDA}>Aplicaciones</th>
                  <th scope="col" className={CELDA}>Claves de API</th>
                  <th scope="col" className={CELDA}>Webhooks</th>
                  <th scope="col" className={CELDA}>En uso</th>
                  <th scope="col" className={cn(CELDA, 'text-right')}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((e) => (
                  <FilaEmpresa key={e.companyId} empresa={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-border/60 px-4 py-3 text-caption text-muted-foreground">
          Mostrando {visibles.length} de {empresas.length} empresas
        </p>
      </div>
    </div>
  )
}
