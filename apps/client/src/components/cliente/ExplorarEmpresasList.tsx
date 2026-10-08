import React, { useState } from 'react'
import { View, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native'
import { Plus, Check } from 'lucide-react-native'
import {
  BusinessCard,
  type BusinessCardData,
} from '../marketplace/BusinessCard'
import { brandColor, brandDisplayForeground } from '../../lib/brand-color'
import { colors } from '../../theme/tokens'

export type EmpresaExplorar = BusinessCardData

interface ExplorarEmpresasListProps {
  empresas: EmpresaExplorar[]
  seguidasIds: string[]
}

/**
 * Rejilla adaptable de empresas.
 *
 * ponytail: el toggle de follow es estado local optimista — el endpoint BFF
 * de follow/unfollow está pendiente (F4). Cuando exista, reemplazar el
 * handler por una llamada al BFF + invalidación del query.
 */
export function ExplorarEmpresasList({
  empresas,
  seguidasIds,
}: ExplorarEmpresasListProps) {
  const { width } = useWindowDimensions()
  const columns = width >= 1024 ? 3 : width >= 768 ? 2 : 1
  const rows = Array.from({ length: Math.ceil(empresas.length / columns) }, (_, rowIndex) =>
    empresas.slice(rowIndex * columns, (rowIndex + 1) * columns),
  )
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
      {rows.map((row) => (
        <View key={row[0].id} className="flex-row gap-3">
          {row.map((company) => {
            const siguiendo = seguidas.has(company.id)
            const pending = pendingId === company.id
            const companyColor = brandColor(company.colorPrimario, colors.primary.DEFAULT)
            const activeForeground = brandDisplayForeground(companyColor, colors.primary.DEFAULT)

            return (
              <View key={company.id} className="min-w-0 flex-1">
                <BusinessCard
                  company={company}
                  hrefBase="/empresas"
                  className="w-full"
                  action={
                    <Pressable
                      onPress={() => toggleSeguir(company)}
                      disabled={pending}
                      className="size-10 items-center justify-center rounded-full border"
                      style={{
                        borderColor: companyColor,
                        backgroundColor: siguiendo ? companyColor : `${companyColor}14`,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        siguiendo
                          ? `Dejar de seguir a ${company.name}`
                          : `Seguir a ${company.name}`
                      }
                    >
                      {pending ? (
                        <ActivityIndicator
                          size="small"
                          color={siguiendo ? activeForeground : colors.surface.foreground}
                        />
                      ) : siguiendo ? (
                        <Check size={18} color={activeForeground} />
                      ) : (
                        <Plus size={18} color={colors.surface.foreground} />
                      )}
                    </Pressable>
                  }
                />
              </View>
            )
          })}
          {Array.from({ length: columns - row.length }, (_, index) => (
            <View key={`spacer-${row[0].id}-${index}`} className="flex-1" />
          ))}
        </View>
      ))}
    </View>
  )
}
