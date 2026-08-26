import { useCallback, useEffect, useRef, useState } from "react";

export type FsChangeEvent = {
  event_type: "created" | "deleted" | "modified" | "moved";
  src_path: string;
  dest_path: string | null;
  is_directory: boolean;
};

export type SseStatus = "connecting" | "connected" | "disconnected";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

function getEventsUrl(currentPath: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";
  const params = new URLSearchParams({ path: currentPath });
  return `${base}/events?${params.toString()}`;
}

/**
 * Connects to the backend SSE endpoint and calls `onEvent` whenever a
 * relevant filesystem change is received. Handles automatic reconnection
 * with exponential backoff. Returns the current connection status.
 *
 * The application remains fully functional even when SSE is unavailable —
 * this hook degrades gracefully to "disconnected" status.
 */
export function useFileSSE(
  currentPath: string,
  onEvent: (event: FsChangeEvent) => void,
): { status: SseStatus } {
  const [status, setStatus] = useState<SseStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const reconnectDelayRef = useRef(BASE_DELAY_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const unmountedRef = useRef(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const url = getEventsUrl(currentPath);
    const es = new EventSource(url);
    esRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      if (unmountedRef.current) return;
      reconnectDelayRef.current = BASE_DELAY_MS;
      setStatus("connected");
    };

    es.onmessage = (event: MessageEvent<string>) => {
      if (unmountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as FsChangeEvent;
        onEventRef.current(parsed);
      } catch {
        // Ignore parse errors (e.g. keepalive comments arrive as message events
        // only if the server incorrectly uses "data:" — our server uses ": keepalive"
        // which does NOT trigger onmessage, so this is just a safety guard)
      }
    };

    es.onerror = () => {
      if (unmountedRef.current) return;
      es.close();
      esRef.current = null;
      setStatus("disconnected");

      // Exponential backoff reconnect
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_DELAY_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) connect();
      }, delay);
    };
  }, [currentPath]); // reconnect when path changes

  useEffect(() => {
    unmountedRef.current = false;
    reconnectDelayRef.current = BASE_DELAY_MS;
    connect();

    return () => {
      unmountedRef.current = true;
      clearReconnectTimer();
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect, clearReconnectTimer]);

  return { status };
}
