import { AnchorProvider, BN, Program, type Idl } from '@anchor-lang/core'
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import type { AnchorWallet } from '@solana/wallet-adapter-react'
import idl from '../idl/equb.json'

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'

/** Circle's devnet USDC. Override with VITE_USDC_MINT to use your own test token. */
export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT ??
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
)
export const USDC_DECIMALS = 6

export const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`
export const explorerAddr = (addr: string) =>
  `https://explorer.solana.com/address/${addr}?cluster=devnet`

export type Status = 'open' | 'active' | 'complete'

export interface EqubAccount {
  creator: PublicKey
  mint: PublicKey
  vault: PublicKey
  equbId: BN
  name: string
  contribution: BN
  maxMembers: number
  members: PublicKey[]
  currentRound: number
  paidMask: number
  status: Record<string, object>
  bump: number
  vaultBump: number
  proposalActive: boolean
  proposalBeneficiary: PublicKey
  proposalReason: string
  yesMask: number
  votedMask: number
}

export interface EqubView {
  address: PublicKey
  data: EqubAccount
  status: Status
}

const readOnlyWallet: AnchorWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(
    txs: T[],
  ) => txs,
}

export function getProgram(connection: Connection, wallet?: AnchorWallet) {
  const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet, {
    commitment: 'confirmed',
  })
  return new Program(idl as Idl, provider)
}

export const statusOf = (s: Record<string, object>): Status =>
  Object.keys(s)[0] as Status

export const toUsdc = (amount: BN | number) =>
  (Number(amount.toString()) / 10 ** USDC_DECIMALS).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })

export const fromUsdc = (amount: number) =>
  new BN(Math.round(amount * 10 ** USDC_DECIMALS))

export const short = (k: PublicKey | string) => {
  const s = k.toString()
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

export const hasBit = (mask: number, i: number) => (mask & (1 << i)) !== 0

export function equbPda(programId: PublicKey, creator: PublicKey, id: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('equb'), creator.toBuffer(), id.toArrayLike(Buffer, 'le', 8)],
    programId,
  )[0]
}

export function vaultPda(programId: PublicKey, equb: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), equb.toBuffer()],
    programId,
  )[0]
}

// ---------------------------------------------------------------- reads

export async function fetchAllEqubs(program: Program): Promise<EqubView[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (program.account as any).equb.all()
  return rows
    .map((r: { publicKey: PublicKey; account: EqubAccount }) => ({
      address: r.publicKey,
      data: r.account,
      status: statusOf(r.account.status),
    }))
    .sort(
      (a: EqubView, b: EqubView) =>
        Number(b.data.equbId.toString()) - Number(a.data.equbId.toString()),
    )
}

export async function fetchVaultBalance(
  connection: Connection,
  vault: PublicKey,
) {
  try {
    const bal = await connection.getTokenAccountBalance(vault)
    return Number(bal.value.amount)
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------- writes

export async function createEqub(
  program: Program,
  creator: PublicKey,
  name: string,
  contributionUsdc: number,
  members: number,
) {
  const id = new BN(Date.now())
  const equb = equbPda(program.programId, creator, id)
  const sig = await program.methods
    .createEqub(id, name, fromUsdc(contributionUsdc), members)
    .accountsStrict({
      creator,
      equb,
      mint: USDC_MINT,
      vault: vaultPda(program.programId, equb),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
  return { sig, equb }
}

export const joinEqub = (program: Program, member: PublicKey, equb: PublicKey) =>
  program.methods.joinEqub().accountsStrict({ member, equb }).rpc()

export function contribute(program: Program, member: PublicKey, e: EqubView) {
  return program.methods
    .contribute()
    .accountsStrict({
      member,
      equb: e.address,
      mint: e.data.mint,
      memberToken: getAssociatedTokenAddressSync(e.data.mint, member),
      vault: e.data.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc()
}

export function payout(program: Program, caller: PublicKey, e: EqubView) {
  const recipient = e.data.members[e.data.currentRound]
  const recipientToken = getAssociatedTokenAddressSync(e.data.mint, recipient)
  return program.methods
    .payout()
    .accountsStrict({
      caller,
      equb: e.address,
      mint: e.data.mint,
      vault: e.data.vault,
      recipientToken,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      // Make sure the recipient can receive USDC, even if they never held any.
      createAssociatedTokenAccountIdempotentInstruction(
        caller,
        recipientToken,
        recipient,
        e.data.mint,
      ),
    ])
    .rpc()
}

export const proposeEmergency = (
  program: Program,
  member: PublicKey,
  equb: PublicKey,
  beneficiary: PublicKey,
  reason: string,
) =>
  program.methods
    .proposeEmergency(beneficiary, reason)
    .accountsStrict({ member, equb })
    .rpc()

export const voteEmergency = (
  program: Program,
  member: PublicKey,
  equb: PublicKey,
  approve: boolean,
) =>
  program.methods.voteEmergency(approve).accountsStrict({ member, equb }).rpc()

/** Pull the human-readable message out of an Anchor / wallet error. */
export function errorMessage(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any
  const anchorMsg = e?.error?.errorMessage
  if (anchorMsg) return anchorMsg
  const logs: string[] | undefined = e?.logs ?? e?.transactionLogs
  const fromLogs = logs?.find((l) => l.includes('Error Message:'))
  if (fromLogs) return fromLogs.split('Error Message:')[1].trim()
  const msg: string = e?.message ?? String(err)
  if (msg.includes('insufficient funds') || msg.includes('0x1'))
    return 'Not enough USDC in your wallet. Get devnet USDC at faucet.circle.com.'
  if (msg.includes('AccountNotInitialized') || msg.includes('member_token'))
    return 'Your wallet has no devnet USDC yet. Get some at faucet.circle.com.'
  if (msg.includes('User rejected')) return 'You cancelled the transaction.'
  return msg.length > 160 ? msg.slice(0, 160) + '…' : msg
}
