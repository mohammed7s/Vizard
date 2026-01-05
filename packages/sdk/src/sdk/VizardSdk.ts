import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractArtifact } from '@aztec/aztec.js/abi';
import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import type { Wallet } from '@aztec/aztec.js/wallet';

import { getSponsoredPaymentMethod } from '../fees/sponsored';
import { VizardWallet, type ConnectionState } from '../wallet/VizardWallet';

export interface VizardSdkConfig {
  pxeUrl: string;
  feeMode?: 'sponsored' | 'none';
  autoSync?: boolean;
  bbWasmPath?: string;
  bbThreads?: number;
  bbBackend?: 'wasm-worker' | 'wasm';
  bbLog?: boolean;
}

type ContractWrapper<T> = {
  artifact: ContractArtifact;
  at: (address: AztecAddress, wallet: Wallet) => T;
};

export class VizardSdk {
  private wallet: VizardWallet;
  private feePaymentMethod: FeePaymentMethod | null = null;
  private feeMode: 'sponsored' | 'none';
  private registeredContracts: Set<string> = new Set();

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

  async contractAt<T>(contract: ContractWrapper<T>, address: string | AztecAddress, register = true): Promise<T> {
    const wallet = this.getWallet();
    const node = this.getNode();
    if (!wallet || !node) {
      throw new Error('Wallet not connected');
    }

    const aztecAddress = typeof address === 'string' ? AztecAddress.fromString(address) : address;
    const addressKey = aztecAddress.toString().toLowerCase();

    if (register && !this.registeredContracts.has(addressKey)) {
      const instance = await node.getContract(aztecAddress);
      if (!instance) {
        throw new Error(`Contract not found at ${aztecAddress.toString()}. Make sure it is deployed on this network.`);
      }
      await wallet.registerContract(instance, contract.artifact);
      this.registeredContracts.add(addressKey);
      await this.wallet.syncPrivateState([aztecAddress]);
    }

    return contract.at(aztecAddress, wallet);
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
}
