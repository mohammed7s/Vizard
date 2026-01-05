# Vizard

Embedded Aztec wallet SDK controlled by your EVM wallet (MetaMask first). WIP.

```
 __     ___                 _
 \ \   / (_)____ _ _ __  __| |
  \ \ / /| |_  / _` | '__/ _` |
   \ V / | |/ / (_| | | | (_| |
    \_/  |_/___\__,_|_|  \__,_|
```

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

This starts the demo at `http://localhost:5555`.

## SDK Docs

See `packages/sdk/README.md` for:
- SDK usage API
- fee model
- connection flow
- environment notes (bb.js WASM assets, COOP/COEP)
- plan/TODO

## Status

This project is under active development and the SDK surface may change.

## Contributing

Contributions are welcome. Open an issue or PR.

## License

MIT
