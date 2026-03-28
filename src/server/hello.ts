import { ethers } from "ethers";

export interface HelloMessage {
  message: string;
  signature: string;
  address: string;
}

export interface VerifyResult {
  valid: boolean;
  address: string;
  nonce: string;
  expires: string;
  error?: string;
}

/**
 * Verify a base64-encoded hello message and recover the signer's Ethereum address.
 * Compatible with hello-message-go's GenerateHelloMessage output.
 */
export function verifyHelloMessage(encoded: string): VerifyResult {
  // Decode base64
  let json: string;
  try {
    json = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return { valid: false, address: "", nonce: "", expires: "", error: "failed to decode base64" };
  }

  // Parse JSON
  let msg: HelloMessage;
  try {
    msg = JSON.parse(json);
  } catch {
    return { valid: false, address: "", nonce: "", expires: "", error: "failed to parse JSON" };
  }

  if (!msg.message || !msg.signature || !msg.address) {
    return { valid: false, address: "", nonce: "", expires: "", error: "missing required fields" };
  }

  // Validate message format: "hello:<uuid>:<unix_timestamp>"
  const parts = msg.message.split(":");
  if (parts.length !== 3 || parts[0] !== "hello") {
    return { valid: false, address: "", nonce: "", expires: "", error: "invalid message format" };
  }

  const [, nonce, expires] = parts;

  // Check expiration
  const expiresUnix = parseInt(expires, 10);
  if (isNaN(expiresUnix)) {
    return { valid: false, address: "", nonce: "", expires: "", error: "invalid expires format" };
  }
  if (Math.floor(Date.now() / 1000) >= expiresUnix) {
    return { valid: false, address: msg.address, nonce, expires, error: "message expired" };
  }

  // Recover signer address using Ethereum personal_sign format
  // The Go implementation uses: keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)
  // ethers.verifyMessage does exactly this
  try {
    // Normalize signature: hello-message-go uses v=27/28, ethers expects the same
    const sigBytes = Buffer.from(msg.signature, "hex");
    if (sigBytes.length !== 65) {
      return { valid: false, address: msg.address, nonce, expires, error: "invalid signature length" };
    }

    const recoveredAddress = ethers.verifyMessage(msg.message, "0x" + msg.signature);

    if (recoveredAddress.toLowerCase() !== msg.address.toLowerCase()) {
      return { valid: false, address: msg.address, nonce, expires, error: "signature address mismatch" };
    }

    return { valid: true, address: recoveredAddress, nonce, expires };
  } catch (e) {
    return { valid: false, address: msg.address, nonce, expires, error: "signature recovery failed" };
  }
}

/**
 * Extract a hello message from an Authorization header.
 * Expects format: "Hello <base64>"
 * Returns the base64 payload or undefined if not a Hello auth header.
 */
export function extractHelloToken(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith("Hello ")) return undefined;
  return authHeader.slice(6);
}
