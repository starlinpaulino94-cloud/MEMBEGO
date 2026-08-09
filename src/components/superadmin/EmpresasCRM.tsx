'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  LayoutGrid,
  List,
  Building2,
  Car,
  UtensilsCrossed,
  MapPin,
  Mail,
  Phone,
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Pause,
  Play,
  Trash2,
  ArrowUpDown,
  ChevronRight,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { toggleEmpresa, duplicarEmpresa, eliminarEmpresa } from '@/modules/empresas/actions'
import { formatMoneyRD } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface EmpresaItem {
  id: string
  name: string
  slug: string
  type: string
  description: string | null
  logoUrl: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  categoria: string | null
  website: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  clientes: number
  users: number
  sucursales: number
  plans: number
  promociones: number
  membresiaActivas: number
  ingresos: number
  ultimaActividad: string | null
}

type ViewMode = 'cards' | 'table'
type SortField = 'name' | 'createdAt' | 'clientes' | 'ingresos'
type SortDir = 'asc' | 'desc'

function fmtMoney(n: number) {
  return formatMoneyRD(n)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function relativeTime(d: string | null) {
  if (!d) return 'Sin actividad'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Hace un momento'
  if (mins < 60) return `Hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Hace ${days}d`
  return fmtDate(d)
}

function CompanyIcon({ type, logoUrl }: { type: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // Logo subido por el usuario, de dominio arbitrario: <img> evita que
      // next/image rompa el render si el host no está en remotePatterns.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className="h-10 w-10 rounded-xl object-cover"
      />
    )
  }
  const bg = type === 'carwash' ? 'bg-info/10' : 'bg-warning/15'
  const Icon = type === 'carwash' ? Car : UtensilsCrossed
  const color = type === 'carwash' ? 'text-primary' : 'text-warning'
  return (
    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', bg)}>
      <Icon className={cn('h-5 w-5', color)} />
    </div>
  )
}

function ActionMenu({
  empresa,
  onDelete,
}: {
  empresa: EmpresaItem
  onDelete: (id: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleToggle = () => {
    startTransition(async () => {
      const res = await toggleEmpresa(empresa.id, !empresa.isActive)
      if (res.error) toast.error(res.error)
      else toast.success(res.message)
    })
  }

  const handleDuplicate = () => {
    startTransition(async () => {
      const res = await duplicarEmpresa(empresa.id)
      if (res.error) toast.error(res.error)
      else toast.success(res.message)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => router.push(`/superadmin/empresas/${empresa.id}`)}>
          <Eye className="mr-2 h-4 w-4" /> Ver Dashboard
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`/superadmin/empresas/${empresa.id}/editar`)}>
          <Pencil className="mr-2 h-4 w-4" /> Editar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDuplicate}>
          <Copy className="mr-2 h-4 w-4" /> Duplicar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggle}>
          {empresa.isActive ? (
            <>
              <Pause className="mr-2 h-4 w-4" /> Suspender
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" /> Activar
            </>
          )}
        </DropdownMenuItem>
        {empresa.email && (
          <DropdownMenuItem asChild>
            <a href={`mailto:${empresa.email}`}>
              <Mail className="mr-2 h-4 w-4" /> Enviar correo
            </a>
          </DropdownMenuItem>
        )}
        {empresa.telefono && (
          <DropdownMenuItem asChild>
            <a
              href={`https://wa.me/${empresa.telefono.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Phone className="mr-2 h-4 w-4" /> Enviar WhatsApp
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(empresa.id)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function EmpresaCard({
  empresa,
  onDelete,
}: {
  empresa: EmpresaItem
  onDelete: (id: string) => void
}) {
  const router = useRouter()

  return (
    <Card className="group relative overflow-hidden border-border/60 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-0.5">
      <div className={cn('absolute inset-x-0 top-0 h-0.5', empresa.isActive ? 'bg-success' : 'bg-muted-foreground/30')} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex min-w-0 flex-1 cursor-pointer items-start gap-3"
            onClick={() => router.push(`/superadmin/empresas/${empresa.id}`)}
          >
            <CompanyIcon type={empresa.type} logoUrl={empresa.logoUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-foreground">{empresa.name}</h3>
                <Badge
                  variant="secondary"
                  className={cn(
                    'shrink-0 text-[10px]',
                    empresa.isActive
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {empresa.isActive ? 'Activa' : 'Suspendida'}
                </Badge>
              </div>
              {empresa.categoria && (
                <p className="text-xs text-muted-foreground">{empresa.categoria}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {empresa.ciudad && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {empresa.ciudad}
                  </span>
                )}
                {empresa.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {empresa.email}
                  </span>
                )}
                {empresa.telefono && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {empresa.telefono}
                  </span>
                )}
              </div>
            </div>
          </div>
          <ActionMenu empresa={empresa} onDelete={onDelete} />
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2 rounded-xl bg-muted/40 py-3">
          <MiniStat label="Clientes" value={empresa.clientes} />
          <MiniStat label="Sucursales" value={empresa.sucursales} />
          <MiniStat label="Planes" value={empresa.plans} />
          <MiniStat label="Activas" value={empresa.membresiaActivas} />
          <MiniStat label="Ingresos" value={fmtMoney(empresa.ingresos)} />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Última actividad: {relativeTime(empresa.ultimaActividad)}</span>
          <button
            onClick={() => router.push(`/superadmin/empresas/${empresa.id}`)}
            className="flex items-center gap-0.5 text-primary hover:underline"
          >
            Ver dashboard <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmpresaTableRow({
  empresa,
  onDelete,
}: {
  empresa: EmpresaItem
  onDelete: (id: string) => void
}) {
  const router = useRouter()

  return (
    <tr
      className="border-b border-border/40 transition hover:bg-muted/30 cursor-pointer"
      onClick={() => router.push(`/superadmin/empresas/${empresa.id}`)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <CompanyIcon type={empresa.type} logoUrl={empresa.logoUrl} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{empresa.name}</p>
            <p className="text-xs text-muted-foreground">{empresa.categoria ?? empresa.type}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge
          variant="secondary"
          className={cn(
            'text-[10px]',
            empresa.isActive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
          )}
        >
          {empresa.isActive ? 'Activa' : 'Suspendida'}
        </Badge>
      </td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
        {empresa.ciudad ?? '—'}
      </td>
      <td className="px-4 py-3 text-center text-sm font-medium tabular-nums">{empresa.clientes}</td>
      <td className="hidden px-4 py-3 text-center text-sm font-medium tabular-nums lg:table-cell">
        {empresa.sucursales}
      </td>
      <td className="hidden px-4 py-3 text-center text-sm font-medium tabular-nums lg:table-cell">
        {empresa.membresiaActivas}
      </td>
      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
        {fmtMoney(empresa.ingresos)}
      </td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground xl:table-cell">
        {relativeTime(empresa.ultimaActividad)}
      </td>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <ActionMenu empresa={empresa} onDelete={onDelete} />
      </td>
    </tr>
  )
}

export function EmpresasCRM({ empresas }: { empresas: EmpresaItem[] }) {
  const [view, setView] = useState<ViewMode>('cards')
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<string>('all')
  const [categoria, setCategoria] = useState<string>('all')
  const [ciudad, setCiudad] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, startDelete] = useTransition()

  const ciudades = useMemo(
    () => [...new Set(empresas.map((e) => e.ciudad).filter(Boolean))] as string[],
    [empresas]
  )
  const categorias = useMemo(
    () => [...new Set(empresas.map((e) => e.categoria ?? e.type).filter(Boolean))] as string[],
    [empresas]
  )

  const filtered = useMemo(() => {
    let list = [...empresas]

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q) ||
          e.ciudad?.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q)
      )
    }

    if (estado !== 'all') {
      list = list.filter((e) => (estado === 'active' ? e.isActive : !e.isActive))
    }

    if (categoria !== 'all') {
      list = list.filter((e) => (e.categoria ?? e.type) === categoria)
    }

    if (ciudad !== 'all') {
      list = list.filter((e) => e.ciudad === ciudad)
    }

    list.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'clientes':
          cmp = a.clientes - b.clientes
          break
        case 'ingresos':
          cmp = a.ingresos - b.ingresos
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [empresas, search, estado, categoria, ciudad, sortField, sortDir])

  const activeFilters = [estado !== 'all', categoria !== 'all', ciudad !== 'all'].filter(Boolean).length

  const handleDelete = () => {
    if (!deleteId) return
    startDelete(async () => {
      const res = await eliminarEmpresa(deleteId)
      if (res.error) toast.error(res.error)
      else toast.success(res.message)
      setDeleteId(null)
    })
  }

  const clearFilters = () => {
    setEstado('all')
    setCategoria('all')
    setCiudad('all')
    setSearch('')
  }

  const totalIngresos = empresas.reduce((s, e) => s + e.ingresos, 0)
  const totalClientes = empresas.reduce((s, e) => s + e.clientes, 0)
  const activas = empresas.filter((e) => e.isActive).length

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-sm text-muted-foreground">Total empresas</p>
          <p className="text-2xl font-bold tabular-nums">{empresas.length}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-sm text-muted-foreground">Activas</p>
          <p className="text-2xl font-bold tabular-nums text-success">{activas}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-sm text-muted-foreground">Clientes totales</p>
          <p className="text-2xl font-bold tabular-nums">{totalClientes.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-sm text-muted-foreground">Ingresos totales</p>
          <p className="text-2xl font-bold tabular-nums">{fmtMoney(totalIngresos)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="inactive">Suspendidas</SelectItem>
            </SelectContent>
          </Select>

          {categorias.length > 0 && (
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {ciudades.length > 0 && (
            <Select value={ciudad} onValueChange={setCiudad}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Ciudad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ciudades.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={`${sortField}-${sortDir}`}
            onValueChange={(v) => {
              const [f, d] = v.split('-') as [SortField, SortDir]
              setSortField(f)
              setSortDir(d)
            }}
          >
            <SelectTrigger className="w-[160px]">
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Nombre A-Z</SelectItem>
              <SelectItem value="name-desc">Nombre Z-A</SelectItem>
              <SelectItem value="createdAt-desc">Más recientes</SelectItem>
              <SelectItem value="createdAt-asc">Más antiguas</SelectItem>
              <SelectItem value="clientes-desc">Más clientes</SelectItem>
              <SelectItem value="ingresos-desc">Mayor ingreso</SelectItem>
            </SelectContent>
          </Select>

          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-xs">
              <X className="h-3 w-3" /> Limpiar
            </Button>
          )}

          <div className="flex rounded-lg border border-border/60">
            <button
              onClick={() => setView('cards')}
              className={cn(
                'rounded-l-lg px-2.5 py-1.5 transition',
                view === 'cards' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('table')}
              className={cn(
                'rounded-r-lg px-2.5 py-1.5 transition',
                view === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} de {empresas.length} empresa{empresas.length !== 1 ? 's' : ''}
      </p>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-16">
          <Building2 className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">Sin resultados</p>
          <p className="text-sm text-muted-foreground/60">Ajusta los filtros o la búsqueda.</p>
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((e) => (
            <EmpresaCard key={e.id} empresa={e} onDelete={setDeleteId} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
          <table className="w-full">
            <thead className="border-b border-border/60 bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Empresa
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                  Ciudad
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Clientes
                </th>
                <th className="hidden px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                  Sucursales
                </th>
                <th className="hidden px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                  Activas
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ingresos
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground xl:table-cell">
                  Actividad
                </th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <EmpresaTableRow key={e.id} empresa={e} onDelete={setDeleteId} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Solo se puede eliminar si no tiene clientes ni
              usuarios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
