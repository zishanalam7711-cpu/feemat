import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api } from "./api";

export type HwPhoto = { id: string; preview: string };

// Take or choose ONE photo, shrink it (fast on mobile data) and upload it to `endpoint`. Returns the file id to attach/submit.
async function pickAndUpload(source: "camera" | "gallery", endpoint: string, name: string): Promise<HwPhoto | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Camera permission is needed to take a photo. You can allow it in your phone's settings for FeeMat.");
  }
  const res =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  const full = await ImageManipulator.manipulateAsync(a.uri, a.width && a.width > 1400 ? [{ resize: { width: 1400 } }] : [], {
    compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true,
  });
  const thumb = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 320 } }], {
    compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true,
  });
  if (!full.base64) throw new Error("Could not read this photo. Please try another one.");
  const f = await api<{ id: string }>(endpoint, { method: "POST", body: { name, data: full.base64, thumb: thumb.base64 || "" } });
  return { id: f.id, preview: full.uri };
}

// Student: photo of the finished homework (goes to the teacher).
export const pickHomeworkPhoto = (source: "camera" | "gallery") => pickAndUpload(source, "/student/homework/files", "homework.jpg");
// Teacher: photo that is attached to a NEW homework (worksheet, board, book page) and shown to the students.
export const pickTeacherHomeworkPhoto = (source: "camera" | "gallery") => pickAndUpload(source, "/teacher/homework/attachments", "homework-task.jpg");

export const dataUri = (mime: string | undefined, b64: string) => `data:${mime || "image/jpeg"};base64,${b64}`;

export function fmtWhen(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

// "2026-10-24" -> Today / Yesterday / Tomorrow / "Sat, 24 Oct"
export function dayLabel(ymd: string, today: string) {
  if (ymd === today) return "Today";
  const d = (s: string) => new Date(s + "T00:00:00Z").getTime();
  const diff = Math.round((d(ymd) - d(today)) / 86400000);
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  try { return new Date(d(ymd)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); } catch { return ymd; }
}

// Dates as YYYY-MM-DD in the phone's own time zone (so "today" is right for the teacher late in the evening / after midnight)
const pad = (n: number) => String(n).padStart(2, "0");
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function addDaysYmd(ymd: string, n: number) {
  const dt = new Date(ymd + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
