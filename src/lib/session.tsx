// Who is signed in, and which circles they belong to.

import type { Session } from "@supabase/supabase-js";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "./supabase";
import type { Circle, Membership } from "./types";

type SessionState = {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  // The circle this person is using: an active one if there is one, else a pending one.
  current: Membership | null;
  isOrganizer: boolean;
  // Paid or on a pilot code. Unpaid circles can be set up but not shared.
  isActive: boolean;
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
      .select("circle_id, role, status, circle:circles(id, name, organizer_id, access:circle_access(active_until))")
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

    // Supabase advises against calling it from inside this callback, which can
    // deadlock; defer the membership load to the next tick.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setTimeout(() => {
        loadMemberships(next).catch(() => setMemberships([]));
      }, 0);
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
    // Back to the welcome screen, clearing the screens behind it.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/");
  }, []);

  const value = useMemo<SessionState>(() => {
    const current = memberships.find((m) => m.status === "active") ?? memberships[0] ?? null;
    const isOrganizer = !!current && !!session && current.circle.organizer_id === session.user.id;
    const isActive = !!current && circleIsActive(current.circle);
    return { session, loading, memberships, current, isOrganizer, isActive, refresh, signOut };
  }, [session, loading, memberships, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function circleIsActive(circle: Circle): boolean {
  const access = Array.isArray(circle.access) ? circle.access[0] : circle.access;
  if (!access) return false;
  return access.active_until === null || Date.parse(access.active_until) > Date.now();
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

// Supabase errors from our database functions carry the friendly message we wrote.
export function errorMessage(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  if (!message || /network request failed|failed to fetch|fetch failed|network error|timed? ?out/i.test(message)) {
    return "Couldn't reach DailyPulse. Check your internet connection and try again.";
  }
  return message;
}
