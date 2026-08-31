import React, { useEffect, useState, useCallback } from "react";
import { api } from "./api";

export type PlanState = { plan: "free" | "pro"; status: string; billing?: string | null; expires_at?: string | null; provider?: string };

export function useSubscription(): { data: PlanState | null; refresh: () => Promise<void>; loading: boolean } {
  const [data, setData] = useState<PlanState | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { try { const s = await api<PlanState>("/teacher/subscription"); setData(s); } catch {} }, []);
  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);
  return { data, refresh, loading };
}
