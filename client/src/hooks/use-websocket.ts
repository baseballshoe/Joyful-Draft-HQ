import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    // Vite handles /vite-hmr, we want our own socket
    const wsUrl = `${protocol}//${host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === "draft_state") {
            queryClient.setQueryData([api.draftState.get.path], msg.data);
            queryClient.invalidateQueries({ queryKey: [api.dashboard.get.path] });
          }
          if (msg.type === "player_updated") {
            queryClient.invalidateQueries({ queryKey: [api.players.list.path] });
            queryClient.invalidateQueries({ queryKey: [api.dashboard.get.path] });
          }
          if (msg.type === "round_strategy_updated") {
            queryClient.invalidateQueries({ queryKey: [api.roundStrategy.list.path] });
          }
          if (msg.type === "cheat_sheet_updated") {
            queryClient.invalidateQueries({ queryKey: [api.cheatSheet.list.path] });
          }
        } catch (e) {
          console.error("WS parse error", e);
        }
      };

      ws.onclose = () => {
        // Exponential backoff or simple timeout for reconnect
        setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [queryClient]);
}
