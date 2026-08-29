import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUserResponseDTO, LoginResponseDTO } from "@razorgrowth/contracts";
import { apiGet, apiPost } from "../lib/api-client";
import { clearToken, getToken, setToken, subscribeToken } from "../lib/auth-storage";

/** Reactive session-token presence — re-renders on login, logout, a
 * server-forced 401 clearing the token, or another tab logging out. */
export function useAuthToken(): string | null {
  return useSyncExternalStore(subscribeToken, getToken, () => null);
}

export function useLogin() {
  return useMutation({
    mutationFn: (params: { email: string; password: string }) => apiPost<LoginResponseDTO>("/auth/login", params),
    onSuccess: (data) => setToken(data.token),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/auth/logout"),
    onSettled: () => {
      clearToken();
      queryClient.clear();
    },
  });
}

export function useCurrentUser() {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<CurrentUserResponseDTO>("/auth/me"),
    enabled: Boolean(token),
    retry: false,
  });
}
