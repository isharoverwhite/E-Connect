/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

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

    function clearReconnectTimer() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function stopHeartbeat() {
      if (pingIntervalRef.current !== null) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (pongTimeoutRef.current !== null) {
        window.clearTimeout(pongTimeoutRef.current);
        pongTimeoutRef.current = null;
      }
    }

    function clearTimers() {
      clearReconnectTimer();
      stopHeartbeat();
    }

    function startHeartbeat(ws: WebSocket) {
      stopHeartbeat();
      if (document.visibilityState !== "visible") {
        return;
      }

      pingIntervalRef.current = window.setInterval(() => {
        if (!isActive || wsRef.current !== ws || document.visibilityState !== "visible") {
          stopHeartbeat();
          return;
        }

        if (ws.readyState !== WebSocket.OPEN) {
          stopHeartbeat();
          return;
        }

        ws.send("ping");

        if (pongTimeoutRef.current !== null) {
          window.clearTimeout(pongTimeoutRef.current);
        }

        pongTimeoutRef.current = window.setTimeout(() => {
          if (!isActive || wsRef.current !== ws || document.visibilityState !== "visible") {
            return;
          }

          if (ws.readyState === WebSocket.OPEN) {
            console.debug("WebSocket pong timeout. Closing stale connection.");
            ws.close(4000, "pong_timeout");
          }
        }, 10000);
      }, 15000);
    }

    function scheduleReconnect(immediate = false) {
      if (!isActive) {
        return;
      }
      if (!navigator.onLine) {
        return;
      }
      if (!immediate && document.visibilityState !== "visible") {
        return;
      }

      clearReconnectTimer();
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
        if (!isActive) {
          ws.close(1000, "inactive");
          return;
        }
        if (wsRef.current !== ws) {
          ws.close(1000, "superseded");
          return;
        }
        setIsConnected(true);
        backoffRef.current = 1000;
        clearReconnectTimer();
        startHeartbeat(ws);
      };

      ws.onmessage = (event) => {
        if (!isActive || wsRef.current !== ws) return;
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
        if (wsRef.current !== ws) {
          return;
        }
        wsRef.current = null;
        setIsConnected(false);
        stopHeartbeat();
        if (!isActive) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!isActive || wsRef.current !== ws) {
          return;
        }
        console.debug("WebSocket channel errored; waiting for close/reconnect.");
      };
    }

    void connect();

    // Reconnect immediately when user comes back to the tab or regains network
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const currentSocket = wsRef.current;
        if (currentSocket?.readyState === WebSocket.OPEN) {
          startHeartbeat(currentSocket);
          return;
        }
        if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED || currentSocket.readyState === WebSocket.CLOSING) {
          backoffRef.current = 1000;
          scheduleReconnect(true);
        }
        return;
      }

      stopHeartbeat();
    };
    
    const handleOnline = () => {
      const currentSocket = wsRef.current;
      if (currentSocket?.readyState === WebSocket.OPEN) {
        startHeartbeat(currentSocket);
        return;
      }
      backoffRef.current = 1000;
      scheduleReconnect(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      isActive = false;
      clearTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      const currentSocket = wsRef.current;
      wsRef.current = null;
      if (currentSocket) {
        currentSocket.onopen = null;
        currentSocket.onmessage = null;
        currentSocket.onclose = null;
        currentSocket.onerror = null;
        if (
          currentSocket.readyState === WebSocket.OPEN ||
          currentSocket.readyState === WebSocket.CONNECTING
        ) {
          currentSocket.close(1000, "component_unmount");
        }
      }
    };
  }, []);

  return { isConnected };
}
