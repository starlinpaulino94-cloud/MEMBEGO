'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import type { SupplyV2SupplierAccessStatus } from '@prisma/client'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { aceptarContratoProveedorAction, generarCodigoDePruebaAction } from '@/modules/supply-v2/actions-acceso'
import { ACCESS_STATUS_LABELS, type Preparacion } from '@/modules/supply-v2/suppliers/acceso-dominio'
import { RUTA_PORTAL_ESCANER, RUTA_PORTAL_PERSONAL } from '@/modules/supply-v2/core/catalogo'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Configuración del portal (Supplier Lite, §8).
 * La lista de preparación, el contrato y la prueba del escáner. Pensado para
 * el teléfono: una columna, botones grandes.
 */
export function ConfiguracionProveedor({
  accessStatus,
  preparacion,
  contratoAceptadoEn,
  codigoDePrueba,
  qrProbadoEn,
  puedeConfigurar,
}: {
  accessStatus: SupplyV2SupplierAccessStatus
  preparacion: Preparacion
  contratoAceptadoEn: string | null
  codigoDePrueba: string | null
  qrProbadoEn: string | null
  puedeConfigurar: boolean
}) {
  const [contrato, aceptar, aceptando] = useActionState<EstadoAccion<Preparacion>, FormData>(aceptarContratoProveedorAction, {})
  const [prueba, generar, generando] = useActionState<EstadoAccion<{ codigo: string }>, FormData>(generarCodigoDePruebaAction, {})
  const prep = contrato.data ?? preparacion
  const tone = accessStatus === 'ACTIVE' ? 'success' : accessStatus === 'SUSPENDED' || accessStatus === 'TERMINATED' ? 'danger' : 'warning'
  const codigo = prueba.data?.codigo ?? codigoDePrueba

  return (
    <div className="space-y-4">
      <Card data-testid="config-preparacion">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Tu activación</CardTitle>
          <StatusChip tone={tone}>{ACCESS_STATUS_LABELS[accessStatus]}</StatusChip>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2 text-sm">
            {prep.pasos.map((p) => (
              <li key={p.paso} className="flex items-center gap-2" data-testid={`paso-${p.paso}`} data-hecho={p.hecho ? '1' : '0'}>
                {p.hecho ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className={p.hecho ? '' : 'text-muted-foreground'}>{p.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted-foreground" data-testid="config-progreso">
            {prep.completos} de {prep.total}. {prep.lista ? 'Tu portal está operativo.' : 'Cuando completes la lista, Membego podrá activar acuerdos y publicar ofertas nuevas contigo.'}
          </p>
          {!prep.pasos.find((p) => p.paso === 'sucursalConfigurada')?.hecho && (
            <p className="text-sm"><Link href="/admin/sucursales" className="underline underline-offset-4">Configura tu sucursal de canje</Link></p>
          )}
          {!prep.pasos.find((p) => p.paso === 'operadorConfigurado')?.hecho && (
            <p className="text-sm"><Link href={RUTA_PORTAL_PERSONAL} className="underline underline-offset-4">Invita a quien va a escanear</Link></p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="config-contrato">
        <CardHeader><CardTitle>Contrato de proveedor</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Al aceptar, tu organización se compromete a entregar las unidades y derechos que Membego compró, a registrar cada canje escaneando el QR del cliente y a reportar las ventas adicionales de cada visita según las condiciones de tu acuerdo.
          </p>
          {contratoAceptadoEn || contrato.success ? (
            <p className="flex items-center gap-2 text-sm text-success" data-testid="contrato-aceptado">
              <CheckCircle2 className="size-4" aria-hidden /> Contrato aceptado{contratoAceptadoEn ? ` el ${contratoAceptadoEn}` : ''}.
            </p>
          ) : puedeConfigurar ? (
            <form action={aceptar}>
              {contrato.error && <p className="mb-2 text-sm text-destructive" role="alert">{contrato.error}</p>}
              <Button type="submit" size="lg" disabled={aceptando} loading={aceptando} data-testid="btn-aceptar-contrato">Acepto el contrato</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Solo el dueño puede aceptar el contrato.</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="config-prueba-qr">
        <CardHeader><CardTitle>Prueba del escáner</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {qrProbadoEn ? (
            <p className="flex items-center gap-2 text-sm text-success" data-testid="qr-probado">
              <CheckCircle2 className="size-4" aria-hidden /> Escáner probado el {qrProbadoEn}.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Genera un código de prueba, ábrelo en el escáner (cámara o escrito a mano) y confirma. Así sabemos que tu equipo puede canjear de verdad.
              </p>
              {codigo ? (
                <p className="rounded-lg bg-muted p-3 text-center font-mono text-lg tracking-wider" data-testid="codigo-prueba">{codigo}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {puedeConfigurar && (
                  <form action={generar}>
                    {prueba.error && <p className="mb-2 text-sm text-destructive" role="alert">{prueba.error}</p>}
                    <Button type="submit" variant={codigo ? 'outline' : 'default'} disabled={generando} loading={generando} data-testid="btn-generar-prueba">
                      {codigo ? 'Ver el código de nuevo' : 'Generar código de prueba'}
                    </Button>
                  </form>
                )}
                {codigo && (
                  <Button asChild>
                    <Link href={RUTA_PORTAL_ESCANER} data-testid="link-ir-al-escaner">Ir al escáner</Link>
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
