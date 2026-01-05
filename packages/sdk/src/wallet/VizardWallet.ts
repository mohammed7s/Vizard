/**
 * VizardWallet - Main wallet class
 *
 * Connects MetaMask to Aztec via external node.
 * Keys are derived from a MetaMask signature.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';

import { deriveAztecKeys, type DerivedKeys } from '../keys/derivation';
import type { BackendOptions } from '@aztec/bb.js';
import { connectToPXE } from '../pxe/BrowserPXE';
import { SPONSORED_FPC_ADDRESS } from '../fees/sponsored';

export interface VizardWalletConfig {
  /** Node URL (e.g., http://localhost:8080 for sandbox) */
  pxeUrl: string;
  /** Optional fee payment method provider (e.g., SponsoredFPC on testnet) */
  feePaymentMethodProvider?: (wallet: Wallet) => Promise<FeePaymentMethod | undefined>;
  /** Whether to sync private state after connecting (default: true). */
  autoSync?: boolean;
  /** Optional bb.js WASM path (e.g., /assets/bb/barretenberg.wasm.gz). */
  bbWasmPath?: string;
  /** Optional bb.js thread count override. */
  bbThreads?: number;
  /** Force bb.js backend (wasm-worker or wasm). */
  bbBackend?: 'wasm-worker' | 'wasm';
  /** Enable bb.js initialization logs. */
  bbLog?: boolean;
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'deriving_keys' | 'initializing_pxe' | 'registering' | 'syncing' | 'connected';
  message: string;
}

type ConnectionStateListener = (state: ConnectionState) => void;

/**
 * VizardWallet connects MetaMask to Aztec.
 *
 * Usage:
 * ```ts
 * const wallet = new VizardWallet({ pxeUrl: 'http://localhost:8080' });
 * const account = await wallet.connect();
 *
 * // Now use like any Aztec wallet
 * const token = await TokenContract.at(tokenAddress, account);
 * await token.methods.transfer(to, amount).send();
 * ```
 */
export class VizardWallet {
  private node: AztecNode | null = null;
  private accountWallet: Wallet | null = null;
  private testWalletInstance: any = null; // Store TestWallet for reuse
  private derivedKeys: DerivedKeys | null = null;
  private evmAddress: string | null = null;
  private aztecAddress: AztecAddress | null = null;
  private feePaymentMethod: FeePaymentMethod | null = null;
  private bbInitialized = false;

  private stateListeners: Set<ConnectionStateListener> = new Set();
  private connectionState: ConnectionState = { status: 'disconnected', message: 'Not connected' };

  constructor(private config: VizardWalletConfig) {}

  /**
   * Subscribe to connection state changes.
   * Useful for showing loading progress to users.
   */
  onStateChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: ConnectionState) {
    this.connectionState = state;
    console.log('[Vizard]', state.message);
    this.stateListeners.forEach(l => l(state));
  }

  private async resolveFeePaymentMethod(wallet: Wallet): Promise<FeePaymentMethod | undefined> {
    if (this.feePaymentMethod) {
      return this.feePaymentMethod;
    }
    if (!this.config.feePaymentMethodProvider) {
      return undefined;
    }
    const method = await this.config.feePaymentMethodProvider(wallet);
    this.feePaymentMethod = method ?? null;
    return method;
  }

  private async initBarretenberg(): Promise<void> {
    if (this.bbInitialized) {
      return;
    }

    const { Barretenberg, BackendType } = await import('@aztec/bb.js') as typeof import('@aztec/bb.js');
    const logger = this.config.bbLog ? (msg: string) => console.log(`[Vizard][BB] ${msg}`) : undefined;
    const options: BackendOptions = {
      threads: this.config.bbThreads,
      wasmPath: this.config.bbWasmPath,
      logger,
    };

    if (this.config.bbBackend === 'wasm-worker') {
      options.backend = BackendType.WasmWorker;
    } else if (this.config.bbBackend === 'wasm') {
      options.backend = BackendType.Wasm;
    }

    try {
      await Barretenberg.initSingleton(options);
      this.bbInitialized = true;
    } catch (error) {
      console.warn('[Vizard] bb.js init failed:', error);
      if (options.backend === BackendType.WasmWorker) {
        console.warn('[Vizard] Retrying bb.js init with non-worker WASM backend...');
        await Barretenberg.initSingleton({
          threads: options.threads ?? 1,
          wasmPath: options.wasmPath,
          backend: BackendType.Wasm,
          logger,
        });
        this.bbInitialized = true;
      } else {
        this.bbInitialized = false;
        throw error;
      }
    }
  }

  /**
   * Connect to Aztec using MetaMask.
   *
   * Flow:
   * 1. Connect MetaMask
   * 2. Sign message to derive Aztec keys
   * 3. Connect to node
   * 4. Register/deploy ECDSA account
   */
  async connect(): Promise<Wallet> {
    if (this.accountWallet) {
      return this.accountWallet;
    }

    try {
      // Step 1: Connect MetaMask
      this.setState({ status: 'connecting', message: 'Connecting to MetaMask...' });

      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask not detected. Please install MetaMask.');
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      }) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts available. Please unlock MetaMask.');
      }

      this.evmAddress = accounts[0];
      console.log('[Vizard] MetaMask connected:', this.evmAddress);

      // Step 2: Derive Aztec keys from MetaMask signature
      this.setState({ status: 'deriving_keys', message: 'Sign to derive your Aztec keys...' });

      this.derivedKeys = await deriveAztecKeys(this.evmAddress);
      console.log('[Vizard] Keys derived from signature');

      // Step 3: Connect to node
      this.setState({ status: 'initializing_pxe', message: 'Connecting to Aztec node...' });

      this.node = await connectToPXE({ pxeUrl: this.config.pxeUrl });

      // Step 4: Create and register account
      this.setState({ status: 'registering', message: 'Registering Aztec account...' });

      const { wallet, address } = await this.setupAccount();
      this.accountWallet = wallet;
      this.aztecAddress = address;

      const shouldSync = this.config.autoSync ?? true;
      if (shouldSync) {
        this.setState({ status: 'syncing', message: 'Syncing private state...' });
        await this.syncPrivateState([address]);
      }

      this.setState({
        status: 'connected',
        message: `Connected! Aztec address: ${this.aztecAddress!.toString().slice(0, 10)}...`,
      });

      return this.accountWallet;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      this.setState({ status: 'disconnected', message });
      throw error;
    }
  }

  /**
   * Set up the ECDSA account contract using TestWallet.
   *
   * In Aztec v3, TestWallet has built-in createECDSAKAccount() method.
   * This creates the AccountManager and we then deploy the account contract.
   */
  private async setupAccount(): Promise<{ wallet: Wallet; address: AztecAddress }> {
    if (!this.node || !this.derivedKeys) {
      throw new Error('Not initialized');
    }

    // Import TestWallet (lazy loading for browser)
    const { TestWallet } = await import('@aztec/test-wallet/client/lazy');

    // Debug: Check if SharedArrayBuffer is available (required for multithreading)
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    const hasAtomics = typeof Atomics !== 'undefined';
    const hardwareConcurrency = navigator?.hardwareConcurrency ?? 'unknown';
    const crossOriginIsolated = (globalThis as any).crossOriginIsolated ?? false;

    console.log('[Vizard] ===== PROVER DEBUG INFO =====');
    console.log('[Vizard] SharedArrayBuffer available:', hasSharedArrayBuffer);
    console.log('[Vizard] Atomics available:', hasAtomics);
    console.log('[Vizard] crossOriginIsolated:', crossOriginIsolated);
    console.log('[Vizard] Hardware concurrency:', hardwareConcurrency);

    if (!crossOriginIsolated) {
      console.warn('[Vizard] WARNING: crossOriginIsolated is FALSE!');
      console.warn('[Vizard] SharedArrayBuffer may not work properly');
      console.warn('[Vizard] Check COOP/COEP headers');
    }

    if (!hasSharedArrayBuffer) {
      console.warn('[Vizard] WARNING: SharedArrayBuffer NOT available!');
      console.warn('[Vizard] This means WASM runs SINGLE-THREADED (very slow)');
      console.warn('[Vizard] Check that COOP/COEP headers are set correctly');
    } else {
      console.log('[Vizard] SharedArrayBuffer enabled - multithreading should work');
    }
    console.log('[Vizard] ================================');

    await this.initBarretenberg();

    console.log('[Vizard] Creating TestWallet...');

    // Get L1 contracts for proper prover configuration
    const l1Contracts = await this.node.getL1ContractAddresses();
    console.log('[Vizard] L1 contracts fetched');

    // Create TestWallet with prover enabled (required for valid proofs)
    // Use a per-node + per-account directory to avoid cross-account state bleed.
    const storeKey = this.config.pxeUrl.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const dataDirectory = `vizard-wallet/${storeKey}/${this.evmAddress?.toLowerCase() ?? 'unknown'}`;
    const testWallet = await TestWallet.create(this.node, {
      l1Contracts,
      proverEnabled: true,
      dataDirectory,
    });

    console.log('[Vizard] TestWallet created');

    // CRITICAL: Register FPC BEFORE creating account
    // This ensures the nullifier tree is synced for sponsored fee payments
    console.log('[Vizard] Registering SponsoredFPC...');
    let paymentMethod: FeePaymentMethod | undefined;
    if (this.config.feePaymentMethodProvider) {
      const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
      let fpcAvailable = false;
      try {
        const fpcInstance = await this.node.getContract(fpcAddress);
        fpcAvailable = !!fpcInstance;
        console.log('[Vizard] SponsoredFPC on-chain:', fpcAvailable);
      } catch (err) {
        console.warn('[Vizard] SponsoredFPC on-chain check failed:', err);
      }
      if (!fpcAvailable) {
        console.warn(
          '[Vizard] SponsoredFPC not found via getContract. Proceeding anyway (address from docs).'
        );
      }
      paymentMethod = await this.resolveFeePaymentMethod(testWallet);
      if (paymentMethod) {
        console.log('[Vizard] SponsoredFPC ready for fee payments');
      } else {
        console.log('[Vizard] No fee payment method configured');
      }
    } else {
      console.log('[Vizard] No fee payment method configured');
    }

    console.log('[Vizard] Creating ECDSA-K account...');

    // Use TestWallet's built-in createECDSAKAccount method
    // This creates an AccountManager with the ECDSA-K account contract
    const accountManager = await testWallet.createECDSAKAccount(
      this.derivedKeys.secretKey,
      this.derivedKeys.salt,
      this.derivedKeys.signingPrivateKey,
    );

    const address = accountManager.address;
    console.log('[Vizard] Account address:', address.toString());

    // Check if account is initialized using getContractMetadata
    // This checks the nullifier tree (siloNullifier) which is the source of truth
    // for whether a contract has been deployed/initialized
    console.log('[Vizard] Checking if account is initialized...');
    try {
      const metadata = await testWallet.getContractMetadata(address);
      console.log('[Vizard] Contract metadata:', {
        isInitialized: metadata.isContractInitialized,
        isPublished: metadata.isContractPublished,
        hasInstance: !!metadata.contractInstance,
      });

      if (metadata.isContractInitialized) {
        console.log('[Vizard] Account is already initialized (nullifier exists)');
      } else {
        console.log('[Vizard] Account NOT initialized. Deploying...');

        // Deploy the account contract with sponsored fees
        const deployMethod = await accountManager.getDeployMethod();
        const deployOpts = {
          from: AztecAddress.ZERO,
          skipInstancePublication: false,
          skipClassPublication: false,
          ...(paymentMethod ? { fee: { paymentMethod } } : {}),
        };

        console.log('[Vizard] Sending deploy transaction...');
        const tx = deployMethod.send(deployOpts);
        const txHash = await tx.getTxHash();
        console.log('[Vizard] Deploy tx hash:', txHash.toString());

        console.log('[Vizard] Waiting for deploy confirmation...');
        await tx.wait({ timeout: 300000 }); // 5 minute timeout
        console.log('[Vizard] Account contract deployed!');
      }
    } catch (metadataError) {
      console.error('[Vizard] Could not check contract metadata:', metadataError);
      throw metadataError;
    }

    console.log('[Vizard] Account ready');

    // Store TestWallet for reuse (e.g., creating deployer account for faucet)
    this.testWalletInstance = testWallet;

    // Enable simulated simulations to avoid ECDSA account note sync issues
    // This uses a fake account for simulations, bypassing auth witness generation
    if (typeof testWallet.enableSimulatedSimulations === 'function') {
      testWallet.enableSimulatedSimulations();
      console.log('[Vizard] Simulated simulations enabled');
    }

    // Register account as a sender so PXE can discover notes emitted by the account contract.
    try {
      await testWallet.registerSender(address);
      console.log('[Vizard] Account registered as sender');
    } catch (error) {
      console.warn('[Vizard] Account sender registration failed:', error);
    }

    // Pre-register deployer account for faucet (loads Schnorr WASM now instead of later)
    try {
      const { Fr, GrumpkinScalar } = await import('@aztec/aztec.js/fields');
      await testWallet.createSchnorrAccount(
        Fr.fromString('0x225fafae863538379b3c721e6d3ea2882b6369c027cb788b24dfb8e0fe3ac074'),
        Fr.fromString('0x0cc7c488dfd5333ce14c97de919e257c2bacbabbd3c2a2ca088957af1514584e'),
        (GrumpkinScalar as any).fromString('0x14670948755a44cb342ee08ab2dc8ca31a113e2ea20d6046d62bb5c8648e1df4'),
      );
      console.log('[Vizard] Deployer account pre-registered for faucet');
    } catch (e) {
      console.log('[Vizard] Deployer pre-registration skipped:', e);
    }

    // Return the testWallet (which now has this account registered) and address
    return { wallet: testWallet, address };
  }

  /**
   * Get the TestWallet instance for creating additional accounts.
   * Used internally for faucet functionality.
   */
  getTestWallet(): any {
    return this.testWalletInstance;
  }

  /**
   * Sync private state for one or more contract addresses.
   * PXE handles syncing after sender registration; this is a no-op logger.
   */
  async syncPrivateState(addresses: AztecAddress[]): Promise<void> {
    const wallet = this.accountWallet;
    if (!wallet) {
      throw new Error('Wallet not connected');
    }

    for (const address of addresses) {
      console.log(`[Vizard] Contract ${address.toString()} registered for sync`);
    }
  }

  /**
   * Disconnect wallet.
   */
  disconnect() {
    this.node = null;
    this.accountWallet = null;
    this.testWalletInstance = null;
    this.derivedKeys = null;
    this.evmAddress = null;
    this.aztecAddress = null;
    this.setState({ status: 'disconnected', message: 'Disconnected' });
  }

  /**
   * Get the connected account wallet.
   */
  getWallet(): Wallet | null {
    return this.accountWallet;
  }

  /**
   * Get the node instance.
   */
  getNode(): AztecNode | null {
    return this.node;
  }

  /**
   * Get the Aztec address.
   */
  getAztecAddress(): AztecAddress | null {
    return this.aztecAddress;
  }

  /**
   * Get the EVM address.
   */
  getEvmAddress(): string | null {
    return this.evmAddress;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connectionState.status === 'connected';
  }

  /**
   * Get the resolved fee payment method, if available.
   */
  getFeePaymentMethod(): FeePaymentMethod | null {
    return this.feePaymentMethod;
  }
}
