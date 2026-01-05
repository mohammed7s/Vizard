import { Fr } from '@aztec/aztec.js/fields';
import { TestWallet } from '@aztec/test-wallet/server';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { keccak256, toBytes, concat } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const key = '0x5d01b7093f311780f9b27cb7d1b5a24bb01558dc944d4060595ced2c6eb02054';
const account = privateKeyToAccount(key);
const evmAddress = account.address.toLowerCase();

const message = [
  'Vizard Aztec Wallet',
  '',
  'Sign this message to derive your Aztec private keys.',
  'This signature will NOT be sent to any server.',
  '',
  'Version: vizard-v1',
  'Address: ' + evmAddress,
].join('\n');

async function main() {
  const signature = await account.signMessage({ message });
  const secretKey = Fr.fromBuffer(Buffer.from(keccak256(concat([toBytes(signature), toBytes('vizard:secret')])).slice(2), 'hex'));
  const salt = Fr.fromBuffer(Buffer.from(keccak256(concat([toBytes(signature), toBytes('vizard:salt')])).slice(2), 'hex'));
  const signingKey = Buffer.from(keccak256(concat([toBytes(signature), toBytes('vizard:signing')])).slice(2), 'hex');

  const node = createAztecNodeClient('https://next.devnet.aztec-labs.com');
  const block = await node.getBlockNumber();
  console.log('Block:', block);

  const l1Contracts = await node.getL1ContractAddresses();
  const testWallet = await TestWallet.create(node, { l1Contracts, proverEnabled: true });
  const accountManager = await testWallet.createECDSAKAccount(secretKey, salt, signingKey);

  console.log('Account address:', accountManager.address.toString());
  console.log('Has initializer:', await accountManager.hasInitializer());

  // Check via node
  const nodeContract = await node.getContract(accountManager.address);
  console.log('node.getContract result:', nodeContract);

  // Check if account is deployed via accountManager
  try {
    const acc = await accountManager.getAccount();
    console.log('accountManager.getAccount() succeeded');
    console.log('Account complete key:', acc.getCompleteAddress().toString());
  } catch (e) {
    console.log('accountManager.getAccount() error:', e.message);
  }
}

main().catch(console.error);
