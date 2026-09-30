import { Stack, useRouter } from 'expo-router'
import { type ReactNode } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { Sheet } from './Sheet'

interface ResponsiveDetailSheetProps {
  readonly children: ReactNode
  readonly footer?: ReactNode
}

export function ResponsiveDetailSheet({ children, footer }: ResponsiveDetailSheetProps) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const showAsSheet = width >= 768 && router.canGoBack()

  return (
    <>
      <Stack.Screen
        options={{
          presentation: showAsSheet ? 'transparentModal' : 'card',
          animation: showAsSheet && Platform.OS === 'web' ? 'none' : undefined,
          contentStyle: showAsSheet ? { backgroundColor: 'transparent' } : undefined,
        }}
      />
      {showAsSheet ? (
        <Sheet
          visible
          onClose={() => router.back()}
          contentClassName="min-h-0 flex-1 p-0"
          footer={footer}
          contentStyle={{
            width: '95%',
            maxWidth: 680,
            height: '90%',
            alignSelf: 'center',
            overflow: 'hidden',
          }}
        >
          {children}
        </Sheet>
      ) : children}
    </>
  )
}
