/**
 * Transfer tokens from ECDSA account to another address
 * Uses native prover (fast ~50s vs browser WASM 30+ minutes)
 *
 * Usage: npx tsx scripts/transfer-tokens.ts
 */

import { Fr } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TestWallet } from '@aztec/test-wallet/server';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import { keccak256, toBytes, concat } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============= CONFIGURATION =============

// Your MetaMask private key (same one used to derive ECDSA account)
const ETH_PRIVATE_KEY = '0x5d01b7093f311780f9b27cb7d1b5a24bb01558dc944d4060595ced2c6eb02054';

// Token contract address
const TOKEN_ADDRESS = '0x1f82c5ab43b5dc0d9c3224759f6ced5d12774386d163d315a8a0c3550add1fd9';

// Recipient address
const RECIPIENT_ADDRESS = '0x117bbe3f8f81381312fcc813373febb991f55d847006cbf21f54345e23716f66';

// Amount to transfer (in raw units - 1000000 = 1 USDC with 6 decimals)
const TRANSFER_AMOUNT = 1000000n; // 1 USDC

// ============= END CONFIGURATION =============

const AZTEC_NODE_URL = 'https://next.devnet.aztec-labs.com';
const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';
const DERIVATION_VERSION = 'vizard-v1';

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
  console.log('='.repeat(60));
  console.log('Transfer Tokens from ECDSA Account');
  console.log('='.repeat(60));
  console.log('');

  // Derive ECDSA account from ETH private key
  const account = privateKeyToAccount(ETH_PRIVATE_KEY as `0x${string}`);
  const evmAddress = account.address.toLowerCase();

  console.log('EVM Address:', evmAddress);
  console.log('Token:', TOKEN_ADDRESS);
  console.log('Recipient:', RECIPIENT_ADDRESS);
  console.log('Amount:', TRANSFER_AMOUNT.toString());
  console.log('');

  // Sign derivation message
  const message = createDerivationMessage(evmAddress);
  const signature = await account.signMessage({ message });

  // Derive Aztec keys
  const secretKey = deriveSecretKey(signature);
  const salt = deriveSalt(signature);
  const signingKey = deriveSigningKey(signature);

  console.log('[1/5] Connecting to Aztec node...');
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  const blockNumber = await node.getBlockNumber();
  console.log('  Connected! Block:', blockNumber);

  console.log('\n[2/5] Creating TestWallet...');
  const l1Contracts = await node.getL1ContractAddresses();
  const testWallet = await TestWallet.create(node, { l1Contracts, proverEnabled: true });
  console.log('  TestWallet created');

  const paymentMethod = await getSponsoredPaymentMethod(testWallet);
  console.log('  Sponsored FPC registered');

  console.log('\n[3/5] Creating ECDSA-K account...');
  const accountManager = await testWallet.createECDSAKAccount(secretKey, salt, signingKey);
  const senderAddress = accountManager.address;
  console.log('  Sender address:', senderAddress.toString());

  console.log('\n[4/5] Registering token contract...');
  const tokenAddress = AztecAddress.fromString(TOKEN_ADDRESS);
  const tokenInstance = await node.getContract(tokenAddress);

  if (!tokenInstance) {
    console.error('Token contract not found!');
    process.exit(1);
  }

  await testWallet.registerContract(tokenInstance, TokenContract.artifact);
  console.log('  Token registered');

  // Check balance first
  const token = await TokenContract.at(tokenAddress, testWallet);
  try {
    const balance = await token.methods.balance_of_public(senderAddress).simulate({ from: senderAddress });
    console.log('  Current balance:', balance.toString());

    if (balance < TRANSFER_AMOUNT) {
      console.error('  Insufficient balance!');
      process.exit(1);
    }
  } catch (e) {
    console.log('  Could not check balance, proceeding anyway...');
  }

  console.log('\n[5/5] Sending transfer...');
  console.log('  This may take ~1 minute for proof generation...');

  const recipientAddress = AztecAddress.fromString(RECIPIENT_ADDRESS);

  const tx = await token.methods
    .transfer_in_public(senderAddress, recipientAddress, TRANSFER_AMOUNT, 0)
    .send({
      from: senderAddress,
      fee: { paymentMethod },
    });

  console.log('  Tx:', (await tx.getTxHash()).toString());
  console.log('  Waiting for confirmation...');
  await tx.wait({ timeout: 300000 });

  // Check new balance
  try {
    const newBalance = await token.methods.balance_of_public(senderAddress).simulate({ from: senderAddress });
    console.log('  New balance:', newBalance.toString());
  } catch (e) {
    console.log('  Could not check new balance');
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Transferred', TRANSFER_AMOUNT.toString(), 'tokens');
  console.log('From:', senderAddress.toString());
  console.log('To:', recipientAddress.toString());
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
