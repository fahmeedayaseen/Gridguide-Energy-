"use client";
/**
 * GridGuide Real-time Dashboard Hook
 * 
 * Drop-in React hook that connects to /api/events (SSE stream)
 * and updates dashboard state in real-time.
 * 
 * Usage in your React dashboard:
 * 
 *   import { useRealtime } from "@/lib/realtime";
 *   
 *   function Dashboard() {
 *     const { thermostat, notifications, vppEvent, devices, connected } = useRealtime();
 *     // data updates automatically every 30 seconds
 *   }
 */

import { useState, useEffect, useRef, useCallback } from "react";

const SSE_URL = "/api/events";
const MAX_RECONNECT_DELAY = 30_000; // 30 seconds max backoff
const INITIAL_RECONNECT_DELAY = 1_000;

export function useRealtime() {
  const [connected,     setConnected]     = useState(false);
  const [thermostat,    setThermostat]    = useState(null);
  const [notifications, setNotifications] = useState({ count: 0 });
  const [vppEvent,      setVppEvent]      = useState(null);
  const [devices,       setDevices]       = useState([]);
  const [adminStats,    setAdminStats]    = useState(null);
  const [lastUpdate,    setLastUpdate]    = useState(null);
  const [error,         setError]         = useState(null);

  const esRef          = useRef(null);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(SSE_URL, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectDelay.current = INITIAL_RECONNECT_DELAY; // reset backoff
    };

    es.onerror = () => {
      setConnected(false);
      es.close();

      // Exponential backoff reconnect
      const delay = Math.min(reconnectDelay.current, MAX_RECONNECT_DELAY);
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, delay);
    };

    // ── Event handlers ────────────────────────────────────────────────────────
    es.addEventListener("thermostat", (e) => {
      try { setThermostat(JSON.parse(e.data)); setLastUpdate(new Date()); } catch {}
    });

    es.addEventListener("notifications", (e) => {
      try { setNotifications(JSON.parse(e.data)); setLastUpdate(new Date()); } catch {}
    });

    es.addEventListener("vpp", (e) => {
      try { setVppEvent(JSON.parse(e.data)); setLastUpdate(new Date()); } catch {}
    });

    es.addEventListener("devices", (e) => {
      try {
        const { devices: d } = JSON.parse(e.data);
        if (Array.isArray(d)) setDevices(d);
        setLastUpdate(new Date());
      } catch {}
    });

    es.addEventListener("admin_stats", (e) => {
      try { setAdminStats(JSON.parse(e.data)); setLastUpdate(new Date()); } catch {}
    });

    es.addEventListener("heartbeat", () => {
      setConnected(true);
      setLastUpdate(new Date());
    });

    es.addEventListener("error", (e) => {
      try {
        const { message } = JSON.parse(e.data);
        setError(message);
      } catch {}
    });

  }, []);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      esRef.current?.close();
    };
  }, [connect]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectDelay.current = INITIAL_RECONNECT_DELAY;
    connect();
  }, [connect]);

  return {
    connected,
    thermostat,
    notifications,
    vppEvent,
    devices,
    adminStats,
    lastUpdate,
    error,
    reconnect,
  };
}

// ─── Simpler polling fallback (for environments that don't support SSE) ────────
export function usePolling(fetchFn, interval = 30_000) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await fetchFn();
        if (!cancelled) { setData(result); setLoading(false); setError(null); }
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    };

    poll();
    const timer = setInterval(poll, interval);
    return () => { cancelled = true; clearInterval(timer); };
  }, [interval]);

  return { data, loading, error };
}
