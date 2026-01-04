/**
 * Key derivation from MetaMask signature
 *
 * Derives Aztec keys deterministically from a MetaMask signature.
 * Same MetaMask account + same message = same Aztec keys.
 */

import { Fr } from '@aztec/aztec.js/fields';
import { keccak256, toBytes, concat } from 'viem';

const DERIVATION_VERSION = 'vizard-v1';

export interface DerivedKeys {
  /** Master secret key for Aztec account */
  secretKey: Fr;
  /** Salt for deterministic address derivation */
  salt: Fr;
  /** ECDSA signing private key for the account contract */
  signingPrivateKey: Buffer;
  /** The EVM address that signed */
  evmAddress: string;
  /** Raw signature (for verification) */
  signature: string;
}

/**
 * Derive Aztec keys from a MetaMask signature.
 *
 * This is deterministic: same address + same message = same keys.
 * The signature never leaves the browser.
 */
export async function deriveAztecKeys(evmAddress: string): Promise<DerivedKeys> {
  // Check for ethereum provider
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask not detected. Please install MetaMask.');
  }

  // Create derivation message
  const message = createDerivationMessage(evmAddress);

  // Request signature from MetaMask
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, evmAddress],
  }) as string;

  // Derive keys from signature
  const secretKey = deriveSecretKey(signature);
  const salt = deriveSalt(signature);
  const signingPrivateKey = deriveSigningKey(signature);

  return {
    secretKey,
    salt,
    signingPrivateKey,
    evmAddress,
    signature,
  };
}

/**
 * Create the message that will be signed for key derivation.
 * This message is shown to the user in MetaMask.
 *
 * Note: No timestamp - keys should be deterministic and stable.
 */
function createDerivationMessage(evmAddress: string): string {
  return [
    'Vizard Aztec Wallet',
    '',
    'Sign this message to derive your Aztec private keys.',
    'This signature will NOT be sent to any server.',
    '',
    `Version: ${DERIVATION_VERSION}`,
    `Address: ${evmAddress}`,
  ].join('\n');
}

/**
 * Derive the master secret key from signature.
 * Uses domain separation to ensure different keys for different purposes.
 */
function deriveSecretKey(signature: string): Fr {
  const hash = keccak256(
    concat([
      toBytes(signature),
      toBytes('vizard:secret'),
    ])
  );
  return Fr.fromBuffer(Buffer.from(hash.slice(2), 'hex'));
}

/**
 * Derive salt for deterministic address computation.
 */
function deriveSalt(signature: string): Fr {
  const hash = keccak256(
    concat([
      toBytes(signature),
      toBytes('vizard:salt'),
    ])
  );
  return Fr.fromBuffer(Buffer.from(hash.slice(2), 'hex'));
}

/**
 * Derive the ECDSA signing private key for the account contract.
 * This is a 32-byte secp256k1 private key.
 */
function deriveSigningKey(signature: string): Buffer {
  const hash = keccak256(
    concat([
      toBytes(signature),
      toBytes('vizard:signing'),
    ])
  );
  return Buffer.from(hash.slice(2), 'hex');
}

/**
 * Recover public key from MetaMask address.
 * Used for ECDSA account contract registration.
 */
export async function getMetaMaskPublicKey(evmAddress: string): Promise<Buffer> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask not detected');
  }

  // Sign a known message to recover public key
  const message = 'Vizard: Recover public key';
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, evmAddress],
  }) as string;

  // Recover public key from signature using viem
  const { recoverPublicKey } = await import('viem');
  const { hashMessage } = await import('viem');

  const messageHash = hashMessage(message);
  const publicKey = await recoverPublicKey({
    hash: messageHash,
    signature: signature as `0x${string}`,
  });

  // Return uncompressed public key (64 bytes, without 0x04 prefix)
  return Buffer.from(publicKey.slice(4), 'hex');
}

// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      removeListener?: (event: string, handler: (...args: any[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}
