import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Share, Linking,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { PhotoPicker } from "@/src/components/PhotoPicker";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => todayStr().slice(0, 8) + "01";
const waNumber = (p?: string) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
};

export default function AddStudent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [teacherName, setTeacherName] = useState("");

  const [photo, setPhoto] = useState("");
  const [name, setName] = useState("");
  const [father, setFather] = useState("");
  const [phone, setPhone] = useState("");
  const [classId, setClassId] = useState<string | undefined>();
  const [batchId, setBatchId] = useState<string | undefined>();
  const [fee, setFee] = useState("");
  const [disc, setDisc] = useState("");
  const [joined, setJoined] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null); // saved connection

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const [c, b, p]: any = await Promise.all([
          api("/teacher/classes"), api("/teacher/batches"), api("/teacher/profile").catch(() => ({})),
        ]);
        setClasses(c || []); setBatches(b || []);
        setTeacherName(p?.coaching_name || p?.name || "");
      } catch {}
    })();
  }, []));

  const reset = () => {
    setPhoto(""); setName(""); setFather(""); setPhone(""); setClassId(undefined); setBatchId(undefined);
    setFee(""); setDisc(""); setJoined(todayStr()); setDone(null);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Naam likho", "Student ka naam zaroori hai."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joined)) { Alert.alert("Date galat hai", "Joining date YYYY-MM-DD format mein likho."); return; }
    const d = parseFloat(disc || "0");
    if (isNaN(d) || d < 0 || d > 100) { Alert.alert("Discount galat hai", "Discount 0 se 100 ke beech hona chahiye."); return; }
    setBusy(true);
    try {
      const cls = classes.find((c) => c.id === classId);
      const res: any = await api("/teacher/students/manual", {
        method: "POST",
        body: {
          name: name.trim(), father_name: father.trim(), phone: phone.trim(), class: cls?.name || "",
          photo_url: photo || "", class_id: classId, batch_id: batchId,
          monthly_fee: parseFloat(fee || "0") || 0, discount_pct: d, joined_on: joined,
        },
      });
      setDone(res);
    } catch (e: any) {
      const msg = String(e?.message || "Student nahi juda.");
      if (msg.includes("Free plan limit")) {
        Alert.alert("Free limit poori ho gayi", msg, [
          { text: "Baad mein" },
          { text: "Pro dekho", onPress: () => router.push("/teacher/subscription" as any) },
        ]);
      } else Alert.alert("Error", msg);
    } finally { setBusy(false); }
  };

  const codeMessage = (conn: any) =>
    `Namaste ${name.trim()}, aapka record ${teacherName || "hamari coaching"} mein FeeMat pe ban gaya hai.\n` +
    `Admission No: ${conn.admission_number}\n\n` +
    `Agar aap FeeMat app use karna chahein to app install karke "Student Sign Up" karte waqt ye code daalo:\n` +
    `🔑 ${conn.claim_code}\n\nIsse aapki fees, attendance aur marks sab aapke account mein aa jayenge.`;

  const sendCode = async (conn: any) => {
    const msg = codeMessage(conn);
    const num = waNumber(phone);
    if (num) {
      Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`).catch(() => Share.share({ message: msg }));
    } else {
      await Share.share({ message: msg });
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
      <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
      <Text style={styles.title}>{done ? "Student Juda" : "Student Jodo"}</Text>
    </View>
  );

  // ---------------- success ----------------
  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK.bg }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          <View style={styles.okCard}>
            <View style={styles.okIcon}><Ionicons name="checkmark" size={34} color="#fff" /></View>
            <Text style={styles.okTitle}>{name.trim()} ka record ban gaya</Text>
            <Text style={styles.okSub}>Admission No: {done.admission_number}</Text>
          </View>

          <View style={styles.codeCard}>
            <Text style={styles.codeLbl}>App ka code (student ko dena)</Text>
            <Text style={styles.code} selectable>{done.claim_code}</Text>
            <Text style={styles.codeHint}>
              Student jab app mein "Student Sign Up" kare aur ye code daale, to uski fees, attendance aur marks sab uske account mein aa jayenge. Code sirf ek baar chalta hai.
            </Text>
          </View>

          <Pressable onPress={() => sendCode(done)} style={[styles.big, { backgroundColor: "#25D366" }]}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={styles.bigTxt}>{phone.trim() ? "WhatsApp pe code bhejo" : "Code share karo"}</Text>
          </Pressable>
          <Pressable onPress={() => router.replace(`/teacher/student/${done.id}` as any)} style={[styles.big, { backgroundColor: "#7C3AED" }]}>
            <Ionicons name="person" size={20} color="#fff" />
            <Text style={styles.bigTxt}>Student ki detail kholo (fees lo)</Text>
          </Pressable>
          <Pressable onPress={reset} style={[styles.big, { backgroundColor: "rgba(168,85,247,0.18)" }]}>
            <Ionicons name="person-add" size={20} color="#A855F7" />
            <Text style={[styles.bigTxt, { color: "#A855F7" }]}>Aur student jodo</Text>
          </Pressable>
          <Text style={styles.note}>Code baad mein bhi student ki detail screen mein dikhega, jab tak student app se nahi judta.</Text>
        </ScrollView>
      </View>
    );
  }

  // ---------------- form ----------------
  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      {header}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color="#A855F7" />
            <Text style={styles.infoTxt}>Student ke paas app na ho tab bhi aap uska record bana sakte ho. Fees, attendance, marks sab chalega.</Text>
          </View>

          <View style={{ marginTop: SPACING.lg }}>
            <PhotoPicker label="Photo (optional)" name={name} value={photo} onChange={setPhoto} />
          </View>

          <Label t="Naam *" />
          <TextInput testID="ms-name" value={name} onChangeText={setName} placeholder="Student ka poora naam" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />

          <Label t="Father ka naam" />
          <TextInput testID="ms-father" value={father} onChangeText={setFather} placeholder="Father / guardian" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />

          <Label t="Phone number (WhatsApp wala)" />
          <TextInput testID="ms-phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10 digit number" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />

          {classes.length > 0 && (
            <>
              <Label t="Class" />
              <View style={styles.wrap}>
                {classes.map((c) => (
                  <Chip key={c.id} label={c.name} on={classId === c.id} onPress={() => setClassId(classId === c.id ? undefined : c.id)} />
                ))}
              </View>
            </>
          )}
          {batches.length > 0 && (
            <>
              <Label t="Batch" />
              <View style={styles.wrap}>
                {batches.map((b) => (
                  <Chip key={b.id} label={b.name} on={batchId === b.id} onPress={() => setBatchId(batchId === b.id ? undefined : b.id)} />
                ))}
              </View>
            </>
          )}
          {classes.length === 0 && batches.length === 0 && (
            <Text style={styles.hint}>Class ya batch chuna ho to pehle "Classes" mein banao.</Text>
          )}

          <View style={{ flexDirection: "row", gap: SPACING.md }}>
            <View style={{ flex: 1 }}>
              <Label t="Monthly fee (₹)" />
              <TextInput testID="ms-fee" value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="500" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Label t="Discount (%)" />
              <TextInput testID="ms-disc" value={disc} onChangeText={setDisc} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
            </View>
          </View>

          <Label t="Joining date (YYYY-MM-DD)" />
          <TextInput testID="ms-joined" value={joined} onChangeText={setJoined} placeholder="2026-10-01" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
          <View style={styles.wrap}>
            <Chip label="Aaj" on={joined === todayStr()} onPress={() => setJoined(todayStr())} />
            <Chip label="Is mahine ki 1 tareekh" on={joined === firstOfMonth()} onPress={() => setJoined(firstOfMonth())} />
          </View>
          <Text style={styles.hint}>Joining date se hi mahine ki fees banni shuru hoti hai. Purani date daaloge to purane mahine ki fees bhi baaki dikhegi.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable testID="ms-save" onPress={save} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Student Jodo</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Label({ t }: { t: string }) {
  return <Text style={styles.label}>{t}</Text>;
}
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipTxt, on && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  infoBox: { flexDirection: "row", gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: "rgba(168,85,247,0.12)", borderWidth: 1, borderColor: "rgba(168,85,247,0.3)" },
  infoTxt: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.lg, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 46, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  hint: { color: DARK.sub, fontSize: 11, marginTop: 8, lineHeight: 16 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: SPACING.md, backgroundColor: DARK.bg, borderTopWidth: 1, borderTopColor: DARK.border },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  okCard: { alignItems: "center", padding: SPACING.xl, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border, gap: 6 },
  okIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" },
  okTitle: { color: "#fff", fontSize: 18, fontWeight: "800", textAlign: "center", marginTop: 6 },
  okSub: { color: DARK.sub, fontSize: 13 },
  codeCard: { alignItems: "center", padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)", gap: 8 },
  codeLbl: { color: DARK.sub, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  code: { color: "#FBBF24", fontSize: 32, fontWeight: "800", letterSpacing: 4 },
  codeHint: { color: "rgba(255,255,255,0.75)", fontSize: 12, textAlign: "center", lineHeight: 17 },
  big: { height: 50, borderRadius: RADIUS.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  bigTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  note: { color: DARK.sub, fontSize: 11, textAlign: "center", marginTop: 4 },
});
