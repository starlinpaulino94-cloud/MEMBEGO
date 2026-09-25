import React from 'react'
import { View } from 'react-native'
import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="inicio" />
        <Tabs.Screen name="qr" />
        <Tabs.Screen name="cuenta" />
        <Tabs.Screen name="beneficios" />
        <Tabs.Screen name="menu" />
      </Tabs>
    </View>
  )
}
