/**
 * Node/PXE Connection
 *
 * Connects to an existing Aztec node (sandbox or hosted).
 *
 * In v3, we use createAztecNodeClient instead of createPXEClient.
 */

import { createAztecNodeClient, waitForNode, type AztecNode } from '@aztec/aztec.js/node';

export interface PXEConfig {
  /** Node URL (e.g., http://localhost:8080 for sandbox) */
  pxeUrl: string;
}

/**
 * Connect to an Aztec node.
 */
export async function connectToPXE(config: PXEConfig): Promise<AztecNode> {
  const { pxeUrl } = config;

  console.log('[Vizard] Connecting to Aztec node at', pxeUrl);

  const node = createAztecNodeClient(pxeUrl);

  // Wait for node to be ready
  try {
    await waitForNode(node);
    const blockNumber = await node.getBlockNumber();
    console.log('[Vizard] Connected to Aztec node, block:', blockNumber);
  } catch (error) {
    throw new Error(`Failed to connect to Aztec node at ${pxeUrl}: ${error}`);
  }

  return node;
}

/**
 * Check if sandbox is running locally.
 */
export async function isSandboxRunning(url = 'http://localhost:8080'): Promise<boolean> {
  try {
    const node = createAztecNodeClient(url);
    await waitForNode(node);
    return true;
  } catch {
    return false;
  }
}
