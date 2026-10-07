"use client";
import { useState, useEffect } from "react";

/**
 * /reset-password?token=X — receives the link from both
 * sendPasswordResetEmail (forgot-password flow) and
 * sendEnterpriseAccountProvisioned (new enterprise account setup).
 *
 * This page did not exist before — POST /api/auth/reset-password (which
 * validates the token and sets the new password) was already real and
 * working, but nothing in the frontend ever called it, so every password
 * reset email ever sent led to a 404 on click.
 */
export default function ResetPasswordPage() {
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") || params.get("resetToken"));
  }, []);

  const submit = async () => {
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "This link is invalid or has expired."); setLoading(false); return; }
      setDone(true);
    } catch (e) { setErr("Network error — please try again."); }
    setLoading(false);
  };

  const styles = {
    page: { minHeight: "100vh", background: "#0B0F14", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Inter', sans-serif" },
    card: { background: "#181E28", border: "1px solid #1F2A3C", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400 },
    h1: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#E8EEFF", marginBottom: 8 },
    p: { fontSize: 13, color: "#8890A8", marginBottom: 22, lineHeight: 1.6 },
    label: { display: "block", fontSize: 11, color: "#8890A8", marginBottom: 6, fontWeight: 500 },
    input: { width: "100%", padding: "11px 14px", background: "#0B0F14", border: "1px solid #1F2A3C", borderRadius: 9, color: "#E8EEFF", fontSize: 14, marginBottom: 14, boxSizing: "border-box" },
    btn: { width: "100%", padding: "12px", borderRadius: 9, background: "linear-gradient(135deg,#00D4AA,#009D7E)", color: "#0A0F1E", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" },
    err: { background: "#FF4D6A14", border: "1px solid #FF4D6A30", borderRadius: 9, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: "#FF4D6A" },
  };

  if (token === null) return null; // avoid a flash before reading the URL param

  if (!token) return (
    <div style={styles.page}><div style={styles.card}>
      <h1 style={styles.h1}>Invalid Link</h1>
      <p style={styles.p}>This password reset link is missing its token. Please request a new one.</p>
    </div></div>
  );

  if (done) return (
    <div style={styles.page}><div style={styles.card}>
      <h1 style={styles.h1}>Password Set ✓</h1>
      <p style={styles.p}>Your password has been updated. You can now sign in with it.</p>
      <a href="/platform" style={{ ...styles.btn, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>Go to Sign In</a>
    </div></div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Set Your Password</h1>
        <p style={styles.p}>Choose a password to finish setting up your account.</p>
        {err && <div style={styles.err}>{err}</div>}
        <label style={styles.label}>New Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={styles.input} placeholder="At least 8 characters" onKeyDown={e => e.key === "Enter" && submit()} />
        <label style={styles.label}>Confirm Password</label>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={styles.input} onKeyDown={e => e.key === "Enter" && submit()} />
        <button onClick={submit} disabled={loading} style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}>{loading ? "Setting…" : "Set Password"}</button>
      </div>
    </div>
  );
}
