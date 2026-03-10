import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

export function useCheatSheet() {
  return useQuery<Record<string, string>>({
    queryKey: [api.cheatSheet.list.path],
    queryFn: async () => {
      const res = await fetch(api.cheatSheet.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cheat sheet");
      return await res.json();
    },
  });
}

export function useUpdateCheatSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ section, content }: { section: string; content: string }) => {
      const url = buildUrl(api.cheatSheet.update.path, { section });
      const res = await fetch(url, {
        method: api.cheatSheet.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update cheat sheet");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.cheatSheet.list.path] });
    },
  });
}
