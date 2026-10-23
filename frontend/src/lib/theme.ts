export const COLORS = {
  surface: "#FFFFFF",
  onSurface: "#0F172A",
  surfaceSecondary: "#EEF4FF",
  onSurfaceSecondary: "#334155",
  surfaceTertiary: "#F1F5F9",
  onSurfaceTertiary: "#475569",
  brand: "#1F6BFF",
  brandDark: "#1550CC",
  brandSoft: "#E3EEFF",
  onBrand: "#FFFFFF",
  pink: "#F9A8D4",
  blue: "#93C5FD",
  success: "#16A34A",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#2E8BFF",
  border: "#DCE6F7",
  borderStrong: "#CBD5E1",
  divider: "#E8EFFB",
  muted: "#64748B",
};

// New design: deep navy backgrounds, white panels, blue + green accents.
export const NAVY = {
  top: "#020B22",
  mid: "#06214F",
  bottom: "#0A3A8C",
  header: "#071E4A",
  card: "#0F2B63",
};
export const GRAD = {
  primary: ["#1F6BFF", "#16B5F0"] as const,
  blue: ["#1B5BFF", "#3B8BFF"] as const,
  green: ["#16A34A", "#34D399"] as const,
  bg: ["#020B22", "#06214F", "#0A3A8C"] as const,
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };
export const SHADOW = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

export function initials(name?: string): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "•";
}

export function inr(n: number | undefined): string {
  const v = Number(n || 0);
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
