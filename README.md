# Vizard

Embedded Aztec wallet SDK controlled by your EVM wallet (MetaMask first). WIP.

```
 __     ___                 _
 \ \   / (_)____ _ _ __  __| |
  \ \ / /| |_  / _` | '__/ _` |
   \ V / | |/ / (_| | | | (_| |
    \_/  |_/___\__,_|_|  \__,_|
```

## Auth Modes (WIP)

We are exploring two authorization modes:

- **Session auth (current)**: derive Aztec keys from a MetaMask signature once per session and keep them **in memory** only. No derived keys are written to disk.
- **Per‑tx auth (planned)**: MetaMask signs each transaction intent to produce an auth witness. This removes a long‑lived session signing key, but you still need Aztec keys in memory to decrypt notes and build proofs.

## Security Considerations

Deriving keys from a MetaMask signature is unconventional—signatures are normally public. If a phishing site tricks you into signing the derivation message, they obtain your **viewing keys** and can see your balance and transaction history. However, they **cannot spend your funds**: spending requires MetaMask to sign the actual transaction, which the attacker doesn't control. We are exploring better approaches (per-tx signing, WebAuthn, MPC) and welcome suggestions via issues or PRs.

## What This Repo Is

- SDK for embedding an Aztec wallet in any web app.
- Example app showing MetaMask connection, account setup, and token transfers.

## Repo Layout

- `packages/sdk`: the SDK package (`@vizard/wallet`) and scripts
- `examples/demo`: demo app that consumes the SDK

## Quickstart

```bash
pnpm install
pnpm dev
```

This starts the demo at `http://localhost:5555`. The example app lives in `examples/demo` and consumes the SDK from `packages/sdk`.

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

## SDK Integration

See `packages/sdk/README.md` for:
- Installation and usage
- API reference
- Fee model
- Environment notes (bb.js WASM assets, COOP/COEP)
- Architecture details

## Plan / TODO

- Demo coverage: add private balance read + private transfer + a sync private state button.
- Auth model: add a per-tx signing toggle (MM popup vs session authwit cache), with explicit UI/logs.
- Wallet-agnostic provider: abstract EVM signer input (WalletConnect, Coinbase, MM).
- Build/publish pipeline: ensure `packages/sdk` builds cleanly and can be consumed externally (exports, types).

## Status

This project is under active development and the SDK surface may change.

## Contributing

Contributions are welcome. Open an issue or PR.

## License

MIT
