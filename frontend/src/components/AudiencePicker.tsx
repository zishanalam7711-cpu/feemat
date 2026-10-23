import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput } from "react-native";

const D = {
  card: "#0E2A63",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
  brand: "#1F6BFF",
};

export type Audience = {
  target: "all" | "class" | "batch" | "students";
  target_id?: string;
  student_ids: string[];
};

export const EVERYONE: Audience = { target: "all", student_ids: [] };

// students = /teacher/students items (connections). student_ids = student_user_id
export function audienceCount(a: Audience, students: any[]): number {
  if (a.target === "all") return students.length;
  if (a.target === "class") return students.filter((s) => s.class_id === a.target_id).length;
  if (a.target === "batch") return students.filter((s) => s.batch_id === a.target_id).length;
  return a.student_ids.length;
}

export function audienceValid(a: Audience): boolean {
  if (a.target === "all") return true;
  if (a.target === "students") return a.student_ids.length > 0;
  return !!a.target_id;
}

export function audienceBody(a: Audience) {
  return {
    target: a.target,
    target_id: a.target === "class" || a.target === "batch" ? a.target_id : undefined,
    student_ids: a.target === "students" ? a.student_ids : undefined,
  };
}

export function audienceLabel(item: any, classes: any[], batches: any[]): string {
  if (item.target === "class") return `Class: ${classes.find((c) => c.id === item.target_id)?.name || "—"}`;
  if (item.target === "batch") return `Batch: ${batches.find((b) => b.id === item.target_id)?.name || "—"}`;
  if (item.target === "students") return `${(item.student_ids || []).length} students`;
  return "Everyone";
}

const SEGMENTS: { k: Audience["target"]; l: string }[] = [
  { k: "all", l: "Everyone" },
  { k: "class", l: "Class" },
  { k: "batch", l: "Batch" },
  { k: "students", l: "Select" },
];

export function AudiencePicker({
  classes, batches, students, value, onChange,
}: {
  classes: any[]; batches: any[]; students: any[]; value: Audience; onChange: (a: Audience) => void;
}) {
  const [q, setQ] = useState("");
  const set = (p: Partial<Audience>) => onChange({ ...value, ...p });
  const shown = useMemo(
    () => students.filter((s) => (s.student?.name || "").toLowerCase().includes(q.toLowerCase())),
    [students, q]
  );
  const toggle = (id: string) =>
    set({ student_ids: value.student_ids.includes(id) ? value.student_ids.filter((x) => x !== id) : [...value.student_ids, id] });
  const selectShown = () => {
    const ids = new Set(value.student_ids);
    shown.forEach((s) => ids.add(s.student_user_id));
    set({ student_ids: Array.from(ids) });
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>Send to</Text>
      <View style={styles.seg}>
        {SEGMENTS.map((s) => {
          const on = value.target === s.k;
          return (
            <Pressable key={s.k} onPress={() => onChange({ target: s.k, target_id: undefined, student_ids: [] })} style={[styles.segBtn, on && styles.segOn]}>
              <Text style={[styles.segTxt, on && { color: "#fff" }]}>{s.l}</Text>
            </Pressable>
          );
        })}
      </View>

      {value.target === "class" && (
        classes.length === 0 ? (
          <Text style={styles.hint}>Create a class first in Classes.</Text>
        ) : (
          <View style={styles.wrap}>
            {classes.map((c) => (
              <Chip key={c.id} label={c.name} on={value.target_id === c.id} onPress={() => set({ target_id: c.id })} />
            ))}
          </View>
        )
      )}

      {value.target === "batch" && (
        batches.length === 0 ? (
          <Text style={styles.hint}>Create a batch first in Batches.</Text>
        ) : (
          <View style={styles.wrap}>
            {batches.map((b) => (
              <Chip key={b.id} label={b.name} on={value.target_id === b.id} onPress={() => set({ target_id: b.id })} />
            ))}
          </View>
        )
      )}

      {value.target === "students" && (
        <View style={{ gap: 8 }}>
          <TextInput
            value={q} onChangeText={setQ} placeholder="Search student name"
            placeholderTextColor="rgba(255,255,255,0.35)" style={styles.search}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={selectShown}><Text style={styles.link}>Select all shown</Text></Pressable>
            <Pressable onPress={() => set({ student_ids: [] })}><Text style={[styles.link, { color: "#F87171" }]}>Clear all</Text></Pressable>
          </View>
          <View style={styles.wrap}>
            {shown.map((s) => (
              <Chip key={s.id} label={s.student?.name || "Student"} on={value.student_ids.includes(s.student_user_id)} onPress={() => toggle(s.student_user_id)} />
            ))}
          </View>
        </View>
      )}

      <Text style={styles.count}>
        Will reach {audienceCount(value, students)} students
      </Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipTxt, on && { color: "#fff" }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { color: D.sub, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  seg: { flexDirection: "row", backgroundColor: D.input, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: D.brand },
  segTxt: { color: D.sub, fontWeight: "700", fontSize: 13 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: D.input, borderWidth: 1, borderColor: D.border, alignItems: "center", justifyContent: "center", maxWidth: 200 },
  chipOn: { backgroundColor: D.brand, borderColor: D.brand },
  chipTxt: { color: D.sub, fontSize: 13, fontWeight: "600" },
  search: { height: 42, borderRadius: 12, backgroundColor: D.input, color: "#fff", paddingHorizontal: 12, fontSize: 14 },
  link: { color: "#35A7FF", fontWeight: "700", fontSize: 13 },
  hint: { color: D.sub, fontSize: 13 },
  count: { color: "#34D399", fontSize: 12, fontWeight: "700" },
});
