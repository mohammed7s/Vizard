/**
 * Deploy a Token contract on Aztec devnet (TypeScript version)
 *
 * This script uses the SDK directly with proper prover configuration.
 * The deployed token will have matching class IDs with the SDK artifacts.
 *
 * Usage: npx tsx scripts/deploy-token.ts [options]
 *
 * Options:
 *   --name <name>       Token name (default: "Test Token")
 *   --symbol <symbol>   Token symbol (default: "TEST")
 *   --decimals <num>    Token decimals (default: 6)
 *   --mint <amount>     Initial mint amount to admin (default: 1000000)
 *   --node <url>        Aztec node URL (default: https://next.devnet.aztec-labs.com)
 */

import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { TestWallet } from '@aztec/test-wallet/server';
import { getPXEConfig } from '@aztec/pxe/config';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { TokenContract } from '@aztec/noir-contracts.js/Token';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Defaults - Updated for devnet 20251212
const DEFAULT_NODE_URL = 'https://next.devnet.aztec-labs.com';
const DEFAULT_NAME = 'Test Token';
const DEFAULT_SYMBOL = 'TEST';
const DEFAULT_DECIMALS = 6;
const DEFAULT_MINT_AMOUNT = 1_000_000n; // 1M tokens

// Known Sponsored FPC address on devnet
const SPONSORED_FPC_ADDRESS = '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e';

interface Config {
  nodeUrl: string;
  name: string;
  symbol: string;
  decimals: number;
  mintAmount: bigint;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    nodeUrl: DEFAULT_NODE_URL,
    name: DEFAULT_NAME,
    symbol: DEFAULT_SYMBOL,
    decimals: DEFAULT_DECIMALS,
    mintAmount: DEFAULT_MINT_AMOUNT,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        config.name = args[++i];
        break;
      case '--symbol':
        config.symbol = args[++i];
        break;
      case '--decimals':
        config.decimals = parseInt(args[++i], 10);
        break;
      case '--mint':
        config.mintAmount = BigInt(args[++i]);
        break;
      case '--node':
        config.nodeUrl = args[++i];
        break;
      case '--help':
        console.log(`
Deploy a Token contract on Aztec devnet

Usage: npx tsx scripts/deploy-token.ts [options]

Options:
  --name <name>       Token name (default: "${DEFAULT_NAME}")
  --symbol <symbol>   Token symbol (default: "${DEFAULT_SYMBOL}")
  --decimals <num>    Token decimals (default: ${DEFAULT_DECIMALS})
  --mint <amount>     Initial mint amount to admin (default: ${DEFAULT_MINT_AMOUNT})
  --node <url>        Aztec node URL (default: ${DEFAULT_NODE_URL})
  --help              Show this help message
`);
        process.exit(0);
    }
  }

  return config;
}

async function getSponsoredPaymentMethod(wallet: TestWallet) {
  console.log('  Setting up sponsored fee payment...');
  const fpcAddress = AztecAddress.fromString(SPONSORED_FPC_ADDRESS);
  console.log('  Using Sponsored FPC at:', fpcAddress.toString());

  // Register the contract with the wallet
  try {
    const instance = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContract.artifact,
      {
        salt: new Fr(0),
        deployer: AztecAddress.ZERO,
      }
    );
    await wallet.registerContract(instance, SponsoredFPCContract.artifact);
    console.log('  Sponsored FPC registered');
  } catch (err: any) {
    console.log('  (Already registered or using known address)');
  }

  return new SponsoredFeePaymentMethod(fpcAddress);
}

function saveDeploymentData(data: Record<string, string>) {
  const dataPath = path.join(__dirname, 'token-deployment.json');
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`\nDeployment data saved to: ${dataPath}`);
}

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('Deploy Token Contract on Aztec (TypeScript)');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log('  Node URL:', config.nodeUrl);
  console.log('  Token Name:', config.name);
  console.log('  Token Symbol:', config.symbol);
  console.log('  Decimals:', config.decimals);
  console.log('  Initial Mint:', config.mintAmount.toString());
  console.log('');

  // Step 1: Connect to node
  console.log('[1/6] Connecting to Aztec node...');
  const node = createAztecNodeClient(config.nodeUrl);
  const blockNumber = await node.getBlockNumber();
  console.log('  Connected! Block:', blockNumber);

  // Get L1 contracts for proper config
  console.log('  Fetching L1 contract addresses...');
  const l1Contracts = await node.getL1ContractAddresses();

  // Step 2: Create TestWallet with prover enabled
  console.log('\n[2/6] Creating TestWallet with prover...');
  // The key difference: enable prover for valid proof generation
  const pxeConfig = {
    ...getPXEConfig(),
    l1Contracts,
    proverEnabled: true,
  };
  const wallet = await TestWallet.create(node, pxeConfig);
  console.log('  TestWallet created with prover enabled');

  // Step 3: Setup sponsored fees
  console.log('\n[3/6] Setting up sponsored fees...');
  const paymentMethod = await getSponsoredPaymentMethod(wallet);

  // Step 4: Create deployer account
  console.log('\n[4/6] Creating deployer account...');
  const deployerSecretKey = Fr.random();
  const deployerSalt = new Fr(0);  // Use 0 for salt
  const deployerSigningKey = GrumpkinScalar.random();

  const deployerAccount = await wallet.createSchnorrAccount(
    deployerSecretKey,
    deployerSalt,
    deployerSigningKey,
  );
  console.log('  Deployer address:', deployerAccount.address.toString());

  // Check if deployer needs deployment
  const hasInitializer = await deployerAccount.hasInitializer();
  if (hasInitializer) {
    console.log('  Deploying deployer account contract...');
    console.log('  (This may take 1-2 minutes for proof generation)');
    const deployMethod = await deployerAccount.getDeployMethod();
    const tx = await deployMethod.send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod },
    });
    console.log('  Tx:', (await tx.getTxHash()).toString());
    console.log('  Waiting for confirmation...');
    await tx.wait({ timeout: 600000 });
    console.log('  Deployer account deployed!');
  } else {
    console.log('  Deployer account already deployed');
  }

  // Step 5: Deploy Token contract
  console.log('\n[5/6] Deploying Token contract...');
  console.log('  This may take 2-5 minutes for proof generation...');

  const tokenContract = await TokenContract.deploy(
    wallet,
    deployerAccount.address, // admin
    config.name,
    config.symbol,
    config.decimals,
  )
    .send({
      from: deployerAccount.address,
      fee: { paymentMethod },
    })
    .deployed({ timeout: 600000 });

  console.log('  Token deployed at:', tokenContract.address.toString());

  // Get class ID safely
  let tokenClassId = 'unknown';
  try {
    if (tokenContract.instance?.currentContractClassId) {
      tokenClassId = tokenContract.instance.currentContractClassId.toString();
    }
  } catch (e) {
    console.log('  (Could not read class ID)');
  }
  console.log('  Token class ID:', tokenClassId);

  // Save keys IMMEDIATELY in case later steps fail
  const earlyDeploymentData = {
    tokenAddress: tokenContract.address.toString(),
    tokenClassId,
    tokenName: config.name,
    tokenSymbol: config.symbol,
    tokenDecimals: config.decimals.toString(),
    adminAddress: deployerAccount.address.toString(),
    deployerSecretKey: deployerSecretKey.toString(),
    deployerSalt: deployerSalt.toString(),
    deployerSigningKey: deployerSigningKey.toString(),
    nodeUrl: config.nodeUrl,
    deployedAt: new Date().toISOString(),
  };
  saveDeploymentData(earlyDeploymentData);
  console.log('  Keys saved to token-deployment.json');

  // Step 6: Mint initial tokens to admin
  if (config.mintAmount > 0n) {
    console.log('\n[6/6] Minting initial tokens to admin...');
    const mintAmount = config.mintAmount * 10n ** BigInt(config.decimals);

    const mintTx = await tokenContract.methods
      .mint_to_public(deployerAccount.address, mintAmount)
      .send({
        from: deployerAccount.address,
        fee: { paymentMethod },
      });

    console.log('  Tx:', (await mintTx.getTxHash()).toString());
    console.log('  Waiting for confirmation...');
    await mintTx.wait({ timeout: 600000 });
    console.log('  Minted', config.mintAmount.toString(), config.symbol, 'to admin');
  } else {
    console.log('\n[6/6] Skipping initial mint (amount is 0)');
  }

  // Save deployment data
  const deploymentData = {
    tokenAddress: tokenContract.address.toString(),
    tokenClassId: tokenContract.instance.currentContractClassId.toString(),
    tokenName: config.name,
    tokenSymbol: config.symbol,
    tokenDecimals: config.decimals.toString(),
    adminAddress: deployerAccount.address.toString(),
    deployerSecretKey: deployerSecretKey.toString(),
    deployerSalt: deployerSalt.toString(),
    deployerSigningKey: deployerSigningKey.toString(),
    nodeUrl: config.nodeUrl,
    deployedAt: new Date().toISOString(),
  };

  saveDeploymentData(deploymentData);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Token Contract:', tokenContract.address.toString());
  console.log('Token Class ID:', tokenContract.instance.currentContractClassId.toString());
  console.log('Admin Address: ', deployerAccount.address.toString());
  console.log('');
  console.log('Admin Keys (SAVE THESE to mint more tokens):');
  console.log('  Secret Key:  ', deployerSecretKey.toString());
  console.log('  Salt:        ', deployerSalt.toString());
  console.log('  Signing Key: ', deployerSigningKey.toString());
  console.log('');
  console.log('The token class ID matches the SDK artifact, so the frontend');
  console.log('will be able to interact with this contract correctly.');
  console.log('');
}

main().catch((err) => {
  console.error('Error:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
