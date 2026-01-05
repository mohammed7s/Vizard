# Vizard

**MetaMask-powered Aztec Wallet**

Use your existing MetaMask wallet to interact with Aztec's private smart contracts. No additional extensions required.

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

## Installation

```bash
npm install @vizard/wallet
```

## Usage

```typescript
import { VizardWallet } from '@vizard/wallet';

// Create wallet instance
const wallet = new VizardWallet({
  pxeUrl: 'https://devnet.aztec-labs.com',
});

// Connect (triggers MetaMask popups)
const account = await wallet.connect();

// Use like any Aztec wallet
const token = await TokenContract.at(tokenAddress, account);
await token.methods.transfer(recipient, amount).send();
```

## SDK (MVP)

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
const account = sdk.getAztecAddress();
if (!account) throw new Error('Aztec account not available');

await token.methods
  .transfer_in_public(account, account, 1n, 0)
  .send(paymentMethod ? { from: account, fee: { paymentMethod } } : { from: account })
  .wait();
```

Notes:
- `feeMode: 'sponsored'` uses the canonical SponsoredFPC (salt 0) for testnet/devnet fees.
- You need a deployed token contract address and balance to transfer.

## Connection Flow

1. **Connect MetaMask** - User approves connection
2. **Sign Key Derivation** - User signs message to derive Aztec keys
3. **Initialize PXE** - Browser loads WASM prover
4. **Register Account** - ECDSA account deployed/registered

## Development

```bash
# Install dependencies
pnpm install

# Start the example app
pnpm dev

# Open http://localhost:5555
```

The example app lives in `examples/demo` and consumes the SDK from `packages/sdk`.

### Running the Aztec Sandbox

Vizard connects to an external PXE (Private Execution Environment). For local development, run the Aztec sandbox:

```bash
# Start the sandbox (Docker required)
aztec sandbox

# Or with specific options
aztec sandbox --host 0.0.0.0 --port 8080
```

The sandbox exposes a PXE at `http://localhost:8080`.

**Note:** If you encounter CORS errors, you may need to run the dev server and sandbox on the same origin or use a proxy.

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

## Comparison with Azguard

| | Azguard | Vizard |
|--|---------|--------|
| Installation | Browser extension | None (library in dapp) |
| Key management | Separate seed phrase | Derived from MetaMask |
| PXE location | Extension | Browser (in dapp) |
| Proof generation | Extension WASM | Browser WASM |
| Recovery | Azguard seed phrase | MetaMask seed phrase |

## Limitations

- **First load is slow** - WASM prover artifacts are ~200MB
- **Proofs can be slower in browser** - WASM prover is slower than native
- **Dapps must integrate** - Not a drop-in replacement for Azguard

## License

MIT
