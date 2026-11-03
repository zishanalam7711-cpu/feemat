import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { dataUri } from "@/src/lib/hwFiles";

// Full-screen look at one homework photo. role decides which endpoint is used. kind="attachment": the teacher's task photo; "submission": a student's answer photo.
export function HomeworkPhotoViewer({ fileId, role, onClose, kind = "submission" }: { fileId: string | null; role: "student" | "teacher"; onClose: () => void; kind?: "submission" | "attachment" }) {
  const [uri, setUri] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setUri(null); setErr("");
    if (!fileId) return;
    let live = true;
    api<{ mime: string; data: string }>(`/${role}/homework/${kind === "attachment" ? "attachments" : "files"}/${fileId}`)
      .then((r) => { if (live) setUri(dataUri(r.mime, r.data)); })
      .catch((e) => { if (live) setErr(e?.message || "Could not open this photo."); });
    return () => { live = false; };
  }, [fileId, role, kind]);

  return (
    <InlineOverlay visible={!!fileId} onClose={onClose}>
      <View style={s.wrap}>
        <Pressable onPress={onClose} hitSlop={14} style={s.close} testID="hw-photo-close"><Ionicons name="close" size={28} color="#fff" /></Pressable>
        {err ? <Text style={s.err}>{err}</Text> : !uri ? <ActivityIndicator color="#fff" size="large" /> : (
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} centerContent>
            <Image source={{ uri }} style={s.img} resizeMode="contain" />
          </ScrollView>
        )}
      </View>
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", justifyContent: "center" },
  close: { position: "absolute", top: 48, right: 18, zIndex: 5, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: 560 },
  err: { color: "#fff", textAlign: "center", padding: 24 },
});
