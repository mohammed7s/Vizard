import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';

const SPONSORED_FPC_SALT = new Fr(0);

// Known FPC address on devnet
export const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

export async function getSponsoredPaymentMethod(wallet: Wallet) {
  const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);

  // Register the contract
  try {
    const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      { salt: SPONSORED_FPC_SALT },
    );

    await wallet.registerContract(
      sponsoredFPCInstance,
      SponsoredFPCContract.artifact,
    );
    console.log('[Vizard] SponsoredFPC contract registered');
  } catch (err) {
    // May already be registered
    console.log('[Vizard] SponsoredFPC contract registration skipped (may already exist)');
  }

  // CRITICAL: Register FPC as a sender so PXE syncs its nullifier tree
  // This is required for sponsored fee payments to work
  try {
    await wallet.registerSender(fpcAddress);
    console.log('[Vizard] SponsoredFPC registered as sender');
  } catch (err) {
    console.log('[Vizard] SponsoredFPC sender registration skipped:', err);
  }

  // Note: private state sync is handled by PXE after sender registration.

  return new SponsoredFeePaymentMethod(fpcAddress);
}
