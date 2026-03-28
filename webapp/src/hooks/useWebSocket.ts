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
  | { type: "command_delivery"; device_id: string; payload: WebSocketPayload };

export function useWebSocket(onEvent: (event: WebSocketEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);
  const handleEvent = useEffectEvent(onEvent);

  useEffect(() => {
    let isActive = true;

    function clearReconnectTimer() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function clearPingInterval() {
      if (pingIntervalRef.current !== null) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }

    function scheduleReconnect() {
      clearReconnectTimer();
      const timeout = Math.min(backoffRef.current * 1.5, 30000);
      backoffRef.current = timeout;
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
        clearReconnectTimer();
        clearPingInterval();
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isActive) return;
        try {
          if (event.data === "pong") return;
          const parsed = JSON.parse(event.data) as WebSocketEvent;
          handleEvent(parsed);
        } catch (err) {
          console.error("Failed to parse WS message", err);
        }
      };

      ws.onclose = () => {
        if (!isActive) return;
        setIsConnected(false);
        clearPingInterval();
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

    return () => {
      isActive = false;
      clearReconnectTimer();
      clearPingInterval();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { isConnected };
}
