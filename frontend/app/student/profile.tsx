import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/lib/auth";

export default function StudentProfile() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setS(await api("/student/profile")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = (k: string, v: any) => setS((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body: any = {
        name: s.name, father_name: s.father_name, phone: s.phone, class: s.class, address: s.address, photo_url: s.photo_url,
      };
      const updated = await api("/student/profile", { method: "PUT", body });
      setS(updated);
    } catch {} finally { setSaving(false); }
  };

  if (loading || !s) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
          <Avatar name={s.name} uri={s.photo_url} size={72} />
          <Text style={styles.name}>{s.name}</Text>
          {s.connection?.admission_number ? <Text style={styles.tid}>{s.connection.admission_number}</Text> : <Text style={styles.tid}>No admission yet</Text>}
        </View>
        <View style={styles.section}>
          <Input testID="s-name" label="Full Name" value={s.name || ""} onChangeText={(v) => patch("name", v)} />
          <Input label="Father's Name" value={s.father_name || ""} onChangeText={(v) => patch("father_name", v)} />
          <Input label="Phone" value={s.phone || ""} onChangeText={(v) => patch("phone", v)} keyboardType="phone-pad" />
          <Input label="Class / Course" value={s.class || ""} onChangeText={(v) => patch("class", v)} />
          <Input label="Address" value={s.address || ""} onChangeText={(v) => patch("address", v)} multiline />
          <Input label="Photo URL" value={s.photo_url || ""} onChangeText={(v) => patch("photo_url", v)} autoCapitalize="none" />
        </View>
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Button testID="save-student-profile" title="Save Profile" loading={saving} onPress={save} />
          <Button testID="student-logout" title="Log Out" variant="secondary" onPress={async () => { await signOut(); router.replace("/"); }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", padding: SPACING.xl, gap: SPACING.sm, backgroundColor: COLORS.surface },
  name: { fontSize: 22, fontWeight: "800", color: COLORS.onSurface },
  tid: { fontSize: 13, color: COLORS.brand, fontWeight: "700" },
  section: { padding: SPACING.lg, gap: SPACING.md, marginTop: SPACING.md, backgroundColor: COLORS.surface, marginHorizontal: SPACING.md, borderRadius: RADIUS.md },
});
