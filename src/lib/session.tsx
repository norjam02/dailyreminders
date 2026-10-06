// Who is signed in, and which circles they belong to.

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "./supabase";
import type { Membership } from "./types";

type SessionState = {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  // The circle this person is using: an active one if there is one, else a pending one.
  current: Membership | null;
  isOrganizer: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMemberships = useCallback(async (s: Session | null) => {
    if (!s) {
      setMemberships([]);
      return;
    }
    const { data, error } = await supabase
      .from("circle_members")
      .select("circle_id, role, status, circle:circles(id, name, organizer_id)")
      .eq("user_id", s.user.id)
      .neq("status", "removed")
      .order("joined_at", { ascending: true });
    if (error) throw error;
    setMemberships((data ?? []) as unknown as Membership[]);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      try {
        await loadMemberships(data.session);
      } finally {
        if (active) setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      loadMemberships(next).catch(() => setMemberships([]));
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadMemberships]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadMemberships(data.session);
  }, [loadMemberships]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setMemberships([]);
  }, []);

  const value = useMemo<SessionState>(() => {
    const current = memberships.find((m) => m.status === "active") ?? memberships[0] ?? null;
    const isOrganizer = !!current && !!session && current.circle.organizer_id === session.user.id;
    return { session, loading, memberships, current, isOrganizer, refresh, signOut };
  }, [session, loading, memberships, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

// Supabase errors from our database functions carry the friendly message we wrote.
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Something went wrong. Check your connection and try again.";
}
