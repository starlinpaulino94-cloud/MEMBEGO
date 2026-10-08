import { View, Text } from 'react-native'
import { Link, useLocalSearchParams } from 'expo-router'
import { Card } from '../../../src/components/ui/Card'
import { colors } from '../../../src/theme/tokens'

export default function RegistroVerificadoPage() {
  const params = useLocalSearchParams<{ returnTo?: string }>()
  const rawReturnTo = typeof params.returnTo === 'string' ? params.returnTo : ''
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : ''
  const loginHref = returnTo ? `/(auth)/login?redirect=${encodeURIComponent(returnTo)}` : '/(auth)/login'
  return (
    <Card className="w-full border border-border bg-card p-6">
      <View className="gap-3">
        <Text className="text-2xl font-inter-semibold text-foreground">Correo verificado</Text>
        <Text className="text-small text-muted-foreground">Tu cuenta está lista. Inicia sesión con el correo y la contraseña que elegiste.</Text>
        <Link href={loginHref} className="text-small font-inter-semibold" style={{ color: colors.retail.blue }}>Ir a iniciar sesión</Link>
      </View>
    </Card>
  )
}
