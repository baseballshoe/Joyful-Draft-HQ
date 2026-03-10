import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { DashboardData } from "@shared/schema";

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: [api.dashboard.get.path],
    queryFn: async () => {
      const res = await fetch(api.dashboard.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard data");
      return await res.json();
    },
  });
}
