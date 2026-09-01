'use client'

import { useActionState, useState } from 'react'
import { concederLimiteAction, type ConnectAdminState } from '@/modules/connect/superadminActions'
import type { EmpresaConnect } from '@/modules/connect/superadmin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Lo que tiene concedido cada empresa, y cómo cambiarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VACÍO NO ES CERO
 *
 * El campo distingue tres cosas y la pantalla lo dice: un número concede ese
 * límite; CERO lo prohíbe explícitamente; VACÍO devuelve la empresa al valor
 * por defecto del sistema. Cero y por-defecto coinciden hoy en las claves de
 * API, y dejarán de coincidir el día que el default cambie — quien concedió
 * «cero» quería cero, no «lo que traiga el sistema».
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

function FilaEmpresa({ empresa }: { empresa: EmpresaConnect }) {
  const [estado, conceder, guardando] = useActionState(concederLimiteAction, INIT)
  const [abierto, setAbierto] = useState(false)

  return (
    <li className="rounded-xl border border-border/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{empresa.nombre}</span>
        <span className="text-caption text-muted-foreground">
          {empresa.conexionesVivas} apps · {empresa.clavesActivas} claves ·{' '}
          {empresa.webhooksActivos} webhooks
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? 'Cerrar' : 'Conceder'}
        </Button>
      </div>

      {abierto && (
        <div className="mt-3 space-y-3">
          {FEATURES.map((f) => {
            const actual = empresa.limites[f.clave as keyof typeof empresa.limites]
            return (
              <form key={f.clave} action={conceder} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="companyId" value={empresa.companyId} />
                <input type="hidden" name="feature" value={f.clave} />
                <label className="flex-1 space-y-1">
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
          {estado.error && (
            <StatusBanner variant="destructive" title="No se pudo guardar">
              {estado.error}
            </StatusBanner>
          )}
          {estado.success && (
            <p className="text-caption text-success" role="status">
              {estado.success}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function ConcesionesPanel({ empresas }: { empresas: EmpresaConnect[] }) {
  const [filtro, setFiltro] = useState('')
  const visibles = filtro
    ? empresas.filter((e) => e.nombre.toLowerCase().includes(filtro.toLowerCase()))
    : empresas

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Qué tiene concedida cada empresa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption text-muted-foreground">
          Las claves de API y los webhooks nacen en <strong>cero</strong>: se conceden empresa a
          empresa. Un número concede ese límite, cero lo prohíbe, y dejarlo vacío devuelve al valor
          por defecto del sistema.
        </p>
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar empresa…"
          aria-label="Buscar empresa"
        />
        {visibles.length === 0 ? (
          <p className="text-caption text-muted-foreground">Ninguna empresa coincide.</p>
        ) : (
          <ul className="space-y-2">
            {visibles.map((e) => (
              <FilaEmpresa key={e.companyId} empresa={e} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
