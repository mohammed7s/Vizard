# Vizard

**MetaMask-powered Aztec Wallet**

Mission: an embedded wallet that lets any Aztec app use an existing EVM wallet (starting with MetaMask) to control an Aztec account in the browser.

Status: **WIP**. Expect breaking changes while the SDK surface stabilizes.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         BROWSER                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Vizard Wallet                          │   │
│   │   • Aztec keys derived from MetaMask signature      │   │
│   │   • ECDSA signing key derived deterministically     │   │
│   │   • Same MetaMask = same Aztec identity             │   │
│   └─────────────────────────────────────────────────────┘   │
│                              │                               │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              MetaMask                               │   │
│   │   • Signs key derivation message (once)             │   │
│   │   • Controls account recovery via seed phrase       │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Connect to PXE
                               ▼
                    ┌─────────────────────┐
                    │   PXE (Sandbox or   │
                    │   Hosted Service)   │
                    └─────────────────────┘
                               │
                               ▼
                        Aztec Network
```

## Features

- **No additional wallet** - Just use MetaMask
- **Full privacy** - All private data stays in your browser
- **Unified identity** - Your Aztec address is derived from your ETH address
- **Single recovery** - Recover Aztec account with your existing seed phrase

## Quickstart (App Integration)

```bash
pnpm add @vizard/wallet
```

> Package publishing is in progress. Until then, use a workspace or git install.

```bash
# From a workspace
pnpm add ../packages/sdk
```

### Usage

```typescript
import { VizardSdk } from '@vizard/wallet';
import { TokenContract } from '@aztec/noir-contracts.js/Token';

const sdk = new VizardSdk({
  pxeUrl: 'https://aztec-testnet-fullnode.zkv.xyz',
  feeMode: 'sponsored',
  autoSync: true,
});

await sdk.connect();

const token = await sdk.contractAt(TokenContract, '0x...');
const paymentMethod = sdk.getFeePaymentMethod();
const feeOptions = await sdk.buildFeeOptions({ paymentMethod });
const account = sdk.getAztecAddress();
if (!account) throw new Error('Aztec account not available');

await token.methods
  .transfer_in_public(account, account, 1n, 0)
  .send({ from: account, ...feeOptions })
  .wait();
```

### MetaMask Connection (required user click)

Browsers only allow wallet popups on direct user actions. Trigger `sdk.connect()` from a button click:

```typescript
const connectBtn = document.getElementById('connectBtn');
connectBtn?.addEventListener('click', async () => {
  await sdk.connect(); // MetaMask popup
});
```

## Environment

- No required env vars. Pass `pxeUrl` directly, or map it from your app env (e.g. `import.meta.env.VITE_PXE_URL`).
- Browser proving needs the bb.js WASM assets to be served by your app. See `examples/demo` for a Vite copy setup.

## Fee Model

- `feeMode: 'sponsored'` uses the canonical SponsoredFPC (salt 0) for testnet/devnet fees.
- `feeMode: 'none'` uses the account's fee juice balance (you must fund it).
- `buildFeeOptions()` fetches base + priority fees and applies padding; you can override `padding` per tx.

## SDK Usage API (MVP)

- `new VizardSdk({ pxeUrl, feeMode, autoSync, bbWasmPath, bbThreads, bbBackend, bbLog })`
- `connect()` - connects MetaMask, derives keys, registers account
- `onStateChange(cb)` - progress updates for UI
- `contractAt(ContractClass, address, register?)` - register + bind to a contract
- `buildFeeOptions({ paymentMethod?, padding? })` - fetches gas fees and returns `fee` options
- `getWallet()`, `getNode()`, `getAztecAddress()`, `getEvmAddress()`
- `getFeePaymentMethod()` - sponsored fee provider if configured
- `syncPrivateState(addresses)` - explicit sync when needed

## Flow

1. **Connect MetaMask** - User approves connection
2. **Sign Key Derivation** - User signs message to derive Aztec keys
3. **Initialize PXE** - Browser loads WASM prover
4. **Register Account** - ECDSA account deployed/registered

## Architecture

### Key Derivation

Aztec keys are deterministically derived from a MetaMask signature:

```typescript
// User signs this message in MetaMask
const message = `Vizard Aztec Wallet
Sign this message to derive your Aztec private keys.
Address: 0x...`;

// Signature is used to derive:
// - secretKey = keccak256(signature + "vizard:secret")
// - salt = keccak256(signature + "vizard:salt")
```

Same MetaMask account always produces the same Aztec keys.

### Transaction Signing

When a transaction needs authorization:

1. PXE computes transaction hash
2. Hash is sent to MetaMask via `personal_sign`
3. User sees MetaMask popup, clicks "Sign"
4. Signature returned as AuthWitness for ECDSA account contract

### Privacy Model

| Component | Location | Private? |
|-----------|----------|----------|
| Keys | Browser | Yes |
| Notes | Browser IndexedDB | Yes |
| Proof generation | Browser WASM | Yes |
| Submitted proofs | Aztec network | ZK (reveals nothing) |

**No backend ever sees your private data.**

## Comparison with Extension Wallet

| | Extension wallet | Vizard |
|--|---------|--------|
| Installation | Browser extension | None (library in dapp) |
| Key management | Separate seed phrase | Derived from MetaMask |
| PXE location | Extension | Browser (in dapp) |
| Proof generation | Extension WASM | Browser WASM |
| Recovery | Extension wallet seed phrase | MetaMask seed phrase |

## License

MIT
