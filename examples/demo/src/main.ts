import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { VizardSdk, getSponsoredPaymentMethod } from '@vizard/wallet';

let sdk: VizardSdk | null = null;
let loadedTokenAddress: string | null = null;
let txQueue: Promise<void> = Promise.resolve();

// Token deployer keys (token admin) - for faucet functionality
// From token-deployment.json (deployed via deploy-token.ts)
const TESTNET_DEPLOYER = {
  secretKey: '0x1035a0445ae39c2bd2ec1eef5fa2b415e8c8522d7265e2eeecc64f483d3e66fa',
  salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
  signingKey: '0x155f2de70705a06a0dca13004f949bc197c2431baa23d9d428eb448bc48db83a',
};

function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const logEl = document.getElementById('log');
  if (!logEl) {
    return;
  }
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateStatus(status: string, message: string) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (!dot || !text) {
    return;
  }

  dot.className = 'status-dot';
  if (status === 'connected') dot.classList.add('connected');
  else if (status !== 'disconnected') dot.classList.add('connecting');

  text.textContent = message;
}

function getInputValue(id: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.value.trim() : '';
}

function requireSdk() {
  if (!sdk) {
    throw new Error('SDK not initialized. Connect MetaMask first.');
  }
}

function requireToken() {
  if (!loadedTokenAddress) {
    throw new Error('Token not loaded. Enter a token address and click Load Token.');
  }
}

function enqueueTx<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => fn();
  const next = txQueue.then(run, run);
  txQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function handleConnect() {
  const btn = document.getElementById('connectBtn') as HTMLButtonElement | null;
  const nodeUrl = getInputValue('nodeUrl');
  const useSponsoredFees = (document.getElementById('useSponsoredFees') as HTMLInputElement | null)?.checked ?? true;

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Connecting...';
    }

    log('Creating SDK instance...');

    sdk = new VizardSdk({
      pxeUrl: nodeUrl,
      feeMode: useSponsoredFees ? 'sponsored' : 'none',
      autoSync: true,
      bbWasmPath: '/assets/bb/barretenberg.wasm.gz',
      bbThreads: 1,
      bbBackend: 'wasm-worker',
      bbLog: true,
    });

    sdk.onStateChange((state) => {
      updateStatus(state.status, state.message);
      log(state.message, state.status === 'connected' ? 'success' : 'info');
    });

    log('Starting connection (MetaMask popup will appear)...');
    await sdk.connect();

    const accountCard = document.getElementById('accountCard');
    const actionsCard = document.getElementById('actionsCard');
    if (accountCard) accountCard.style.display = 'block';
    if (actionsCard) actionsCard.style.display = 'block';

    const evmAddress = document.getElementById('evmAddress');
    const aztecAddress = document.getElementById('aztecAddress');
    if (evmAddress) evmAddress.textContent = sdk.getEvmAddress() ?? '-';
    if (aztecAddress) aztecAddress.textContent = sdk.getAztecAddress()?.toString() ?? '-';

    if (btn) {
      btn.textContent = 'Connected!';
    }
    log('Successfully connected!', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    log(`Error: ${message}`, 'error');
    updateStatus('disconnected', 'Connection failed');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Connect MetaMask';
    }
  }
}

async function handleLoadToken() {
  try {
    requireSdk();
    const tokenAddress = getInputValue('tokenAddress');
    if (!tokenAddress) {
      throw new Error('Token address is required.');
    }
    log('Loading token contract...');
    await sdk!.contractAt(TokenContract, tokenAddress, true);
    loadedTokenAddress = tokenAddress;
    const loadedToken = document.getElementById('loadedToken');
    if (loadedToken) {
      loadedToken.textContent = tokenAddress;
    }
    log('Token loaded.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load token';
    log(`Error: ${message}`, 'error');
  }
}

async function handlePublicBalance() {
  try {
    requireSdk();
    requireToken();
    log('Fetching public balance...');
    const account = sdk!.getAztecAddress();
    if (!account) {
      throw new Error('Aztec account not available.');
    }
    const token = await sdk!.contractAt(TokenContract, loadedTokenAddress!, true);
    const balance = await token.methods.balance_of_public(account).simulate({ from: account });
    const publicBalance = document.getElementById('publicBalance');
    if (publicBalance) {
      publicBalance.textContent = balance.toString();
    }
    log('Public balance updated.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch balance';
    log(`Error: ${message}`, 'error');
  }
}

async function handleFaucet() {
  return enqueueTx(async () => {
    try {
      requireSdk();
      requireToken();
      log('Requesting tokens from faucet... (this takes 2-3 minutes)');
      const mintAmount = 100n * 10n ** 6n; // 100 USDC (6 decimals)

      const node = sdk!.getNode();
      const userAddress = sdk!.getAztecAddress();
      const testWallet = sdk!.getTestWallet();
      if (!node || !userAddress || !testWallet) {
        throw new Error('Wallet not connected');
      }

      const signingKeyBuffer = Buffer.from(TESTNET_DEPLOYER.signingKey.slice(2), 'hex');
      const deployerAccount = await testWallet.createSchnorrAccount(
        Fr.fromString(TESTNET_DEPLOYER.secretKey),
        Fr.fromString(TESTNET_DEPLOYER.salt),
        GrumpkinScalar.fromBuffer(signingKeyBuffer),
      );

      const paymentMethod = await getSponsoredPaymentMethod(testWallet);
      const aztecTokenAddress = AztecAddress.fromString(loadedTokenAddress!);
      const instance = await node.getContract(aztecTokenAddress);
      if (!instance) {
        throw new Error('Token contract not found');
      }
      await testWallet.registerContract(instance, TokenContract.artifact);

      const deployerToken = await TokenContract.at(aztecTokenAddress, testWallet);
      const feeOptions = await sdk!.buildFeeOptions({ paymentMethod });
      const tx = await deployerToken.methods
        .mint_to_public(userAddress, mintAmount)
        .send({
          from: deployerAccount.address,
          ...feeOptions,
        });

      const txHash = await tx.getTxHash();
      await tx.wait({ timeout: 300000 });

      log(`Faucet tx: ${txHash.toString()}`, 'success');
      log('Tokens minted! Click Check Balance to see.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Faucet failed';
      log(`Error: ${message}`, 'error');
    }
  });
}

async function handlePublicTransfer() {
  return enqueueTx(async () => {
    try {
      requireSdk();
      requireToken();
      const recipient = getInputValue('recipient');
      const amountRaw = getInputValue('amount');
      if (!recipient || !amountRaw) {
        throw new Error('Recipient and amount are required.');
      }

      const amount = BigInt(amountRaw);
      log('Starting public transfer (WASM prover)...');

      const startTime = Date.now();

      // Progress indicator
      const progressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        log(`Still proving... ${mins}m ${secs}s elapsed`);
      }, 30000); // Log every 30 seconds

      try {
        const account = sdk!.getAztecAddress();
        if (!account) {
          throw new Error('Aztec account not available.');
        }
        const token = await sdk!.contractAt(TokenContract, loadedTokenAddress!, true);
        const to = AztecAddress.fromString(recipient);
        const paymentMethod = sdk!.getFeePaymentMethod();
        const feeOptions = await sdk!.buildFeeOptions({ paymentMethod });

        const tx = await token.methods
          .transfer_in_public(account, to, amount, 0)
          .send({ from: account, ...feeOptions });

        clearInterval(progressInterval);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const txHash = (await tx.getTxHash()).toString();
        const txHashEl = document.getElementById('txHash');
        if (txHashEl) {
          txHashEl.textContent = txHash;
        }
        log(`Tx submitted after ${elapsed}s: ${txHash}`, 'success');

        log('Waiting for tx to be mined...');
        await tx.wait();
        log('Tx mined!', 'success');
      } catch (e) {
        clearInterval(progressInterval);
        throw e;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      log(`Error: ${message}`, 'error');
    }
  });
}

function bindHandlers() {
  const connectBtn = document.getElementById('connectBtn');
  const loadTokenBtn = document.getElementById('loadTokenBtn');
  const faucetBtn = document.getElementById('faucetBtn');
  const balanceBtn = document.getElementById('balanceBtn');
  const transferBtn = document.getElementById('transferBtn');

  connectBtn?.addEventListener('click', handleConnect);
  loadTokenBtn?.addEventListener('click', handleLoadToken);
  faucetBtn?.addEventListener('click', handleFaucet);
  balanceBtn?.addEventListener('click', handlePublicBalance);
  transferBtn?.addEventListener('click', handlePublicTransfer);
}

if (typeof window.ethereum === 'undefined') {
  log('MetaMask not detected. Please install MetaMask.', 'error');
  const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null;
  if (connectBtn) {
    connectBtn.disabled = true;
  }
} else {
  log('MetaMask detected. Ready to connect.');
}

bindHandlers();
