/**
 * Vizard - MetaMask-powered Aztec Wallet
 *
 * Enables users to interact with Aztec using their existing MetaMask wallet.
 * - Connects to external Aztec node (sandbox or hosted)
 * - Keys derived from MetaMask signature
 * - ECDSA account with derived signing key
 */

export { VizardWallet, type VizardWalletConfig, type ConnectionState } from './wallet/VizardWallet';
export { deriveAztecKeys, type DerivedKeys } from './keys/derivation';
export { connectToPXE, isSandboxRunning, type PXEConfig } from './pxe/BrowserPXE';
export { VizardSdk, type VizardSdkConfig } from './sdk/VizardSdk';
export { getSponsoredPaymentMethod } from './fees/sponsored';

// Re-export useful Aztec types
export type { AztecNode } from '@aztec/aztec.js/node';
export type { Wallet } from '@aztec/aztec.js/wallet';
