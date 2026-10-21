import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getCachedUser, getToken, saveToken, saveUser } from "./api";

export type User = { id: string; email: string; role: "teacher" | "student"; name: string };

type Ctx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string, role?: "teacher" | "student") => Promise<User>;
  signUp: (email: string, password: string, name: string, role: "teacher" | "student", claimCode?: string) => Promise<any>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
      await saveUser(me);
    } catch (e: any) {
      // Sign out ONLY when the server says the login is invalid. If the server is asleep or
      // there is no internet, keep the session so the user stays logged in.
      if (e?.status === 401 || e?.status === 403) {
        await saveToken(null);
        await saveUser(null);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const cached = token ? await getCachedUser<User>() : null;
      if (cached) {
        // open instantly from the saved login, verify with the server in the background
        setUser(cached);
        setLoading(false);
        refresh();
      } else {
        await refresh();
        setLoading(false);
      }
    })();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string, role?: "teacher" | "student") => {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password, role },
      auth: false,
    });
    // Wrong portal (for example a teacher account in the Student portal): do NOT log in.
    if (role && res.user.role !== role) {
      const actual = res.user.role === "teacher" ? "Teacher" : "Student";
      throw new Error(`This is a ${actual} account. Please log in from the ${actual} portal.`);
    }
    await saveToken(res.token);
    await saveUser(res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, role: "teacher" | "student", claimCode?: string) => {
      const res = await api<{ token: string; user: User; claimed?: boolean; claim_error?: string }>("/auth/signup", {
        method: "POST",
        body: { email, password, name, role, claim_code: claimCode || undefined },
        auth: false,
      });
      await saveToken(res.token);
      await saveUser(res.user);
      setUser(res.user);
      return { ...res.user, claimed: res.claimed, claim_error: res.claim_error };
    },
    []
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
    await saveUser(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
