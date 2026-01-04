#!/bin/bash
#
# Deploy a Token contract on Aztec devnet using aztec-wallet CLI
#
# Usage: ./scripts/deploy-token.sh [name] [symbol] [decimals]
#
# Prerequisites:
#   - Install aztec tools: curl -s https://install.aztec.network | bash
#   - Run: aztec-up devnet
#

set -e

# Configuration - Devnet 20251212
export VERSION=3.0.0-devnet.20251212
export AZTEC_NODE_URL=https://next.devnet.aztec-labs.com/
export SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e

# Token parameters (with defaults)
TOKEN_NAME="${1:-TestToken}"
TOKEN_SYMBOL="${2:-TEST}"
TOKEN_DECIMALS="${3:-6}"

echo "============================================================"
echo "Deploy Token Contract on Aztec Devnet"
echo "============================================================"
echo ""
echo "Configuration:"
echo "  Node URL: $AZTEC_NODE_URL"
echo "  Token Name: $TOKEN_NAME"
echo "  Token Symbol: $TOKEN_SYMBOL"
echo "  Decimals: $TOKEN_DECIMALS"
echo "  Sponsored FPC: $SPONSORED_FPC_ADDRESS"
echo ""

# Step 1: Check aztec-wallet is installed
if ! command -v aztec-wallet &> /dev/null; then
    echo "Error: aztec-wallet not found. Install with:"
    echo "  curl -s https://install.aztec.network | bash"
    echo "  aztec-up devnet"
    exit 1
fi

# Step 2: Register the Sponsored FPC contract
echo "[1/4] Registering Sponsored FPC contract..."
aztec-wallet -n $AZTEC_NODE_URL register-contract \
  --alias sponsoredfpc \
  $SPONSORED_FPC_ADDRESS SponsoredFPC \
  --salt 0 2>/dev/null || echo "  (Already registered)"

# Step 3: Create account (or use existing)
echo ""
echo "[2/4] Creating deployer account..."
echo "  This will download proving keys on first run (may take a few minutes)..."

# Check if account already exists
if aztec-wallet get-alias my-deployer --type accounts 2>/dev/null; then
    echo "  Using existing account: my-deployer"
    DEPLOYER_ADDRESS=$(aztec-wallet get-alias my-deployer --type accounts 2>/dev/null | grep -oP '0x[a-fA-F0-9]+' | head -1)
else
    aztec-wallet -n $AZTEC_NODE_URL create-account \
      --alias my-deployer \
      --payment method=fpc-sponsored,fpc=$SPONSORED_FPC_ADDRESS

    echo "  Account created!"
    DEPLOYER_ADDRESS=$(aztec-wallet get-alias my-deployer --type accounts 2>/dev/null | grep -oP '0x[a-fA-F0-9]+' | head -1)
fi

echo "  Deployer address: $DEPLOYER_ADDRESS"

# Step 4: Deploy Token contract
echo ""
echo "[3/4] Deploying Token contract..."
echo "  This may take 2-5 minutes..."

aztec-wallet -n $AZTEC_NODE_URL deploy \
  --from accounts:my-deployer \
  --payment method=fpc-sponsored,fpc=$SPONSORED_FPC_ADDRESS \
  --alias my-token \
  TokenContract \
  --args accounts:my-deployer "$TOKEN_NAME" "$TOKEN_SYMBOL" $TOKEN_DECIMALS

# Get the token address
TOKEN_ADDRESS=$(aztec-wallet get-alias my-token --type contracts 2>/dev/null | grep -oP '0x[a-fA-F0-9]+' | head -1)

echo ""
echo "[4/4] Token deployed successfully!"
echo ""
echo "============================================================"
echo "SUCCESS!"
echo "============================================================"
echo ""
echo "Token Contract: $TOKEN_ADDRESS"
echo "Admin Address:  $DEPLOYER_ADDRESS"
echo ""
echo "To mint tokens:"
echo "  aztec-wallet -n $AZTEC_NODE_URL send mint_to_public \\"
echo "    --from accounts:my-deployer \\"
echo "    --payment method=fpc-sponsored,fpc=$SPONSORED_FPC_ADDRESS \\"
echo "    --contract contracts:my-token \\"
echo "    --args accounts:my-deployer 1000000000000"
echo ""
echo "To check balance:"
echo "  aztec-wallet -n $AZTEC_NODE_URL simulate balance_of_public \\"
echo "    --from accounts:my-deployer \\"
echo "    --contract contracts:my-token \\"
echo "    --args accounts:my-deployer"
echo ""

# Save deployment info to JSON
cat > scripts/token-deployment.json << EOF
{
  "tokenAddress": "$TOKEN_ADDRESS",
  "tokenName": "$TOKEN_NAME",
  "tokenSymbol": "$TOKEN_SYMBOL",
  "tokenDecimals": "$TOKEN_DECIMALS",
  "adminAddress": "$DEPLOYER_ADDRESS",
  "adminAlias": "my-deployer",
  "contractAlias": "my-token",
  "nodeUrl": "$AZTEC_NODE_URL",
  "deployedAt": "$(date -Iseconds)"
}
EOF

echo "Deployment data saved to: scripts/token-deployment.json"
