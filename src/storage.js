// localStorage-backed state. Stores root seed, node metadata, per-node SSH creds.
// Credentials are NOT encrypted — this is a demo. Do not commit real secrets.
//
// On first launch:
//   - rootSeed is empty here so the app generates a fresh random nsec (see App.jsx:
//     `useState(initial.rootSeed || randomNsec())`). Replace it with your own nsec
//     in the Wallet tab if you want to import an existing identity.
//   - Node entries below are placeholders. Open each node and fill in its
//     `<npub>.fips` host + SSH password / private key via the Credentials modal.

const KEY = "fanal.state.v5";

// Empty seed → App.jsx falls through to randomNsec() on first render, then
// persists the generated value. To import your own identity, paste an
// `nsec1…` in the Wallet tab after launch.
const DEFAULT_ROOT_SEED = "";

const defaults = () => {
  const now = Date.now();
  // Pre-generate 10 keypair slots (indices 0..9). Derivation happens at render time from rootSeed.
  // Index 0 is reserved for the seed-holding device. All slots start as "new" — assign them
  // to nodes as you onboard each device.
  const keys = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    status: "new",
    lastDevice: null,
    createdAt: now - (10 - i) * 3600_000,
  }));

  return {
    rootSeed: DEFAULT_ROOT_SEED,
    keys,
    keyCounter: 10,
    peers: [
      // Public FIPS bootstrap peers (documented in the upstream FIPS README).
      { id: "p1", npub: "npub1zv58cn7v83mxvttl70w5fwjwuclfmntv9cnmv5wmz2nzz88u5urqvdx96n", alias: "fips.v0l.io",     transport: "tcp", addr: "fips.v0l.io",  port: 8443, public: true },
      { id: "p2", npub: "npub1qmc3cvfz0yu2hx96nq3gp55zdan2qclealn7xshgr448d3nh6lks7zel98", alias: "fips-test-node", transport: "udp", addr: "217.77.8.91", port: 2121, public: true },
      // Placeholder rows for transports that are not yet implemented in the
      // FIPS daemon — the UI lists them as "coming soon" and won't generate
      // YAML for them.
      { id: "p3", npub: "npub1mixnet0examplexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",   alias: "nym-relay-01",    transport: "mixnet",     addr: "nym.example.net",    port: 1789, public: true },
      { id: "p4", npub: "npub1bt0dht0examplexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  alias: "bt-dht-bootstrap", transport: "bittorrent", addr: "router.bittorrent.com", port: 6881, public: true },
      { id: "p5", npub: "npub1yt0covert0examplexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", alias: "yt-covert-01",     transport: "youtube",    addr: "yt-chan.example", port: 443, public: false },
    ],
    peerCounter: 6,
    nodes: [
      // Two example node slots — fill in via the Credentials modal in the app.
      // The host MUST be a `<npub>.fips` address; never use a raw IP (see CLAUDE.md).
      {
        id: "n1", title: "Home Router", icon: "🛡️", online: null,
        keyId: 0, externalNpub: null,
        platform: "opnsense", peerIds: [], activePeerId: null,
        ssh: { host: "", port: 22, user: "root", authMode: "password", password: "" },
      },
      {
        id: "n2", title: "VPS", icon: "☁️", online: null,
        keyId: 1, externalNpub: null,
        platform: "openwrt", peerIds: [], activePeerId: null,
        ssh: { host: "", port: 22, user: "root", authMode: "key", privateKey: "", passphrase: "" },
      },
    ],
    nodeCounter: 3,
  };
};

export function loadState() {
  // Purge any prior-version state so HMR can't re-save stale keys under new versions.
  try { for (let i = 1; i < 5; i++) localStorage.removeItem(`fanal.state.v${i}`); } catch {}
  try {
    const raw = localStorage.getItem(KEY);
    const d = defaults();
    if (!raw) return d;
    const parsed = JSON.parse(raw);
    // Always guarantee baseline keys 0..9 are present, then layer in any extras (id >= 10).
    const byId = new Map(d.keys.map(k => [k.id, k]));
    for (const k of (parsed.keys || [])) byId.set(k.id, { ...(byId.get(k.id) || {}), ...k });
    const keys = Array.from(byId.values()).sort((a, b) => a.id - b.id);
    const keyCounter = Math.max(parsed.keyCounter || 0, 10, ...keys.map(k => k.id + 1));
    return { ...d, ...parsed, keys, keyCounter };
  } catch {
    return defaults();
  }
}
export function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
export function resetState() {
  try { localStorage.removeItem(KEY); } catch {}
}
