"use client";
import { useState, useEffect } from "react";

/**
 * /invite/homeowner/[token] — public landing page for Phase 2 enterprise
 * homeowner invitations. Follows the same standalone-page pattern as
 * app/reset-password/page.jsx.
 */
export default function HomeownerInvitePage({ params }) {
  const token = params.token;
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // "accepted" | "declined"

  const [accountExists, setAccountExists] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/homeowner/${token}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setErr(d.error || "This invitation could not be found."); setLoading(false); return; }
        setInvite(d.invite); setAccountExists(!!d.accountExists); setLoading(false);
      })
      .catch(() => { setErr("Network error — please try again."); setLoading(false); });
  }, [token]);

  const accept = async () => {
    if (!accountExists) {
      if (!name.trim()) { setErr("Please enter your name."); return; }
      if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
      if (password !== confirm) { setErr("Passwords don't match."); return; }
    }
    setSubmitting(true); setErr("");
    try {
      const r = await fetch(`/api/invites/homeowner/${token}/accept`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountExists ? {} : { name: name.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Could not accept this invitation."); setSubmitting(false); return; }
      setResult("accepted");
    } catch (e) { setErr("Network error — please try again."); }
    setSubmitting(false);
  };

  const decline = async () => {
    setSubmitting(true); setErr("");
    try {
      await fetch(`/api/invites/homeowner/${token}/decline`, { method: "POST" });
      setResult("declined");
    } catch (e) { setErr("Network error — please try again."); }
    setSubmitting(false);
  };

  const styles = {
    page: { minHeight: "100vh", background: "#0B0F14", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Inter', sans-serif" },
    card: { background: "#181E28", border: "1px solid #1F2A3C", borderRadius: 16, padding: 32, width: "100%", maxWidth: 420 },
    h1: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#E8EEFF", marginBottom: 8 },
    p: { fontSize: 13, color: "#8890A8", marginBottom: 20, lineHeight: 1.6 },
    label: { display: "block", fontSize: 11, color: "#8890A8", marginBottom: 6, fontWeight: 500 },
    input: { width: "100%", padding: "11px 14px", background: "#0B0F14", border: "1px solid #1F2A3C", borderRadius: 9, color: "#E8EEFF", fontSize: 14, marginBottom: 14, boxSizing: "border-box" },
    btnPrimary: { width: "100%", padding: "12px", borderRadius: 9, background: "linear-gradient(135deg,#00D4AA,#009D7E)", color: "#0A0F1E", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", marginBottom: 10 },
    btnGhost: { width: "100%", padding: "12px", borderRadius: 9, background: "transparent", color: "#8890A8", fontWeight: 600, fontSize: 13, border: "1px solid #1F2A3C", cursor: "pointer" },
    err: { background: "#FF4D6A14", border: "1px solid #FF4D6A30", borderRadius: 9, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: "#FF4D6A" },
  };

  if (loading) return <div style={styles.page}><div style={styles.card}><p style={styles.p}>Loading…</p></div></div>;

  if (err && !invite) return (
    <div style={styles.page}><div style={styles.card}>
      <h1 style={styles.h1}>Invitation Unavailable</h1>
      <p style={styles.p}>{err}</p>
    </div></div>
  );

  if (result === "accepted") return (
    <div style={styles.page}><div style={styles.card}>
      <h1 style={styles.h1}>You're In ✓</h1>
      <p style={styles.p}>Your GridGuide account is connected to {invite.orgName}.</p>
      <a href="/platform" style={{ ...styles.btnPrimary, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>Go to Dashboard</a>
    </div></div>
  );

  if (result === "declined") return (
    <div style={styles.page}><div style={styles.card}>
      <h1 style={styles.h1}>Invitation Declined</h1>
      <p style={styles.p}>You've declined this invitation. Nothing further happens — no account was created.</p>
    </div></div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>{invite.orgName} invited you</h1>
        <p style={styles.p}>{invite.orgName} wants to connect your home energy account with GridGuide{accountExists ? ". Log in to accept." : ". Create your account to accept."}</p>
        {err && <div style={styles.err}>{err}</div>}
        {!accountExists && (
          <>
            <label style={styles.label}>Your Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} placeholder="Full name" />
            <label style={styles.label}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={styles.input} placeholder="At least 8 characters" />
            <label style={styles.label}>Confirm Password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={styles.input} />
          </>
        )}
        <button onClick={accept} disabled={submitting} style={{ ...styles.btnPrimary, opacity: submitting ? 0.6 : 1 }}>{submitting ? "…" : accountExists ? "Log In & Accept" : "Create Account & Accept"}</button>
        <button onClick={decline} disabled={submitting} style={styles.btnGhost}>Decline</button>
      </div>
    </div>
  );
}
