"use client";
/**
 * /join/[installerCode]/[inviteToken]
 * Public installer invite landing page.
 * Resolves the token, displays installer info and system details,
 * and lets the visitor create an account or log in to accept.
 */
import React, { useState, useEffect } from "react";

export default function InstallerInvitePage({ params }) {
  const { installerCode, inviteToken } = params;
  const [state, setState] = useState("loading"); // loading|ready|accepted|declined|error
  const [invite, setInvite]   = useState(null);
  const [accountExists, setAccountExists] = useState(false);
  const [error, setError]     = useState("");
  const [form, setForm]       = useState({ name: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/installer/${inviteToken}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setState("error"); }
        else { setInvite(d.invite); setAccountExists(d.accountExists); setState("ready"); }
      })
      .catch(() => { setError("Could not load invitation."); setState("error"); });
  }, [inviteToken]);

  const accept = async () => {
    setSubmitting(true); setError("");
    try {
      const body = accountExists ? {} : { name: form.name, password: form.password };
      const r = await fetch(`/api/invites/installer/${inviteToken}/accept`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) setState("accepted");
      else setError(d.error || "Could not accept invitation.");
    } catch { setError("Network error. Please try again."); }
    setSubmitting(false);
  };

  const decline = async () => {
    await fetch(`/api/invites/installer/${inviteToken}/decline`, { method: "POST", credentials: "include" });
    setState("declined");
  };

  const styles = {
    page:  { fontFamily: "system-ui, sans-serif", background: "#0A0F1E", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
    card:  { background: "#0D1526", border: "1px solid #1C2842", borderRadius: 18, padding: "36px 32px", maxWidth: 440, width: "100%" },
    h1:    { fontFamily: "inherit", fontSize: 22, fontWeight: 800, color: "#E8F0FF", margin: "0 0 6px" },
    muted: { color: "#8890A8", fontSize: 13 },
    input: { width: "100%", padding: "11px 14px", background: "#0A0F1E", border: "1px solid #1C2842", borderRadius: 9, color: "#E8F0FF", fontSize: 14, boxSizing: "border-box", marginBottom: 10 },
    btn:   { width: "100%", padding: "13px", background: "#06B6D4", color: "#0A0F1E", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10 },
    ghost: { width: "100%", padding: "11px", background: "transparent", color: "#8890A8", border: "1px solid #1C2842", borderRadius: 10, fontSize: 13, cursor: "pointer" },
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {state === "loading" && <p style={styles.muted}>Loading invitation…</p>}

        {state === "error" && (
          <>
            <h1 style={{ ...styles.h1, color: "#FF4D6A" }}>Invitation Unavailable</h1>
            <p style={styles.muted}>{error}</p>
          </>
        )}

        {state === "accepted" && (
          <>
            <div style={{ fontSize: 40, marginBottom: 14 }}>🎉</div>
            <h1 style={styles.h1}>Welcome to GridGuide!</h1>
            <p style={styles.muted}>Your account is connected to {invite?.installerName}. Head to your dashboard to get started.</p>
            <a href="/platform" style={{ ...styles.btn, display: "block", textAlign: "center", textDecoration: "none", marginTop: 20 }}>
              Go to Dashboard →
            </a>
          </>
        )}

        {state === "declined" && (
          <>
            <h1 style={styles.h1}>Invitation Declined</h1>
            <p style={styles.muted}>You've declined this invitation. No account was created.</p>
          </>
        )}

        {state === "ready" && invite && (
          <>
            {/* Installer info */}
            <div style={{ background: "#06B6D410", border: "1px solid #06B6D420", borderRadius: 12, padding: "14px 16px", marginBottom: 22 }}>
              <div style={{ fontSize: 12, color: "#8890A8", marginBottom: 4 }}>Invitation from</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#E8F0FF" }}>{invite.installerName}</div>
              {invite.installerRating > 0 && (
                <div style={{ fontSize: 12, color: "#8890A8", marginTop: 2 }}>⭐ {invite.installerRating} · {invite.installerJobs} installations</div>
              )}
            </div>

            {invite.systemType && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: "#8890A8", marginBottom: 6 }}>Your system</div>
                {[
                  invite.systemType && `Type: ${invite.systemType}`,
                  invite.batterySystem && "Battery: Yes",
                  invite.utility && `Utility: ${invite.utility}`,
                ].filter(Boolean).map(line => (
                  <div key={line} style={{ fontSize: 13, color: "#E8F0FF", padding: "3px 0" }}>• {line}</div>
                ))}
              </div>
            )}

            <h1 style={styles.h1}>
              {accountExists ? "Log in to accept" : "Create your free account"}
            </h1>
            <p style={{ ...styles.muted, marginBottom: 18 }}>
              {accountExists
                ? "You already have a GridGuide account. Log in to connect with your installer."
                : `${invite.installerName} installed your system and invited you to GridGuide — free to join.`}
            </p>

            {error && <div style={{ color: "#FF4D6A", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#FF4D6A14", borderRadius: 8 }}>{error}</div>}

            {accountExists ? (
              <a href={`/login?redirect=/join/${installerCode}/${inviteToken}`}
                style={{ ...styles.btn, display: "block", textAlign: "center", textDecoration: "none" }}>
                Log In to Accept →
              </a>
            ) : (
              <>
                <div>
                  <label style={{ fontSize: 11, color: "#8890A8", display: "block", marginBottom: 4 }}>Full Name</label>
                  <input style={styles.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Your name" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#8890A8", display: "block", marginBottom: 4 }}>Create Password</label>
                  <input style={styles.input} type="password" value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="At least 8 characters" />
                </div>
                <button style={styles.btn} onClick={accept} disabled={submitting}>
                  {submitting ? "Creating account…" : "Create Account & Accept →"}
                </button>
              </>
            )}

            <button style={styles.ghost} onClick={decline}>Decline this invitation</button>

            <p style={{ fontSize: 11, color: "#4A5570", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
              GridGuide is free. Your installer invited you — GridGuide will never charge you without your consent.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
