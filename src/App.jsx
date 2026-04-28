import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { deriveKey, isValidNsec, isValidNpub, randomNsec, shortNpub } from "./crypto.js";
import { loadState, saveState } from "./storage.js";
import { api } from "./api.js";
import {
  C, I, TRANSPORTS,
  Copyable, Toast, Modal, StatusBadge, Field, SectionHeader,
  inputStyle, submitBtn, ghostBtn, addBtnStyle,
} from "./ui.jsx";

// ---------- Archetype icon guesser (mirrors prototype) ----------
const NODE_ARCHETYPES = [
  { icon: "🛡️", match: /router|home|gateway/i },
  { icon: "☁️", match: /vps|cloud|server/i },
  { icon: "🌸", match: /blossom|media/i },
  { icon: "💻", match: /laptop|desktop/i },
  { icon: "🌳", match: /htree|relay/i },
  { icon: "📱", match: /phone|mobile/i },
  { icon: "🌐", match: /public|gw/i },
];
const iconFor = (title) => NODE_ARCHETYPES.find(a => a.match.test(title))?.icon || "◼";
const randomHex = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// ---------- Utility: derive a node's current (wallet-side) npub ----------
function walletNpubForNode(node, rootSeed, keys) {
  if (!rootSeed) return null;
  if (node.keyId != null) {
    const k = keys.find(k => k.id === node.keyId);
    if (!k) return null;
    try { return deriveKey(rootSeed, node.keyId).npub; } catch { return null; }
  }
  return null;
}
function effectiveNpub(node, rootSeed, keys) {
  return walletNpubForNode(node, rootSeed, keys) || node.externalNpub || null;
}
function fipsAddr(node, rootSeed, keys) {
  const np = effectiveNpub(node, rootSeed, keys);
  return np ? np + ".fips" : null;
}

// Fonts & keyframes that live INSIDE the phone frame.
const GlobalStyles = () => (
  <style>{`
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: ${C.borderHi}; border-radius: 3px; }
    @keyframes fadeUp { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
    @keyframes nodeIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
    @keyframes shimmer { 0%, 100% { opacity: .6; } 50% { opacity: 1; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 0 0 ${C.moss}30; } 50% { box-shadow: 0 0 0 10px ${C.moss}00; } }
    @keyframes driftFog { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(8px, -4px); } }
    input, textarea, select { font-family: inherit; }
  `}</style>
);

// =========================================================================
export default function FanalApp() {
  // --- Load persisted state on boot ---
  const initial = useMemo(loadState, []);
  const [tab, setTab] = useState("wallet");
  const [rootSeed, setRootSeed] = useState(initial.rootSeed || randomNsec());
  const [keys, setKeys] = useState(initial.keys);
  const [keyCounter, setKeyCounter] = useState(initial.keyCounter || 10);
  const [peers, setPeers] = useState(initial.peers);
  const [peerCounter, setPeerCounter] = useState(initial.peerCounter || 3);
  const [nodes, setNodes] = useState(initial.nodes);
  const [nodeCounter, setNodeCounter] = useState(initial.nodeCounter || 3);
  const [apiOk, setApiOk] = useState(null);

  useEffect(() => { saveState({ rootSeed, keys, keyCounter, peers, peerCounter, nodes, nodeCounter }); },
    [rootSeed, keys, keyCounter, peers, peerCounter, nodes, nodeCounter]);

  useEffect(() => { api.health().then(() => setApiOk(true)).catch(() => setApiOk(false)); }, []);

  // --- UI helper state ---
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [expandedNode, setExpandedNode] = useState(initial.nodes[0]?.id || null);

  const showToast = useCallback((message, kind = "info") => setToast({ message, kind, at: Date.now() }), []);

  // --- Key / wallet ops ---
  const deriveNewKey = () => {
    const id = keyCounter;
    setKeyCounter(id + 1);
    const k = { id, status: "new", lastDevice: null, createdAt: Date.now() };
    setKeys(prev => [...prev, k]);
    return k;
  };

  // --- Peer ops ---
  const addPeer = (p) => {
    const np = { id: "p" + peerCounter, ...p };
    setPeers(prev => [...prev, np]);
    setPeerCounter(c => c + 1);
    setModal(null);
    showToast(`Peer "${p.alias}" added`);
    return np;
  };
  const removePeer = (id) => {
    setPeers(prev => prev.filter(p => p.id !== id));
    setNodes(prev => prev.map(n => ({
      ...n,
      peerIds: n.peerIds.filter(x => x !== id),
      activePeerId: n.activePeerId === id ? null : n.activePeerId,
    })));
    showToast("Peer removed");
  };

  // --- Node ops ---
  const upsertNode = (nodeId, patch) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, ...patch } : n));
  };
  const attachPeer = (nodeId, peerId) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      if (n.peerIds.includes(peerId)) return n;
      return { ...n, peerIds: [...n.peerIds, peerId], activePeerId: n.activePeerId || peerId };
    }));
    setModal(null);
    showToast("Peer attached");
  };
  const detachPeer = (nodeId, peerId) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const rest = n.peerIds.filter(x => x !== peerId);
      return { ...n, peerIds: rest, activePeerId: n.activePeerId === peerId ? (rest[0] || null) : n.activePeerId };
    }));
  };
  const activatePeer = (nodeId, peerId) => {
    upsertNode(nodeId, { activePeerId: peerId });
    showToast("Active peer set — will take effect on next apply");
  };
  const addNode = ({ title, keyId, externalNpub, peerId }) => {
    const nn = {
      id: "n" + nodeCounter, title, icon: iconFor(title), online: null,
      keyId: keyId ?? null, externalNpub: externalNpub ?? null,
      platform: "unknown", peerIds: peerId ? [peerId] : [], activePeerId: peerId || null,
      ssh: { host: "", port: 22, user: "root", authMode: "password", password: "" },
    };
    setNodes(prev => [...prev, nn]);
    setNodeCounter(c => c + 1);
    if (keyId != null) {
      setKeys(prev => prev.map(k => k.id === keyId ? { ...k, status: "active" } : k));
    }
    setModal(null);
    setExpandedNode(nn.id);
    showToast(`Node "${title}" planted`);
  };

  // =======================================================================
  // Render
  // =======================================================================
  const tabs = [
    { id: "wallet",   label: "Wallet", Ic: I.Wallet },
    { id: "nodes",    label: "Nodes",  Ic: I.Nodes },
    { id: "peers",    label: "Peers",  Ic: I.Peers },
    { id: "topology", label: "Topo",   Ic: I.Topology },
    { id: "chat",     label: "Chat",   Ic: I.Chat },
  ];

  // --- Chat state (ClaudeCode → ssh root@<npub>.fips) ---
  const [chatTarget, setChatTarget] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [chatInput, setChatInput] = useState("");
  const sendChat = () => {
    if (!chatInput.trim() || !chatTarget) return;
    const node = nodes.find(n => n.id === chatTarget);
    const addr = fipsAddr(node, rootSeed, keys) || "unknown.fips";
    const text = chatInput.trim();
    const now = Date.now();
    setChatInput("");
    setChatMessages(prev => {
      const list = prev[chatTarget] || [];
      return { ...prev, [chatTarget]: [...list, { from: "me", text, ts: now }] };
    });
    setTimeout(() => {
      setChatMessages(prev => {
        const list = prev[chatTarget] || [];
        return { ...prev, [chatTarget]: [...list, { from: "claude", text: `→ ssh root@${addr} ‹interpreting›`, meta: true, ts: Date.now() }] };
      });
    }, 300);
    setTimeout(() => {
      const reply = simulateClaudeCodeResponse(text, node, addr);
      setChatMessages(prev => {
        const list = prev[chatTarget] || [];
        return { ...prev, [chatTarget]: [...list, { from: "node", text: reply, ts: Date.now() }] };
      });
    }, 900);
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: C.bgDeep, color: C.text, fontFamily: "'Space Grotesk', sans-serif", position: "relative", overflow: "hidden" }}>
      <GlobalStyles/>

      {/* STATUS BAR */}
      <StatusBar apiOk={apiOk} nodes={nodes} keys={keys}/>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px", position: "relative", zIndex: 1 }}>
        {tab === "nodes" && (
          <NodesTab
            nodes={nodes} setNodes={setNodes} keys={keys} setKeys={setKeys} peers={peers}
            rootSeed={rootSeed} expandedNode={expandedNode} setExpandedNode={setExpandedNode}
            showToast={showToast} openModal={setModal}
            attachPeer={attachPeer} detachPeer={detachPeer} activatePeer={activatePeer}
            deriveNewKey={deriveNewKey}
          />
        )}
        {tab === "wallet" && (
          <WalletTab
            rootSeed={rootSeed} setRootSeed={setRootSeed}
            keys={keys} setKeys={setKeys} keyCounter={keyCounter} setKeyCounter={setKeyCounter}
            nodes={nodes} showToast={showToast}
          />
        )}
        {tab === "peers" && (
          <PeersTab peers={peers} nodes={nodes} onAdd={() => setModal({ type: "addPeer" })} onRemove={removePeer}/>
        )}
        {tab === "topology" && (
          <TopologyView
            nodes={nodes} peers={peers} rootSeed={rootSeed} keys={keys}
            onChatNode={(id) => { setChatTarget(id); setTab("chat"); }}
          />
        )}
        {tab === "chat" && (
          <ChatView
            nodes={nodes} rootSeed={rootSeed} keys={keys}
            chatTarget={chatTarget} setChatTarget={setChatTarget}
            chatMessages={chatMessages} chatInput={chatInput}
            setChatInput={setChatInput} sendChat={sendChat}
          />
        )}
      </div>

      {/* MODALS */}
      {modal?.type === "addNode" && (
        <AddNodeModal
          onClose={() => setModal(null)} onAdd={addNode}
          peers={peers} deriveNewKey={deriveNewKey}
        />
      )}
      {modal?.type === "addPeer" && (
        <AddPeerModal onClose={() => setModal(null)} onAdd={addPeer}/>
      )}
      {modal?.type === "attachPeer" && (() => {
        const target = nodes.find(n => n.id === modal.nodeId);
        const available = peers.filter(p => !target?.peerIds.includes(p.id));
        return (
          <Modal title="Attach Peer to Node" onClose={() => setModal(null)}>
            {available.map(p => {
              const tr = TRANSPORTS[p.transport] || { icon: "🌐", name: p.transport };
              return (
                <button key={p.id} onClick={() => attachPeer(modal.nodeId, p.id)} style={{ width: "100%", background: C.bgElev, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: C.text, textAlign: "left" }}>
                  <span style={{ fontSize: 18 }}>{tr.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>{p.alias} {p.public && <I.Globe/>}</div>
                    <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{tr.name} · {p.transport === "ethernet" ? p.iface : `${p.addr}:${p.port}`}</div>
                  </div>
                </button>
              );
            })}
            {available.length === 0 && <div style={{ color: C.textMute, fontSize: 12, textAlign: "center", padding: 16 }}>All peers already attached.</div>}
          </Modal>
        );
      })()}
      {modal?.type === "credentials" && (
        <CredentialsModal node={nodes.find(n => n.id === modal.nodeId)}
          onClose={() => setModal(null)}
          onSave={(ssh) => { upsertNode(modal.nodeId, { ssh }); setModal(null); showToast("Credentials saved"); }}/>
      )}
      {modal?.type === "rotate" && (
        <RotateModal
          node={nodes.find(n => n.id === modal.nodeId)}
          rootSeed={rootSeed} keys={keys}
          onClose={() => setModal(null)}
          onKeyDerived={(k) => setKeys(prev => prev.some(x => x.id === k.id) ? prev : [...prev, k])}
          onAllocateIndex={() => { const id = keyCounter; setKeyCounter(id + 1); return id; }}
          onCommit={(nodeId, newKeyId, newNpub) => {
            setKeys(prev => {
              const exists = prev.some(k => k.id === newKeyId);
              const rebuilt = exists ? prev : [...prev, { id: newKeyId, status: "new", lastDevice: null, createdAt: Date.now() }];
              return rebuilt.map(k => {
                if (k.id === newKeyId) return { ...k, status: "active", lastDevice: null };
                const n = nodes.find(nn => nn.id === nodeId);
                if (n && k.id === n.keyId) return { ...k, status: "inactive", lastDevice: n.title };
                return k;
              });
            });
            setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, keyId: newKeyId, externalNpub: null,
              ssh: { ...n.ssh, host: newNpub + ".fips" } } : n));
            showToast("✓ Rotated — SSH host updated to new .fips address");
          }}
          showToast={showToast}
        />
      )}
      {modal?.type === "configure" && (
        <ConfigureModal
          node={nodes.find(n => n.id === modal.nodeId)}
          peers={peers} rootSeed={rootSeed} keys={keys}
          onClose={() => setModal(null)}
          showToast={showToast}
        />
      )}

      {/* TAB BAR */}
      <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 8px 14px",
        borderTop: `1px solid ${C.border}`, background: "rgba(8, 16, 12, .85)", backdropFilter: "blur(8px)", position: "relative", zIndex: 2 }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "none", border: "none", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 3, cursor: "pointer", color: active ? C.mossBri : C.textMute,
              padding: "4px 8px", position: "relative",
            }}>
              {active && <div style={{ position: "absolute", top: -9, width: 22, height: 2, background: C.moss, borderRadius: 1, boxShadow: `0 0 10px ${C.moss}` }}/>}
              <t.Ic/>
              <span style={{ fontSize: 9.5, fontWeight: active ? 600 : 400, letterSpacing: 0.5 }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {toast && <Toast message={toast.message} kind={toast.kind} onDone={() => setToast(null)} key={toast.at}/>}
    </div>
  );
}

// ===== Status bar ========================================================
function StatusBar({ apiOk, nodes, keys }) {
  const up = nodes.filter(n => n.online).length;
  const active = keys.filter(k => k.status === "active").length;
  return (
    <div style={{
      padding: "14px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center",
      borderBottom: `1px solid ${C.border}`, position: "relative", zIndex: 2, background: "rgba(8, 16, 12, .6)", backdropFilter: "blur(8px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20, filter: "drop-shadow(0 0 8px rgba(154, 194, 154, .4))" }}>🌳</span>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase", color: C.mossBri, fontFamily: "'Unbounded', sans-serif", textShadow: `0 0 12px ${C.moss}40` }}>FANAL</span>
      </div>
      <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%",
          background: apiOk === true ? C.moss : apiOk === false ? C.danger : C.textMute,
          boxShadow: apiOk === true ? `0 0 8px ${C.moss}` : "none" }}/>
        <span>api {apiOk === null ? "…" : apiOk ? "up" : "down"}</span>
        <span style={{ color: C.textMute }}>·</span>
        <span>{up}/{nodes.length} up</span>
        <span style={{ color: C.textMute }}>·</span>
        <span>{active} keys</span>
      </div>
    </div>
  );
}

// ===== Nodes tab =========================================================
function NodesTab({ nodes, keys, peers, rootSeed, expandedNode, setExpandedNode, showToast, openModal, attachPeer, detachPeer, activatePeer, setNodes }) {
  const [probing, setProbing] = useState({});  // nodeId → bool

  const probeNode = async (node) => {
    if (!node.ssh?.host) {
      showToast("Set SSH credentials first", "warn");
      openModal({ type: "credentials", nodeId: node.id });
      return;
    }
    setProbing(p => ({ ...p, [node.id]: true }));
    try {
      const creds = buildCreds(node.ssh);
      const r = await api.probe(creds);
      if (!r.ok) throw new Error(r.error || "probe failed");
      setNodes(prev => prev.map(n => n.id === node.id ? {
        ...n, online: true, platform: r.platform.layout.platform,
        lastProbe: { ts: Date.now(), status: r.status.status.slice(0, 4000), peers: r.status.peers, transports: r.status.transports, uname: r.platform.uname, yaml: r.yaml },
      } : n));
      showToast(`✓ ${node.title} reachable (${r.platform.layout.platform})`);
    } catch (e) {
      setNodes(prev => prev.map(n => n.id === node.id ? { ...n, online: false, lastProbe: { ts: Date.now(), error: e.message } } : n));
      showToast(`✗ ${node.title}: ${e.message}`, "error");
    } finally { setProbing(p => ({ ...p, [node.id]: false })); }
  };

  const pingNode = async (node) => {
    const addr = fipsAddr(node, rootSeed, keys);
    if (!addr) return showToast("No .fips address for node", "warn");
    showToast(`ping6 ${addr.slice(0, 20)}…`);
    try {
      const r = await api.ping(addr, 4000);
      showToast(r.ok ? `✓ ${addr.slice(0, 18)}… up (${r.elapsedMs}ms)` : `✗ ping timeout`, r.ok ? "info" : "warn");
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div style={{ paddingBottom: 16 }}>
      <SectionHeader right={<button onClick={() => openModal({ type: "addNode" })} style={addBtnStyle}><I.Plus/> Add Node</button>}>
        My Nodes · {nodes.length}
      </SectionHeader>
      {nodes.map((node, i) => (
        <NodeCard
          key={node.id} node={node} rootSeed={rootSeed} keys={keys} peers={peers}
          expanded={expandedNode === node.id}
          probing={!!probing[node.id]}
          onToggle={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
          onProbe={() => probeNode(node)}
          onPing={() => pingNode(node)}
          onEditCreds={() => openModal({ type: "credentials", nodeId: node.id })}
          onRotate={() => openModal({ type: "rotate", nodeId: node.id })}
          onConfigure={() => openModal({ type: "configure", nodeId: node.id })}
          onAttachPeer={() => openModal({ type: "attachPeer", nodeId: node.id })}
          onDetachPeer={(pid) => detachPeer(node.id, pid)}
          onActivatePeer={(pid) => activatePeer(node.id, pid)}
          animDelay={i * 0.05}
        />
      ))}
      {nodes.length === 0 && (
        <div style={{ fontSize: 12, color: C.textMute, fontStyle: "italic", textAlign: "center", padding: 24 }}>
          No nodes yet. (Demo ships with two; clear localStorage fanal.state.v1 to restore.)
        </div>
      )}
    </div>
  );
}

function buildCreds(ssh) {
  const out = { host: ssh.host, port: ssh.port || 22, user: ssh.user || "root" };
  if (ssh.authMode === "password") out.password = ssh.password;
  else if (ssh.authMode === "key") { out.privateKey = ssh.privateKey; if (ssh.passphrase) out.passphrase = ssh.passphrase; }
  else if (ssh.authMode === "agent") { /* ssh2 falls back to agent via env */ }
  return out;
}

// ===== NodeCard ==========================================================
function NodeCard({ node, rootSeed, keys, peers, expanded, probing, onToggle, onProbe, onPing, onEditCreds, onRotate, onConfigure, onAttachPeer, onDetachPeer, onActivatePeer, animDelay }) {
  const key = keys.find(k => k.id === node.keyId);
  const np = effectiveNpub(node, rootSeed, keys);
  const attached = node.peerIds.map(pid => peers.find(p => p.id === pid)).filter(Boolean);
  const activePeer = peers.find(p => p.id === node.activePeerId);
  const activeTr = activePeer ? TRANSPORTS[activePeer.transport] : null;
  const statusDot = node.online === true ? C.moss : node.online === false ? C.danger : C.textMute;
  const platformBadge = node.platform || node.ssh?.authMode === "password" ? "opnsense" : null;

  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${node.online ? C.moss + "25" : C.border}`,
      borderRadius: 14, marginBottom: 10, overflow: "hidden",
      animation: `nodeIn .3s ease ${animDelay}s both`,
      boxShadow: node.online ? `0 0 20px ${C.moss}08` : "none",
    }}>
      <div onClick={onToggle} style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: C.bgElev, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, filter: node.online ? "none" : "grayscale(.6) opacity(.6)" }}>{node.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {node.title}
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusDot, boxShadow: node.online ? `0 0 8px ${statusDot}` : "none", animation: node.online ? "shimmer 2.5s infinite" : "none" }}/>
            {node.platform && (
              <span style={{ fontSize: 8, fontWeight: 700, color: C.mossDim, background: C.bgElev, border: `1px solid ${C.border}`, padding: "1px 6px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase" }}>{node.platform}</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {np ? shortNpub(np) + ".fips" : "no identity"}
          </div>
          {activeTr && (
            <div style={{ fontSize: 10, color: activeTr.color, marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
              <span>{activeTr.icon}</span><span>{activePeer.alias}</span>
            </div>
          )}
        </div>
        <div style={{ color: C.textMute, transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}><I.ChevDown/></div>
      </div>

      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ marginTop: 10, background: C.bgDeep, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <I.Key/>
              <span style={{ fontSize: 10, color: C.textDim }}>{key ? `Key #${key.id}` : "external"}</span>
              {np && <Copyable text={np}/>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <I.Terminal/>
              <span style={{ fontSize: 10, color: C.textDim }}>ssh</span>
              <span style={{ fontSize: 10.5, color: C.fogDim, fontFamily: "'JetBrains Mono', monospace" }}>
                {node.ssh?.user}@{node.ssh?.host ? shortNpub(node.ssh.host) : "(not set)"}
              </span>
              <button onClick={onEditCreds} style={{ marginLeft: "auto", background: "none", border: "none", color: C.mossDim, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>edit</button>
            </div>
            {node.lastProbe && !node.lastProbe.error && (
              <div style={{ fontSize: 9.5, color: C.mossDim, fontFamily: "'JetBrains Mono', monospace" }}>
                probed {timeAgo(node.lastProbe.ts)} · {node.lastProbe.uname?.split("\n")[0] || "ok"}
              </div>
            )}
            {node.lastProbe?.error && (
              <div style={{ fontSize: 9.5, color: C.danger, fontFamily: "'JetBrains Mono', monospace" }}>
                last error: {node.lastProbe.error.slice(0, 90)}
              </div>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1.5, color: C.textMute }}>Peers · {attached.length}</span>
              <button onClick={onAttachPeer} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 999, padding: "2px 10px", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><I.Plus/> Attach</button>
            </div>
            {attached.length === 0 && <div style={{ fontSize: 10, color: C.textMute, fontStyle: "italic", padding: "4px 0" }}>— no wallet-attached peers (probe to see live ones) —</div>}
            {attached.map(p => {
              const active = node.activePeerId === p.id;
              const tr = TRANSPORTS[p.transport];
              return (
                <div key={p.id} onClick={() => !active && onActivatePeer(p.id)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px",
                  borderRadius: 8, background: active ? `${tr.color}12` : "transparent",
                  border: `1px solid ${active ? tr.color + "30" : "transparent"}`, marginBottom: 3, cursor: active ? "default" : "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13 }}>{tr.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: active ? tr.color : C.text }}>{p.alias}</div>
                      <div style={{ fontSize: 9, color: C.textMute, fontFamily: "'JetBrains Mono', monospace" }}>
                        {tr.name} · {p.transport === "ethernet" ? p.iface : `${p.addr}:${p.port}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {active ? <span style={{ fontSize: 9, fontWeight: 700, color: tr.color, letterSpacing: 1 }}>● ACTIVE</span> : <span style={{ fontSize: 9, color: C.textMute, letterSpacing: 1 }}>tap to activate</span>}
                    <button onClick={(e) => { e.stopPropagation(); onDetachPeer(p.id); }} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", padding: 2, opacity: 0.4 }}><I.Trash/></button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Last probe snapshot */}
          {node.lastProbe && !node.lastProbe.error && node.lastProbe.peers && (
            <div style={{ marginTop: 10, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 9, color: C.textMute, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>Live peers (fipsctl show peers)</div>
              <pre style={{ margin: 0, fontSize: 9.5, color: C.mossDim, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, overflow: "auto", maxHeight: 120 }}>{node.lastProbe.peers.slice(0, 1200) || "(empty)"}</pre>
            </div>
          )}

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button onClick={onProbe} disabled={probing} style={{ ...ghostBtn, padding: 10, flex: "unset", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: probing ? 0.5 : 1 }}>
              {probing ? <Spinner/> : "↯"} SSH Probe
            </button>
            <button onClick={onPing} style={{ ...ghostBtn, padding: 10, flex: "unset", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              ◯ Ping .fips
            </button>
            <button onClick={onConfigure} style={{ ...ghostBtn, padding: 10, flex: "unset", color: C.mossBri, borderColor: C.moss + "30" }}>
              ≡ Transport & Peers
            </button>
            <button onClick={onRotate} style={{ ...ghostBtn, padding: 10, flex: "unset", color: C.warn, borderColor: C.warn + "30" }}>
              ⟳ Rotate Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 10, height: 10, border: `2px solid ${C.border}`, borderTopColor: C.moss, borderRadius: "50%", animation: "spin 1s linear infinite" }}/>;
}

function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ===== Wallet tab ========================================================
function WalletTab({ rootSeed, setRootSeed, keys, setKeys, keyCounter, setKeyCounter, nodes, showToast }) {
  const [showRoot, setShowRoot] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (!isValidNsec(draft)) return showToast("Invalid nsec (bech32 checksum failed)", "error");
    setRootSeed(draft.trim());
    setEditing(false);
    showToast("✓ Root seed updated — keys re-derived");
  };

  const newKey = () => {
    const id = keyCounter;
    setKeyCounter(id + 1);
    setKeys(prev => [...prev, { id, status: "new", lastDevice: null, createdAt: Date.now() }]);
    showToast(`Key #${id} derived (HKDF-SHA256)`);
  };

  return (
    <div style={{ paddingBottom: 16 }}>
      <SectionHeader>Root Private Key · HKDF-SHA256</SectionHeader>
      <div style={{ background: C.bgCard, border: `1px solid ${editing ? C.moss + "60" : C.border}`, borderRadius: 14, padding: "14px 16px", transition: "border-color .2s" }}>
        {editing ? (
          <div>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="nsec1..." onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
              style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: isValidNsec(draft) ? C.mossBri : C.danger, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}/>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
              <button onClick={commit} disabled={!isValidNsec(draft)} style={{ ...submitBtn, margin: 0, opacity: isValidNsec(draft) ? 1 : 0.4 }}>Update & Re-derive</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: showRoot ? C.warn : C.textMute }}>
              {showRoot ? rootSeed : "•".repeat(32)}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setDraft(rootSeed); setEditing(true); }} style={{ background: "none", border: "none", color: C.mossDim, cursor: "pointer", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>EDIT</button>
              <button onClick={() => setShowRoot(!showRoot)} style={{ background: "none", border: "none", color: showRoot ? C.warn : C.textDim, cursor: "pointer" }}>{showRoot ? <I.EyeOff/> : <I.Eye/>}</button>
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 9.5, color: C.textMute, marginTop: 6, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.7 }}>
        HKDF-SHA256(ikm=root, salt="fips-backup-v1",<br/>
        &nbsp;info="fips-backup/v1/index/&lt;n&gt;/try/0") → 32B scalar<br/>
        Index 0 = root key itself. Identical to <code>fips_keygen.py</code>.
      </div>

      <SectionHeader right={<button onClick={newKey} style={addBtnStyle}><I.Plus/> Derive</button>}>
        Derived Keys · {keys.length}
      </SectionHeader>

      {keys.map((k, i) => <KeyRow key={k.id} k={k} rootSeed={rootSeed} nodes={nodes} i={i}/>)}
      {keys.length === 0 && <div style={{ fontSize: 11, color: C.textMute, fontStyle: "italic", textAlign: "center", padding: 14 }}>No derived keys yet. Tap Derive to add one.</div>}
    </div>
  );
}

function KeyRow({ k, rootSeed, nodes, i }) {
  const [reveal, setReveal] = useState(false);
  const derived = useMemo(() => {
    try { return deriveKey(rootSeed, k.id); } catch { return null; }
  }, [rootSeed, k.id]);
  const node = nodes.find(n => n.keyId === k.id);
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${k.status === "active" ? C.moss + "25" : C.border}`,
      borderRadius: 14, padding: "14px 16px", marginBottom: 10,
      animation: `nodeIn .3s ease ${i * 0.04}s both`, boxShadow: k.status === "active" ? `0 0 20px ${C.moss}08` : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, hsl(${120 + (k.id * 13) % 40},40%,25%), hsl(${110 + (k.id * 13) % 30},30%,15%))`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: C.mossBri,
            fontFamily: "'JetBrains Mono', monospace",
          }}>/{k.id}</div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>Key #{k.id} <StatusBadge status={k.status}/></div>
            <div style={{ fontSize: 9.5, color: C.textDim, marginTop: 2 }}>
              {node && <>→ {node.icon} {node.title}</>}
              {!node && k.status === "new" && <>unassigned</>}
              {!node && k.status === "inactive" && k.lastDevice && <>last used on: {k.lastDevice}</>}
            </div>
          </div>
        </div>
        <button onClick={() => setReveal(!reveal)} style={{ background: "none", border: "none", color: reveal ? C.moss : C.textMute, cursor: "pointer", padding: 4 }}>
          {reveal ? <I.Eye/> : <I.EyeOff/>}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.moss, width: 34, textTransform: "uppercase", letterSpacing: 1 }}>npub</span>
          <Copyable text={derived?.npub || "(derivation failed)"}/>
        </div>
        {reveal && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.danger, width: 34, textTransform: "uppercase", letterSpacing: 1 }}>nsec</span>
          <Copyable text={derived?.nsec || ""}/>
        </div>}
      </div>
    </div>
  );
}

// ===== Peers tab =========================================================
function PeersTab({ peers, nodes, onAdd, onRemove }) {
  return (
    <div style={{ paddingBottom: 16 }}>
      <SectionHeader right={<button onClick={onAdd} style={addBtnStyle}><I.Plus/> Add Peer</button>}>
        Peers · {peers.length}
      </SectionHeader>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 16 }}>
        {Object.entries(TRANSPORTS).map(([tid, t]) => {
          const count = peers.filter(p => p.transport === tid).length;
          return (
            <div key={tid} style={{ background: C.bgCard, border: `1px solid ${count > 0 ? t.color + "30" : C.border}`, borderRadius: 10, padding: "8px 4px", textAlign: "center", opacity: t.working ? 1 : 0.45 }}>
              <div style={{ fontSize: 16 }}>{t.icon}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: t.color, marginTop: 2 }}>{t.name}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: count > 0 ? t.color : C.textMute }}>{count}</div>
              {!t.working && <div style={{ fontSize: 7, color: C.textMute, letterSpacing: 1 }}>SOON</div>}
            </div>
          );
        })}
      </div>

      {peers.map(p => (
        <div key={p.id} style={{ background: C.bgCard, border: `1px solid ${TRANSPORTS[p.transport].color}20`, borderRadius: 12, padding: "12px 14px", marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 18 }}>{TRANSPORTS[p.transport].icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                  {p.alias}{p.public && <I.Globe/>}
                  <span style={{ fontSize: 9, color: TRANSPORTS[p.transport].color, textTransform: "uppercase", letterSpacing: 1 }}>{TRANSPORTS[p.transport].name}</span>
                </div>
                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                  {p.transport === "ethernet" ? `iface: ${p.iface}` : `${p.addr}:${p.port}`}
                </div>
                {p.transport === "ethernet"
                  ? <div style={{ fontSize: 9.5, color: C.textMute, marginTop: 3, fontStyle: "italic" }}>autodiscovery · no npub</div>
                  : <div style={{ fontSize: 9.5, color: C.textMute, marginTop: 3 }}><Copyable text={p.npub}/></div>}
              </div>
            </div>
            <button onClick={() => onRemove(p.id)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", padding: 4, opacity: 0.5 }}><I.Trash/></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Topology view =====================================================
function TopologyView({ nodes, peers, rootSeed, keys, onChatNode }) {
  const [detail, setDetail] = useState(null);
  const publicPeers = peers.filter(p => p.public);

  const W = 360, H = 360;
  const cx = W / 2, cy = H / 2 - 10;
  const innerR = 75, outerR = 140;

  const nodePos = {};
  nodes.forEach((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    nodePos[n.id] = { x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a) };
  });
  const peerPos = {};
  publicPeers.forEach((p, i) => {
    const a = (i / Math.max(publicPeers.length, 1)) * Math.PI * 2 - Math.PI / 3;
    peerPos[p.id] = { x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a) };
  });

  const links = [];
  nodes.forEach(n => {
    n.peerIds.forEach(pid => {
      const peer = peers.find(p => p.id === pid);
      if (!peer) return;
      const destNode = nodes.find(nn => nn.id !== n.id && effectiveNpub(nn, rootSeed, keys) === peer.npub);
      const destPos = destNode ? nodePos[destNode.id] : peerPos[pid];
      if (!destPos) return;
      links.push({ from: nodePos[n.id], to: destPos, peer, active: n.activePeerId === pid, bothOnline: n.online && (destNode ? destNode.online : true), seed: n.id + pid });
    });
  });

  const branchPath = (a, b, seed) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return "";
    const nx = -dy / len, ny = dx / len;
    let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) & 0xff;
    const sway = ((s % 30) - 15);
    const c1x = a.x + dx * 0.33 + nx * sway;
    const c1y = a.y + dy * 0.33 + ny * sway;
    const c2x = a.x + dx * 0.66 + nx * sway * 0.6;
    const c2y = a.y + dy * 0.66 + ny * sway * 0.6;
    return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
  };

  const twigs = (a, b, seed) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) return [];
    const nx = -dy / len, ny = dx / len;
    let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) & 0xff;
    const result = [];
    for (let t = 0.3; t < 0.8; t += 0.25) {
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const sign = ((s >> Math.floor(t * 8)) & 1) ? 1 : -1;
      const twigLen = 6 + (s % 6);
      result.push({ x1: px, y1: py, x2: px + nx * twigLen * sign, y2: py + ny * twigLen * sign });
    }
    return result;
  };

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ padding: "20px 0 10px" }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2.5, color: C.textDim }}>Forest Topology · Fanal Grove</span>
      </div>

      <div style={{ background: `linear-gradient(180deg, ${C.bgCard} 0%, #0a1610 100%)`, border: `1px solid ${C.border}`, borderRadius: 16, padding: 6, marginBottom: 12, position: "relative", overflow: "hidden" }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
          <defs>
            <pattern id="dotgrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="0.5" fill={C.borderHi}/>
            </pattern>
            <filter id="fog" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="12" result="b"/>
            </filter>
            <filter id="softblur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5"/>
            </filter>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.moss} stopOpacity="0.08"/>
              <stop offset="100%" stopColor={C.moss} stopOpacity="0"/>
            </radialGradient>
            <radialGradient id="fogPatch" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.fog} stopOpacity="0.12"/>
              <stop offset="100%" stopColor={C.fog} stopOpacity="0"/>
            </radialGradient>
          </defs>

          <rect width={W} height={H} fill="url(#dotgrid)"/>
          <circle cx={cx} cy={cy} r="110" fill="url(#centerGlow)"/>

          <g filter="url(#fog)" opacity="0.8">
            <circle cx="80" cy="60" r="50" fill={C.fog} opacity="0.08"/>
            <circle cx="300" cy="100" r="60" fill={C.mossBri} opacity="0.05"/>
            <circle cx="320" cy="280" r="55" fill={C.fog} opacity="0.07"/>
            <circle cx="60" cy="300" r="70" fill={C.mossBri} opacity="0.04"/>
          </g>

          <g style={{ animation: "driftFog 14s ease-in-out infinite" }} opacity="0.5">
            <circle cx="180" cy="180" r="80" fill="url(#fogPatch)"/>
          </g>

          {links.map((l, i) => {
            const tr = TRANSPORTS[l.peer.transport] || { color: C.mossDim, dash: "3 4" };
            const path = branchPath(l.from, l.to, l.seed);
            const isDormant = !l.active || !l.bothOnline;
            const dash = tr.dash || "none";
            return (
              <g key={i} filter={isDormant ? "url(#softblur)" : "none"} opacity={isDormant ? 0.4 : 1}>
                <path d={path} stroke={tr.color} strokeWidth={l.active ? 5 : 3} fill="none" opacity="0.15" strokeLinecap="round"/>
                <path d={path} stroke={tr.color} strokeWidth={l.active ? 1.8 : 1} fill="none" strokeLinecap="round" strokeDasharray={dash}/>
                {l.active && twigs(l.from, l.to, l.seed).map((t, ti) => (
                  <line key={ti} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={tr.color} strokeWidth="0.8" opacity="0.6" strokeLinecap="round"/>
                ))}
              </g>
            );
          })}

          {nodes.map(n => {
            const pos = nodePos[n.id];
            const dim = !n.online;
            return (
              <g key={n.id} style={{ cursor: "pointer" }} onClick={() => setDetail({ type: "node", id: n.id })}
                filter={dim ? "url(#softblur)" : "url(#glow)"} opacity={dim ? 0.55 : 1}>
                {n.online && <circle cx={pos.x} cy={pos.y} r="30" fill={C.moss} opacity="0.06"/>}
                <circle cx={pos.x} cy={pos.y} r="22" fill={C.bgCard} stroke={n.online ? C.moss : C.mossDim} strokeWidth="1.5"/>
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="16">{n.icon}</text>
                <text x={pos.x} y={pos.y + 36} textAnchor="middle" fill={dim ? C.textMute : C.mossBri} fontSize="9" fontFamily="Space Grotesk" fontWeight="500">{n.title.length > 12 ? n.title.slice(0, 11) + "…" : n.title}</text>
                <circle cx={pos.x + 14} cy={pos.y - 14} r="3.5" fill={n.online ? C.moss : C.danger}/>
              </g>
            );
          })}

          {publicPeers.map(p => {
            const pos = peerPos[p.id];
            const tr = TRANSPORTS[p.transport] || { color: C.mossDim, icon: "🌐", name: "peer" };
            return (
              <g key={p.id} style={{ cursor: "pointer" }} onClick={() => setDetail({ type: "peer", id: p.id })} opacity="0.85">
                <circle cx={pos.x} cy={pos.y} r="14" fill={C.bgCard} stroke={tr.color} strokeWidth="1" strokeDasharray="2 2"/>
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="10">🌐</text>
                <text x={pos.x} y={pos.y + 25} textAnchor="middle" fill={tr.color} fontSize="8" fontFamily="JetBrains Mono">{p.alias.length > 14 ? p.alias.slice(0, 13) + "…" : p.alias}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12, fontSize: 10 }}>
        {Object.entries(TRANSPORTS).filter(([, t]) => t.working).map(([tid, t]) => (
          <div key={tid} style={{ display: "flex", alignItems: "center", gap: 4, color: t.color }}>
            <svg width="22" height="4"><line x1="0" y1="2" x2="22" y2="2" stroke={t.color} strokeWidth="1.8" strokeLinecap="round" strokeDasharray={t.dash || "none"}/></svg>
            {t.name}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.textMute, marginLeft: "auto" }}><span style={{ filter: "blur(.8px)" }}>◯</span> offline (fogged)</div>
      </div>

      {detail?.type === "node" && (() => {
        const node = nodes.find(n => n.id === detail.id);
        if (!node) return null;
        const np = effectiveNpub(node, rootSeed, keys);
        return (
          <div style={{ background: C.bgCard, border: `1px solid ${C.moss}25`, borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{node.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{node.title}</div>
                  <div style={{ fontSize: 10, color: node.online ? C.moss : C.danger }}>{node.online ? "● Online" : "○ Offline"}</div>
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", color: C.textMute, cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            {np && <div style={{ fontSize: 11, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><I.Key/><Copyable text={np}/></div>}
            <button onClick={() => onChatNode(node.id)} style={{ width: "100%", background: C.moss + "15", border: `1px solid ${C.moss}40`, color: C.mossBri, borderRadius: 10, padding: 8, fontSize: 12, cursor: "pointer", marginTop: 6 }}>Chat with node →</button>
          </div>
        );
      })()}
      {detail?.type === "peer" && (() => {
        const p = peers.find(x => x.id === detail.id);
        if (!p) return null;
        const tr = TRANSPORTS[p.transport] || { color: C.mossDim, icon: "🌐", name: "peer" };
        return (
          <div style={{ background: C.bgCard, border: `1px solid ${tr.color}30`, borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{tr.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{p.alias} {p.public && <I.Globe/>}</div>
                  <div style={{ fontSize: 10, color: tr.color }}>{tr.name} peer</div>
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", color: C.textMute, cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{p.transport === "ethernet" ? `iface: ${p.iface}` : `${p.addr}:${p.port}`}</div>
            <div style={{ marginTop: 4 }}><Copyable text={p.npub}/></div>
          </div>
        );
      })()}
    </div>
  );
}

// ===== Chat view =========================================================
function ChatView({ nodes, rootSeed, keys, chatTarget, setChatTarget, chatMessages, chatInput, setChatInput, sendChat }) {
  if (!chatTarget) {
    return (
      <div style={{ paddingBottom: 16 }}>
        <div style={{ padding: "20px 0 10px" }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2.5, color: C.textDim }}>Node Conversations</span>
        </div>
        <div style={{ background: C.bgCard, border: `1px dashed ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 10.5, color: C.textDim, display: "flex", alignItems: "center", gap: 8 }}>
          <I.Terminal/><span>Messages routed via ClaudeCode → <code style={{ color: C.mossBri, fontSize: 10 }}>ssh root@&lt;npub&gt;.fips</code></span>
        </div>
        {nodes.length === 0 && <div style={{ textAlign: "center", color: C.textMute, padding: 32, fontSize: 12 }}>No nodes yet. Plant one in the Nodes tab.</div>}
        {nodes.map(n => {
          const msgs = chatMessages[n.id] || [];
          const last = msgs[msgs.length - 1];
          const np = effectiveNpub(n, rootSeed, keys);
          return (
            <div key={n.id} onClick={() => setChatTarget(n.id)} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.bgElev, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, position: "relative", filter: n.online ? "none" : "grayscale(.5) opacity(.6)" }}>
                {n.icon}
                <div style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: n.online ? C.moss : C.danger, border: `2px solid ${C.bgCard}` }}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                {np && <div style={{ fontSize: 9.5, color: C.textMute, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortNpub(np)}.fips</div>}
                {last && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last.text.split("\n")[0]}</div>}
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMute} strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          );
        })}
      </div>
    );
  }

  const node = nodes.find(n => n.id === chatTarget);
  const np = node ? effectiveNpub(node, rootSeed, keys) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0 10px", borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setChatTarget(null)} style={{ background: "none", border: "none", color: C.mossBri, cursor: "pointer", padding: 4 }}><I.Back/></button>
        <span style={{ fontSize: 22 }}>{node?.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{node?.title}
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: node?.online ? C.moss : C.danger }}/>
          </div>
          <div style={{ fontSize: 9.5, color: C.textMute, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{np ? shortNpub(np) : ""}.fips</div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
        {(chatMessages[chatTarget] || []).length === 0 && (
          <div style={{ textAlign: "center", color: C.textMute, padding: 28, fontSize: 11, lineHeight: 1.6 }}>
            Speak a natural-language command. ClaudeCode parses intent, SSHes to the node.<br/>
            <span style={{ color: C.mossDim }}>Try: "restart DNS", "show peers", "check uptime"</span>
          </div>
        )}
        {(chatMessages[chatTarget] || []).map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.from === "me" ? "flex-end" : "flex-start", maxWidth: "82%" }}>
            {msg.meta ? (
              <div style={{ fontSize: 10, color: C.textMute, fontFamily: "'JetBrains Mono', monospace", padding: "4px 10px", opacity: 0.7, whiteSpace: "pre-line" }}>{msg.text}</div>
            ) : (
              <div style={{ background: msg.from === "me" ? C.moss + "15" : C.bgCard, border: `1px solid ${msg.from === "me" ? C.moss + "30" : C.border}`, borderRadius: msg.from === "me" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "10px 13px", whiteSpace: "pre-line" }}>
                {msg.from === "node" && <div style={{ fontSize: 9, color: C.moss, marginBottom: 4, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>◉ {node?.title}</div>}
                <div style={{ fontSize: 12.5, fontFamily: msg.from === "node" ? "'JetBrains Mono', monospace" : "inherit", color: msg.from === "node" ? C.mossBri : C.text }}>{msg.text}</div>
                <div style={{ fontSize: 9, color: C.textMute, marginTop: 4, textAlign: "right" }}>{new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder="Message via ClaudeCode…" style={{ flex: 1, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none" }}/>
        <button onClick={sendChat} style={{ background: C.moss, border: "none", borderRadius: 12, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.bgDeep }}><I.Send/></button>
      </div>
    </div>
  );
}

// ===== Simulated ClaudeCode response =====================================
function simulateClaudeCodeResponse(input, node, addr) {
  const s = input.toLowerCase();
  if (!node) return "Error: no target node";
  const shortAddr = addr.length > 22 ? addr.slice(0, 14) + "…" : addr;
  if (/restart|reload/.test(s) && /dns/.test(s))
    return `$ systemctl restart fips-dns\n✓ Stopped fips-dns.service\n✓ Started fips-dns.service\n✓ Listening on 127.0.0.1:5354\nDone.`;
  if (/peer|connect/.test(s) && /show|list|status/.test(s))
    return `$ fipsctl show peers\nNPUB              TRANSPORT  STATE\n${shortAddr}  udp:2121   LISTEN\nfips.v0l.io       tcp:8443   ACTIVE\nfips-test-node    udp:2121   ACTIVE`;
  if (/uptime|status/.test(s))
    return `$ uptime && fipsctl show status\nup 14 days, 3:22, load 0.12 0.18 0.14\nfips daemon: RUNNING · pid 1847\ntun: fips0 UP mtu 1280\ndns: 127.0.0.1:5354 listening`;
  if (/restart/.test(s))
    return `$ systemctl restart fips\n✓ fips.service restarted (pid 2104)`;
  if (/log|tail/.test(s))
    return `$ journalctl -u fips -n 5\n[INF] peer ${shortAddr} handshake ok\n[INF] transport udp bind 0.0.0.0:2121\n[INF] tun fips0 up, mtu 1280\n[DBG] relay loop tick\n[INF] gossip advertising 2 addresses`;
  if (/config|yaml/.test(s))
    return `$ cat /etc/fips/fips.yaml | head -20\n# managed by Fanal\nnode:\n  identity:\n    persistent: true\ntun:\n  enabled: true\n  name: fips0\ntransports:\n  udp:\n    bind_addr: "0.0.0.0:2121"`;
  if (/help/.test(s))
    return `ClaudeCode commands understood:\n• restart dns / restart\n• show peers / show status\n• uptime\n• tail logs\n• show config`;
  return `$ ClaudeCode interpreted: "${input}"\n→ Sent to ${node.title} via ssh root@${shortAddr}\n✓ Executed. No output.`;
}

// ===== Credentials modal =================================================
function CredentialsModal({ node, onClose, onSave }) {
  const [ssh, setSsh] = useState({
    host: node?.ssh?.host || "",
    port: node?.ssh?.port || 22,
    user: node?.ssh?.user || "root",
    authMode: node?.ssh?.authMode || "password",
    password: node?.ssh?.password || "",
    privateKey: node?.ssh?.privateKey || "",
    passphrase: node?.ssh?.passphrase || "",
  });
  return (
    <Modal title={`SSH Credentials · ${node?.title}`} onClose={onClose} maxHeight="90vh">
      <Field label="Host (must be a .fips address)"><input value={ssh.host} onChange={e => setSsh({ ...ssh, host: e.target.value })} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}/></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <Field label="Port"><input type="number" value={ssh.port} onChange={e => setSsh({ ...ssh, port: Number(e.target.value) || 22 })} style={inputStyle}/></Field>
        <Field label="User"><input value={ssh.user} onChange={e => setSsh({ ...ssh, user: e.target.value })} style={inputStyle}/></Field>
      </div>
      <Field label="Auth">
        <div style={{ display: "flex", gap: 6 }}>
          {["password", "key", "agent"].map(m => (
            <button key={m} onClick={() => setSsh({ ...ssh, authMode: m })} style={{
              flex: 1, background: ssh.authMode === m ? C.moss + "15" : "transparent",
              border: `1px solid ${ssh.authMode === m ? C.moss + "40" : C.border}`,
              color: ssh.authMode === m ? C.mossBri : C.textDim, borderRadius: 8, padding: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>{m}</button>
          ))}
        </div>
      </Field>
      {ssh.authMode === "password" && (
        <Field label="Password"><input type="password" value={ssh.password} onChange={e => setSsh({ ...ssh, password: e.target.value })} style={inputStyle}/></Field>
      )}
      {ssh.authMode === "key" && (
        <>
          <Field label="Private key (paste OpenSSH-format)" hint="Stored in browser localStorage (demo). Prefer 'agent' for production.">
            <textarea value={ssh.privateKey} onChange={e => setSsh({ ...ssh, privateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…" rows={6} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, resize: "vertical" }}/>
          </Field>
          <Field label="Passphrase (if any)"><input type="password" value={ssh.passphrase} onChange={e => setSsh({ ...ssh, passphrase: e.target.value })} style={inputStyle}/></Field>
        </>
      )}
      {ssh.authMode === "agent" && (
        <div style={{ fontSize: 11, color: C.textDim, background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
          Uses your local <code style={{ color: C.moss, fontSize: 10 }}>ssh-agent</code> (env <code style={{ color: C.moss, fontSize: 10 }}>SSH_AUTH_SOCK</code>).
          Load your key first: <code style={{ color: C.moss, fontSize: 10, display: "block", marginTop: 4 }}>ssh-add ~/.ssh/id_ed25519</code>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
        <button onClick={() => onSave(ssh)} style={{ ...submitBtn, flex: 2, margin: 0 }}>Save</button>
      </div>
    </Modal>
  );
}

// ===== Rotate modal ======================================================
// Three-stage flow: preview → apply → verify (ping .fips).
function RotateModal({ node, rootSeed, keys, onClose, onCommit, onAllocateIndex, showToast }) {
  const [stage, setStage] = useState("preview");      // preview | applying | applied | verify | done | error
  const [plan, setPlan] = useState(null);
  const [execLog, setExecLog] = useState([]);
  const [newKey, setNewKey] = useState(null);
  const [newIndex, setNewIndex] = useState(null);
  const [err, setErr] = useState(null);
  const [verifyLog, setVerifyLog] = useState("");

  // Allocate a fresh wallet index for the rotation on first mount.
  useEffect(() => {
    const idx = onAllocateIndex();
    setNewIndex(idx);
    try { setNewKey(deriveKey(rootSeed, idx)); } catch (e) { setErr(e.message); }
  }, []);

  const preview = async () => {
    setErr(null); setStage("loading");
    try {
      const creds = buildCreds(node.ssh);
      const r = await api.rotateKey({ creds, rootNsec: rootSeed, newIndex, apply: false });
      if (!r.ok) throw new Error(r.error || "preview failed");
      setPlan(r.plan);
      setStage("preview");
    } catch (e) { setErr(e.message); setStage("error"); }
  };

  useEffect(() => { if (newIndex != null) preview(); /* eslint-disable-line */ }, [newIndex]);

  const apply = async () => {
    setStage("applying"); setErr(null);
    try {
      const creds = buildCreds(node.ssh);
      const r = await api.rotateKey({ creds, rootNsec: rootSeed, newIndex, apply: true });
      setExecLog(r.execLog || []);
      if (!r.ok) throw new Error(r.error || "apply failed");
      setStage("applied");
    } catch (e) {
      // Expected: SSH drops mid-restart. Treat most errors here as "probably ok, verify next".
      setExecLog(l => [...l, { step: "ssh-dropped", output: e.message }]);
      setStage("applied");
    }
  };

  const verify = async () => {
    setStage("verify"); setVerifyLog("");
    const target = newKey.npub + ".fips";
    const deadline = Date.now() + 60000;
    let ok = false;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      setVerifyLog(v => v + `\n[${attempt}] ping6 ${shortNpub(target)}…`);
      try {
        const r = await api.ping(target, 4000);
        if (r.ok) {
          setVerifyLog(v => v + `   ✓ ${r.elapsedMs}ms`);
          ok = true; break;
        }
        setVerifyLog(v => v + `   timeout`);
      } catch (e) {
        setVerifyLog(v => v + `   err: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (ok) {
      onCommit(node.id, newIndex, newKey.npub);
      setStage("done");
    } else {
      setErr("Verification timed out after 60s. The device may still be coming up; ping manually.");
      setStage("error");
    }
  };

  if (!node || !newKey) return null;
  const curAddr = node.ssh?.host || "(unset)";
  const newAddr = newKey.npub + ".fips";

  return (
    <Modal title={`Rotate · ${node.title}`} onClose={onClose} maxHeight="92vh">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 9, color: C.textMute, letterSpacing: 1.5, marginBottom: 4 }}>CURRENT</div>
          <div style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", color: C.fogDim, wordBreak: "break-all" }}>{shortNpub(curAddr)}</div>
        </div>
        <div style={{ background: C.bgDeep, border: `1px solid ${C.moss}40`, borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 9, color: C.mossDim, letterSpacing: 1.5, marginBottom: 4 }}>NEW · index #{newIndex}</div>
          <div style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", color: C.mossBri, wordBreak: "break-all" }}>{shortNpub(newAddr)}</div>
        </div>
      </div>

      {stage === "loading" && <div style={{ textAlign: "center", padding: 20, color: C.textDim, fontSize: 12 }}><Spinner/> probing…</div>}

      {stage === "preview" && plan && (
        <>
          <div style={{ background: C.warn + "10", border: `1px solid ${C.warn}30`, borderRadius: 10, padding: 10, marginBottom: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ color: C.warn }}><I.Warning/></div>
            <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>
              The SSH session will drop the moment the daemon restarts. Fanal will verify the new address via ping6. Ensure you have an out-of-band recovery path (console/LAN) before applying.
            </div>
          </div>
          <PlanView plan={plan}/>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
            <button onClick={apply} style={{ ...submitBtn, flex: 2, margin: 0, background: C.warn, color: C.bgDeep }}>Apply rotation</button>
          </div>
        </>
      )}

      {(stage === "applying" || stage === "applied") && (
        <div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            {stage === "applying" ? "executing…" : "rotation applied — session dropped as expected"}
          </div>
          <ExecLogView log={execLog}/>
          {stage === "applied" && (
            <button onClick={verify} style={{ ...submitBtn, marginTop: 12 }}>Verify new identity (ping6)</button>
          )}
        </div>
      )}

      {stage === "verify" && (
        <div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>Polling ping6 against <code style={{ color: C.moss }}>{shortNpub(newAddr)}</code> up to 60s…</div>
          <pre style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 10.5, color: C.mossDim, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap", margin: 0, maxHeight: 220, overflow: "auto" }}>{verifyLog || "starting…"}</pre>
        </div>
      )}

      {stage === "done" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: 28, color: C.moss, marginBottom: 10 }}>✓</div>
          <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>Rotation complete.</div>
          <div style={{ fontSize: 10.5, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>{newAddr}</div>
          <button onClick={onClose} style={{ ...submitBtn, marginTop: 14 }}>Close</button>
        </div>
      )}

      {stage === "error" && (
        <div>
          <div style={{ background: C.danger + "10", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: 10, fontSize: 11, color: C.danger, marginBottom: 10 }}>{err}</div>
          <ExecLogView log={execLog}/>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
            <button onClick={preview} style={{ ...submitBtn, flex: 2, margin: 0 }}>Retry preview</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PlanView({ plan }) {
  return (
    <div style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 9, color: C.mossDim, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>Plan · {plan.platform}</div>
      <pre style={{ margin: 0, fontSize: 10, color: C.mossBri, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {plan.steps.join("\n")}
      </pre>
    </div>
  );
}

function ExecLogView({ log }) {
  if (!log?.length) return null;
  return (
    <div style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, maxHeight: 240, overflow: "auto" }}>
      {log.map((entry, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, color: C.mossDim, letterSpacing: 1.5, textTransform: "uppercase" }}>→ {entry.step}</div>
          <pre style={{ margin: 0, fontSize: 10, color: C.fogDim, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap" }}>{String(entry.output).slice(0, 600)}</pre>
        </div>
      ))}
    </div>
  );
}

// ===== Configure (transport & peers) modal ===============================
function ConfigureModal({ node, peers, rootSeed, keys, onClose, showToast }) {
  const [stage, setStage] = useState("edit");    // edit | preview | applying | done | error
  const [selectedPeerIds, setSelectedPeerIds] = useState(node.peerIds);
  const [previewYaml, setPreviewYaml] = useState("");
  const [oldYaml, setOldYaml] = useState("");
  const [execLog, setExecLog] = useState([]);
  const [err, setErr] = useState(null);

  const chosenPeers = peers.filter(p => selectedPeerIds.includes(p.id));
  const ownedKey = node.keyId != null; // wallet owns this node's identity
  const canAct = !!node.ssh?.host;

  const buildBody = (apply) => {
    const body = { creds: buildCreds(node.ssh), peers: chosenPeers, apply };
    // Only send identity material if the wallet owns this node's key — avoids
    // accidentally writing key #0 to an external node if no yaml exists yet.
    if (ownedKey) { body.rootNsec = rootSeed; body.nodeIndex = node.keyId; }
    return body;
  };

  const doPreview = async () => {
    if (!canAct) { setErr("Set SSH credentials for this node first."); setStage("error"); return; }
    setErr(null); setStage("loading");
    try {
      const r = await api.updateConfig(buildBody(false));
      if (!r.ok) throw new Error(r.error || "preview failed");
      setPreviewYaml(r.yaml || "");
      setOldYaml(r.oldYaml || "");
      setStage("preview");
    } catch (e) { setErr(e.message); setStage("error"); }
  };

  const apply = async () => {
    if (!canAct) { setErr("Set SSH credentials for this node first."); setStage("error"); return; }
    setStage("applying");
    try {
      const r = await api.updateConfig(buildBody(true));
      setExecLog(r.execLog || []);
      setStage("done");
      showToast("✓ Config applied — daemon restarted");
    } catch (e) {
      setExecLog(l => [...l, { step: "err", output: e.message }]);
      setErr(e.message);
      setStage("error");
    }
  };

  if (stage === "edit") return (
    <Modal title={`Transport & Peers · ${node.title}`} onClose={onClose} maxHeight="92vh">
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.6, marginBottom: 12 }}>
        Select which peers this node should carry. Transports are derived from the peer set. Preview the YAML before applying.
      </div>
      <div style={{ marginBottom: 12 }}>
        {peers.map(p => {
          const tr = TRANSPORTS[p.transport];
          const checked = selectedPeerIds.includes(p.id);
          return (
            <div key={p.id} onClick={() => setSelectedPeerIds(prev => checked ? prev.filter(x => x !== p.id) : [...prev, p.id])} style={{
              display: "flex", alignItems: "center", gap: 10, padding: 10,
              background: checked ? tr.color + "10" : C.bgDeep, border: `1px solid ${checked ? tr.color + "40" : C.border}`,
              borderRadius: 10, marginBottom: 6, cursor: "pointer",
            }}>
              <span style={{ fontSize: 18 }}>{tr.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.text, display: "flex", alignItems: "center", gap: 4 }}>{p.alias}{p.public && <I.Globe/>}</div>
                <div style={{ fontSize: 10, color: C.textMute, fontFamily: "'JetBrains Mono', monospace" }}>{tr.name} · {p.transport === "ethernet" ? p.iface : `${p.addr}:${p.port}`}</div>
              </div>
              <div style={{ width: 18, height: 18, border: `1.5px solid ${checked ? tr.color : C.border}`, borderRadius: 4, background: checked ? tr.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: checked ? C.bgDeep : "transparent", fontWeight: 800, fontSize: 13 }}>✓</div>
            </div>
          );
        })}
      </div>
      {!canAct && (
        <div style={{ background: C.warn + "15", border: `1px solid ${C.warn}40`, color: C.warn, borderRadius: 10, padding: 10, fontSize: 11, marginBottom: 10 }}>
          ⚠ No SSH credentials on this node — set host/password before previewing.
        </div>
      )}
      {!ownedKey && (
        <div style={{ background: C.textDim + "10", border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 10, padding: 10, fontSize: 11, marginBottom: 10 }}>
          External node (no wallet key). Identity will be preserved; requires existing yaml on the device.
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
        <button onClick={doPreview} disabled={!canAct} style={{ ...submitBtn, flex: 2, margin: 0, opacity: canAct ? 1 : 0.4 }}>Preview YAML</button>
      </div>
    </Modal>
  );

  if (stage === "loading") return (
    <Modal title={`Configure · ${node.title}`} onClose={onClose}>
      <div style={{ textAlign: "center", padding: 30, color: C.textDim, fontSize: 12 }}><Spinner/> fetching yaml from node…</div>
    </Modal>
  );

  if (stage === "preview") return (
    <Modal title="Preview · fips.yaml" onClose={onClose} maxHeight="92vh">
      <pre style={{ background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontSize: 10, color: C.mossBri, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, whiteSpace: "pre", overflow: "auto", maxHeight: 360, margin: 0 }}>{previewYaml}</pre>
      <div style={{ fontSize: 10, color: C.textMute, margin: "8px 0 12px", fontFamily: "'JetBrains Mono', monospace" }}>
        ← atomic write + {node.platform === "opnsense" ? "configctl fipsbackup restart" : "/etc/init.d/fips restart"}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setStage("edit")} style={ghostBtn}>Back</button>
        <button onClick={apply} style={{ ...submitBtn, flex: 2, margin: 0 }}>Apply</button>
      </div>
    </Modal>
  );

  if (stage === "applying") return (
    <Modal title="Applying…" onClose={() => {}}>
      <div style={{ textAlign: "center", padding: 30, color: C.textDim, fontSize: 12 }}><Spinner/> writing yaml + restarting daemon…</div>
    </Modal>
  );

  if (stage === "done") return (
    <Modal title={`✓ Applied`} onClose={onClose}>
      <div style={{ fontSize: 12, color: C.text, marginBottom: 10 }}>Config applied. The daemon has been restarted; re-probe to see new peer state.</div>
      <ExecLogView log={execLog}/>
      <button onClick={onClose} style={{ ...submitBtn, marginTop: 12 }}>Close</button>
    </Modal>
  );

  return (
    <Modal title="Error" onClose={onClose}>
      <div style={{ background: C.danger + "10", border: `1px solid ${C.danger}40`, borderRadius: 10, padding: 10, fontSize: 11, color: C.danger, marginBottom: 10 }}>{err}</div>
      <ExecLogView log={execLog}/>
      <button onClick={onClose} style={{ ...submitBtn, marginTop: 10 }}>Close</button>
    </Modal>
  );
}

// ===== Add-node modal ====================================================
function AddNodeModal({ onClose, onAdd, peers, deriveNewKey }) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("create"); // "create" | "manual"
  const [manualNpub, setManualNpub] = useState("");
  const [peerId, setPeerId] = useState(null);
  const [scanning, setScanning] = useState(false);

  const manualValid = isValidNpub(manualNpub.trim());
  const nodeIdPreview = mode === "create"
    ? "(new key will be derived)"
    : (manualValid ? manualNpub.trim() + ".fips" : "enter a valid npub");

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (mode === "create") {
      const k = deriveNewKey();
      onAdd({ title: title.trim(), keyId: k.id, peerId });
    } else {
      if (!manualValid) return;
      onAdd({ title: title.trim(), externalNpub: manualNpub.trim(), peerId });
    }
  };

  const simulateScan = () => {
    setScanning(true);
    setTimeout(() => {
      const fake = "npub1" + randomHex(58);
      setManualNpub(fake);
      setScanning(false);
    }, 1400);
  };

  const canSubmit = !!title.trim() && (mode === "create" || manualValid);

  return (
    <Modal title="Add Device to the Grove" onClose={onClose}>
      <Field label="Device Title">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Kitchen Router" style={inputStyle}/>
      </Field>

      <Field label="FIPS Node ID (<npub>.fips)">
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button onClick={() => setMode("create")} style={{ flex: 1, background: mode === "create" ? C.moss + "15" : "transparent", border: `1px solid ${mode === "create" ? C.moss + "40" : C.border}`, color: mode === "create" ? C.mossBri : C.textDim, borderRadius: 8, padding: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌱 Create new</button>
          <button onClick={() => setMode("manual")} style={{ flex: 1, background: mode === "manual" ? C.moss + "15" : "transparent", border: `1px solid ${mode === "manual" ? C.moss + "40" : C.border}`, color: mode === "manual" ? C.mossBri : C.textDim, borderRadius: 8, padding: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✎ Enter manually</button>
        </div>

        {mode === "manual" && (
          <div style={{ position: "relative" }}>
            <input value={manualNpub} onChange={e => setManualNpub(e.target.value)} placeholder="npub1..." style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, paddingRight: 40, borderColor: manualNpub && !manualValid ? C.danger + "60" : C.border }}/>
            <button onClick={simulateScan} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: C.bgElev, border: `1px solid ${C.border}`, color: C.moss, borderRadius: 6, padding: 6, cursor: "pointer", display: "flex", alignItems: "center" }} title="Scan QR"><I.QR/></button>
            {scanning && <div style={{ marginTop: 6, padding: 10, background: C.bgDeep, border: `1px dashed ${C.moss}40`, borderRadius: 8, fontSize: 10, color: C.moss, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>📷 Scanning QR code…</div>}
          </div>
        )}

        <div style={{ fontSize: 9.5, color: C.textMute, fontFamily: "'JetBrains Mono', monospace", marginTop: 6, wordBreak: "break-all" }}>
          {nodeIdPreview.length > 50 ? nodeIdPreview.slice(0, 40) + "…fips" : nodeIdPreview}
        </div>
      </Field>

      <Field label="Initial Peer (optional)">
        <select value={peerId ?? ""} onChange={e => setPeerId(e.target.value || null)} style={inputStyle}>
          <option value="">— disconnected (root node) —</option>
          {peers.map(p => <option key={p.id} value={p.id}>{(TRANSPORTS[p.transport] || {}).icon || "🌐"} {p.alias} · {(TRANSPORTS[p.transport] || {}).name || p.transport}</option>)}
        </select>
      </Field>

      <button onClick={handleSubmit} disabled={!canSubmit} style={{ ...submitBtn, opacity: canSubmit ? 1 : 0.4 }}>Plant Node</button>
    </Modal>
  );
}

// ===== Add-peer modal ====================================================
function AddPeerModal({ onClose, onAdd }) {
  const [step, setStep] = useState(0);
  const [transport, setTransport] = useState(null);
  const [form, setForm] = useState({ npub: "", alias: "", addr: "", port: "", iface: "eth0", public: false });

  useEffect(() => {
    if (transport === "udp") setForm(f => ({ ...f, port: "2121" }));
    if (transport === "tcp") setForm(f => ({ ...f, port: "8443" }));
  }, [transport]);

  if (step === 0) return (
    <Modal title="Select Transport" onClose={onClose}>
      {Object.entries(TRANSPORTS).map(([tid, t]) => (
        <button key={tid} onClick={() => { if (!t.working) return; setTransport(tid); setStep(1); }} disabled={!t.working}
          style={{ width: "100%", background: t.working ? `${t.color}08` : C.bgDeep,
            border: `1px solid ${t.working ? t.color + "20" : C.border}`, borderRadius: 12, padding: "12px 14px",
            marginBottom: 6, display: "flex", alignItems: "center", gap: 12, cursor: t.working ? "pointer" : "not-allowed",
            color: C.text, opacity: t.working ? 1 : 0.4, textAlign: "left" }}>
          <span style={{ fontSize: 22 }}>{t.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.color }}>{t.name}{!t.working && " · soon"}</div>
            <div style={{ fontSize: 10, color: C.textDim }}>{t.desc}</div>
          </div>
        </button>
      ))}
    </Modal>
  );

  const isEthernet = transport === "ethernet";
  const npubOk = isEthernet || isValidNpub(form.npub);
  const canCreate = !!form.alias && npubOk;
  return (
    <Modal title={`${TRANSPORTS[transport].name} Peer`} onClose={onClose}>
      <Field label="Alias"><input value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} placeholder="my-peer-alias" style={inputStyle}/></Field>
      {!isEthernet && (
        <Field label="Peer npub"><input value={form.npub} onChange={e => setForm({ ...form, npub: e.target.value })} placeholder="npub1…" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, borderColor: form.npub && !isValidNpub(form.npub) ? C.danger + "60" : C.border }}/></Field>
      )}
      {(transport === "udp" || transport === "tcp") && (
        <>
          <Field label="Address"><input value={form.addr} onChange={e => setForm({ ...form, addr: e.target.value })} placeholder="217.77.8.91" style={inputStyle}/></Field>
          <Field label="Port"><input value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} type="number" style={inputStyle}/></Field>
        </>
      )}
      {isEthernet && (
        <Field label="Interface" hint="L2 autodiscovery — peers on this interface find each other; no npub needed.">
          <input value={form.iface} onChange={e => setForm({ ...form, iface: e.target.value })} placeholder="eth0" style={inputStyle}/>
        </Field>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer" }}>
        <input type="checkbox" checked={form.public} onChange={e => setForm({ ...form, public: e.target.checked })} style={{ accentColor: C.moss }}/>
        <span style={{ fontSize: 12, color: C.text, display: "flex", alignItems: "center", gap: 4 }}><I.Globe/> Public (topology visible)</span>
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => setStep(0)} style={ghostBtn}>Back</button>
        <button onClick={() => {
          if (!canCreate) return;
          onAdd({
            transport, alias: form.alias,
            npub: isEthernet ? "" : form.npub,
            addr: form.addr,
            port: Number(form.port) || TRANSPORTS[transport].defaultPort,
            iface: form.iface, public: form.public,
          });
        }} disabled={!canCreate} style={{ ...submitBtn, flex: 2, margin: 0, opacity: canCreate ? 1 : 0.4 }}>Create</button>
      </div>
    </Modal>
  );
}
