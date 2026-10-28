import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Linking, Switch, Image as RNImage,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { pickAndUploadImage, pickAndUploadPdf, Uploaded } from "@/src/lib/aiFiles";
import { GradientBg, Logo } from "@/src/components/ui";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { RichText } from "@/src/components/RichText";

type Msg = {
  id: string; role: "user" | "assistant" | "error"; content: string; data?: any; actions?: any[]; provider?: string;
  privacy_note?: string; attachments?: { id: string; name: string; kind: string }[]; routed?: string; retry?: { text: string; files: string[] };
};

const SUGGESTIONS = [
  "Aaj kitni fees collect hui?",
  "Who has pending fees?",
  "This month's attendance report",
  "Make a 10 question maths quiz for class 8",
  "Draft a fee reminder for parents",
  "Write a simple lesson plan on fractions",
];

const waNumber = (p?: string) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
};
const stripMd = (s: string) => s.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/\|/g, " ");

export default function AiChat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scroller = useRef<ScrollView>(null);
  const [status, setStatus] = useState<any>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [convs, setConvs] = useState<any[]>([]);
  const [memory, setMemory] = useState<{ enabled: boolean; items: any[] }>({ enabled: true, items: [] });
  const [memText, setMemText] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [actionState, setActionState] = useState<Record<string, { st: string; text?: string }>>({});

  const loadStatus = useCallback(async () => { try { setStatus(await api("/ai/status")); } catch (e: any) { setStatus({ error: e?.message || "AI is not available." }); } }, []);
  useFocusEffect(useCallback(() => { loadStatus(); return () => { Speech.stop(); }; }, [loadStatus]));
  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80); }, [msgs.length, busy]);

  const speak = (m: Msg) => {
    if (speakingId === m.id) { Speech.stop(); setSpeakingId(null); return; }
    Speech.stop();
    const hindi = /[\u0900-\u097F]/.test(m.content);
    setSpeakingId(m.id);
    Speech.speak(stripMd(m.content).slice(0, 3500), { language: hindi ? "hi-IN" : "en-IN", onDone: () => setSpeakingId(null), onStopped: () => setSpeakingId(null), onError: () => setSpeakingId(null) });
  };

  const send = async (override?: { text: string; files: string[] }) => {
    const text = (override ? override.text : input).trim();
    const fileIds = override ? override.files : files.map((f) => f.id);
    if ((!text && fileIds.length === 0) || busy) return;
    const attach = override ? [] : files.map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
    if (!override) { setInput(""); setFiles([]); setMsgs((m) => [...m, { id: "u" + Date.now(), role: "user", content: text, attachments: attach }]); }
    else setMsgs((m) => m.filter((x) => x.role !== "error"));
    setBusy(true);
    try {
      const res: any = await api("/ai/chat", { method: "POST", body: { message: text, conversation_id: convId, file_ids: fileIds } });
      setConvId(res.conversation_id);
      const a = res.message;
      setMsgs((m) => [...m, { id: a.id, role: "assistant", content: a.content, data: a.data, actions: a.actions, provider: a.provider, privacy_note: a.privacy_note, routed: a.routed }]);
      if (autoSpeak) speak({ id: a.id, role: "assistant", content: a.content });
    } catch (e: any) {
      setMsgs((m) => [...m, { id: "e" + Date.now(), role: "error", content: e?.message || "Something went wrong.", retry: { text, files: fileIds } }]);
    } finally { setBusy(false); }
  };

  const attach = async (kind: "camera" | "gallery" | "pdf") => {
    setShowAttach(false);
    if (files.length >= 3) { Alert.alert("Limit reached", "You can attach up to 3 files to one message."); return; }
    setUploading(true);
    try {
      const f = kind === "pdf" ? await pickAndUploadPdf() : await pickAndUploadImage(kind);
      if (f) setFiles((p) => [...p, f]);
    } catch (e: any) { Alert.alert("Could not attach", e?.message || "Please try again."); }
    finally { setUploading(false); }
  };
  const removeFile = async (f: Uploaded) => {
    setFiles((p) => p.filter((x) => x.id !== f.id));
    try { await api(`/ai/files/${f.id}`, { method: "DELETE" }); } catch {}
  };

  const newChat = () => { setConvId(null); setMsgs([]); setFiles([]); setShowHistory(false); Speech.stop(); };
  const openHistory = async () => { try { setConvs(await api("/ai/conversations")); } catch {} setShowHistory(true); };
  const openConv = async (id: string) => {
    try {
      const d: any = await api(`/ai/conversations/${id}`);
      setConvId(id);
      setMsgs((d.messages || []).map((m: any) => ({ id: m.id, role: m.role, content: m.content, data: m.data, actions: m.actions, provider: m.provider, privacy_note: m.privacy_note, attachments: m.attachments })));
      setShowHistory(false);
    } catch (e: any) { Alert.alert("Could not open", e?.message || "Please try again."); }
  };
  const delConv = (id: string) => Alert.alert("Delete this chat?", "This cannot be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/ai/conversations/${id}`, { method: "DELETE" }); setConvs((c) => c.filter((x) => x.id !== id)); if (id === convId) newChat(); } catch {} } },
  ]);

  const openSettings = async () => { try { setMemory(await api("/ai/memory")); } catch {} loadStatus(); setShowSettings(true); };
  const addMemory = async () => {
    if (!memText.trim()) return;
    try { await api("/ai/memory", { method: "POST", body: { text: memText.trim() } }); setMemText(""); setMemory(await api("/ai/memory")); }
    catch (e: any) { Alert.alert("Not saved", e?.message || "Please try again."); }
  };
  const toggleMemory = async (v: boolean) => { try { await api("/ai/memory/settings", { method: "PUT", body: { enabled: v } }); setMemory((m) => ({ ...m, enabled: v })); } catch {} };
  const wipe = () => Alert.alert("Delete all AI data?", "This deletes your AI chats, uploaded files, memory and pending actions.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete everything", style: "destructive", onPress: async () => { try { await api("/ai/data", { method: "DELETE" }); newChat(); setMemory({ enabled: true, items: [] }); setShowSettings(false); } catch {} } },
  ]);

  const act = async (a: any, ok: boolean) => {
    setActionState((s) => ({ ...s, [a.id]: { st: "busy" } }));
    try {
      await api(`/ai/actions/${a.id}/${ok ? "confirm" : "cancel"}`, { method: "POST" });
      setActionState((s) => ({ ...s, [a.id]: { st: ok ? "done" : "cancelled" } }));
    } catch (e: any) { setActionState((s) => ({ ...s, [a.id]: { st: "error", text: e?.message || "Failed" } })); }
  };

  const ready = status && !status.error && status.ready;
  const private_ = status?.providers?.some((p: any) => p.configured && p.private);

  return (
    <GradientBg>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={26} color="#fff" /></Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>AI Assistant</Text>
          <Text style={styles.sub}>{!status ? "Checking..." : status.error ? "Not available" : ready ? (private_ ? "Private AI ready" : "Free AI ready") : "Not set up yet"}</Text>
        </View>
        <Pressable onPress={() => router.push("/teacher/ai-attendance" as any)} hitSlop={8} style={styles.icoBtn}><Ionicons name="camera" size={20} color="#fff" /></Pressable>
        <Pressable onPress={openHistory} hitSlop={8} style={styles.icoBtn}><Ionicons name="time" size={20} color="#fff" /></Pressable>
        <Pressable onPress={openSettings} hitSlop={8} style={styles.icoBtn}><Ionicons name="settings" size={20} color="#fff" /></Pressable>
      </View>

      <View style={styles.panel}>
        <ScrollView ref={scroller} contentContainerStyle={{ padding: 14, paddingBottom: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          {msgs.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 10 }}>
              <Logo size={84} tagline={false} />
              <Text style={styles.hello}>How can I help today?</Text>
              <Text style={styles.helloSub}>Ask about fees and students, upload a photo or PDF, or ask me to write a worksheet, notice or lesson plan. Hindi, Hinglish and English all work.</Text>
              {status?.error || (status && !status.ready) ? (
                <View style={styles.warn}><Ionicons name="alert-circle" size={18} color="#B45309" /><Text style={styles.warnTxt}>
                  {status?.error || "The AI provider is not set up on the server yet. Fee, due and attendance questions still work without it."}
                </Text></View>
              ) : null}
              <View style={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => send({ text: s, files: [] })}><Text style={styles.chipTxt}>{s}</Text></Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {msgs.map((m) => (
            <View key={m.id} style={{ alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "user" ? (
                <View style={styles.userBub}>
                  {(m.attachments || []).map((a) => (
                    <View key={a.id} style={styles.attachPill}><Ionicons name={a.kind === "pdf" ? "document" : "image"} size={14} color="#fff" /><Text style={styles.attachTxt} numberOfLines={1}>{a.name}</Text></View>
                  ))}
                  {m.content ? <Text style={styles.userTxt}>{m.content}</Text> : null}
                </View>
              ) : m.role === "error" ? (
                <View style={styles.errBub}>
                  <Text style={styles.errTxt}>{m.content}</Text>
                  {m.retry ? <Pressable onPress={() => send(m.retry)} style={styles.retry}><Ionicons name="refresh" size={14} color="#fff" /><Text style={styles.retryTxt}>Try again</Text></Pressable> : null}
                </View>
              ) : (
                <View style={styles.aiWrap}>
                  <View style={styles.aiBub}>
                    <RichText text={m.content} />
                    {m.data?.table ? <TableCard t={m.data.table} /> : null}
                    {m.data?.drafts ? <DraftsCard d={m.data.drafts} /> : null}
                  </View>
                  {(m.actions || []).map((a) => <ActionCard key={a.id} a={a} st={actionState[a.id]} onAct={act} />)}
                  {m.privacy_note ? <Text style={styles.priv}>{m.privacy_note}</Text> : null}
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{m.routed === "database" ? "Exact answer from your records, no AI used" : m.provider ? `AI: ${m.provider}` : ""}</Text>
                    <Pressable onPress={() => speak(m)} hitSlop={8}><Ionicons name={speakingId === m.id ? "stop-circle" : "volume-high"} size={18} color="#1F6BFF" /></Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}
          {busy ? <View style={styles.aiBub}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><ActivityIndicator color="#1F6BFF" /><Text style={{ color: "#64748B" }}>Thinking...</Text></View></View> : null}
        </ScrollView>

        <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
          {files.length > 0 || uploading ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
              {files.map((f) => (
                <View key={f.id} style={styles.fileChip}>
                  {f.preview ? <RNImage source={{ uri: f.preview }} style={styles.thumb} /> : <Ionicons name="document" size={20} color="#1F6BFF" />}
                  <Text style={styles.fileTxt} numberOfLines={1}>{f.name}{f.scanned ? " (scanned)" : ""}</Text>
                  <Pressable onPress={() => removeFile(f)} hitSlop={8}><Ionicons name="close-circle" size={18} color="#94A3B8" /></Pressable>
                </View>
              ))}
              {uploading ? <View style={styles.fileChip}><ActivityIndicator size="small" color="#1F6BFF" /><Text style={styles.fileTxt}>Uploading...</Text></View> : null}
            </ScrollView>
          ) : null}
          <View style={styles.composer}>
            <Pressable onPress={() => setShowAttach(true)} style={styles.sideBtn} testID="ai-attach"><Ionicons name="add" size={26} color="#1F6BFF" /></Pressable>
            <TextInput
              testID="ai-input" value={input} onChangeText={setInput} placeholder="Ask anything..." placeholderTextColor="#94A3B8"
              multiline maxLength={6000} style={styles.input}
            />
            <Pressable
              onPress={() => Alert.alert("Voice typing", "Tap the microphone on your keyboard to speak. Built-in speech-to-text needs a paid speech service, which is not set up. You can still listen to answers with the speaker icon.")}
              style={styles.sideBtn}><Ionicons name="mic" size={22} color="#94A3B8" /></Pressable>
            <Pressable testID="ai-send" onPress={() => send()} disabled={busy || (!input.trim() && files.length === 0)} style={[styles.send, (busy || (!input.trim() && files.length === 0)) && { opacity: 0.4 }]}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>

      {/* attach menu */}
      <InlineOverlay visible={showAttach} onClose={() => setShowAttach(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAttach(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Attach</Text>
            <Pressable style={styles.menuRow} onPress={() => attach("camera")}><Ionicons name="camera" size={22} color="#1F6BFF" /><Text style={styles.menuTxt}>Take a photo</Text></Pressable>
            <Pressable style={styles.menuRow} onPress={() => attach("gallery")}><Ionicons name="image" size={22} color="#1F6BFF" /><Text style={styles.menuTxt}>Choose from gallery</Text></Pressable>
            <Pressable style={styles.menuRow} onPress={() => attach("pdf")}><Ionicons name="document" size={22} color="#1F6BFF" /><Text style={styles.menuTxt}>PDF document</Text></Pressable>
            <Text style={styles.note}>Photos up to 6 MB and PDFs up to 8 MB. Do not upload students' personal details to a free AI service.</Text>
          </View>
        </View>
      </InlineOverlay>

      {/* history */}
      <InlineOverlay visible={showHistory} onClose={() => setShowHistory(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowHistory(false)} />
          <View style={[styles.sheet, { maxHeight: "80%", paddingBottom: insets.bottom + 16 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.sheetTitle}>Chats</Text>
              <Pressable onPress={newChat} style={styles.newBtn}><Ionicons name="add" size={16} color="#fff" /><Text style={styles.newTxt}>New chat</Text></Pressable>
            </View>
            <ScrollView style={{ marginTop: 8 }}>
              {convs.length === 0 ? <Text style={styles.note}>No chats yet.</Text> : convs.map((c) => (
                <View key={c.id} style={styles.convRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => openConv(c.id)}>
                    <Text style={styles.convTitle} numberOfLines={1}>{c.title}</Text>
                    <Text style={styles.meta}>{new Date(c.updated_at).toLocaleString()}</Text>
                  </Pressable>
                  <Pressable onPress={() => delConv(c.id)} hitSlop={8}><Ionicons name="trash" size={18} color="#EF4444" /></Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>

      {/* settings: memory, usage, privacy */}
      <InlineOverlay visible={showSettings} onClose={() => setShowSettings(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowSettings(false)} />
          <View style={[styles.sheet, { maxHeight: "88%", paddingBottom: insets.bottom + 16 }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>AI settings</Text>

              <Text style={styles.label}>Usage today</Text>
              <Text style={styles.body}>
                {status?.usage ? `${status.usage.ai_requests_today} of ${status.usage.daily_limit} AI requests used.` : "-"}
                {status?.usage?.free_providers?.map((p: any) => ` ${p.provider}: ${p.remaining_today} free left today.`).join("")}
              </Text>
              <Text style={styles.note}>
                Questions about fees, dues, classes and attendance are answered from your records without AI, so they cost nothing.
                {status?.usage?.paid_enabled ? ` Paid AI is ON (this month: $${status.usage.paid_spend_month_usd} of $${status.usage.monthly_budget_usd}).` : " Paid AI is OFF."}
              </Text>

              <View style={styles.switchRow}>
                <Text style={styles.menuTxt}>Read answers aloud automatically</Text>
                <Switch value={autoSpeak} onValueChange={setAutoSpeak} />
              </View>

              <Text style={styles.label}>Memory</Text>
              <View style={styles.switchRow}>
                <Text style={styles.menuTxt}>Remember my preferences</Text>
                <Switch value={memory.enabled} onValueChange={toggleMemory} />
              </View>
              {memory.items.length === 0 ? <Text style={styles.note}>Nothing saved. Say "remember: reply in Hindi" in the chat, or add a note below.</Text> :
                memory.items.map((i) => (
                  <View key={i.id} style={styles.convRow}>
                    <Text style={[styles.body, { flex: 1 }]}>{i.text}</Text>
                    <Pressable onPress={async () => { await api(`/ai/memory/${i.id}`, { method: "DELETE" }); setMemory(await api("/ai/memory")); }} hitSlop={8}><Ionicons name="trash" size={18} color="#EF4444" /></Pressable>
                  </View>
                ))}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TextInput value={memText} onChangeText={setMemText} placeholder="Add a note (preferences only)" placeholderTextColor="#94A3B8" style={[styles.input, { flex: 1, minHeight: 44 }]} />
                <Pressable onPress={addMemory} style={styles.newBtn}><Text style={styles.newTxt}>Add</Text></Pressable>
              </View>
              <Text style={styles.note}>Memory never stores passwords, phone numbers or student names, and it is never used for fees or attendance.</Text>

              <Text style={styles.label}>Privacy</Text>
              <Text style={styles.note}>
                {private_ ? "A private AI provider is configured, so questions that need student records can use it." :
                  "Only a shared free AI provider is configured. Student records and class photos are never sent to it."}
              </Text>
              <Pressable onPress={wipe} style={styles.danger}><Ionicons name="trash" size={16} color="#EF4444" /><Text style={styles.dangerTxt}>Delete all my AI data</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>
    </GradientBg>
  );
}

function TableCard({ t }: { t: { title?: string; columns: string[]; rows: any[][] } }) {
  return (
    <View style={styles.tableBox}>
      {t.title ? <Text style={styles.tableTitle}>{t.title}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.tr, styles.th]}>{t.columns.map((c, i) => <Text key={i} style={[styles.td, { fontWeight: "800" }]}>{c}</Text>)}</View>
          {t.rows.map((r, ri) => <View key={ri} style={styles.tr}>{r.map((c, ci) => <Text key={ci} style={styles.td}>{String(c)}</Text>)}</View>)}
        </View>
      </ScrollView>
    </View>
  );
}

function DraftsCard({ d }: { d: { recipients: any[]; no_phone: string[] } }) {
  const open = (r: any) => {
    const num = waNumber(r.phone);
    if (!num) { Alert.alert("No phone number", "This student has no phone number saved."); return; }
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(r.text)}`).catch(() => Alert.alert("WhatsApp not found", "Install WhatsApp to send this message."));
  };
  return (
    <View style={styles.tableBox}>
      <Text style={styles.tableTitle}>Reminder drafts (nothing is sent until you tap WhatsApp)</Text>
      {d.recipients.map((r) => (
        <View key={r.connection_id} style={styles.draftRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.draftName}>{r.name}</Text>
            <Text style={styles.meta} numberOfLines={2}>{r.text}</Text>
          </View>
          <Pressable onPress={() => open(r)} style={styles.wa}><Ionicons name="logo-whatsapp" size={20} color="#25D366" /></Pressable>
        </View>
      ))}
    </View>
  );
}

function ActionCard({ a, st, onAct }: { a: any; st?: { st: string; text?: string }; onAct: (a: any, ok: boolean) => void }) {
  const s = st?.st || a.status;
  return (
    <View style={styles.actionCard}>
      <Text style={styles.actionLbl}>Needs your confirmation</Text>
      <Text style={styles.actionTxt}>{a.summary}</Text>
      {s === "done" ? <Text style={styles.okTxt}>Done ✓</Text> : s === "cancelled" ? <Text style={styles.meta}>Cancelled</Text> :
        s === "busy" ? <ActivityIndicator color="#1F6BFF" /> : (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable onPress={() => onAct(a, true)} style={styles.confirm}><Text style={styles.confirmTxt}>Confirm</Text></Pressable>
            <Pressable onPress={() => onAct(a, false)} style={styles.cancel}><Text style={styles.cancelTxt}>Cancel</Text></Pressable>
          </View>
        )}
      {s === "error" ? <Text style={styles.errSmall}>{st?.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  sub: { color: "#7FD3FF", fontSize: 12, marginTop: 1 },
  icoBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  hello: { color: "#0F172A", fontSize: 20, fontWeight: "800", marginTop: 6 },
  helloSub: { color: "#64748B", textAlign: "center", fontSize: 13, lineHeight: 19, marginTop: 6, paddingHorizontal: 12 },
  warn: { flexDirection: "row", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginTop: 14 },
  warnTxt: { flex: 1, color: "#92400E", fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, backgroundColor: "#fff", borderWidth: 1, borderColor: "#DCE6F7" },
  chipTxt: { color: "#1F6BFF", fontWeight: "700", fontSize: 13 },
  userBub: { backgroundColor: "#1F6BFF", borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "85%", gap: 6 },
  userTxt: { color: "#fff", fontSize: 15, lineHeight: 21 },
  attachPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  attachTxt: { color: "#fff", fontSize: 12, maxWidth: 180 },
  aiWrap: { maxWidth: "94%", gap: 6 },
  aiBub: { backgroundColor: "#fff", borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 11, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  errBub: { backgroundColor: "#FEE2E2", borderRadius: 14, padding: 12, maxWidth: "90%", gap: 8 },
  errTxt: { color: "#B91C1C", fontSize: 14, lineHeight: 20 },
  retry: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "#DC2626", borderRadius: 14, paddingHorizontal: 12, height: 30 },
  retryTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
  priv: { color: "#B45309", fontSize: 11, lineHeight: 16 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  meta: { color: "#94A3B8", fontSize: 11 },
  composerWrap: { backgroundColor: "#fff", paddingHorizontal: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E8EFFB" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  sideBtn: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: 22, backgroundColor: "#F4F8FF", paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15, color: "#0F172A" },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1F6BFF", alignItems: "center", justifyContent: "center" },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EEF4FF", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 220 },
  fileTxt: { color: "#0F172A", fontSize: 12, maxWidth: 120 },
  thumb: { width: 28, height: 28, borderRadius: 6 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 4 },
  sheetTitle: { fontSize: 19, fontWeight: "800", color: "#0F172A" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  menuTxt: { fontSize: 15, color: "#0F172A", fontWeight: "600" },
  note: { color: "#64748B", fontSize: 12, lineHeight: 17, marginTop: 6 },
  body: { color: "#0F172A", fontSize: 14, lineHeight: 20, marginTop: 4 },
  label: { color: "#1F6BFF", fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginTop: 16, letterSpacing: 0.5 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1F6BFF", borderRadius: 14, paddingHorizontal: 14, height: 36 },
  newTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  convRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#EEF2F9" },
  convTitle: { color: "#0F172A", fontWeight: "700", fontSize: 14 },
  danger: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: "#EF4444", marginTop: 14 },
  dangerTxt: { color: "#EF4444", fontWeight: "800" },
  tableBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: "#E8EFFB", paddingTop: 8 },
  tableTitle: { color: "#1F6BFF", fontWeight: "800", fontSize: 12, marginBottom: 6 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#EEF2F9" },
  th: { backgroundColor: "#EEF4FF", borderTopWidth: 0 },
  td: { minWidth: 92, paddingHorizontal: 8, paddingVertical: 7, fontSize: 12, color: "#0F172A" },
  draftRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#EEF2F9" },
  draftName: { color: "#0F172A", fontWeight: "700", fontSize: 13 },
  wa: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(37,211,102,0.14)", alignItems: "center", justifyContent: "center" },
  actionCard: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D", borderRadius: 14, padding: 12, gap: 2 },
  actionLbl: { color: "#B45309", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  actionTxt: { color: "#0F172A", fontSize: 14, fontWeight: "600", marginTop: 2 },
  confirm: { flex: 1, height: 38, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  confirmTxt: { color: "#fff", fontWeight: "800" },
  cancel: { flex: 1, height: 38, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  cancelTxt: { color: "#475569", fontWeight: "800" },
  okTxt: { color: "#16A34A", fontWeight: "800", marginTop: 6 },
  errSmall: { color: "#DC2626", fontSize: 12, marginTop: 6 },
});
