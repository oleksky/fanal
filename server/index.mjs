import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import yamlLib from "js-yaml";
import {
  sshConnect, sshExec, sshClose,
  detectPlatform, readStatus, readYaml,
  atomicWrite, backupFile, restartDaemon,
} from "./ssh.mjs";
import { composeYaml, patchYaml } from "./yaml-edit.mjs";
import { deriveKey } from "../src/crypto.js";

const app = express();
app.use(cors({ origin: "http://127.0.0.1:5173" }));
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.FANAL_PORT || 8787);

function logReq(req, extra) {
  const safe = { ...req.body };
  if (safe.creds) safe.creds = { ...safe.creds, password: safe.creds.password ? "***" : undefined, privateKey: safe.creds.privateKey ? "***" : undefined };
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, extra || safe);
}

// --- Health ---
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "fanal", port: PORT }));

// --- Ping6 over .fips from the macOS host ---
// macOS ping6 doesn't support -W the same way Linux does; enforce timeout via kill.
app.post("/api/ping", async (req, res) => {
  const { target, timeoutMs = 5000 } = req.body || {};
  if (!target || !/^[a-z0-9.\-]+$/i.test(target)) return res.status(400).json({ error: "bad target" });
  const started = Date.now();
  const p = spawn("ping6", ["-c", "1", "-i", "1", target]);
  let out = "", err = "", done = false;
  const finish = (payload) => { if (done) return; done = true; try { p.kill("SIGKILL"); } catch {} res.json(payload); };
  p.stdout.on("data", d => out += d.toString());
  p.stderr.on("data", d => err += d.toString());
  p.on("close", (code) => finish({ ok: code === 0, code, elapsedMs: Date.now() - started, stdout: out, stderr: err }));
  p.on("error", (e) => finish({ ok: false, error: e.message, elapsedMs: Date.now() - started }));
  setTimeout(() => finish({ ok: false, code: "timeout", elapsedMs: Date.now() - started, stdout: out, stderr: err || "timed out" }), Math.max(1000, timeoutMs));
});

// --- Detect platform + read status ---
app.post("/api/ssh/probe", async (req, res) => {
  logReq(req);
  const { creds } = req.body || {};
  let client;
  try {
    client = await sshConnect(creds);
    const platform = await detectPlatform(client);
    const status = await readStatus(client, platform.layout);
    const yamlText = await readYaml(client, platform.layout);
    res.json({ ok: true, platform, status, yaml: yamlText });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally { if (client) sshClose(client); }
});

// --- Key rotation ---
// Body: { creds, rootNsec, newIndex }
// Returns: dry run plan (commands + new yaml) OR executes if apply=true.
app.post("/api/ssh/rotate-key", async (req, res) => {
  logReq(req, "<rotate-key>");
  const { creds, rootNsec, newIndex, apply = false } = req.body || {};
  if (!rootNsec || typeof newIndex !== "number") return res.status(400).json({ error: "missing rootNsec/newIndex" });

  const newKey = deriveKey(rootNsec, newIndex);
  let client;
  try {
    client = await sshConnect(creds);
    const platform = await detectPlatform(client);
    const { layout } = platform;
    const oldYaml = await readYaml(client, layout);
    const statusBefore = await readStatus(client, layout);

    const peers = extractPeersFromYaml(oldYaml);
    const newYaml = patchYaml(oldYaml || "node:\n  identity:\n    persistent: true\n", {
      platform: layout.platform, nsec: newKey.nsec, peers, rewriteIdentity: true,
    });

    const plan = {
      platform: layout.platform,
      oldNpubHint: statusBefore.status.slice(0, 400),
      newNpub: newKey.npub,
      steps: buildRotateSteps(layout, newKey, newYaml),
    };

    if (!apply) {
      return res.json({ ok: true, dryRun: true, plan, newKey: { index: newKey.index, npub: newKey.npub } });
    }

    // EXECUTE. After restart, SSH will drop — catch errors but still return plan.
    const execLog = [];
    const bakYaml = layout.yamlPath ? await backupFile(client, layout.yamlPath) : "";
    execLog.push({ step: "backup-yaml", output: bakYaml });
    if (layout.keyFile) {
      const bakKey = await backupFile(client, layout.keyFile);
      execLog.push({ step: "backup-key", output: bakKey });
    }
    if (layout.pubFile) {
      const bakPub = await backupFile(client, layout.pubFile);
      execLog.push({ step: "backup-pub", output: bakPub });
    }

    if (layout.platform === "openwrt") {
      await atomicWrite(client, layout.keyFile, newKey.nsec + "\n", "0600");
      execLog.push({ step: "write-key", output: "ok" });
      await atomicWrite(client, layout.pubFile, newKey.npub + "\n", "0644");
      execLog.push({ step: "write-pub", output: "ok" });
    }
    if (layout.yamlPath) {
      await atomicWrite(client, layout.yamlPath, newYaml, "0600");
      execLog.push({ step: "write-yaml", output: "ok" });
    }

    const restartOut = await restartDaemon(client, layout).catch(e => `(restart error) ${e.message}`);
    execLog.push({ step: "restart", output: restartOut });

    res.json({ ok: true, dryRun: false, plan, execLog, newKey: { index: newKey.index, npub: newKey.npub, nsec: newKey.nsec } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally { if (client) sshClose(client); }
});

// --- Update transports / peers (persistent) ---
// Body: { creds, rootNsec, nodeIndex, peers: [{ npub, alias, transport, addr?, port?, iface? }], apply }
app.post("/api/ssh/update-config", async (req, res) => {
  logReq(req, "<update-config>");
  const { creds, rootNsec, nodeIndex, peers, apply = false } = req.body || {};
  if (!Array.isArray(peers)) return res.status(400).json({ error: "peers must be array" });
  // rootNsec / nodeIndex are only required when there is no existing yaml to patch
  // (i.e. we need to compose a fresh identity from the wallet).
  const canDerive = !!rootNsec && typeof nodeIndex === "number";
  const key = canDerive ? deriveKey(rootNsec, nodeIndex) : null;
  let client;
  try {
    client = await sshConnect(creds);
    const platform = await detectPlatform(client);
    const { layout } = platform;
    const oldYaml = await readYaml(client, layout);

    let patched;
    if (oldYaml) {
      // Identity preserved — this endpoint is for transports/peers only.
      patched = patchYaml(oldYaml, { platform: layout.platform, peers, rewriteIdentity: false });
    } else {
      if (!key) throw new Error("No existing yaml on device and no wallet key to compose identity (node.keyId required).");
      patched = composeYaml({ platform: layout.platform, nsec: key.nsec, peers });
    }

    if (!apply) {
      return res.json({ ok: true, dryRun: true, platform: layout.platform, yaml: patched, oldYaml });
    }

    const execLog = [];
    if (layout.yamlPath) {
      const bak = await backupFile(client, layout.yamlPath);
      execLog.push({ step: "backup-yaml", output: bak });
      await atomicWrite(client, layout.yamlPath, patched, "0600");
      execLog.push({ step: "write-yaml", output: "ok" });
    }
    const restartOut = await restartDaemon(client, layout).catch(e => `(restart error) ${e.message}`);
    execLog.push({ step: "restart", output: restartOut });
    res.json({ ok: true, dryRun: false, platform: layout.platform, yaml: patched, execLog });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally { if (client) sshClose(client); }
});

// --- Ephemeral peer add via fipsctl (no restart) ---
app.post("/api/ssh/fipsctl", async (req, res) => {
  logReq(req, "<fipsctl>");
  const { creds, args } = req.body || {};
  if (!Array.isArray(args)) return res.status(400).json({ error: "args must be array" });
  let client;
  try {
    client = await sshConnect(creds);
    const sanitized = args.map(a => "'" + String(a).replace(/'/g, "'\\''") + "'").join(" ");
    const out = await sshExec(client, `fipsctl ${sanitized} 2>&1`);
    res.json({ ok: true, stdout: out.stdout, code: out.code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally { if (client) sshClose(client); }
});

// --- Key derivation preview (no SSH) ---
app.post("/api/derive", (req, res) => {
  try {
    const { rootNsec, index } = req.body || {};
    const k = deriveKey(rootNsec, index);
    res.json({ ok: true, key: { index: k.index, npub: k.npub, nsec: k.nsec } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// --- Helpers ---
function extractPeersFromYaml(txt) {
  if (!txt) return [];
  try {
    const doc = yamlLib.load(txt) || {};
    return Array.isArray(doc.peers) ? doc.peers.map(p => {
      const addr = (p.addresses || [])[0] || {};
      return {
        npub: p.npub,
        alias: p.alias,
        transport: addr.transport,
        addr: addr.addr ? addr.addr.split(":")[0] : undefined,
        port: addr.addr && addr.addr.includes(":") ? Number(addr.addr.split(":")[1]) : undefined,
        iface: addr.interface,
      };
    }) : [];
  } catch { return []; }
}

function buildRotateSteps(layout, newKey, newYaml) {
  const steps = [];
  steps.push(`# Probe platform: ${layout.platform}`);
  if (layout.yamlPath) steps.push(`cp ${layout.yamlPath} ${layout.yamlPath}.fanal-TS.bak`);
  if (layout.keyFile)  steps.push(`cp ${layout.keyFile}  ${layout.keyFile}.fanal-TS.bak`);
  if (layout.pubFile)  steps.push(`cp ${layout.pubFile}  ${layout.pubFile}.fanal-TS.bak`);
  if (layout.platform === "openwrt") {
    steps.push(`atomic-write ${layout.keyFile} (0600)  <- ${newKey.nsec.slice(0, 10)}…`);
    steps.push(`atomic-write ${layout.pubFile} (0644)  <- ${newKey.npub}`);
  }
  if (layout.yamlPath) steps.push(`atomic-write ${layout.yamlPath} (0600)  <- patched yaml (identity → new nsec)`);
  steps.push(`# Restart`);
  steps.push(layout.restartCmd || "(no restart command)");
  steps.push(`# After restart, the SSH session drops. Phone will verify via ping6 -c1 -W5 ${newKey.npub}.fips`);
  return steps;
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\x1b[32m●\x1b[0m fanal-api listening on http://127.0.0.1:${PORT}`);
  console.log(`  (web dev server proxies /api/* here)`);
});
