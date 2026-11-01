import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";

// A cute little robot made only from Views (no image files, no extra packages).
// <AIRobot size={64} />                      -> happy, blinking, floating
// <AIRobot size={28} animated={false} />     -> small and still (use inside chat bubbles / lists)
// <AIRobot size={90} mood="thinking" />      -> while the AI is working
// <AIRobotBadge size={48} />                 -> robot inside a round soft background (dashboard card, tiles)

export type RobotMood = "happy" | "thinking" | "sleepy";

const ND = Platform.OS !== "web"; // native driver is not supported on web

export function AIRobot({ size = 64, mood = "happy", animated = true }: { size?: number; mood?: RobotMood; animated?: boolean }) {
  const u = size / 100;
  const float = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animated) return;
    const loops: Animated.CompositeAnimation[] = [
      Animated.loop(Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
        Animated.timing(float, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.delay(2400),
        Animated.timing(blink, { toValue: 0.1, duration: 90, useNativeDriver: ND }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: ND }),
        Animated.delay(500),
        Animated.timing(blink, { toValue: 0.1, duration: 90, useNativeDriver: ND }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: ND }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: mood === "thinking" ? 350 : 800, useNativeDriver: ND }),
        Animated.timing(pulse, { toValue: 1, duration: mood === "thinking" ? 350 : 800, useNativeDriver: ND }),
      ])),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animated, mood, float, blink, pulse]);

  const bob = float.interpolate({ inputRange: [0, 1], outputRange: [-2 * u, 2 * u] });
  const eyeScale = mood === "sleepy" ? 0.18 : blink;
  const eye = { width: 13 * u, height: 16 * u, borderRadius: 7 * u };

  return (
    <Animated.View style={{ width: size, height: size, alignItems: "center", transform: [{ translateY: animated ? bob : 0 }] }}>
      {/* antenna */}
      <View style={{ position: "absolute", top: 7 * u, width: 3 * u, height: 8 * u, backgroundColor: "#9DB8E8", borderRadius: 2 * u }} />
      <Animated.View style={{ position: "absolute", top: 0, width: 10 * u, height: 10 * u, borderRadius: 5 * u, backgroundColor: mood === "thinking" ? "#FF8FB1" : "#FFD166", transform: [{ scale: animated ? pulse : 1 }] }} />

      {/* body (drawn first so the head sits on top) */}
      <View style={{ position: "absolute", top: 63 * u, width: 40 * u, height: 27 * u, borderRadius: 13 * u, backgroundColor: "#FFFFFF", borderWidth: 3 * u, borderColor: "#BFD7FF", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 9 * u, height: 9 * u, borderRadius: 5 * u, backgroundColor: "#FF6B8A" }} />
      </View>
      {/* arms */}
      <View style={{ position: "absolute", top: 69 * u, left: 24 * u, width: 11 * u, height: 11 * u, borderRadius: 6 * u, backgroundColor: "#7FB0FF" }} />
      <View style={{ position: "absolute", top: 69 * u, right: 24 * u, width: 11 * u, height: 11 * u, borderRadius: 6 * u, backgroundColor: "#7FB0FF" }} />

      {/* ears */}
      <View style={{ position: "absolute", top: 30 * u, left: 6 * u, width: 9 * u, height: 22 * u, borderRadius: 5 * u, backgroundColor: "#7FB0FF" }} />
      <View style={{ position: "absolute", top: 30 * u, right: 6 * u, width: 9 * u, height: 22 * u, borderRadius: 5 * u, backgroundColor: "#7FB0FF" }} />

      {/* head */}
      <View style={{ position: "absolute", top: 11 * u, width: 74 * u, height: 55 * u, borderRadius: 24 * u, backgroundColor: "#FFFFFF", borderWidth: 3 * u, borderColor: "#BFD7FF", padding: 5 * u, ...shadow(u) }}>
        {/* face screen */}
        <View style={{ flex: 1, borderRadius: 18 * u, backgroundColor: "#0B2F78", alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 15 * u, marginTop: 9 * u }}>
            <Animated.View style={[styles.eye, eye, { transform: [{ scaleY: eyeScale as any }] }]}><View style={{ width: 4 * u, height: 4 * u, borderRadius: 2 * u, backgroundColor: "#fff", marginTop: 3 * u, marginLeft: 3 * u }} /></Animated.View>
            <Animated.View style={[styles.eye, eye, { transform: [{ scaleY: eyeScale as any }] }]}><View style={{ width: 4 * u, height: 4 * u, borderRadius: 2 * u, backgroundColor: "#fff", marginTop: 3 * u, marginLeft: 3 * u }} /></Animated.View>
          </View>
          {/* cheeks */}
          <View style={{ position: "absolute", top: 27 * u, left: 7 * u, width: 9 * u, height: 5 * u, borderRadius: 3 * u, backgroundColor: "#FF8FB1", opacity: 0.85 }} />
          <View style={{ position: "absolute", top: 27 * u, right: 7 * u, width: 9 * u, height: 5 * u, borderRadius: 3 * u, backgroundColor: "#FF8FB1", opacity: 0.85 }} />
          {/* mouth */}
          {mood === "thinking" ? (
            <View style={{ position: "absolute", bottom: 5 * u, width: 7 * u, height: 7 * u, borderRadius: 4 * u, borderWidth: 2.2 * u, borderColor: "#5CF2FF" }} />
          ) : mood === "sleepy" ? (
            <View style={{ position: "absolute", bottom: 7 * u, width: 10 * u, height: 2.4 * u, borderRadius: 2 * u, backgroundColor: "#5CF2FF" }} />
          ) : (
            <View style={{ position: "absolute", bottom: 5 * u, width: 15 * u, height: 8 * u, borderBottomLeftRadius: 8 * u, borderBottomRightRadius: 8 * u, borderWidth: 2.4 * u, borderTopWidth: 0, borderColor: "#5CF2FF" }} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// Robot inside a soft round background, e.g. for the dashboard card or a list tile.
export function AIRobotBadge({ size = 48, bg = "rgba(255,255,255,0.22)", mood = "happy", animated = true }: { size?: number; bg?: string; mood?: RobotMood; animated?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <AIRobot size={size * 0.82} mood={mood} animated={animated} />
    </View>
  );
}

function shadow(u: number) {
  return Platform.select({
    ios: { shadowColor: "#0A3A8C", shadowOpacity: 0.18, shadowRadius: 4 * u, shadowOffset: { width: 0, height: 2 * u } },
    android: { elevation: 3 },
    default: {},
  }) as object;
}

const styles = StyleSheet.create({
  eye: { backgroundColor: "#5CF2FF" },
});
