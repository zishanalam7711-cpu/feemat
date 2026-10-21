import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "") + "/api";

const TOKEN_KEY = "feemat.token";
const USER_KEY = "feemat.user";

export async function saveToken(token: string | null) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

// The signed-in user is cached so the app opens straight into the right portal,
// even if the server is asleep or there is no internet.
export async function saveUser(user: any | null) {
  try {
    if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(USER_KEY);
  } catch {}
}
export async function getCachedUser<T = any>(): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(USER_KEY);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // The free server can take up to a minute to wake up, so allow a long wait.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") fail("The server took too long to respond. Please try again.", 0);
    fail("Network error. Check your internet connection and try again.", 0);
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // e.g. an HTML error page while the server is waking up
    fail(res.ok ? "Unexpected response from the server." : `Server is busy (${res.status}). Please try again in a moment.`, res.ok ? 0 : res.status);
  }
  if (!res.ok) {
    const msg = data?.detail || data?.message || `Request failed (${res.status})`;
    fail(typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return data as T;
}
