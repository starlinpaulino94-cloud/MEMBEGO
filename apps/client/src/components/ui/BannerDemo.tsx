import React from 'react'
import { Text, View } from 'react-native'
import { FlaskConical } from 'lucide-react-native'

export function BannerDemo({ nombreEmpresa }: { nombreEmpresa?: string | null }) {
  return (
    <View
      accessibilityRole="alert"
      className="mx-4 mb-4 flex-row items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <FlaskConical size={17} color="#ab6300" />
      <Text className="flex-1 text-small font-inter-semibold text-warning">
        Modo demostración{nombreEmpresa ? ` · ${nombreEmpresa}` : ''} — todo lo que pase aquí es de práctica: ni los cobros ni los datos son reales.
      </Text>
    </View>
  )
}
