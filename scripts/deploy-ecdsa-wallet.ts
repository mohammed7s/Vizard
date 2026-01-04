/**
 * Deploy an ECDSA-K wallet on Aztec devnet
 *
 * Usage: npx tsx scripts/deploy-ecdsa-wallet.ts [--secret <hex>] [--signing-key <hex>]
 *
 * If no keys provided, generates random ones.
 * Outputs the keys and address for later use.
 */

import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { TestWallet } from '@aztec/test-wallet/server';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { randomBytes } from 'crypto';

// Config - Updated for devnet 20251212
const AZTEC_NODE_URL = 'https://next.devnet.aztec-labs.com';
const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

async function getSponsoredPaymentMethod(wallet: TestWallet) {
  const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);

  // Try to register the contract
  try {
    const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      { salt: new Fr(0) },
    );
    await wallet.registerContract(sponsoredFPCInstance, SponsoredFPCContract.artifact);
  } catch (err) {
    // May already be registered
  }

  return new SponsoredFeePaymentMethod(fpcAddress);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let secret: string | undefined;
  let signingKey: string | undefined;
  let salt: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--secret' && args[i + 1]) {
      secret = args[i + 1];
      i++;
    } else if (args[i] === '--signing-key' && args[i + 1]) {
      signingKey = args[i + 1];
      i++;
    } else if (args[i] === '--salt' && args[i + 1]) {
      salt = args[i + 1];
      i++;
    }
  }

  return { secret, signingKey, salt };
}

function generateRandomHex(bytes: number): string {
  return '0x' + randomBytes(bytes).toString('hex');
}

async function main() {
  const { secret, signingKey, salt } = parseArgs();

  // Generate or use provided keys
  const secretKey = secret || generateRandomHex(32);
  const saltValue = salt || generateRandomHex(32);
  const ecdsaSigningKey = signingKey || generateRandomHex(32);

  console.log('='.repeat(60));
  console.log('Deploy ECDSA-K Wallet on Aztec Devnet');
  console.log('='.repeat(60));
  console.log('');
  console.log('Keys (SAVE THESE!):');
  console.log('-'.repeat(60));
  console.log('Secret Key:      ', secretKey);
  console.log('Salt:            ', saltValue);
  console.log('ECDSA Signing Key:', ecdsaSigningKey);
  console.log('-'.repeat(60));
  console.log('');

  // Connect to node
  console.log('[1/4] Connecting to Aztec node...');
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  const blockNumber = await node.getBlockNumber();
  console.log('  Connected! Block:', blockNumber);

  // Create TestWallet with prover configuration
  console.log('\n[2/4] Creating TestWallet...');
  const l1Contracts = await node.getL1ContractAddresses();
  console.log('  L1 contracts fetched');

  const testWallet = await TestWallet.create(node, {
    l1Contracts,
    proverEnabled: true,
  });
  console.log('  TestWallet created (prover enabled)');

  // Get sponsored fee payment
  const paymentMethod = await getSponsoredPaymentMethod(testWallet);
  console.log('  Sponsored FPC registered');

  // Create ECDSA-K account
  console.log('\n[3/4] Creating ECDSA-K account...');
  const signingKeyBuffer = Buffer.from(ecdsaSigningKey.slice(2), 'hex');
  const accountManager = await testWallet.createECDSAKAccount(
    Fr.fromString(secretKey),
    Fr.fromString(saltValue),
    signingKeyBuffer,
  );

  const address = accountManager.address;
  console.log('  Account address:', address.toString());

  // Check if already deployed
  const hasInitializer = await accountManager.hasInitializer();
  console.log('  Needs deployment:', hasInitializer);

  if (!hasInitializer) {
    console.log('\n  Account already deployed!');
  } else {
    // Deploy account
    console.log('\n[4/4] Deploying account contract...');
    const deployMethod = await accountManager.getDeployMethod();

    const tx = await deployMethod.send({
      from: AztecAddress.ZERO,  // Use ZERO for deployment - account doesn't exist yet!
      fee: { paymentMethod },
    });

    const txHash = await tx.getTxHash();
    console.log('  Tx:', txHash.toString());
    console.log('  Waiting for confirmation (this may take 2-3 minutes)...');

    await tx.wait({ timeout: 300000 });
    console.log('  Account deployed!');
  }

  // Verify deployment
  const account = await accountManager.getAccount();
  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Wallet Address:', address.toString());
  console.log('');
  console.log('To use this wallet later, save these keys:');
  console.log('');
  console.log(`  --secret "${secretKey}" \\`);
  console.log(`  --salt "${saltValue}" \\`);
  console.log(`  --signing-key "${ecdsaSigningKey}"`);
  console.log('');
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
