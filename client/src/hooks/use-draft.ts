import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { DraftState, UpdateDraftStateRequest } from "@shared/schema";

export function useDraftState() {
  return useQuery<DraftState>({
    queryKey: [api.draftState.get.path],
    queryFn: async () => {
      const res = await fetch(api.draftState.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch draft state");
      return await res.json();
    },
  });
}

export function useUpdateDraftState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: UpdateDraftStateRequest) => {
      const res = await fetch(api.draftState.update.path, {
        method: api.draftState.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update draft state");
      return await res.json();
    },
    // We update local cache immediately for snappy UI, WS handles the rest
    onSuccess: (data) => {
      queryClient.setQueryData([api.draftState.get.path], data);
      queryClient.invalidateQueries({ queryKey: [api.dashboard.get.path] });
    },
  });
}
