// Canonical FIPS key derivation — mirrors os-fips-backup/src/opnsense/scripts/OPNsense/FipsBackup/fips_keygen.py
// byte-for-byte. Shared between browser and Node backend.

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import * as secp from "@noble/secp256k1";

// secp256k1 group order
const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"
);

// ---------------- bech32 (no bech32m) ----------------
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function verifyChecksum(hrp, data) {
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

function createChecksum(hrp, data) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const pm = polymod(values) ^ 1;
  const out = [];
  for (let i = 0; i < 6; i++) out.push((pm >> (5 * (5 - i))) & 31);
  return out;
}

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  for (const v of data) {
    if (v < 0 || (v >> from) !== 0) return null;
    acc = ((acc << from) | v) & maxAcc;
    bits += from;
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
  }
  if (pad) {
    if (bits) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return ret;
}

export function bech32Encode(hrp, data) {
  const data5 = convertBits(Array.from(data), 8, 5, true);
  if (!data5) throw new Error("bech32: convertBits failed");
  const combined = [...data5, ...createChecksum(hrp, data5)];
  return hrp + "1" + combined.map(d => CHARSET[d]).join("");
}

export function bech32Decode(bech) {
  if (!bech || typeof bech !== "string") throw new Error("bech32: bad input");
  const lower = bech.toLowerCase();
  if (lower !== bech && bech.toUpperCase() !== bech) throw new Error("bech32: mixed case");
  const s = lower;
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) throw new Error("bech32: bad separator");
  const hrp = s.slice(0, pos);
  const data = [];
  for (const c of s.slice(pos + 1)) {
    const i = CHARSET.indexOf(c);
    if (i < 0) throw new Error("bech32: bad char " + c);
    data.push(i);
  }
  if (!verifyChecksum(hrp, data)) throw new Error("bech32: bad checksum");
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (!bytes) throw new Error("bech32: bad payload");
  return { hrp, bytes: new Uint8Array(bytes) };
}

// ---------------- Key helpers ----------------
export function decodeNsec(nsec) {
  const { hrp, bytes } = bech32Decode(String(nsec).trim());
  if (hrp !== "nsec") throw new Error(`expected nsec1..., got hrp=${hrp}`);
  if (bytes.length !== 32) throw new Error(`expected 32-byte privkey, got ${bytes.length}`);
  const n = bytesToBigInt(bytes);
  if (n === 0n || n >= SECP256K1_N) throw new Error("invalid privkey: out of range");
  return bytes;
}

export function isValidNsec(nsec) {
  try { decodeNsec(nsec); return true; } catch { return false; }
}

export function isValidNpub(npub) {
  try {
    const { hrp, bytes } = bech32Decode(String(npub).trim());
    return hrp === "npub" && bytes.length === 32;
  } catch { return false; }
}

function bytesToBigInt(b) {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function bigIntTo32Bytes(n) {
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

// HKDF-SHA256 child privkey, retry with try/{attempt} counter.
export function deriveChildPrivkey(rootPriv, index) {
  const salt = new TextEncoder().encode("fips-backup-v1");
  for (let attempt = 0; attempt < 16; attempt++) {
    const info = new TextEncoder().encode(`fips-backup/v1/index/${index}/try/${attempt}`);
    const out = hkdf(sha256, rootPriv, salt, info, 32);
    const n = bytesToBigInt(out);
    if (n > 0n && n < SECP256K1_N) return bigIntTo32Bytes(n);
  }
  throw new Error("HKDF failed to produce valid scalar");
}

// Given root nsec + index → { npub, nsec, pubkeyHex, privkeyHex }
export function deriveKey(rootNsec, index) {
  const rootPriv = decodeNsec(rootNsec);
  const priv = index === 0 ? rootPriv : deriveChildPrivkey(rootPriv, index);
  // x-only pubkey: drop 02/03 prefix byte from compressed form
  const compressed = secp.getPublicKey(priv, true);
  const xOnly = compressed.slice(1);
  return {
    index,
    npub: bech32Encode("npub", xOnly),
    nsec: bech32Encode("nsec", priv),
    pubkeyHex: bytesToHex(xOnly),
    privkeyHex: bytesToHex(priv),
  };
}

function bytesToHex(b) {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

export function randomNsec() {
  const buf = new Uint8Array(32);
  globalThis.crypto.getRandomValues(buf);
  let n = bytesToBigInt(buf);
  n = (n % (SECP256K1_N - 1n)) + 1n;
  return bech32Encode("nsec", bigIntTo32Bytes(n));
}

export function shortNpub(s) {
  if (!s) return "";
  return s.length > 20 ? s.slice(0, 12) + "…" + s.slice(-6) : s;
}
