import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api } from "./api";

export type HwPhoto = { id: string; preview: string };

// Student: take or choose a photo of the homework, shrink it (fast on mobile data) and upload it. Returns the file id to submit.
export async function pickHomeworkPhoto(source: "camera" | "gallery"): Promise<HwPhoto | null> {
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
  const f = await api<{ id: string }>("/student/homework/files", { method: "POST", body: { name: "homework.jpg", data: full.base64, thumb: thumb.base64 || "" } });
  return { id: f.id, preview: full.uri };
}

export const dataUri = (mime: string | undefined, b64: string) => `data:${mime || "image/jpeg"};base64,${b64}`;

export function fmtWhen(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
