import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { EnrichedPlayer, UpdatePlayerRequest } from "@shared/schema";

export interface PlayerFilters {
  status?: string;
  pos?: string;
  tag?: string;
  search?: string;
}

export function usePlayers(filters?: PlayerFilters) {
  return useQuery<EnrichedPlayer[]>({
    queryKey: [api.players.list.path, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status && filters.status !== 'all') params.append("status", filters.status);
      if (filters?.pos && filters.pos !== 'all') params.append("pos", filters.pos);
      if (filters?.tag && filters.tag !== 'all') params.append("tag", filters.tag);
      if (filters?.search) params.append("search", filters.search);

      const url = `${api.players.list.path}${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch players");
      return await res.json();
    },
  });
}

export function useUpdatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdatePlayerRequest) => {
      const url = buildUrl(api.players.update.path, { id });
      const res = await fetch(url, {
        method: api.players.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update player");
      return await res.json();
    },
    onSuccess: () => {
      // WS will invalidate, but doing it here guarantees immediate local feedback
      queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.dashboard.get.path] });
    },
  });
}

export function useResetPlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.players.reset.path, { id });
      const res = await fetch(url, {
        method: api.players.reset.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to reset player");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.dashboard.get.path] });
    },
  });
}
