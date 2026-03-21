import { useEffect, useState, useRef } from "react";
import { getToken } from "@/lib/auth";

type WebSocketPayload = Record<string, unknown> | null;

type WebSocketEvent =
  | { type: "device_state"; device_id: string; payload: WebSocketPayload }
  | { type: "device_offline"; device_id: string; payload: WebSocketPayload }
  | { type: "device_online"; device_id: string; payload: WebSocketPayload }
  | { type: "pairing_requested"; device_id: string; payload: WebSocketPayload };

export function useWebSocket(onEvent: (event: WebSocketEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);

  useEffect(() => {
    let isActive = true;

    async function connect() {
      const token = await getToken();
      if (!token || !isActive) return;

      let wsUrl = "";
      if (process.env.NEXT_PUBLIC_WS_URL) {
        // Remove trailing slash if accidentally added
        const baseUrl = process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
        wsUrl = `${baseUrl}?token=${encodeURIComponent(token)}`;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        wsUrl = `${protocol}//${host}/api/v1/ws?token=${encodeURIComponent(token)}`;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isActive) return;
        setIsConnected(true);
        backoffRef.current = 1000; // reset backoff
      };

      ws.onmessage = (event) => {
        if (!isActive) return;
        try {
          // ignore pongs
          if (event.data === "pong") return;
          const parsed = JSON.parse(event.data);
          onEvent(parsed);
        } catch (err) {
          console.error("Failed to parse WS message", err);
        }
      };

      ws.onclose = () => {
        if (!isActive) return;
        setIsConnected(false);
        wsRef.current = null;
        
        // Reconnect with exponential backoff
        const timeout = Math.min(backoffRef.current * 1.5, 30000);
        backoffRef.current = timeout;
        reconnectTimeoutRef.current = window.setTimeout(connect, timeout);
      };

      ws.onerror = () => {
        console.warn("WebSocket channel closed or failed to connect.");
      };
    }

    connect();

    return () => {
      isActive = false;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [onEvent]);

  return { isConnected };
}
