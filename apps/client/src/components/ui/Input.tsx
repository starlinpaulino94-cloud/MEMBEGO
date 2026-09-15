import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '../../lib/cn';

export interface InputProps extends TextInputProps {
  className?: string;
}

export function Input({ className, placeholderTextColor, ...props }: InputProps) {
  return (
    <TextInput
      className={cn(
        'h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground',
        'font-sans',
        'focus:border-ring',
        className,
      )}
      placeholderTextColor={placeholderTextColor ?? '#4b5563'}
      {...props}
    />
  );
}
