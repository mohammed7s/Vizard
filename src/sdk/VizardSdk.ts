import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { TokenContract } from '@aztec/noir-contracts.js/Token';

import { getSponsoredPaymentMethod } from '../fees/sponsored';
import { VizardWallet, type ConnectionState } from '../wallet/VizardWallet';

// Token deployer keys (token admin) - for faucet functionality
// From token-deployment.json (deployed via deploy-token.ts)
const TESTNET_DEPLOYER = {
  secretKey: '0x1035a0445ae39c2bd2ec1eef5fa2b415e8c8522d7265e2eeecc64f483d3e66fa',
  salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
  signingKey: '0x155f2de70705a06a0dca13004f949bc197c2431baa23d9d428eb448bc48db83a',
};

// Default token address (VizardUSDC deployed via deploy-token.ts)
const DEFAULT_TOKEN_ADDRESS = '0x1f82c5ab43b5dc0d9c3224759f6ced5d12774386d163d315a8a0c3550add1fd9';

export interface VizardSdkConfig {
  pxeUrl: string;
  feeMode?: 'sponsored' | 'none';
  autoSync?: boolean;
  bbWasmPath?: string;
  bbThreads?: number;
  bbBackend?: 'wasm-worker' | 'wasm';
  bbLog?: boolean;
}

export class VizardSdk {
  private wallet: VizardWallet;
  private feePaymentMethod: FeePaymentMethod | null = null;
  private feeMode: 'sponsored' | 'none';
  private registeredContracts: Set<string> = new Set();
  private txQueue: Promise<void> = Promise.resolve();

  constructor(config: VizardSdkConfig) {
    this.feeMode = config.feeMode ?? 'sponsored';

    const feePaymentMethodProvider = this.feeMode === 'sponsored'
      ? async (wallet: Wallet) => {
          const method = await getSponsoredPaymentMethod(wallet);
          this.feePaymentMethod = method;
          return method;
        }
      : undefined;

    this.wallet = new VizardWallet({
      pxeUrl: config.pxeUrl,
      feePaymentMethodProvider,
      autoSync: config.autoSync,
      bbWasmPath: config.bbWasmPath,
      bbThreads: config.bbThreads,
      bbBackend: config.bbBackend,
      bbLog: config.bbLog,
    });
  }

  private enqueueTx<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => fn();
    const next = this.txQueue.then(run, run);
    this.txQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  async connect() {
    const account = await this.wallet.connect();
    if (this.feeMode === 'sponsored' && !this.feePaymentMethod) {
      const wallet = this.getWallet();
      if (wallet) {
        this.feePaymentMethod = await getSponsoredPaymentMethod(wallet);
      }
    }
    return account;
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    return this.wallet.onStateChange(listener);
  }

  disconnect() {
    this.wallet.disconnect();
    this.registeredContracts.clear();
  }

  getWallet() {
    return this.wallet.getWallet();
  }

  getNode() {
    return this.wallet.getNode();
  }

  getTestWallet() {
    return this.wallet.getTestWallet();
  }

  getEvmAddress() {
    return this.wallet.getEvmAddress();
  }

  getAztecAddress() {
    return this.wallet.getAztecAddress();
  }

  getFeePaymentMethod() {
    return this.feePaymentMethod;
  }

  async syncPrivateState(addresses: Array<string | AztecAddress>) {
    const wallet = this.getWallet();
    if (!wallet) {
      throw new Error('Wallet not connected');
    }

    const targets = addresses.map(address => (
      typeof address === 'string' ? AztecAddress.fromString(address) : address
    ));

    await this.wallet.syncPrivateState(targets);
  }

  async getTokenContract(address: string, register = true) {
    const wallet = this.getWallet();
    const node = this.getNode();
    if (!wallet || !node) {
      throw new Error('Wallet not connected');
    }

    const aztecAddress = AztecAddress.fromString(address);
    const addressKey = aztecAddress.toString().toLowerCase();
    console.log('[Vizard] Loading token contract:', aztecAddress.toString());

    if (register && !this.registeredContracts.has(addressKey)) {
      // Fetch contract instance from node and register with wallet
      console.log('[Vizard] Fetching contract instance from node...');
      const instance = await node.getContract(aztecAddress);

      if (!instance) {
        throw new Error(`Contract not found at ${address}. Make sure the contract is deployed on this network.`);
      }

      console.log('[Vizard] Instance class ID:', instance.currentContractClassId.toString());

      // Register with instance and artifact - Aztec will use the artifact for function calls
      // Function selectors are derived from function names/signatures, so even if class IDs
      // differ slightly between versions, the calls should still work
      console.log('[Vizard] Registering contract...');
      await wallet.registerContract(instance, TokenContract.artifact);
      console.log('[Vizard] Contract registered');

      this.registeredContracts.add(addressKey);
      await this.wallet.syncPrivateState([aztecAddress]);
    } else if (this.registeredContracts.has(addressKey)) {
      console.log('[Vizard] Contract already registered, skipping');
    }

    // Use TokenContract wrapper - function selectors will match even if class IDs differ
    return TokenContract.at(aztecAddress, wallet);
  }

  /**
   * Mint tokens to the connected user (testnet faucet).
   * Uses the deployer (token admin) to mint tokens.
   * Reuses the existing TestWallet to avoid WASM reload issues.
   */
  async mintTokens(tokenAddress: string, amount: bigint) {
    return this.enqueueTx(async () => {
      const node = this.getNode();
      const userAddress = this.getAztecAddress();
      const testWallet = this.getTestWallet();
      if (!node || !userAddress || !testWallet) {
        throw new Error('Wallet not connected');
      }

      console.log('[Vizard] Starting faucet mint...');
      console.log('[Vizard] Token:', tokenAddress);
      console.log('[Vizard] Amount:', amount.toString());
      console.log('[Vizard] Recipient:', userAddress.toString());

      // Create deployer account using the existing TestWallet
      const signingKeyBuffer = Buffer.from(TESTNET_DEPLOYER.signingKey.slice(2), 'hex');
      const deployerAccount = await testWallet.createSchnorrAccount(
        Fr.fromString(TESTNET_DEPLOYER.secretKey),
        Fr.fromString(TESTNET_DEPLOYER.salt),
        GrumpkinScalar.fromBuffer(signingKeyBuffer),
      );
      console.log('[Vizard] Deployer address:', deployerAccount.address.toString());
      console.log('[Vizard] Expected deployer: 0x1f428d2f8913b040f00bbbb1e10e9c3081cacb941f4e6ac66e28520782e554ff');

      // Get sponsored fee payment (testWallet already has this registered)
      const paymentMethod = await getSponsoredPaymentMethod(testWallet);

      // Register token with wallet if not already done
      const aztecTokenAddress = AztecAddress.fromString(tokenAddress);
      const addressKey = aztecTokenAddress.toString().toLowerCase();
      if (!this.registeredContracts.has(addressKey)) {
        const instance = await node.getContract(aztecTokenAddress);
        if (!instance) {
          throw new Error('Token contract not found');
        }
        await testWallet.registerContract(instance, TokenContract.artifact);
        this.registeredContracts.add(addressKey);
      }

      // Mint tokens using the testWallet (which has deployer account registered)
      const deployerToken = await TokenContract.at(aztecTokenAddress, testWallet);
      console.log('[Vizard] Minting tokens...');

      const tx = await deployerToken.methods
        .mint_to_public(userAddress, amount)
        .send({
          from: deployerAccount.address,
          fee: { paymentMethod },
        });

      const txHash = await tx.getTxHash();
      console.log('[Vizard] Mint tx:', txHash.toString());

      await tx.wait({ timeout: 300000 });
      console.log('[Vizard] Mint complete!');

      return txHash.toString();
    });
  }

  async getPublicBalance(tokenAddress: string) {
    const account = this.getAztecAddress();
    if (!account) {
      throw new Error('Aztec account not available.');
    }

    const token = await this.getTokenContract(tokenAddress, true);
    // With enableSimulatedSimulations(), simulate uses a fake account
    // This avoids ECDSA account note sync issues
    return token.methods.balance_of_public(account).simulate({ from: account });
  }

  async sendPublicTransfer(tokenAddress: string, recipient: string, amount: bigint) {
    return this.enqueueTx(async () => {
      const account = this.getAztecAddress();
      if (!account) {
        throw new Error('Aztec account not available.');
      }

      console.log('[Vizard] Starting public transfer...');
      console.log('[Vizard] From:', account.toString());
      console.log('[Vizard] To:', recipient);
      console.log('[Vizard] Amount:', amount.toString());
      console.log('[Vizard] WARNING: Browser WASM prover is SLOW (30-60+ minutes)');
      console.log('[Vizard] For faster transfers, use the Node.js script instead');

      const startTime = Date.now();

      const token = await this.getTokenContract(tokenAddress, true);
      const to = AztecAddress.fromString(recipient);
      const paymentMethod = this.getFeePaymentMethod();

      console.log('[Vizard] Sending tx (this will take a long time in browser)...');

      const tx = await token.methods
        .transfer_in_public(account, to, amount, 0)
        .send(paymentMethod ? { from: account, fee: { paymentMethod } } : { from: account });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Vizard] Tx sent after ${elapsed}s:`, (await tx.getTxHash()).toString());

      return tx;
    });
  }
}
