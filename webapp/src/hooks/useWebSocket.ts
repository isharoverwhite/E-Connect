import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import {
  resolvePublicWebSocketBaseUrl,
  resolveSameOriginWebSocketBaseUrl,
} from "@/lib/secure-origin";

type WebSocketPayload = Record<string, unknown> | null;

type WebSocketEvent =
  | { type: "device_state"; device_id: string; payload: WebSocketPayload }
  | { type: "device_offline"; device_id: string; payload: WebSocketPayload }
  | { type: "device_online"; device_id: string; payload: WebSocketPayload }
  | { type: "pairing_requested"; device_id: string; payload: WebSocketPayload }
  | { type: "pairing_queue_updated"; device_id: string; payload: WebSocketPayload }
  | { type: "command_delivery"; device_id: string; payload: WebSocketPayload }
  | { type: "system_metrics"; payload: WebSocketPayload };

export function useWebSocket(onEvent: (event: WebSocketEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const pongTimeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);
  const handleEvent = useEffectEvent(onEvent);

  useEffect(() => {
    let isActive = true;

    function clearTimers() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current !== null) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (pongTimeoutRef.current !== null) {
        window.clearTimeout(pongTimeoutRef.current);
        pongTimeoutRef.current = null;
      }
    }

    function scheduleReconnect(immediate = false) {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const timeout = immediate ? 500 : Math.min(backoffRef.current * 1.5, 30000);
      if (!immediate) {
        backoffRef.current = timeout;
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        void connect();
      }, timeout);
    }

    async function connect() {
      const token = await getToken();
      if (!token || !isActive) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const baseUrl =
        resolvePublicWebSocketBaseUrl(process.env.NEXT_PUBLIC_WS_URL) ??
        resolveSameOriginWebSocketBaseUrl();

      if (!baseUrl) {
        return;
      }

      const wsUrl = `${baseUrl}?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isActive) return;
        setIsConnected(true);
        backoffRef.current = 1000;
        clearTimers();
        
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
            
            // Set a timeout to wait for pong
            if (pongTimeoutRef.current !== null) {
              window.clearTimeout(pongTimeoutRef.current);
            }
            pongTimeoutRef.current = window.setTimeout(() => {
              console.warn("WebSocket pong timeout. Closing stale connection.");
              ws.close();
            }, 5000);
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isActive) return;
        try {
          if (event.data === "pong") {
            if (pongTimeoutRef.current !== null) {
              window.clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            return;
          }
          const parsed = JSON.parse(event.data) as WebSocketEvent;
          handleEvent(parsed);
        } catch (err) {
          console.error("Failed to parse WS message", err);
        }
      };

      ws.onclose = () => {
        if (!isActive) return;
        setIsConnected(false);
        clearTimers();
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        console.warn("WebSocket channel closed or failed to connect.");
      };
    }

    void connect();

    // Reconnect immediately when user comes back to the tab or regains network
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CLOSING) {
           backoffRef.current = 1000;
           scheduleReconnect(true);
        }
      }
    };
    
    const handleOnline = () => {
       backoffRef.current = 1000;
       scheduleReconnect(true);
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      isActive = false;
      clearTimers();
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { isConnected };
}
