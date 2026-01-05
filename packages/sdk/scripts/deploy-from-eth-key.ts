/**
 * Deploy ECDSA-K account using an Ethereum private key
 *
 * This signs the same message as the browser SDK and deploys the account.
 * Use your MetaMask private key to deploy the same account the browser would create.
 *
 * Usage: npx tsx scripts/deploy-from-eth-key.ts --key 0x...
 */

import { Fr } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { TestWallet } from '@aztec/test-wallet/server';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { keccak256, toBytes, concat } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const AZTEC_NODE_URL = 'https://next.devnet.aztec-labs.com';
const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';
const DERIVATION_VERSION = 'vizard-v1';

function parseArgs() {
  const args = process.argv.slice(2);
  let key: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) {
      key = args[i + 1];
      i++;
    }
  }

  return { key };
}

function createDerivationMessage(evmAddress: string): string {
  return [
    'Vizard Aztec Wallet',
    '',
    'Sign this message to derive your Aztec private keys.',
    'This signature will NOT be sent to any server.',
    '',
    `Version: ${DERIVATION_VERSION}`,
    `Address: ${evmAddress}`,
  ].join('\n');
}

function deriveSecretKey(signature: string): Fr {
  const hash = keccak256(concat([toBytes(signature), toBytes('vizard:secret')]));
  return Fr.fromBuffer(Buffer.from(hash.slice(2), 'hex'));
}

function deriveSalt(signature: string): Fr {
  const hash = keccak256(concat([toBytes(signature), toBytes('vizard:salt')]));
  return Fr.fromBuffer(Buffer.from(hash.slice(2), 'hex'));
}

function deriveSigningKey(signature: string): Buffer {
  const hash = keccak256(concat([toBytes(signature), toBytes('vizard:signing')]));
  return Buffer.from(hash.slice(2), 'hex');
}

async function getSponsoredPaymentMethod(wallet: TestWallet) {
  const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  try {
    const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      { salt: new Fr(0) },
    );
    await wallet.registerContract(sponsoredFPCInstance, SponsoredFPCContract.artifact);
  } catch (err) {}
  return new SponsoredFeePaymentMethod(fpcAddress);
}

async function main() {
  const { key } = parseArgs();

  if (!key) {
    console.log('Usage: npx tsx scripts/deploy-from-eth-key.ts --key 0x...');
    console.log('');
    console.log('Provide your MetaMask private key to deploy the same account the browser would create.');
    process.exit(1);
  }

  // Create account from private key
  const account = privateKeyToAccount(key as `0x${string}`);
  // IMPORTANT: Use lowercase to match browser's MetaMask behavior
  const evmAddress = account.address.toLowerCase();

  console.log('='.repeat(60));
  console.log('Deploy MetaMask Account on Aztec Devnet');
  console.log('='.repeat(60));
  console.log('');
  console.log('EVM Address:', evmAddress);

  // Sign the derivation message (same as browser)
  const message = createDerivationMessage(evmAddress);
  const signature = await account.signMessage({ message });
  console.log('Signature:', signature.slice(0, 30) + '...');

  // Derive Aztec keys from signature
  const secretKey = deriveSecretKey(signature);
  const salt = deriveSalt(signature);
  const signingKey = deriveSigningKey(signature);

  console.log('');
  console.log('[1/4] Connecting to Aztec node...');
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  const blockNumber = await node.getBlockNumber();
  console.log('  Connected! Block:', blockNumber);

  console.log('\n[2/4] Creating TestWallet...');
  const l1Contracts = await node.getL1ContractAddresses();
  const testWallet = await TestWallet.create(node, { l1Contracts, proverEnabled: true });
  console.log('  TestWallet created');

  const paymentMethod = await getSponsoredPaymentMethod(testWallet);
  console.log('  Sponsored FPC registered');

  // Sync FPC to ensure nullifier tree is up to date
  const fpcAddress = AztecAddress.fromString('0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e');
  await testWallet.registerSender(fpcAddress);
  console.log('  FPC registered as sender');

  console.log('\n[3/4] Creating ECDSA-K account...');
  const accountManager = await testWallet.createECDSAKAccount(secretKey, salt, signingKey);
  const accountAddress = accountManager.address;
  console.log('  Aztec Address:', accountAddress.toString());

  const existingContract = await node.getContract(accountAddress);
  if (existingContract) {
    console.log('\n  Account already deployed!');
  } else {
    console.log('\n[4/4] Deploying account contract...');
    const deployMethod = await accountManager.getDeployMethod();
    // IMPORTANT: skipInstancePublication: false to make contract publicly visible
    // Deploy with instance publication enabled
    const tx = await deployMethod.send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod },
      skipInstancePublication: false,
      skipClassPublication: true, // Class is already registered
    });

    console.log('  Tx:', (await tx.getTxHash()).toString());
    console.log('  Waiting for confirmation...');
    await tx.wait({ timeout: 300000 });
    console.log('  Account deployed!');
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS!');
  console.log('='.repeat(60));
  console.log('');
  console.log('EVM Address:   ', evmAddress);
  console.log('Aztec Address: ', accountAddress.toString());
  console.log('');
  console.log('Now use this MetaMask account in the browser - it will work!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
