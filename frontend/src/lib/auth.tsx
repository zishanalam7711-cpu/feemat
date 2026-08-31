import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, saveToken } from "./api";

export type User = { id: string; email: string; role: "teacher" | "student"; name: string };

type Ctx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, name: string, role: "teacher" | "student") => Promise<User>;
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
    } catch {
      await saveToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await saveToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, role: "teacher" | "student") => {
      const res = await api<{ token: string; user: User }>("/auth/signup", {
        method: "POST",
        body: { email, password, name, role },
        auth: false,
      });
      await saveToken(res.token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
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
