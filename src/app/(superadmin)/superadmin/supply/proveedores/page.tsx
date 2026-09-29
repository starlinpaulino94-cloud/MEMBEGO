import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { reporteProveedores } from '@/modules/supply/pool'
import { proveedoresElegibles } from '@/modules/supply/proveedores'
import { FormAccion } from '@/components/supply/form-accion'
import { registrarProveedorExternoAction } from '@/modules/supply/actions-finanzas'
import { CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proveedores de supply' }

/**
 * MEMBEGO SUPPLY · SUPPLIER SCORECARD (Fases 31, 49).
 *
 * Existe para contestar una sola pregunta: ¿volvemos a comprarle 5.000
 * unidades a este comercio?
 *
 * El puntaje es una fórmula que se lee en una línea —cumplimiento menos
 * reversas por dos menos incumplimientos por tres— a propósito. Un proveedor
 * tiene derecho a entender por qué Membego dejó de comprarle, y una puntuación
 * que nadie sabe reproducir no sirve para esa conversación.
 */
export default async function ProveedoresPage() {
  await requireRole('SUPERADMIN')
  const [filas, elegibles] = await Promise.all([reporteProveedores(), proveedoresElegibles()])
  const conSupply = new Set(filas.map((f) => f.proveedorId))
  const sinSupply = elegibles.filter((e) => !conSupply.has(e.id))
  const origenDe = new Map(elegibles.map((e) => [e.id, e.origen]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        description="Cuánto se le compró a cada empresa, cuánto ha cumplido y cómo se está portando."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="proveedores" />}
      />

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Proveedores de Membego Supply"
            columnas={[
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'origen', titulo: 'Origen' },
              { clave: 'acuerdos', titulo: 'Acuerdos', alinearDerecha: true },
              { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
              { clave: 'sinAsignar', titulo: 'Sin asignar', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              { clave: 'pendientes', titulo: 'En clientes', alinearDerecha: true },
              { clave: 'cumplimiento', titulo: 'Cumplimiento', alinearDerecha: true },
              { clave: 'incidencias', titulo: 'Incidencias', alinearDerecha: true },
              { clave: 'costoTotal', titulo: 'Contratado', alinearDerecha: true },
              { clave: 'costoConsumido', titulo: 'Consumido', alinearDerecha: true },
              { clave: 'puntaje', titulo: 'Puntaje', alinearDerecha: true },
            ]}
            filas={filas.map((p) => ({
              __clave: p.proveedorId,
              proveedor: (
                <Link
                  href={`/superadmin/supply/proveedores/${p.proveedorId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {p.proveedor}
                </Link>
              ),
              origen: origenDe.get(p.proveedorId) === 'EXTERNA' ? <Badge variant="outline">Externo</Badge> : <Badge variant="secondary">Registrado</Badge>,
              acuerdos: p.acuerdos,
              compradas: p.compradas.toLocaleString('es-DO'),
              sinAsignar: p.sinAsignar.toLocaleString('es-DO'),
              emitidas: p.emitidas.toLocaleString('es-DO'),
              redimidas: p.redimidas.toLocaleString('es-DO'),
              pendientes: p.pendientesCliente.toLocaleString('es-DO'),
              cumplimiento: `${p.scorecard.tasaCumplimiento}%`,
              incidencias: p.scorecard.incidencias,
              costoTotal: formatMoneyRD(p.costoTotal),
              costoConsumido: formatMoneyRD(p.costoConsumido),
              puntaje: (
                <Badge
                  variant={
                    p.scorecard.puntaje >= 85
                      ? 'success'
                      : p.scorecard.puntaje >= 60
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {p.scorecard.puntaje}
                </Badge>
              ),
            }))}
            vacio="Ninguna empresa tiene supply comprado todavía."
          />
        </CardContent>
      </Card>

      {sinSupply.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Proveedores sin supply todavía</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'proveedor', titulo: 'Proveedor' },
                { clave: 'origen', titulo: 'Origen' },
                { clave: 'sucursales', titulo: 'Sucursales', alinearDerecha: true },
              ]}
              filas={sinSupply.map((e) => ({
                __clave: e.id,
                proveedor: (
                  <Link href={`/superadmin/supply/proveedores/${e.id}`} className="font-medium underline-offset-4 hover:underline">
                    {e.nombre}
                  </Link>
                ),
                origen: e.origen === 'EXTERNA' ? <Badge variant="outline">Externo</Badge> : <Badge variant="secondary">Registrado</Badge>,
                sucursales: e.sucursales.length,
              }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Registrar un proveedor externo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            Una empresa que todavía no opera en Membego. Nace como empresa inactiva con perfil de proveedor: se le puede comprar, pagar y liquidar. Si un día se registra, se convierte en la misma empresa sin perder historial.
          </p>
          <FormAccion
            accion={registrarProveedorExternoAction}
            etiqueta="Registrar proveedor externo"
            campos={[
              { name: 'nombre', label: 'Nombre comercial', required: true, maxLength: 160 },
              { name: 'razonSocial', label: 'Razón social', maxLength: 200 },
              { name: 'rnc', label: 'RNC', maxLength: 40 },
              { name: 'ciudad', label: 'Ciudad', maxLength: 80 },
              { name: 'contactoNombre', label: 'Contacto', maxLength: 120 },
              { name: 'contactoEmail', label: 'Correo', maxLength: 160 },
              { name: 'contactoTelefono', label: 'Teléfono', maxLength: 40 },
              { name: 'plazoPagoDias', label: 'Plazo de pago (días)', tipo: 'number', step: '1', min: 0 },
              { name: 'banco', label: 'Banco', maxLength: 120 },
              { name: 'cuentaBancaria', label: 'Cuenta bancaria', maxLength: 60 },
              { name: 'tipoCuenta', label: 'Tipo de cuenta', maxLength: 40 },
              { name: 'notas', label: 'Notas', tipo: 'textarea' },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
