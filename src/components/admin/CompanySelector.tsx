'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Building2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Props {
  companies: { id: string; name: string }[]
  current: string | null
}

/**
 * Selector de empresa para el superadmin. Al cambiar, recarga la página con
 * ?company=<id> para que el resto del panel opere sobre esa empresa.
 */
export function CompanySelector({ companies, current }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (companies.length === 0) return null

  function onChange(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('company', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" /> Empresa
      </Label>
      <Select value={current ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-56" aria-label="Empresa">
          <SelectValue placeholder="Selecciona empresa" />
        </SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
