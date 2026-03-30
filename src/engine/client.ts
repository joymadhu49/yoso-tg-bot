import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  concat,
  pad,
  numberToHex,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

import {
  ALCHEMY_RPC_URL,
  ALCHEMY_API_KEY,
  ALCHEMY_POLICY_ID,
  ENTRYPOINT_V07,
} from './config.js';
import { entryPointV07Abi } from './contracts.js';

export type UserOperation = {
  sender: Address;
  nonce: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  signature: Hex;
};

// Shared public client (same for all users — just reads chain state)
let _publicClient: any = null;

export function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: base,
      transport: http(ALCHEMY_RPC_URL),
    });
  }
  return _publicClient!;
}

function getBundlerUrl(): string {
  return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

async function bundlerRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(getBundlerUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data: any = await res.json();
  if (data.error) {
    throw new Error(`RPC error (${method}): ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

export async function getNonce(smartAccountAddress: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: ENTRYPOINT_V07,
    abi: entryPointV07Abi,
    functionName: 'getNonce',
    args: [smartAccountAddress, 0n],
  });
}

const DUMMY_SIGNATURE: Hex =
  '0x00fffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c';

export async function requestGasAndPaymaster(
  smartAccountAddress: Address,
  callData: Hex,
  nonce: Hex,
): Promise<{
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
}> {
  return bundlerRpc('alchemy_requestGasAndPaymasterAndData', [
    {
      policyId: ALCHEMY_POLICY_ID,
      entryPoint: ENTRYPOINT_V07,
      userOperation: {
        sender: smartAccountAddress,
        nonce,
        callData,
        signature: DUMMY_SIGNATURE,
      },
      dummySignature: DUMMY_SIGNATURE,
      overrides: {
        maxFeePerGas: { multiplier: 1.5 },
        maxPriorityFeePerGas: { multiplier: 1.05 },
      },
    },
  ]);
}

function hashUserOp(userOp: UserOperation): Hex {
  const hashedInitCode = keccak256('0x');
  const hashedCallData = keccak256(userOp.callData);

  const accountGasLimits = concat([
    pad(userOp.verificationGasLimit as Hex, { size: 16 }),
    pad(userOp.callGasLimit as Hex, { size: 16 }),
  ]);

  const gasFees = concat([
    pad(userOp.maxPriorityFeePerGas as Hex, { size: 16 }),
    pad(userOp.maxFeePerGas as Hex, { size: 16 }),
  ]);

  const hashedPaymasterAndData = keccak256(
    concat([
      userOp.paymaster as Hex,
      pad(userOp.paymasterVerificationGasLimit as Hex, { size: 16 }),
      pad(userOp.paymasterPostOpGasLimit as Hex, { size: 16 }),
      userOp.paymasterData,
    ]),
  );

  const packed = encodeAbiParameters(
    parseAbiParameters(
      'address, uint256, bytes32, bytes32, bytes32, uint256, bytes32, bytes32',
    ),
    [
      userOp.sender,
      BigInt(userOp.nonce),
      hashedInitCode,
      hashedCallData,
      accountGasLimits as Hex,
      BigInt(userOp.preVerificationGas),
      gasFees as Hex,
      hashedPaymasterAndData,
    ],
  );

  const userOpHash = keccak256(packed);

  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, address, uint256'), [
      userOpHash,
      ENTRYPOINT_V07,
      BigInt(base.id),
    ]),
  );
}

/**
 * Sign and send a UserOperation for a specific user.
 */
export async function sendUserOperation(
  privateKey: string,
  smartAccountAddress: Address,
  callData: Hex,
): Promise<{
  userOpHash: Hex;
  txHash?: Hex;
}> {
  const eoa = privateKeyToAccount(privateKey as `0x${string}`);

  // 1. Get nonce
  const nonce = await getNonce(smartAccountAddress);
  const nonceHex = numberToHex(nonce);

  // 2. Get gas + paymaster sponsorship
  const gasData = await requestGasAndPaymaster(smartAccountAddress, callData, nonceHex);

  // 3. Build the UserOperation
  const userOp: UserOperation = {
    sender: smartAccountAddress,
    nonce: nonceHex,
    callData,
    callGasLimit: gasData.callGasLimit,
    verificationGasLimit: gasData.verificationGasLimit,
    preVerificationGas: gasData.preVerificationGas,
    maxFeePerGas: gasData.maxFeePerGas,
    maxPriorityFeePerGas: gasData.maxPriorityFeePerGas,
    paymaster: gasData.paymaster,
    paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
    paymasterData: gasData.paymasterData,
    signature: DUMMY_SIGNATURE,
  };

  // 4. Hash and sign
  const hash = hashUserOp(userOp);
  const signature = await eoa.signMessage({ message: { raw: hash } });

  // Alchemy Light Account: 0x00 + signature
  userOp.signature = concat(['0x00', signature]) as Hex;

  // 5. Send UserOperation
  const userOpHash = await bundlerRpc('eth_sendUserOperation', [
    {
      sender: userOp.sender,
      nonce: userOp.nonce,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit,
      verificationGasLimit: userOp.verificationGasLimit,
      preVerificationGas: userOp.preVerificationGas,
      maxFeePerGas: userOp.maxFeePerGas,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      paymaster: userOp.paymaster,
      paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit,
      paymasterData: userOp.paymasterData,
      signature: userOp.signature,
    },
    ENTRYPOINT_V07,
  ]);

  // 6. Poll for receipt
  let receipt: any = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    receipt = await bundlerRpc('eth_getUserOperationReceipt', [userOpHash]);
    if (receipt) break;
  }

  if (!receipt) {
    console.warn('Warning: UserOp submitted but receipt not received after 60s');
    return { userOpHash };
  }

  if (!receipt.success) {
    throw new Error(`UserOp failed: ${receipt.reason || 'unknown reason'}`);
  }

  return {
    userOpHash,
    txHash: receipt.receipt?.transactionHash,
  };
}
