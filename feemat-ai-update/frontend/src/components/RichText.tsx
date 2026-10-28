import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

// Small, safe renderer for AI answers: **bold**, headings, bullet / numbered lists and | tables |.
function inline(s: string, color: string, keyBase: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <Text key={keyBase + i} style={{ fontWeight: "800", color }}>{p.slice(2, -2)}</Text>
    ) : (
      <Text key={keyBase + i}>{p}</Text>
    )
  );
}

export function RichText({ text, color = "#0F172A" }: { text: string; color?: string }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // table: consecutive lines that start with "|"
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <ScrollView key={"t" + i} horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
          <View style={styles.table}>
            {rows.map((r, ri) => (
              <View key={ri} style={[styles.tr, ri === 0 && styles.th]}>
                {r.map((c, ci) => (
                  <Text key={ci} style={[styles.td, ri === 0 && { fontWeight: "800" }, { color }]}>{c}</Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const n = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (h) {
      out.push(<Text key={i} style={[styles.h, { color }]}>{inline(h[2], color, "h" + i)}</Text>);
    } else if (b) {
      out.push(
        <View key={i} style={styles.li}><Text style={[styles.dot, { color }]}>•</Text><Text style={[styles.p, { color, flex: 1 }]}>{inline(b[1], color, "b" + i)}</Text></View>
      );
    } else if (n) {
      out.push(
        <View key={i} style={styles.li}><Text style={[styles.num, { color }]}>{n[1]}.</Text><Text style={[styles.p, { color, flex: 1 }]}>{inline(n[2], color, "n" + i)}</Text></View>
      );
    } else if (line.trim() === "") {
      out.push(<View key={i} style={{ height: 6 }} />);
    } else {
      out.push(<Text key={i} style={[styles.p, { color }]}>{inline(line, color, "p" + i)}</Text>);
    }
    i++;
  }
  return <View>{out}</View>;
}

const styles = StyleSheet.create({
  p: { fontSize: 15, lineHeight: 22 },
  h: { fontSize: 16, fontWeight: "800", marginTop: 6, marginBottom: 2 },
  li: { flexDirection: "row", gap: 8, paddingRight: 4 },
  dot: { fontSize: 15, lineHeight: 22 },
  num: { fontSize: 15, lineHeight: 22, minWidth: 20 },
  table: { borderWidth: 1, borderColor: "#DCE6F7", borderRadius: 8, overflow: "hidden" },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E8EFFB" },
  th: { backgroundColor: "#EEF4FF", borderTopWidth: 0 },
  td: { minWidth: 90, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13 },
});
