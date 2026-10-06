import Link from 'next/link'
import { ChevronRight, Link2, MapPin, MessageSquare, Store } from 'lucide-react'
import type { SupplyV2SupplierStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import { SUPPLIER_SOURCE_LABELS, SUPPLIER_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import type { ProveedorEnDirectorio } from '@/modules/supply-v2/suppliers/queries'
import { MONO, Tarjeta } from '../resumen/superficie'
import { MenuProveedor } from './menu-proveedor'

const RUTA = '/superadmin/supply/proveedores'

function iniciales(nombre: string): string {
  const palabras = nombre.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (palabras.length > 1 ? palabras[0]![0]! + palabras[1]![0]! : (palabras[0] ?? '?').slice(0, 2)).toUpperCase()
}

/** Enlace de WhatsApp: los números dominicanos de 10 dígitos llevan el código de país 1 delante. */
function enlaceWhatsApp(numero: string): string | null {
  const digitos = numero.replace(/\D/g, '')
  if (digitos.length < 8) return null
  return `https://wa.me/${digitos.length === 10 ? `1${digitos}` : digitos}`
}

function dinero(monto: string, moneda: string): string {
  const n = Number(monto).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'DOP' ? `RD$ ${n}` : `${moneda} ${n}`
}

function ubicacion(p: ProveedorEnDirectorio): string | null {
  return [p.address, p.city].filter(Boolean).join(', ') || null
}

function textoCategorias(c: string[]): string | null {
  if (c.length === 0) return null
  return c.length <= 2 ? c.join(' · ') : `${c.slice(0, 2).join(' · ')} +${c.length - 2}`
}

const ESTADO: Record<SupplyV2SupplierStatus, { fondo: string; punto: string }> = {
  ACTIVE: { fondo: 'bg-sv2-secondary-container text-sv2-on-secondary-container', punto: 'bg-sv2-secondary' },
  INACTIVE: { fondo: 'bg-sv2-soft-hover text-sv2-ink-variant', punto: 'bg-sv2-outline' },
  BLOCKED: { fondo: 'bg-sv2-error-container text-sv2-on-error-container', punto: 'bg-sv2-error' },
}

function ChipEstado({ estado }: { estado: SupplyV2SupplierStatus }) {
  const e = ESTADO[estado]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em]', e.fondo)} data-testid="estado-proveedor">
      <span aria-hidden className={cn('size-1.5 rounded-full', e.punto)} />
      {SUPPLIER_STATUS_LABELS[estado]}
    </span>
  )
}

function Avatar({ p }: { p: ProveedorEnDirectorio }) {
  return (
    <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center rounded-[8px] text-[15px] font-bold', p.source === 'REGISTERED_COMPANY' ? 'bg-sv2-primary-fixed text-sv2-primary' : 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed')}>
      {iniciales(p.commercialName)}
    </span>
  )
}

function Origen({ p }: { p: ProveedorEnDirectorio }) {
  const registrado = p.source === 'REGISTERED_COMPANY'
  const Icono = registrado ? Link2 : Store
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold leading-4 tracking-[0.04em]', registrado ? 'bg-sv2-primary-fixed text-sv2-primary' : 'bg-sv2-soft text-foreground')}>
      <Icono aria-hidden className="size-3.5" />
      {SUPPLIER_SOURCE_LABELS[p.source]}
    </span>
  )
}

function Contacto({ p }: { p: ProveedorEnDirectorio }) {
  const numero = p.whatsapp ?? p.phone
  const wa = p.whatsapp ? enlaceWhatsApp(p.whatsapp) : null
  const persona = p.contactName ?? p.email
  if (!numero && !persona) return <span className="text-sv2-outline">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {numero && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="flex size-6 items-center justify-center rounded-[4px] bg-sv2-secondary-container text-sv2-on-secondary-container">
            <MessageSquare className="size-3.5" />
          </span>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(MONO, 'whitespace-nowrap font-bold text-foreground hover:underline')} aria-label={`Escribir por WhatsApp a ${p.commercialName}`}>{numero}</a>
          ) : (
            <span className={cn(MONO, 'whitespace-nowrap font-bold')}>{numero}</span>
          )}
        </span>
      )}
      {persona && <span className="text-[13px] leading-[18px] text-sv2-ink-variant">{persona}</span>}
    </div>
  )
}

function Catalogo({ p }: { p: ProveedorEnDirectorio }) {
  return (
    <span className={cn(MONO, 'inline-flex whitespace-nowrap rounded-[4px] bg-sv2-soft px-2 py-1 font-bold text-foreground')}>
      {p.productos} {p.productos === 1 ? 'producto' : 'productos'}
    </span>
  )
}

function ComprasAbiertas({ p }: { p: ProveedorEnDirectorio }) {
  const clase = cn(MONO, 'inline-flex size-8 items-center justify-center rounded-full font-bold', p.comprasAbiertas > 0 ? 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed hover:underline' : 'bg-sv2-well text-sv2-outline')
  return p.comprasAbiertas > 0 ? (
    <Link href={`/superadmin/supply/compras?proveedor=${p.id}`} className={clase} aria-label={`${p.comprasAbiertas} compras abiertas de ${p.commercialName}`}>{p.comprasAbiertas}</Link>
  ) : (
    <span className={clase}>0</span>
  )
}

function Nombre({ p }: { p: ProveedorEnDirectorio }) {
  const lugar = ubicacion(p)
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex flex-wrap items-center gap-1.5">
        <Link href={`${RUTA}/${p.id}`} className="text-[15px] font-bold leading-5 text-foreground hover:underline">{p.commercialName}</Link>
        {p.taxId && <span className={cn(MONO, 'whitespace-nowrap rounded-[4px] bg-sv2-soft px-1 text-sv2-outline')}>RNC {p.taxId}</span>}
      </span>
      {lugar && (
        <span className="mt-0.5 flex items-center gap-1 text-[13px] leading-[18px] text-sv2-ink-variant">
          <MapPin aria-hidden className="size-3.5 shrink-0" />
          {lugar}
        </span>
      )}
    </div>
  )
}

/**
 * Directorio de proveedores (Stitch, propuesta A): nueve columnas en
 * escritorio, que se desplazan dentro de su tarjeta si no caben; tarjetas
 * cuando el contenido es estrecho.
 */
export function TablaProveedores({ proveedores, pie }: { proveedores: ProveedorEnDirectorio[]; pie: React.ReactNode }) {
  const th = 'px-1.5 text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline'
  return (
    <Tarjeta className="overflow-hidden" data-testid="tabla-proveedores">
      <div className="hidden w-full overflow-x-auto @4xl:block">
        <table className="w-full border-collapse text-left text-[13px] leading-[18px] text-foreground">
          <thead>
            <tr className="h-11 border-b border-sv2-border bg-sv2-head">
              <th scope="col" className={cn(th, 'min-w-[150px] pl-3')}>Proveedor</th>
              <th scope="col" className={cn(th)}>Origen / Vínculo</th>
              <th scope="col" className={cn(th)}>Contacto &amp; WhatsApp</th>
              <th scope="col" className={cn(th, 'min-w-[100px]')}>Categoría</th>
              <th scope="col" className={cn(th, 'text-center')}>Catálogo</th>
              <th scope="col" className={cn(th, 'text-center')}>Compras abiertas</th>
              <th scope="col" className={cn(th, 'text-right')}>Total comprado</th>
              <th scope="col" className={cn(th, 'text-center')}>Estado</th>
              <th scope="col" className={cn(th, 'pr-2 text-right')}>Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sv2-divider">
            {proveedores.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-sv2-well/60" data-testid="fila-proveedor">
                <td className="py-3 pl-3 pr-1.5 align-middle">
                  <div className="flex items-center gap-2">
                    <Avatar p={p} />
                    <Nombre p={p} />
                  </div>
                </td>
                <td className="px-1.5 py-3 align-middle"><Origen p={p} /></td>
                <td className="px-1.5 py-3 align-middle"><Contacto p={p} /></td>
                <td className="px-1.5 py-3 align-middle text-sv2-ink-variant">{textoCategorias(p.categorias) ?? <span className="text-sv2-outline">—</span>}</td>
                <td className="px-1.5 py-3 text-center align-middle"><Catalogo p={p} /></td>
                <td className="px-1.5 py-3 text-center align-middle"><ComprasAbiertas p={p} /></td>
                <td className={cn(MONO, 'whitespace-nowrap px-1.5 py-3 text-right align-middle font-bold')}>{dinero(p.totalComprado, p.currency).replace('RD$ ', 'RD$')}</td>
                <td className="px-1.5 py-3 text-center align-middle"><ChipEstado estado={p.status} /></td>
                <td className="py-3 pl-1 pr-2 align-middle">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`${RUTA}/${p.id}`} className="inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
                      Ver proveedor
                      <ChevronRight aria-hidden className="size-4" />
                    </Link>
                    <MenuProveedor id={p.id} nombre={p.commercialName} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-sv2-divider @4xl:hidden">
        {proveedores.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 p-3" data-testid="tarjeta-proveedor">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar p={p} />
                <Nombre p={p} />
              </div>
              <MenuProveedor id={p.id} nombre={p.commercialName} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Origen p={p} />
              <ChipEstado estado={p.status} />
            </div>
            <Contacto p={p} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-sv2-ink-variant">
              <Catalogo p={p} />
              {textoCategorias(p.categorias) && <span>{textoCategorias(p.categorias)}</span>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-ink-variant">
                <ComprasAbiertas p={p} />
                <span>compras abiertas</span>
              </div>
              <div className="flex flex-col items-end">
                <span className={cn(MONO, 'font-bold')}>{dinero(p.totalComprado, p.currency)}</span>
                <span className="text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-outline">Total comprado</span>
              </div>
            </div>
            <Link href={`${RUTA}/${p.id}`} className="inline-flex items-center gap-0.5 self-end text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
              Ver proveedor
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </li>
        ))}
      </ul>
      {pie}
    </Tarjeta>
  )
}
