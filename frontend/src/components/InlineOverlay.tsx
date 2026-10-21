import React, { useEffect } from "react";
import { BackHandler, StyleSheet, View } from "react-native";

// A full-screen overlay drawn inside the screen (not a separate native window like <Modal>).
// Because it lives in the main window, the keyboard-avoiding wrapper in the root layout
// lifts it above the keyboard, so what you type is always visible.
export function InlineOverlay({
  visible, onClose, children,
}: { visible: boolean; onClose?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!visible || !onClose) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;
  return <View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>{children}</View>;
}
