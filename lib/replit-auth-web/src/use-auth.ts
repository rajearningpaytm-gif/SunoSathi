import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

const API_ORIGIN = (import.meta as any).env?.VITE_API_ORIGIN ?? "";

async function fetchSessionUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/me`, {
      credentials: "include",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.id) return null;
    return {
      id: data.id,
      email: data.email ?? null,
      firstName: data.anonymousUsername ?? data.firstName ?? null,
      lastName: null,
      profileImageUrl: null,
    };
  } catch {
    return null;
  }
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["auth-user"],
    queryFn: fetchSessionUser,
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const login = useCallback(() => {
    const base = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_ORIGIN}/api/auth/google/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch { }
    const base = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "/";
    window.location.href = base || "/";
  }, []);

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
