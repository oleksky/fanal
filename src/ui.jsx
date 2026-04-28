// Shared UI atoms, colors, icons.
import { useEffect, useState } from "react";

export const C = {
  bgDeep: "#08100c", bgCard: "#0d1814", bgElev: "#11211b",
  border: "#1a2e25", borderHi: "#2a4a3a",
  moss: "#9ac29a", mossBri: "#c5e0c0", mossDim: "#6b8a6e", sage: "#7fbf90", leaf: "#5a8a5a",
  fog: "#c5ddd0", fogDim: "#8ba595", bark: "#3a2818",
  text: "#d4e8d4", textDim: "#8ba595", textMute: "#4a5c52",
  danger: "#d67878", warn: "#c9a87a",
};

export const I = {
  Wallet:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 10h20M6 6V4a2 2 0 012-2h8a2 2 0 012 2v2"/></svg>,
  Nodes:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>,
  Peers:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/></svg>,
  Topology: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v3M9.5 14l-3 3M14.5 14l3 3"/></svg>,
  Chat:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"/></svg>,
  Send:     () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Eye:      () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  EyeOff:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  Plus:     () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Trash:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>,
  Key:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  Rotate:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>,
  Check:    () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
  Copy:     () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  Globe:    () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  ChevDown: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
  Warning:  () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Back:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>,
  Terminal: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  QR:       () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 17v4M14 21h3M17 14h4"/></svg>,
};

export const TRANSPORTS = {
  udp:        { name: "UDP",        icon: "📡", color: "#a8d5a8", working: true,  desc: "Hole-punched datagrams", defaultPort: 2121, dash: "6 4" },
  tcp:        { name: "TCP",        icon: "⚡", color: "#c5e0c0", working: true,  desc: "Reliable stream",        defaultPort: 8443, dash: "none" },
  ethernet:   { name: "Ethernet",   icon: "🔌", color: "#7fbf90", working: true,  desc: "L2 local discovery",     dash: "1.5 3" },
  tor:        { name: "Tor",        icon: "🧅", color: "#b89ad5", working: false, desc: "Hidden service (planned)", dash: "8 3 1 3" },
  ble:        { name: "BLE",        icon: "📶", color: "#90c2c0", working: false, desc: "Bluetooth LE (planned)",   dash: "2 5" },
  nostr:      { name: "Nostr",      icon: "🟣", color: "#b8a8d5", working: false, desc: "Relay-backed (planned)",   dash: "10 4" },
  mixnet:     { name: "Mixnet",     icon: "🌀", color: "#d8c5a0", working: false, desc: "Nym overlay (planned)",    dash: "5 2 1 2" },
  bittorrent: { name: "BitTorrent", icon: "🟢", color: "#90c29a", working: false, desc: "DHT overlay (planned)",    dash: "3 3" },
  youtube:    { name: "YouTube",    icon: "📺", color: "#d6a8a8", working: false, desc: "Covert channel (planned)", dash: "12 2 2 2" },
};

export function Copyable({ text, short = true }) {
  const [c, setC] = useState(false);
  if (!text) return null;
  const label = short && text.length > 22 ? text.slice(0, 12) + "…" + text.slice(-6) : text;
  return (
    <span onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text); setC(true); setTimeout(() => setC(false), 1500); }}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: C.fogDim }}>
      {label} {c ? <I.Check/> : <I.Copy/>}
    </span>
  );
}

export function Toast({ message, kind = "info", onDone, durationMs = 2800 }) {
  useEffect(() => { const t = setTimeout(onDone, durationMs); return () => clearTimeout(t); }, [onDone, durationMs]);
  const border = kind === "error" ? C.danger + "80" : kind === "warn" ? C.warn + "80" : C.borderHi;
  const color = kind === "error" ? C.danger : kind === "warn" ? C.warn : C.mossBri;
  return <div style={{
    position: "absolute", bottom: 92, left: "50%", transform: "translateX(-50%)",
    background: "rgba(13, 24, 20, .95)", border: `1px solid ${border}`, color,
    padding: "10px 18px", borderRadius: 999, fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", zIndex: 999,
    animation: "fadeUp .3s", maxWidth: 340, textAlign: "center", backdropFilter: "blur(8px)",
    boxShadow: `0 4px 24px rgba(127, 191, 144, .15)`,
  }}>{message}</div>;
}

export function Modal({ title, children, onClose, maxHeight = "78vh" }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(8, 16, 12, .82)", backdropFilter: "blur(6px)" }} onClick={onClose}/>
      <div style={{
        position: "relative", width: "100%", maxWidth: 420, background: C.bgCard,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: "20px 20px 0 0",
        padding: "16px 18px 24px", maxHeight, overflowY: "auto", boxShadow: `0 -8px 32px rgba(127, 191, 144, .08)`,
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 14px" }}/>
        <h3 style={{ margin: "0 0 14px", fontSize: 15, color: C.text, fontWeight: 600, fontFamily: "'Unbounded', sans-serif", letterSpacing: 0.5 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    active:   { bg: `${C.moss}15`,  color: C.moss,    border: `${C.moss}40`,   label: "ACTIVE" },
    new:      { bg: "#c5e0c015",    color: C.mossBri, border: "#c5e0c040",     label: "NEW" },
    inactive: { bg: "#55555515",    color: C.textMute, border: "#55555540",    label: "INACTIVE" },
    retired:  { bg: "#55555515",    color: C.textMute, border: "#55555540",    label: "RETIRED" },
  };
  const s = map[status] || map.inactive;
  return <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: s.color, background: s.bg, border: `1px solid ${s.border}`, padding: "2px 7px", borderRadius: 4 }}>{s.label}</span>;
}

export const inputStyle = {
  width: "100%", background: C.bgDeep, border: `1px solid ${C.border}`,
  borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 12.5, outline: "none",
};
export const submitBtn = {
  width: "100%", background: C.moss, border: "none", color: C.bgDeep, borderRadius: 10,
  padding: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 10,
};
export const ghostBtn = {
  flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.textDim,
  borderRadius: 10, padding: 12, fontSize: 12, cursor: "pointer",
};
export const addBtnStyle = {
  background: `${C.moss}15`, border: `1px solid ${C.moss}40`, color: C.mossBri,
  borderRadius: 999, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
  display: "flex", alignItems: "center", gap: 4,
};

export function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: C.textDim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 9.5, color: C.textMute, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{hint}</div>}
    </div>
  );
}

export function SectionHeader({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 10px" }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2.5, color: C.textDim }}>{children}</span>
      {right}
    </div>
  );
}
