/**
 * Ed25519 signing-key helpers (Stage 45 — debug pass fix).
 *
 * A private KeyObject can only export pkcs8; the PUBLIC half (spki) needs
 * createPublicKey first. Deriving spki straight from a private key throws,
 * which used to masquerade as "the stored signing key is corrupt".
 */

import { createPrivateKey, createPublicKey } from "node:crypto";

/** Derive the SPKI public PEM from a stored PKCS8 private PEM. Throws on corrupt input. */
export function publicPemFromPrivateKeyPem(privatePem: string): string {
  const priv = createPrivateKey(privatePem);
  return createPublicKey(priv).export({ type: "spki", format: "pem" }).toString();
}
