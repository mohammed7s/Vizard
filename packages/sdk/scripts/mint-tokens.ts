/**
 * Mint tokens to a user address using the deployer account from CLI wallet
 *
 * Usage: npx tsx scripts/mint-tokens.ts --to <aztec-address> --amount <amount>
 */

import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TestWallet } from '@aztec/test-wallet/server';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { TokenContract } from '@aztec/noir-contracts.js/Token';

const AZTEC_NODE_URL = 'https://next.devnet.aztec-labs.com';
const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

// From token-deployment.json (deployed via deploy-token.ts)
const TOKEN_ADDRESS = '0x1f82c5ab43b5dc0d9c3224759f6ced5d12774386d163d315a8a0c3550add1fd9';
const DEPLOYER_ADDRESS = '0x1f428d2f8913b040f00bbbb1e10e9c3081cacb941f4e6ac66e28520782e554ff';
const DEPLOYER_SECRET_KEY = '0x1035a0445ae39c2bd2ec1eef5fa2b415e8c8522d7265e2eeecc64f483d3e66fa';
const DEPLOYER_SIGNING_KEY = '0x155f2de70705a06a0dca13004f949bc197c2431baa23d9d428eb448bc48db83a';

function parseArgs() {
  const args = process.argv.slice(2);
  let to: string | undefined;
  let amount = 1000000000n; // Default: 1000 tokens with 6 decimals

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      to = args[i + 1];
      i++;
    } else if (args[i] === '--amount' && args[i + 1]) {
      amount = BigInt(args[i + 1]);
      i++;
    }
  }

  return { to, amount };
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
  const { to, amount } = parseArgs();

  if (!to) {
    console.log('Usage: npx tsx scripts/mint-tokens.ts --to <aztec-address> [--amount <amount>]');
    console.log('');
    console.log('Example: npx tsx scripts/mint-tokens.ts --to 0x02dac2d0d4b350a303528c9ff1f20be944ee55a53384b79edb7fbc01bac536bb --amount 1000000000');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Mint Tokens');
  console.log('='.repeat(60));
  console.log('');
  console.log('Token:', TOKEN_ADDRESS);
  console.log('Recipient:', to);
  console.log('Amount:', amount.toString());
  console.log('');

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

  console.log('\n[3/5] Registering deployer account...');
  // We need to create the deployer account with matching keys
  // The deployer is a Schnorr account - we need to retrieve its keys
  // For now, let's try importing from the CLI wallet's stored data

  console.log('\n[4/5] Registering token contract...');
  const tokenAddress = AztecAddress.fromString(TOKEN_ADDRESS);
  const tokenInstance = await node.getContract(tokenAddress);

  if (!tokenInstance) {
    console.error('Token contract not found at', TOKEN_ADDRESS);
    process.exit(1);
  }

  await testWallet.registerContract(tokenInstance, TokenContract.artifact);
  console.log('  Token contract registered');

  // Create deployer account with known keys from token-deployment.json
  const deployerSecretKey = Fr.fromString(DEPLOYER_SECRET_KEY);
  const deployerSalt = new Fr(0);
  const deployerSigningKey = GrumpkinScalar.fromBuffer(Buffer.from(DEPLOYER_SIGNING_KEY.slice(2), 'hex'));

  const deployerAccount = await testWallet.createSchnorrAccount(
    deployerSecretKey,
    deployerSalt,
    deployerSigningKey,
  );

  console.log('  Deployer account address:', deployerAccount.address.toString());
  console.log('  Expected address:', DEPLOYER_ADDRESS);

  if (deployerAccount.address.toString().toLowerCase() !== DEPLOYER_ADDRESS.toLowerCase()) {
    console.log('  WARNING: Address mismatch! The keys may not be correct.');
    console.log('  Trying to continue anyway...');
  } else {
    console.log('  Keys match!');
  }

  console.log('\n[5/5] Minting tokens...');
  const recipientAddress = AztecAddress.fromString(to);
  const token = await TokenContract.at(tokenAddress, testWallet);

  const tx = await token.methods
    .mint_to_public(recipientAddress, amount)
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod },
    });

  console.log('  Tx:', (await tx.getTxHash()).toString());
  console.log('  Waiting for confirmation...');
  await tx.wait({ timeout: 300000 });

  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Minted', amount.toString(), 'tokens to', to);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
