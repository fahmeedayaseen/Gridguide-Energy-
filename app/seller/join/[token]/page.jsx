"use client";
/**
 * /seller/join/[token]
 * Public seller team invitation landing page.
 * Resolves the token, shows seller name + role,
 * requires the invited email to be logged in, then calls the accept API.
 */
import React, { useState, useEffect } from "react";

export default function SellerTeamJoinPage({ params }) {
  const { token } = params;
  const [state,    setState]   = useState("loading"); // loading|ready|accepted|expired|error
  const [invite,   setInvite]  = useState(null);
  const [error,    setError]   = useState("");
  const [loading,  setLoading] = useState(false);

  useEffect(() => {
    // Look up invite details via the accept route (GET-style token check)
    fetch(`/api/sellers/team/invites/${token}/info`)
      .then(r => r.json())
      .then(d => {
        if (d.error)   { setError(d.error); setState(d.status === 410 ? "expired" : "error"); return; }
        setInvite(d.invite);
        setState("ready");
      })
      .catch(() => { setError("Could not load invitation."); setState("error"); });
  }, [token]);

  const accept = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/sellers/team/invites/${token}/accept`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (r.ok) setState("accepted");
      else if (r.status === 401) {
        // Not logged in — redirect to login, come back after
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      } else {
        setError(d.error || "Could not accept invitation.");
      }
    } catch { setError("Network error. Please try again."); }
    setLoading(false);
  };

  const s = {
    page:  { fontFamily:"system-ui,sans-serif", background:"#0A0F1E", minHeight:"100vh",
              display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
    card:  { background:"#0D1526", border:"1px solid #1C2842", borderRadius:18,
              padding:"40px 32px", maxWidth:440, width:"100%", textAlign:"center" },
    h1:    { fontSize:20, fontWeight:800, color:"#E8F0FF", fontFamily:"inherit", margin:"0 0 10px" },
    p:     { fontSize:13, color:"#8890A8", lineHeight:1.7, margin:"0 0 20px" },
    role:  { display:"inline-block", padding:"4px 14px", borderRadius:20, fontSize:12,
              fontWeight:700, background:"#06B6D414", color:"#06B6D4", marginBottom:20 },
    btn:   { width:"100%", padding:"13px", background:"#06B6D4", color:"#0A0F1E",
              border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" },
    err:   { fontSize:12, color:"#FF4D6A", background:"#FF4D6A14", borderRadius:8,
              padding:"10px 14px", marginBottom:16 },
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        {state === "loading" && <p style={s.p}>Loading invitation…</p>}

        {state === "expired" && (
          <>
            <div style={{fontSize:36,marginBottom:12}}>⏰</div>
            <h1 style={s.h1}>Invitation Expired</h1>
            <p style={s.p}>This invitation has expired. Ask the seller to send a new one.</p>
          </>
        )}

        {state === "error" && (
          <>
            <h1 style={{...s.h1, color:"#FF4D6A"}}>Invitation Not Found</h1>
            <p style={s.p}>{error || "This invitation link is invalid or has already been used."}</p>
          </>
        )}

        {state === "accepted" && (
          <>
            <div style={{fontSize:40,marginBottom:14}}>🎉</div>
            <h1 style={s.h1}>Welcome to the team!</h1>
            <p style={s.p}>
              You've joined <strong style={{color:"#E8F0FF"}}>{invite?.sellerName}</strong> as{" "}
              <strong style={{color:"#06B6D4"}}>{invite?.role}</strong>.
            </p>
            <a href="/platform?portal=seller"
               style={{...s.btn, display:"block", textDecoration:"none", lineHeight:"48px"}}>
              Go to Seller Portal →
            </a>
          </>
        )}

        {state === "ready" && invite && (
          <>
            <div style={{background:"#06B6D410",border:"1px solid #06B6D420",borderRadius:12,
                         padding:"14px 16px",marginBottom:22}}>
              <div style={{fontSize:12,color:"#8890A8",marginBottom:4}}>Invitation from</div>
              <div style={{fontSize:17,fontWeight:700,color:"#E8F0FF"}}>{invite.sellerName}</div>
            </div>

            <div style={s.role}>{invite.role}</div>

            <h1 style={s.h1}>Join the Seller Team</h1>
            <p style={s.p}>
              You've been invited to join <strong style={{color:"#E8F0FF"}}>{invite.sellerName}</strong>{" "}
              on GridGuide as a <strong style={{color:"#06B6D4"}}>{invite.role}</strong>.
              {invite.accountExists
                ? " You'll be added to the team using your existing GridGuide account."
                : " You'll need a GridGuide account to accept — log in or create one."}
            </p>

            {error && <div style={s.err}>{error}</div>}

            <button style={s.btn} onClick={accept} disabled={loading}>
              {loading ? "Accepting…" : "Accept Invitation →"}
            </button>

            <p style={{fontSize:11,color:"#4A5570",marginTop:14,lineHeight:1.5}}>
              This invitation was sent to <strong>{invite.email}</strong>.{" "}
              You must be logged in with that email to accept.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
