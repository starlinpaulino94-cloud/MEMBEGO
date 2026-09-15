import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Tabs } from 'expo-router'
import { HeaderVibe } from '../../src/components/layout/HeaderVibe'
import { TabsEscritorio } from '../../src/components/layout/TabsEscritorio'
import { BottomTabDock } from '../../src/components/layout/BottomTabDock'

export default function TabsLayout() {
  const { width } = useWindowDimensions()
  const isDesktop = width >= 768

  return (
    <View className="flex-1 bg-vibe-fondo">
      <HeaderVibe />
      {isDesktop && <TabsEscritorio />}
      <View className="flex-1 w-full max-w-4xl self-center">
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: 'none' },
          }}
        >
          <Tabs.Screen name="inicio" />
          <Tabs.Screen name="qr" />
          <Tabs.Screen name="cuenta" />
          <Tabs.Screen name="menu" />
        </Tabs>
      </View>
      {!isDesktop && <BottomTabDock />}
    </View>
  )
}
