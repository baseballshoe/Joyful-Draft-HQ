import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { RoundStrategy, UpdateRoundStrategyRequest } from "@shared/schema";

export function useRoundStrategy() {
  return useQuery<RoundStrategy[]>({
    queryKey: [api.roundStrategy.list.path],
    queryFn: async () => {
      const res = await fetch(api.roundStrategy.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch round strategy");
      return await res.json();
    },
  });
}

export function useUpdateRoundStrategy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateRoundStrategyRequest) => {
      const url = buildUrl(api.roundStrategy.update.path, { id });
      const res = await fetch(url, {
        method: api.roundStrategy.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update round strategy");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.roundStrategy.list.path] });
    },
  });
}
