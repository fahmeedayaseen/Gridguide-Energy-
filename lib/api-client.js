/**
 * GridGuide API Client
 * Drop this into your frontend React app.
 * Replaces all mock/demo data with real backend calls.
 *
 * Usage:
 *   import api from "@/lib/api-client";
 *   const { user } = await api.auth.login(email, password);
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function request(method, path, body = null, opts = {}) {
  const url = `${BASE_URL}/api${path}`;
  const headers = { "Content-Type": "application/json", ...opts.headers };

  const res = await fetch(url, {
    method,
    headers,
    credentials: "include", // send httpOnly cookies
    ...(body && { body: JSON.stringify(body) }),
    signal: opts.signal,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

const get  = (path, opts) => request("GET",    path, null, opts);
const post = (path, body, opts) => request("POST",   path, body, opts);
const patch = (path, body, opts) => request("PATCH",  path, body, opts);
const del  = (path, opts) => request("DELETE", path, null, opts);

// ─── Auth ─────────────────────────────────────────────────────────────────────
const auth = {
  register: (data) => post("/auth/register", data),
  login:    ({ email, password }) => post("/auth/login", { email, password }),
  logout:   () => post("/auth/logout"),
};

// ─── Users ───────────────────────────────────────────────────────────────────
const users = {
  me:     ()          => get("/users/me"),
  update: (id, data)  => patch(`/users/${id}`, data),
};

// ─── Marketplace ─────────────────────────────────────────────────────────────
const marketplace = {
  products: {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/marketplace/products${q ? "?" + q : ""}`);
    },
    get:    (id)   => get(`/marketplace/products/${id}`),
    create: (data) => post("/marketplace/products", data),
    update: (id, data) => patch(`/marketplace/products/${id}`, data),
  },
  orders: {
    list:   ()     => get("/marketplace/orders"),
    create: (data) => post("/marketplace/orders", data),
    get:    (id)   => get(`/marketplace/orders/${id}`),
  },
};

// ─── Installers ───────────────────────────────────────────────────────────────
const installers = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/installers${q ? "?" + q : ""}`);
  },
  get:    (id) => get(`/installers/${id}`),
  leads: {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/installers/leads${q ? "?" + q : ""}`);
    },
    create: (data) => post("/installers/leads", data),
    update: (id, data) => patch(`/installers/leads?id=${id}`, data),
  },
};

// ─── VPP ─────────────────────────────────────────────────────────────────────
const vpp = {
  events: {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/vpp/events${q ? "?" + q : ""}`);
    },
    create: (data) => post("/vpp/events", data),
  },
  participants: {
    list:   (eventId) => get(`/vpp/participants?eventId=${eventId}`),
    enroll: ()        => post("/vpp/participants/enroll"),
    leave:  ()        => post("/vpp/participants/leave"),
  },
  payouts: {
    list:    (eventId)      => get(`/vpp/payouts?eventId=${eventId}`),
    process: (eventId, data) => post("/vpp/payouts", { eventId, ...data }),
  },
};

// ─── Thermostat ───────────────────────────────────────────────────────────────
const thermostat = {
  getState:     ()           => get("/thermostat/control"),
  updateState:  (data)       => patch("/thermostat/control", data),
  connect:      (data)       => post("/thermostat/connect", data),
  disconnect:   ()           => del("/thermostat/connect"),
  getSchedule:  ()           => get("/thermostat/schedule"),
  setSchedule:  (slots)      => post("/thermostat/schedule", { slots }),
};

// ─── AI Chat ─────────────────────────────────────────────────────────────────
const ai = {
  chat: async (message, sessionId, onChunk) => {
    const res = await fetch(`${BASE_URL}/api/ai/chat`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ message, sessionId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "AI chat failed");
    }

    // Stream SSE response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") break;
        try {
          const { text: chunk } = JSON.parse(payload);
          fullText += chunk;
          onChunk?.(chunk, fullText);
        } catch {}
      }
    }
    return fullText;
  },

  history: () => get("/ai/chat"),
};

// ─── Rebates ─────────────────────────────────────────────────────────────────
const rebates = {
  lookup: (zip, category) => {
    const q = new URLSearchParams({ zip, ...(category && { category }) }).toString();
    return get(`/rebates?${q}`);
  },
  claim:  (data) => post("/rebates", data),
  myClaims: ()   => get("/rebates/claims"),
};

// ─── Payments ────────────────────────────────────────────────────────────────
const payments = {
  checkout: (data)   => post("/payments/checkout", data),
  payouts:  (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/payments/payouts${q ? "?" + q : ""}`);
  },
  connectStripe: () => post("/payments/connect"),
};

// ─── Default export ───────────────────────────────────────────────────────────
const api = {
  auth,
  users,
  marketplace,
  installers,
  vpp,
  thermostat,
  ai,
  rebates,
  payments,
};

export default api;

// ─── React hook: useApi ───────────────────────────────────────────────────────
// Usage: const { data, loading, error } = useApi(() => api.marketplace.products.list())
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fn()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, loading: false, error: err.message }); });

    return () => { cancelled = true; };
  }, deps);

  return state;
}
