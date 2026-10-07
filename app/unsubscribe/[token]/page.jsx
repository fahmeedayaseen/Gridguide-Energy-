"use client";
/**
 * /unsubscribe/[token]
 * Public unsubscribe landing page — no authentication required.
 * Processes the token and shows confirmation.
 */
import React, { useState, useEffect } from "react";

export default function UnsubscribePage({ params }) {
  const { token } = params;
  const [state,    setState]   = useState("loading"); // loading|confirm|done|error|used
  const [email,    setEmail]   = useState("");
  const [loading,  setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/email/unsubscribe/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setState("error"); return; }
        if (d.used)  { setState("used");  return; }
        setEmail(d.email);
        setState("confirm");
      })
      .catch(() => setState("error"));
  }, [token]);

  const confirm = async () => {
    setLoading(true);
    const r = await fetch(`/api/email/unsubscribe/${token}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const d = await r.json();
    if (r.ok) setState("done");
    else      setState("error");
    setLoading(false);
  };

  const s = {
    page:  { fontFamily:"system-ui,sans-serif", background:"#0A0F1E", minHeight:"100vh",
              display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
    card:  { background:"#0D1526", border:"1px solid #1C2842", borderRadius:18,
              padding:"40px 32px", maxWidth:420, width:"100%", textAlign:"center" },
    h1:    { fontSize:20, fontWeight:800, color:"#E8F0FF", fontFamily:"inherit", margin:"0 0 10px" },
    p:     { fontSize:13, color:"#8890A8", lineHeight:1.7, margin:"0 0 24px" },
    btn:   { padding:"12px 32px", background:"#FF4D6A", color:"#fff", border:"none",
              borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
    ghost: { background:"none", border:"1px solid #1C2842", color:"#8890A8",
              padding:"10px 24px", borderRadius:10, fontSize:13, cursor:"pointer", marginTop:12 },
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        {state === "loading" && <p style={s.p}>Loading…</p>}

        {state === "confirm" && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>📧</div>
            <h1 style={s.h1}>Unsubscribe from GridGuide emails</h1>
            <p style={s.p}>
              You're about to unsubscribe <strong style={{color:"#E8F0FF"}}>{email}</strong> from
              GridGuide marketing and invitation emails. You'll still receive critical account
              and security messages.
            </p>
            <button style={s.btn} onClick={confirm} disabled={loading}>
              {loading ? "Processing…" : "Confirm Unsubscribe"}
            </button>
            <br/>
            <a href="/platform" style={{...s.ghost, display:"inline-block", textDecoration:"none", marginTop:12}}>
              Cancel — keep receiving emails
            </a>
          </>
        )}

        {state === "done" && (
          <>
            <div style={{fontSize:40,marginBottom:16}}>✅</div>
            <h1 style={s.h1}>You've been unsubscribed</h1>
            <p style={s.p}>
              <strong style={{color:"#E8F0FF"}}>{email}</strong> has been removed from
              GridGuide marketing and invitation emails.
            </p>
            <a href="/platform" style={{...s.btn, display:"inline-block", textDecoration:"none",
               background:"#06B6D4", color:"#0A0F1E"}}>
              Go to Dashboard
            </a>
          </>
        )}

        {state === "used" && (
          <>
            <h1 style={s.h1}>Already unsubscribed</h1>
            <p style={s.p}>This unsubscribe link has already been used. Your email has been removed.</p>
          </>
        )}

        {state === "error" && (
          <>
            <h1 style={{...s.h1, color:"#FF4D6A"}}>Link not found</h1>
            <p style={s.p}>This unsubscribe link is invalid or has expired. Contact support if you need help.</p>
          </>
        )}
      </div>
    </div>
  );
}
