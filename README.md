# Fanal — FIPS Network Manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-MVP-green.svg)](#status)

A wallet-style manager for a personal fleet of [FIPS](https://github.com/jmcorgan/fips)
nodes. One root seed deterministically derives every device key. Identity
rotation and transport / peer changes are pushed to live nodes over SSH and
verified with an IPv6 ping over the FIPS mesh.

> Fanal is the operator UI on top of FIPS. It is not part of the FIPS
> daemon — it is an SSH client with a UI.

## Overview

A FIPS node's address is its Nostr `npub` — the same key is used for routing,
end-to-end encryption, and `<npub>.fips` DNS. Fanal manages a fleet of these
nodes from a single mobile-shaped UI:

- **Wallet** — one `nsec1…` root seed deterministically derives every node
  key (HKDF-SHA256, byte-identical to the OPNsense FIPS plugin's
  `fips_keygen.py` scheme).
- **Nodes** — each row is a real device (OPNsense or OpenWrt) addressed
  exclusively by `<npub>.fips`. Fanal SSHes in to read state, edit
  `/etc/fips/fips.yaml`, and restart the daemon.
- **Peers** — UDP / TCP / Ethernet (and Tor / BLE on capable nodes)
  connection endpoints. Switching the active peer is presented as a
  disconnect-and-reconnect.
- **Topology** — local nodes inside a ring, public peers outside; active
  links are solid, dormant links dashed.
- **Chat** — natural-language commands routed to a node via
  `ssh root@<npub>.fips` (the MVP simulates ClaudeCode responses; replace
  with a real backend when ready).

The two MVP operations are **identity rotation** and **transport / peer
change**. Both are implemented as `ssh → read state → backup → atomic
write → restart → verify` flows; both expect the SSH session to drop and
reconnect over the new identity / transport.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Vite dev server, http://127.0.0.1:5173)                    │
│    React UI · localStorage · @noble/secp256k1 · @noble/hashes        │
└────────────────────────┬─────────────────────────────────────────────┘
                         │  /api/*  (proxied)
┌────────────────────────▼─────────────────────────────────────────────┐
│  Node API (Express, http://127.0.0.1:8787)                           │
│    ssh2 · js-yaml · ping6                                            │
└────────────────────────┬─────────────────────────────────────────────┘
                         │  ssh root@<npub>.fips
┌────────────────────────▼─────────────────────────────────────────────┐
│  FIPS device                                                         │
│    OpenWrt: /etc/init.d/fips · /etc/fips/fips.{yaml,key,pub}         │
│    OPNsense: configctl fipsbackup · /usr/local/etc/fips/fips.yaml    │
└──────────────────────────────────────────────────────────────────────┘
```

The browser does crypto (key derivation, bech32) and UI; the Node backend
holds the SSH connection (the browser cannot speak SSH). All `<npub>.fips`
hostnames resolve over the host machine's FIPS tunnel — your laptop must be
joined to the same FIPS mesh as the target nodes.

## Requirements

- **Node.js** 20 or newer
- **A FIPS endpoint on the host running Fanal.** Fanal connects to devices
  by `<npub>.fips`, so the laptop running Fanal must be a FIPS node itself
  (or have its DNS resolver pointed at one). See the
  [upstream FIPS install guide](https://github.com/jmcorgan/fips#installation).
- **macOS or Linux.** The dev server binds `127.0.0.1` only. `ping6` is
  used for post-rotate verification — the macOS variant is supported.
- **SSH access to your FIPS devices** as `root` (password or pubkey).
  Credentials are entered in the UI and stored unencrypted in browser
  `localStorage` — treat the host machine as you would any password
  manager.

## Quickstart

```bash
git clone https://github.com/oleksky/fanal.git
cd fanal
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

`npm run dev` starts both processes via `concurrently`:

- `dev:api` — Node backend on `127.0.0.1:8787` (auto-restart with
  `node --watch`)
- `dev:web` — Vite dev server on `127.0.0.1:5173` with `/api/*` proxied to
  the backend

You can also run them separately:

```bash
npm run dev:api   # backend only
npm run dev:web   # frontend only
```

A convenience launcher is provided:

```bash
./start.sh
```

It runs `npm install` on first launch, then `npm run dev`.

### Production build

```bash
npm run build      # static bundle in dist/
npm run preview    # serve dist/ on http://127.0.0.1:4173
```

The Express backend (`server/index.mjs`) is required at runtime — Fanal is
not a static-only app. To deploy, run the API behind a process manager
(systemd, pm2) and serve `dist/` from the same origin (or proxy `/api/*`).

## First-run setup

The first launch starts with **no secrets**:

1. **Wallet → Root seed.** A fresh `nsec1…` is generated locally on first
   render. Either keep it (and back it up — it is the master key for every
   derived device identity) or paste your own existing `nsec` to import a
   wallet you already use.
2. **Nodes.** Two empty placeholder rows are pre-created (`Home Router`
   and `VPS`). Open each, tap **SSH Credentials**, and fill in:
   - **Host** — must be a `<npub>.fips` address. Never use a raw IP. If
     SSH on the FIPS interface is firewalled (typical on OPNsense), open a
     rule allowing TCP/22 inbound on `fips0` first.
   - **Auth** — password (OPNsense) or private key (OpenWrt). The key is
     stored as plaintext PEM in `localStorage`.
3. **Peers.** Two public FIPS bootstrap peers (`fips.v0l.io`,
   `fips-test-node` at `217.77.8.91`) ship as defaults. Add your own from
   the Peers tab; transports flagged "coming soon" (`mixnet`, `bittorrent`,
   `youtube`) are placeholder — Fanal won't generate YAML for them.

To wipe state and start over: in your browser devtools,
`localStorage.removeItem("fanal.state.v5")` and reload.

## How key derivation works

Fanal mirrors the OPNsense FIPS plugin (`fips_keygen.py`) byte-for-byte so
the same `nsec` produces the same node identities everywhere:

```
index 0    → root privkey itself  (the seed-holding device)
index ≥ 1  → HKDF-SHA256(
               IKM  = root privkey (32 bytes raw, NOT bech32),
               salt = ASCII "fips-backup-v1",
               info = ASCII "fips-backup/v1/index/{index}/try/{attempt}",
               L    = 32
             )
```

If the 32-byte output is ≥ secp256k1 group order, `attempt` increments
(in practice never triggers; loop bound is 16). The child npub is the
x-only pubkey (compressed `02`/`03` prefix dropped) bech32-encoded with HRP
`npub`. See `src/crypto.js` and the
[upstream `fips_keygen.py`](https://github.com/oleksky/os-fips-backup) for
the canonical reference.

## Project layout

```
fanal-app/
├── index.html            # Vite entry
├── package.json          # `npm run dev` boots api + web together
├── start.sh              # convenience: install + dev
├── vite.config.js        # /api/* proxied to 127.0.0.1:8787
├── server/
│   ├── index.mjs         # Express routes: /api/health, /api/ping,
│   │                     #   /api/ssh/{probe,rotate-key,update-config,fipsctl},
│   │                     #   /api/derive
│   ├── ssh.mjs           # ssh2 wrapper · platform detection · atomic write
│   └── yaml-edit.mjs     # composeYaml / patchYaml — fips.yaml mutation
└── src/
    ├── main.jsx          # React entry; mounts <PhoneFrame><FanalApp/></>
    ├── App.jsx           # Tabs, modals, all wallet / node / peer logic
    ├── PhoneFrame.jsx    # Mobile-shaped chrome on desktop
    ├── ui.jsx            # Forest-palette primitives + icons
    ├── api.js            # fetch wrapper for /api/*
    ├── crypto.js         # bech32, HKDF, secp256k1 — shared with backend
    └── storage.js        # localStorage default state + migrations
```

## Operations

### Identity rotation (Feature ①)

1. Pre-flight: SSH in, read `fipsctl show status`, capture old npub.
2. Derive new keypair locally from `(rootSeed, newIndex)`.
3. Stage on device: back up `fips.yaml` (and `fips.key`/`fips.pub` on
   OpenWrt), atomically write the new key material.
4. Apply: `configctl fipsbackup restart` (OPNsense) or
   `/etc/init.d/fips restart` (OpenWrt). The current SSH session drops.
5. Verify: poll `ping6 -c 1 <new-npub>.fips` until success or 60 s budget;
   reconnect SSH, assert `fipsctl show status` reports the new npub.

The code path is `POST /api/ssh/rotate-key` (dry-run by default; pass
`apply: true` to execute).

### Transport / peer change (Feature ②)

- **Live (no restart):** `fipsctl connect <npub> <addr:port> <udp|tcp|tor>`
  via `POST /api/ssh/fipsctl` — ephemeral, lost on restart.
- **Persistent:** `POST /api/ssh/update-config` patches `peers:` /
  `transports:` in `fips.yaml`, atomically rewrites it, restarts the
  daemon. The current SSH session may drop if the transport carrying it is
  the one being changed.

## Security notes

- **Never commit your `nsec` or SSH passwords.** This repo ships with empty
  defaults; the `.gitignore` excludes `*.key`, `*.nsec`, `*.pem`,
  `fanal-state.json`. If you fork and add bootstrap secrets, keep them in
  a private branch.
- **Credentials live in browser `localStorage`** in plaintext. Anyone with
  filesystem access to your browser profile can read them. Future work:
  Argon2id-encrypt the wallet on disk.
- **The backend currently accepts any host key on first connection**
  (`hostVerifier: () => true` in `server/ssh.mjs`). Pin host keys before
  production use; mismatch detection is the only protection against MITM
  on the FIPS overlay.
- **All SSH targets must be `<npub>.fips` addresses.** Falling back to a
  LAN IP bypasses FIPS end-to-end encryption and ties the UI to
  transport-specific routing.

## Status

MVP. The two flows above work end-to-end against the reference platforms
(OpenWrt and OPNsense with the FIPS plugin). Known gaps:

- No host-key pinning yet (see above).
- No on-disk encryption of the wallet.
- `mixnet`, `bittorrent`, `youtube` transports are placeholders only.
- The Chat tab simulates ClaudeCode responses; the SSH-backed real
  implementation is in progress.
- No automated tests yet — verify by running `npm run dev` against a
  device.

## Related projects

- [jmcorgan/fips](https://github.com/jmcorgan/fips) — the FIPS daemon and
  protocol Fanal manages.
- [oleksky/os-fips-backup](https://github.com/oleksky/os-fips-backup) —
  OPNsense plugin; canonical source of the `fips_keygen.py` HKDF scheme.

## License

MIT — see [LICENSE](LICENSE).
