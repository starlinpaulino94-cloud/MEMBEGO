import React from 'react';
import { Modal, View, Text, Pressable, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '../../lib/cn';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose} accessibilityRole="button">
        <View className="flex-1 justify-end bg-black/40">
          <TouchableWithoutFeedback>
            <View
              className="rounded-t-2xl border-t border-border bg-card"
              style={{ paddingBottom: insets.bottom }}
            >
              <View className="items-center pt-3 pb-2">
                <View className="h-1 w-10 rounded-full bg-border" />
              </View>
              {title && (
                <View className="px-5 pb-3">
                  <Text className="text-h3 font-inter-bold text-foreground">
                    {title}
                  </Text>
                </View>
              )}
              <View className="px-5">{children}</View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
