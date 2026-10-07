"use client";
import { useState, useEffect } from "react";

const TYPE_LABELS = {
  INSTALLER:  "Installer Partner",
  ENTERPRISE: "Enterprise Organization",
  SELLER:     "Marketplace Seller",
};

const STATUS_COPY = {
  APPROVED:  { icon:"✅", title:"Already Approved", body:"This invitation has already been accepted and approved. Your account is active." },
  ACCEPTED:  { icon:"⏳", title:"Under Review",      body:"You've accepted this invitation. GridGuide is reviewing your application." },
  CANCELLED: { icon:"❌", title:"Invitation Cancelled", body:"This invitation has been cancelled by GridGuide." },
  REJECTED:  { icon:"❌", title:"Application Declined", body:"This invitation has been declined. Contact GridGuide if you have questions." },
  EXPIRED:   { icon:"⏰", title:"Invitation Expired",  body:"This invitation has expired. Contact GridGuide to request a new one." },
};

export default function PartnerInvitePage({ params }) {
  const [state, setState] = useState("loading"); // loading | ready | terminal | accepting | accepted | error
  const [invite, setInvite]   = useState(null);
  const [error,  setError]    = useState(null);

  useEffect(() => {
    fetch(`/api/partner-invitations/${params.token}`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { setError(data.error || "Invitation not found"); setState("error"); return; }
        setInvite(data.invitation);
        setState(STATUS_COPY[data.invitation.status] ? "terminal" : "ready");
      })
      .catch(() => { setError("Unable to load invitation."); setState("error"); });
  }, [params.token]);

  async function handleAccept() {
    setState("accepting");
    const res = await fetch(`/api/partner-invitations/${params.token}/accept`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setState("accepted");
    } else {
      setError(data.error || "Could not accept invitation.");
      setState("ready");
    }
  }

  const C = { bg:"#0A0F1E", card:"#0D1526", bord:"#1C2842", text:"#E8F0FF", muted:"#8890A8",
               accent:"#06B6D4", green:"#10B981", red:"#FF4D6A", gold:"#F59E0B" };

  const wrap = {
    minHeight:"100vh", background:C.bg,
    display:"flex", alignItems:"center", justifyContent:"center",
    padding:"40px 20px", fontFamily:"system-ui,-apple-system,sans-serif",
  };
  const card = {
    maxWidth:480, width:"100%", background:C.card,
    border:`1px solid ${C.bord}`, borderRadius:20, padding:36,
  };

  return (
    <div style={wrap}>
      <div style={card}>
        {/* GridGuide wordmark */}
        <div style={{fontFamily:"'Space Grotesk',system-ui",fontSize:18,fontWeight:800,
          color:C.accent,letterSpacing:"-0.02em",marginBottom:28}}>
          GridGuide
        </div>

        {state==="loading" && (
          <div style={{color:C.muted,fontSize:13,textAlign:"center",padding:"40px 0"}}>Loading invitation…</div>
        )}

        {state==="error" && (
          <div>
            <div style={{fontSize:32,marginBottom:12}}>❌</div>
            <div style={{fontFamily:"'Space Grotesk',system-ui",fontSize:20,fontWeight:800,color:C.text,marginBottom:8}}>
              Invitation not found
            </div>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>{error}</div>
          </div>
        )}

        {state==="terminal" && invite && (() => {
          const s = STATUS_COPY[invite.status];
          return (
            <div>
              <div style={{fontSize:32,marginBottom:12}}>{s.icon}</div>
              <div style={{fontFamily:"'Space Grotesk',system-ui",fontSize:20,fontWeight:800,color:C.text,marginBottom:8}}>{s.title}</div>
              <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>{s.body}</div>
            </div>
          );
        })()}

        {(state==="ready" || state==="accepting") && invite && (
          <div>
            <div style={{fontSize:11,color:C.accent,textTransform:"uppercase",letterSpacing:"0.1em",
              fontWeight:700,marginBottom:8}}>
              {TYPE_LABELS[invite.type] || invite.type} Invitation
            </div>
            <div style={{fontFamily:"'Space Grotesk',system-ui",fontSize:24,fontWeight:800,
              color:C.text,marginBottom:4,lineHeight:1.2}}>
              {invite.companyName}
            </div>
            <div style={{fontSize:13,color:C.muted,marginBottom:24}}>
              Invited: {invite.contactName || invite.email}
            </div>

            {invite.assignedPlan && (
              <div style={{marginBottom:20,padding:"12px 16px",background:`${C.accent}0A`,
                border:`1px solid ${C.accent}20`,borderRadius:10,fontSize:12,color:C.muted}}>
                <span style={{color:C.accent,fontWeight:600}}>Assigned plan: </span>{invite.assignedPlan}
              </div>
            )}

            <div style={{marginBottom:24,padding:"12px 16px",background:`${C.bord}60`,
              borderRadius:10,fontSize:12,color:C.muted,lineHeight:1.7}}>
              By accepting this invitation you agree to begin the GridGuide partner onboarding process.
              Your account will be reviewed by GridGuide before activation.
              Accepting does not activate marketplace listings, payouts, or VPP access.
            </div>

            <div style={{fontSize:10,color:C.muted,marginBottom:20}}>
              Expires {new Date(invite.expiresAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
            </div>

            {error && (
              <div style={{padding:"10px 14px",background:`${C.red}10`,border:`1px solid ${C.red}20`,
                borderRadius:9,fontSize:12,color:C.red,marginBottom:16}}>{error}</div>
            )}

            <button onClick={handleAccept} disabled={state==="accepting"}
              style={{display:"block",width:"100%",padding:"14px",
                background:state==="accepting"?C.bord:C.accent,
                color:state==="accepting"?C.muted:"#0A0F1E",
                border:"none",borderRadius:12,fontSize:14,fontWeight:700,cursor:state==="accepting"?"not-allowed":"pointer"}}>
              {state==="accepting" ? "Accepting…" : "Accept Invitation →"}
            </button>
          </div>
        )}

        {state==="accepted" && (
          <div>
            <div style={{fontSize:32,marginBottom:12}}>🎉</div>
            <div style={{fontFamily:"'Space Grotesk',system-ui",fontSize:20,fontWeight:800,
              color:C.text,marginBottom:8}}>
              Invitation accepted
            </div>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.7}}>
              Thanks! GridGuide will review your application and contact you once your
              partner account is activated. This usually takes 1–2 business days.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
