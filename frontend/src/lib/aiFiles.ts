import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import { api } from "./api";

export type Uploaded = { id: string; name: string; kind: "image" | "pdf"; size: number; scanned?: boolean; preview?: string };

const MAX_PDF_BYTES = 8 * 1024 * 1024;

// Picks or captures a photo, shrinks it (so it uploads fast on mobile data) and stores it for the AI.
export async function pickAndUploadImage(source: "camera" | "gallery"): Promise<Uploaded | null> {
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
  const actions = a.width && a.width > 1600 ? [{ resize: { width: 1600 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, actions, { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error("Could not read this photo. Please try another one.");
  const f = await api<Uploaded>("/ai/files", { method: "POST", body: { name: "photo.jpg", data: out.base64 } });
  return { ...f, preview: out.uri };
}

async function uriToBase64(uri: string): Promise<string> {
  const r = await fetch(uri);
  const blob = await r.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(new Error("Could not read this file."));
    fr.readAsDataURL(blob);
  });
}

export async function pickAndUploadPdf(): Promise<Uploaded | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  if (a.size && a.size > MAX_PDF_BYTES) throw new Error("This PDF is larger than 8 MB. Please choose a smaller file.");
  const b64 = await uriToBase64(a.uri);
  if (!b64) throw new Error("Could not read this PDF.");
  return await api<Uploaded>("/ai/files", { method: "POST", body: { name: a.name || "document.pdf", data: b64 } });
}
