import yaml from "js-yaml";

// Compose a fresh fips.yaml from the Fanal model. Used when no existing yaml is available
// or when the caller explicitly asks for a clean rewrite.
export function composeYaml({ platform, nsec, peers }) {
  const onOpnsense = platform === "opnsense";
  const doc = {
    node: {
      identity: onOpnsense ? { nsec } : { persistent: true },
      leaf_only: false,
    },
    tun: { enabled: true, name: "fips0", mtu: 1280 },
    dns: { enabled: true, bind_addr: "127.0.0.1", port: 5354 },
    transports: {},
    peers: [],
  };

  const used = new Set(peers.map(p => p.transport));
  if (used.has("udp")) doc.transports.udp = { bind_addr: "0.0.0.0:2121" };
  if (used.has("tcp")) doc.transports.tcp = { bind_addr: "0.0.0.0:8443" };
  if (used.has("ethernet")) {
    const ethP = peers.find(p => p.transport === "ethernet");
    doc.transports.ethernet = {
      interface: ethP?.iface || "eth0",
      discovery: true,
      announce: true,
      auto_connect: true,
      accept_connections: true,
    };
  }
  if (Object.keys(doc.transports).length === 0) {
    doc.transports.udp = { bind_addr: "0.0.0.0:2121" };
  }

  for (const p of peers) {
    if (p.transport === "ethernet") continue; // autodiscovery — no explicit peer entry
    const entry = {
      npub: p.npub,
      alias: p.alias,
      addresses: [],
      connect_policy: "auto_connect",
    };
    if (p.transport === "udp" || p.transport === "tcp") {
      entry.addresses.push({ transport: p.transport, addr: `${p.addr}:${p.port || (p.transport === "udp" ? 2121 : 8443)}` });
    }
    doc.peers.push(entry);
  }

  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

// In-place edit: take the current YAML text and replace peers/transports.
// Identity is preserved unless `rewriteIdentity: true` is passed (e.g. key rotation).
// Preserves unknown keys the operator added (log, dns tweaks, etc.).
export function patchYaml(existingText, { platform, nsec, peers, rewriteIdentity = false }) {
  let doc;
  try { doc = yaml.load(existingText) || {}; } catch (e) { throw new Error("Existing yaml failed to parse: " + e.message); }
  if (!doc.node) doc.node = {};
  if (rewriteIdentity) {
    if (platform === "opnsense") doc.node.identity = { nsec };
    else doc.node.identity = { persistent: true };
  }

  const used = new Set(peers.map(p => p.transport));
  doc.transports = doc.transports || {};
  // Remove any transport we won't emit so stale binds don't linger.
  for (const k of Object.keys(doc.transports)) {
    if (!used.has(k) && ["udp", "tcp", "ethernet"].includes(k)) delete doc.transports[k];
  }
  if (used.has("udp") && !doc.transports.udp) doc.transports.udp = { bind_addr: "0.0.0.0:2121" };
  if (used.has("tcp") && !doc.transports.tcp) doc.transports.tcp = { bind_addr: "0.0.0.0:8443" };
  if (used.has("ethernet")) {
    const ethP = peers.find(p => p.transport === "ethernet");
    doc.transports.ethernet = {
      interface: ethP?.iface || "eth0",
      discovery: true,
      announce: true,
      auto_connect: true,
      accept_connections: true,
    };
  }
  if (Object.keys(doc.transports).length === 0) {
    doc.transports.udp = { bind_addr: "0.0.0.0:2121" };
  }

  doc.peers = peers
    .filter(p => p.transport !== "ethernet") // ethernet = autodiscovery, no pinned peer
    .map(p => {
      const entry = { npub: p.npub, alias: p.alias, addresses: [], connect_policy: "auto_connect" };
      if (p.transport === "udp" || p.transport === "tcp") {
        entry.addresses.push({ transport: p.transport, addr: `${p.addr}:${p.port || (p.transport === "udp" ? 2121 : 8443)}` });
      }
      return entry;
    });

  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}
