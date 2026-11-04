import { Alert, Linking } from "react-native";

export function waNumber(phone?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}
export function openWhatsApp(phone: string | undefined, message: string) {
  const num = waNumber(phone);
  if (!num) { Alert.alert("No phone number", "This student has no phone number saved."); return; }
  Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(message)}`).catch(() => Alert.alert("Could not open WhatsApp"));
}
export function callPhone(phone?: string) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) { Alert.alert("No phone number", "This student has no phone number saved."); return; }
  Linking.openURL(`tel:${digits}`).catch(() => {});
}
