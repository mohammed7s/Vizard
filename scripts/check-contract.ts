/**
 * Check if a contract exists on devnet
 */
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';

const node = createAztecNodeClient('https://next.devnet.aztec-labs.com');
const tokenAddress = AztecAddress.fromString('0x1f82c5ab43b5dc0d9c3224759f6ced5d12774386d163d315a8a0c3550add1fd9');

async function check() {
  console.log('Checking token contract on devnet...');
  console.log('Token address:', tokenAddress.toString());

  const block = await node.getBlockNumber();
  console.log('Current block:', block);

  const contract = await node.getContract(tokenAddress);
  if (contract) {
    console.log('Contract FOUND!');
    console.log('  Class ID:', contract.currentContractClassId.toString());
    console.log('  Deployer:', contract.deployer?.toString() || 'N/A');
  } else {
    console.log('Contract NOT FOUND');
  }
}

check().catch(console.error);
