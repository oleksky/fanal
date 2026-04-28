import { Client as SshClient } from "ssh2";

// Thin promise wrapper over ssh2 exec.
// Opens a connection, runs one-or-more commands, returns { stdout, stderr, code } per command.

export function sshConnect(creds) {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    const cfg = {
      host: creds.host,
      port: creds.port || 22,
      username: creds.user || "root",
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      // Accept any host key on first connection (demo); pin externally for production.
      hostVerifier: () => true,
      // Broaden the algorithm list beyond ssh2 defaults. OPNsense/FreeBSD OpenSSH often
      // negotiates older kex / host-key algorithms that modern ssh2 rejects, which
      // manifests as a silent "timed out while waiting for handshake".
      algorithms: {
        kex: [
          "curve25519-sha256", "curve25519-sha256@libssh.org",
          "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group16-sha512", "diffie-hellman-group18-sha512",
          "diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
          "diffie-hellman-group-exchange-sha1", "diffie-hellman-group1-sha1",
        ],
        serverHostKey: [
          "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
          "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-dss",
        ],
        cipher: [
          "chacha20-poly1305@openssh.com",
          "aes128-gcm", "aes128-gcm@openssh.com", "aes256-gcm", "aes256-gcm@openssh.com",
          "aes128-ctr", "aes192-ctr", "aes256-ctr",
          "aes128-cbc", "aes192-cbc", "aes256-cbc", "3des-cbc",
        ],
        hmac: [
          "hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com",
          "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1", "hmac-sha1-96", "hmac-md5",
        ],
        compress: ["none", "zlib@openssh.com", "zlib"],
      },
    };
    if (creds.password) cfg.password = creds.password;
    if (creds.privateKey) cfg.privateKey = creds.privateKey;
    if (creds.passphrase) cfg.passphrase = creds.passphrase;
    if (creds.debug) cfg.debug = (msg) => console.log(`  ssh2[${creds.host}] ${msg}`);

    client.once("ready", () => resolve(client));
    client.once("error", (err) => reject(new Error(`SSH connect: ${err.message}`)));
    client.connect(cfg);
  });
}

export function sshExec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "", stderr = "", code = null;
      stream.on("close", (exitCode) => {
        code = exitCode;
        resolve({ stdout, stderr, code });
      });
      stream.on("data", (d) => { stdout += d.toString("utf8"); });
      stream.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    });
  });
}

export async function sshClose(client) {
  try { client.end(); } catch {}
}

// ---- Platform detection ----

export async function detectPlatform(client) {
  const { stdout: uname } = await sshExec(client, "uname -s 2>/dev/null; uname -r 2>/dev/null");
  const checks = await sshExec(
    client,
    [
      "test -f /etc/init.d/fips && echo openwrt_init",
      "test -d /usr/local/etc/fips && echo opnsense_dir",
      "test -x /usr/local/sbin/configctl && echo configctl_present",
      "command -v fipsctl >/dev/null 2>&1 && echo fipsctl_present",
    ].join("; "),
  );
  const marks = new Set(checks.stdout.split(/\s+/).filter(Boolean));

  let platform = "unknown";
  if (marks.has("openwrt_init")) platform = "openwrt";
  else if (marks.has("opnsense_dir") && marks.has("configctl_present")) platform = "opnsense";

  const layout = platform === "opnsense"
    ? {
      platform,
      fipsBin: "/usr/local/bin/fips",
      yamlPath: "/usr/local/etc/fips/fips.yaml",
      derivedKeysPath: "/usr/local/etc/fips/derived_keys.json",
      restartCmd: "configctl fipsbackup restart",
      statusCmd: "fipsctl show status",
      peersCmd: "fipsctl show peers",
      transportsCmd: "fipsctl show transports",
      logsCmd: "tail -n 80 /var/log/fips.log 2>/dev/null || echo '(no /var/log/fips.log)'",
    }
    : platform === "openwrt"
      ? {
        platform,
        fipsBin: "/usr/bin/fips",
        yamlPath: "/etc/fips/fips.yaml",
        keyFile: "/etc/fips/fips.key",
        pubFile: "/etc/fips/fips.pub",
        restartCmd: "/etc/init.d/fips restart",
        statusCmd: "fipsctl show status",
        peersCmd: "fipsctl show peers",
        transportsCmd: "fipsctl show transports",
        logsCmd: "logread -e fips | tail -n 80",
      }
      : {
        platform,
        statusCmd: "fipsctl show status 2>/dev/null || echo unknown",
      };

  return { uname: uname.trim(), marks: Array.from(marks), layout };
}

// ---- Status helpers ----

export async function readStatus(client, layout) {
  const [st, peers, transports] = await Promise.all([
    sshExec(client, layout.statusCmd + " 2>&1"),
    layout.peersCmd ? sshExec(client, layout.peersCmd + " 2>&1") : Promise.resolve({ stdout: "" }),
    layout.transportsCmd ? sshExec(client, layout.transportsCmd + " 2>&1") : Promise.resolve({ stdout: "" }),
  ]);
  return {
    status: st.stdout,
    peers: peers.stdout,
    transports: transports.stdout,
  };
}

export async function readYaml(client, layout) {
  if (!layout.yamlPath) return "";
  const { stdout } = await sshExec(client, `cat ${layout.yamlPath}`);
  return stdout;
}

// ---- Atomic write helpers ----

function shellQuoteSingle(s) {
  // Wrap in single quotes, escape internal single quotes.
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

export async function atomicWrite(client, path, content, mode = "0600") {
  const tmp = `${path}.tmp.fanal.$$`;
  // Use `cat > tmp <<'FANAL_EOF'` heredoc with a unique sentinel.
  const sentinel = "FANAL_EOF_" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const cmd = [
    `umask 077`,
    `mkdir -p ${shellQuoteSingle(pathDir(path))}`,
    `cat > ${shellQuoteSingle(tmp)} <<'${sentinel}'`,
    content,
    sentinel,
    `chmod ${mode} ${shellQuoteSingle(tmp)}`,
    `mv ${shellQuoteSingle(tmp)} ${shellQuoteSingle(path)}`,
  ].join("\n");
  const res = await sshExec(client, cmd);
  if (res.code !== 0) throw new Error(`atomicWrite ${path} failed: ${res.stderr || res.stdout}`);
  return res;
}

function pathDir(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export async function backupFile(client, path) {
  const ts = Math.floor(Date.now() / 1000);
  const bak = `${path}.fanal-${ts}.bak`;
  const cmd = `if [ -f ${shellQuoteSingle(path)} ]; then cp -p ${shellQuoteSingle(path)} ${shellQuoteSingle(bak)} && echo backup=${bak}; else echo no-source; fi`;
  const { stdout } = await sshExec(client, cmd);
  return stdout.trim();
}

export async function restartDaemon(client, layout) {
  const res = await sshExec(client, layout.restartCmd + " 2>&1; echo __rc=$?");
  return res.stdout;
}
