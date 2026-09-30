import React from 'react';
import { Animated, Easing, Modal, Platform, View, Text, Pressable, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '../../theme/tokens';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  contentClassName?: string;
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  contentStyle,
  contentClassName = 'px-5',
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [modalVisible, setModalVisible] = React.useState(visible);
  const isMounted = React.useRef(visible);
  const animationProgress = React.useRef(new Animated.Value(0)).current;
  const animation = React.useRef<Animated.CompositeAnimation | null>(null);
  const animationFrame = React.useRef<number | null>(null);
  const translateY = animationProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [height, 0],
  });

  React.useEffect(() => {
    if (visible) {
      isMounted.current = true;
      setModalVisible(true);
      animationProgress.setValue(0);
      animationFrame.current = requestAnimationFrame(() => {
        animation.current = Animated.timing(animationProgress, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        });
        animation.current.start();
        animationFrame.current = null;
      });

      return () => {
        if (animationFrame.current !== null) {
          cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
        animation.current?.stop();
      };
    }

    if (!isMounted.current) return;

    animation.current = Animated.timing(animationProgress, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.current.start(({ finished }) => {
      if (finished) {
        isMounted.current = false;
        setModalVisible(false);
      }
    });

    return () => animation.current?.stop();
  }, [visible, animationProgress]);

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar hoja"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
              },
              { opacity: animationProgress },
            ]}
          />
        </Pressable>
        <Animated.View
          style={[
            {
              paddingBottom: insets.bottom,
              backgroundColor: colors.surface.card,
              borderTopColor: colors.surface.border,
              borderTopWidth: 1,
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
            },
            contentStyle,
            { transform: [{ translateY }] },
          ]}
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
          <View className={`${footer ? 'min-h-0 flex-1' : 'min-h-0'} ${contentClassName}`}>
            {children}
          </View>
          {footer && (
            <View className="mt-auto border-t border-border px-5 pt-4 pb-4">
              {footer}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
