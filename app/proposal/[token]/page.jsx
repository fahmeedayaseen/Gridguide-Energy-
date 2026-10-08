"use client";
import { useEffect, useState } from "react";

const money = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function ProposalPage({ params }) {
  const [state, setState] = useState({ loading: true, error: "", proposal: null });

  useEffect(() => {
    fetch(`/api/public/proposals/${encodeURIComponent(params.token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Proposal not found"); return d; })
      .then((d) => setState({ loading: false, error: "", proposal: d.proposal }))
      .catch((e) => setState({ loading: false, error: e.message, proposal: null }));
  }, [params.token]);

  const p = state.proposal;
  const items = Array.isArray(p?.lineItems) ? p.lineItems : [];

  return (
    <main style={{ minHeight: "100vh", background: "#F5F7FA", padding: "32px 16px", fontFamily: "Inter, system-ui, sans-serif", color: "#0B1A2B" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 14, padding: 28, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
        {state.loading && <p>Loading proposal…</p>}
        {state.error && <p style={{ color: "#B42318" }}>{state.error}</p>}
        {p && (
          <>
            <div style={{ fontSize: 13, color: "#5A6A85", marginBottom: 6 }}>Proposal from {p.installer?.companyName || "your installer"}</div>
            <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>{p.title}</h1>
            {p.customerName && <div style={{ fontSize: 14, color: "#5A6A85" }}>Prepared for {p.customerName}{p.address ? ` · ${p.address}` : ""}</div>}
            <div style={{ fontSize: 32, fontWeight: 700, margin: "20px 0" }}>{money(p.amount)}</div>
            {items.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 20 }}>
                <thead><tr style={{ textAlign: "left", color: "#5A6A85" }}><th style={{ padding: "6px 0" }}>Item</th><th>Qty</th><th style={{ textAlign: "right" }}>Price</th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #E6EAF0" }}>
                      <td style={{ padding: "8px 0" }}>{it.description}</td>
                      <td>{it.qty ?? 1}</td>
                      <td style={{ textAlign: "right" }}>{money((it.unitPrice || 0) * (it.qty ?? 1))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.notes && <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{p.notes}</p>}
            <div style={{ fontSize: 13, color: "#5A6A85", marginTop: 20 }}>
              {p.validUntil ? `Valid until ${new Date(p.validUntil).toLocaleDateString()}. ` : ""}
              To accept or ask questions, reply to {p.installer?.companyName || "your installer"} directly.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
