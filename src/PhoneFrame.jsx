import { useEffect, useState } from "react";

// A phone-shaped chrome for desktop demos. Shrinks to fullscreen on small viewports.
export default function PhoneFrame({ children }) {
  const [mobile, setMobile] = useState(window.innerWidth < 520);
  useEffect(() => {
    const r = () => setMobile(window.innerWidth < 520);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  if (mobile) {
    return <div style={{ width: "100vw", height: "100vh", background: "#05080a", overflow: "hidden" }}>{children}</div>;
  }

  const frameW = 414;
  const frameH = 880;
  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "radial-gradient(ellipse at 20% 10%, #1a2e25 0%, #05080a 50%), radial-gradient(ellipse at 80% 90%, #11211b 0%, #05080a 60%)",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 56,
      fontFamily: "'Space Grotesk', sans-serif", color: "#9ac29a", padding: 24, boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 360, textAlign: "right" }}>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, fontFamily: "'Unbounded', sans-serif", color: "#c5e0c0", marginBottom: 14, textShadow: "0 0 24px #7fbf9060" }}>FANAL</div>
        <div style={{ fontSize: 13, color: "#8ba595", lineHeight: 1.7, marginBottom: 18 }}>
          A wallet-style manager for your personal fleet of FIPS nodes. Rotate identities. Switch transports. Over SSH. Over the mesh.
        </div>
        <div style={{ fontSize: 11, color: "#6b8a6e", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace" }}>
          <div style={{ marginBottom: 4 }}>· One root seed → all device keys (HKDF-SHA256)</div>
          <div style={{ marginBottom: 4 }}>· Device identity = <code style={{ color: "#9ac29a" }}>&lt;npub&gt;.fips</code></div>
          <div style={{ marginBottom: 4 }}>· Live ops via <code style={{ color: "#9ac29a" }}>configctl</code> / <code style={{ color: "#9ac29a" }}>/etc/init.d/fips</code></div>
          <div>· Atomic writes, signed backups, post-rotate ping verify</div>
        </div>
      </div>

      <div style={{
        width: frameW + 20, height: frameH, background: "#0a0f0c",
        borderRadius: 52, border: "1px solid #1a2e25",
        boxShadow: "0 40px 80px rgba(0,0,0,.6), 0 0 120px rgba(127,191,144,.07), inset 0 0 0 2px #11211b",
        padding: 10, position: "relative",
      }}>
        {/* side buttons */}
        <div style={{ position: "absolute", left: -2, top: 130, width: 3, height: 30, background: "#11211b", borderRadius: 2 }}/>
        <div style={{ position: "absolute", left: -2, top: 180, width: 3, height: 50, background: "#11211b", borderRadius: 2 }}/>
        <div style={{ position: "absolute", left: -2, top: 245, width: 3, height: 50, background: "#11211b", borderRadius: 2 }}/>
        <div style={{ position: "absolute", right: -2, top: 170, width: 3, height: 80, background: "#11211b", borderRadius: 2 }}/>
        {/* notch */}
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          width: 130, height: 30, background: "#05080a", borderRadius: 20, zIndex: 5,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1a2e25" }}/>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#1a2e25" }}/>
        </div>
        <div style={{
          width: frameW, height: frameH - 20, borderRadius: 44, overflow: "hidden",
          background: "#05080a", position: "relative",
        }}>
          {children}
        </div>
      </div>

      <div style={{ maxWidth: 300, fontSize: 11, color: "#6b8a6e", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, color: "#9ac29a", marginBottom: 10 }}>MVP DEMO</div>
        <div style={{ color: "#8ba595", fontSize: 12, marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif" }}>Two features, end-to-end:</div>
        <div style={{ padding: "6px 10px", background: "#0d1814", border: "1px solid #1a2e25", borderRadius: 8, marginBottom: 6 }}>
          <div style={{ color: "#c5e0c0", fontWeight: 700, marginBottom: 2 }}>① Key rotation</div>
          <div style={{ fontSize: 10, color: "#8ba595" }}>derive → backup → write → restart → ping-verify</div>
        </div>
        <div style={{ padding: "6px 10px", background: "#0d1814", border: "1px solid #1a2e25", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ color: "#c5e0c0", fontWeight: 700, marginBottom: 2 }}>② Transport / peer</div>
          <div style={{ fontSize: 10, color: "#8ba595" }}>patch yaml → atomic rename → daemon restart</div>
        </div>
        <div style={{ fontSize: 10, color: "#4a5c52" }}>Two empty node slots are pre-created (OPNsense + OpenWrt). Open each to fill in its <code style={{ color: "#8ba595" }}>&lt;npub&gt;.fips</code> host and SSH credentials. Credentials are stored in browser localStorage — do not use this on a shared machine.</div>
      </div>
    </div>
  );
}
