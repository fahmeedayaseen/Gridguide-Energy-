"use client";
/**
 * GridGuide Address Input Components
 *
 * Drop-in React address input with Google Places Autocomplete,
 * real-time validation, and utility territory detection.
 *
 * Usage:
 *   import { AddressInput, useAddressValidation } from "@/lib/address-input";
 *
 *   <AddressInput
 *     onSelect={(address) => console.log(address)}
 *     showValidation
 *     detectUtility
 *   />
 */

import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = "/api/geo";

// ─── useAddressValidation hook ────────────────────────────────────────────────
/**
 * Validates a complete address via POST /api/geo/validate
 */
export function useAddressValidation() {
  const [state, setState] = useState({
    validating: false,
    result:     null,
    error:      null,
  });

  const validate = useCallback(async (address) => {
    setState({ validating: true, result: null, error: null });
    try {
      const res = await fetch(`${API_BASE}/validate`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(address),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Validation failed");
      setState({ validating: false, result: data, error: null });
      return data;
    } catch (e) {
      setState({ validating: false, result: null, error: e.message });
      return null;
    }
  }, []);

  return { ...state, validate };
}

// ─── usePlacesAutocomplete hook ───────────────────────────────────────────────
/**
 * Fetches address suggestions as the user types.
 * Debounced to avoid hammering the API.
 */
export function usePlacesAutocomplete(debounceMs = 300) {
  const [input,       setInput]       = useState("");
  const [predictions, setPredictions] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const sessionRef  = useRef(crypto.randomUUID());
  const timerRef    = useRef(null);

  useEffect(() => {
    if (input.length < 3) { setPredictions([]); return; }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(
          `${API_BASE}/search?q=${encodeURIComponent(input)}&session=${sessionRef.current}`,
          { credentials: "include" }
        );
        const data = await res.json();
        setPredictions(data.predictions || []);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timerRef.current);
  }, [input, debounceMs]);

  const selectPlace = useCallback(async (placeId) => {
    // Reset session token after selection (Google billing)
    sessionRef.current = crypto.randomUUID();
    setPredictions([]);

    const res  = await fetch(`${API_BASE}/search?placeId=${placeId}`, { credentials: "include" });
    const data = await res.json();
    return data.place || null;
  }, []);

  return { input, setInput, predictions, loading, selectPlace };
}

// ─── AddressInput component ───────────────────────────────────────────────────
/**
 * Full address input with autocomplete dropdown + validation feedback.
 *
 * Props:
 *   onSelect(address)    — called when user picks a suggestion or types a full address
 *   onValidated(result)  — called after server-side validation completes
 *   showValidation       — show green ✓ / red ✗ feedback inline
 *   detectUtility        — include utility territory in validation result
 *   placeholder          — input placeholder text
 *   style                — additional styles for the wrapper
 */
export function AddressInput({
  onSelect,
  onValidated,
  showValidation = true,
  detectUtility  = true,
  placeholder    = "Start typing your address…",
  style          = {},
  themeColor     = "#00D4AA",
}) {
  const { input, setInput, predictions, loading, selectPlace } = usePlacesAutocomplete();
  const { validate, validating, result, error } = useAddressValidation();
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState(null);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = async (prediction) => {
    setInput(prediction.description);
    setOpen(false);
    const place = await selectPlace(prediction.placeId);
    if (!place) return;
    setSelected(place);
    onSelect?.(place);

    if (showValidation) {
      const validation = await validate({
        addressLine1:  [place.streetNumber, place.route].filter(Boolean).join(" "),
        city:          place.city,
        state:         place.state,
        zip:           place.zip,
        detectUtility,
        saveToProfile: false,
      });
      onValidated?.(validation);
    }
  };

  const validIcon = result?.valid
    ? <span style={{ color: "#22C55E", fontSize: 16 }}>✓</span>
    : result
    ? <span style={{ color: "#FF4D6A", fontSize: 16 }}>✗</span>
    : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      {/* Input field */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); setSelected(null); }}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          style={{
            width:        "100%",
            padding:      "10px 36px 10px 12px",
            borderRadius: 8,
            background:   "#1C1C28",
            border:       `1.5px solid ${selected && result?.valid ? "#22C55E" : selected && result ? "#FF4D6A" : themeColor + "40"}`,
            color:        "#F0F4FF",
            fontSize:     13,
            outline:      "none",
            transition:   "border-color .15s",
            boxSizing:    "border-box",
          }}
          onFocus={(e) => { e.target.style.borderColor = themeColor; setOpen(true); }}
          onBlur={(e) => {
            if (!selected) e.target.style.borderColor = themeColor + "40";
          }}
        />
        {/* Status icon or spinner */}
        <div style={{ position: "absolute", right: 10 }}>
          {(validating || loading)
            ? <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${themeColor}30`, borderTopColor: themeColor, animation: "spin .7s linear infinite" }} />
            : validIcon
          }
        </div>
      </div>

      {/* Autocomplete dropdown */}
      {open && predictions.length > 0 && (
        <div style={{
          position:    "absolute",
          top:         "calc(100% + 4px)",
          left:        0,
          right:       0,
          background:  "#1C1C28",
          border:      `1px solid ${themeColor}30`,
          borderRadius: 10,
          boxShadow:   "0 8px 32px rgba(0,0,0,0.5)",
          zIndex:      999,
          overflow:    "hidden",
        }}>
          {predictions.map((p) => (
            <button
              key={p.placeId}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(p); }}
              style={{
                display:       "flex",
                alignItems:    "flex-start",
                gap:           10,
                width:         "100%",
                padding:       "10px 14px",
                background:    "transparent",
                border:        "none",
                cursor:        "pointer",
                borderBottom:  "1px solid #2A2A3A",
                textAlign:     "left",
                transition:    "background .1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = themeColor + "12"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {/* Pin icon */}
              <svg width="14" height="16" viewBox="0 0 14 18" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M7 0C3.13 0 0 3.13 0 7c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={themeColor + "60"} />
                <circle cx="7" cy="7" r="2.5" fill={themeColor} />
              </svg>
              <div>
                <div style={{ fontSize: 13, color: "#F0F4FF", fontWeight: 500 }}>{p.mainText}</div>
                <div style={{ fontSize: 11, color: "#8890A8", marginTop: 2 }}>{p.secondaryText}</div>
              </div>
            </button>
          ))}
          {/* Google attribution (required by ToS) */}
          <div style={{ padding: "6px 14px", textAlign: "right" }}>
            <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white.png"
              alt="Powered by Google" height="14" style={{ opacity: 0.5 }} />
          </div>
        </div>
      )}

      {/* Validation feedback */}
      {showValidation && result && (
        <div style={{ marginTop: 6 }}>
          {result.valid ? (
            <div style={{ fontSize: 11, color: "#22C55E", display: "flex", alignItems: "center", gap: 5 }}>
              ✓ Address confirmed · {result.normalized?.formatted}
              {result.utility && (
                <span style={{ color: themeColor }}>· {result.utility.shortName}</span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#FF4D6A" }}>
              ⚠ {result.issues?.[0] || "Address could not be verified"}
              {result.normalized?.formatted && (
                <span style={{ color: "#8890A8", marginLeft: 5 }}>
                  Suggestion: {result.normalized.formatted}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── useUserLocation hook ─────────────────────────────────────────────────────
/**
 * Gets user's current GPS location and reverse-geocodes it.
 */
export function useUserLocation() {
  const [location, setLocation] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported by your browser");
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const res  = await fetch(`${API_BASE}/reverse?lat=${lat}&lng=${lng}&utility=true`, { credentials: "include" });
          const data = await res.json();
          setLocation({ lat, lng, ...data.address, utility: data.utility });
        } catch {
          setLocation({ lat, lng });
        } finally {
          setLoading(false);
        }
      },
      (geoError) => {
        setError(geoError.message || "Location access denied");
        setLoading(false);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  return { location, loading, error, getLocation };
}
