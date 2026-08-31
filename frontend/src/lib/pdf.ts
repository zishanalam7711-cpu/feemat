import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** Render an HTML string to PDF and open the platform share sheet.
 *  On web falls back to `window.print()` after injecting the HTML.
 */
export async function shareHtmlAsPdf(html: string, fileName = "feemat.pdf") {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 300);
    }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fileName });
  }
}

export async function printHtml(html: string) {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 300); }
    return;
  }
  await Print.printAsync({ html });
}
