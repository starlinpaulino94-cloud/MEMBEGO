import React, { useState } from 'react'
import { View, Pressable, ActivityIndicator } from 'react-native'
import { Plus, Check } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import {
  BusinessCard,
  type BusinessCardData,
} from '../marketplace/BusinessCard'

export type EmpresaExplorar = BusinessCardData

interface ExplorarEmpresasListProps {
  empresas: EmpresaExplorar[]
  seguidasIds: string[]
}

/**
 * Rejilla 1-col del explorador.
 *
 * ponytail: el toggle de follow es estado local optimista — el endpoint BFF
 * de follow/unfollow está pendiente (F4). Cuando exista, reemplazar el
 * handler por una llamada al BFF + invalidación del query.
 */
export function ExplorarEmpresasList({
  empresas,
  seguidasIds,
}: ExplorarEmpresasListProps) {
  const [seguidas, setSeguidas] = useState<Set<string>>(
    () => new Set(seguidasIds),
  )
  const [pendingId, setPendingId] = useState<string | null>(null)

  function toggleSeguir(company: EmpresaExplorar) {
    setPendingId(company.id)
    // ponytail: follow BFF endpoint pending (F4). Optimistic local toggle only.
    const wasFollowing = seguidas.has(company.id)
    setSeguidas((prev) => {
      const next = new Set(prev)
      if (wasFollowing) next.delete(company.id)
      else next.add(company.id)
      return next
    })
    // Simulate async for UX consistency; replace with real BFF call in F4.
    setTimeout(() => setPendingId(null), 300)
  }

  return (
    <View className="gap-3">
      {empresas.map((company) => {
        const siguiendo = seguidas.has(company.id)
        const pending = pendingId === company.id

        return (
          <BusinessCard
            key={company.id}
            company={company}
            hrefBase="/empresas"
            action={
              <Pressable
                onPress={() => toggleSeguir(company)}
                disabled={pending}
                className={cn(
                  'size-10 items-center justify-center rounded-full border',
                  siguiendo
                    ? 'border-success bg-success/10'
                    : 'border-border bg-card',
                )}
                accessibilityRole="button"
                accessibilityLabel={
                  siguiendo
                    ? `Dejar de seguir a ${company.name}`
                    : `Seguir a ${company.name}`
                }
              >
                {pending ? (
                  <ActivityIndicator size="small" color="#0284c7" />
                ) : siguiendo ? (
                  <Check size={18} color="#22c55e" />
                ) : (
                  <Plus size={18} color="#9ca3af" />
                )}
              </Pressable>
            }
          />
        )
      })}
    </View>
  )
}
