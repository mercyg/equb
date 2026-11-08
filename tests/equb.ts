import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { Equb } from "../target/types/equb";

describe("equb", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.equb as Program<Equb>;
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const creator = payer;
  const abebe = Keypair.generate();
  const selam = Keypair.generate();
  const USDC = 1_000_000; // 6 decimals
  const equbId = new BN(Date.now());

  let mint: PublicKey;
  const ata: Record<string, PublicKey> = {};
  let equbPda: PublicKey;
  let vaultPda: PublicKey;

  const balance = async (who: string) =>
    Number((await getAccount(conn, ata[who])).amount);

  before(async () => {
    for (const kp of [abebe, selam]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }
    mint = await createMint(conn, payer, payer.publicKey, null, 6);
    for (const [name, kp] of [
      ["creator", creator],
      ["abebe", abebe],
      ["selam", selam],
    ] as const) {
      ata[name] = (
        await getOrCreateAssociatedTokenAccount(conn, payer, mint, kp.publicKey)
      ).address;
      await mintTo(conn, payer, mint, ata[name], payer, 10 * USDC);
    }

    [equbPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("equb"),
        creator.publicKey.toBuffer(),
        equbId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), equbPda.toBuffer()],
      program.programId
    );
  });

  it("creates an equb", async () => {
    await program.methods
      .createEqub(equbId, "DC Diaspora Equb", new BN(USDC), 3)
      .accountsStrict({
        creator: creator.publicKey,
        equb: equbPda,
        mint,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const e = await program.account.equb.fetch(equbPda);
    assert.equal(e.name, "DC Diaspora Equb");
    assert.equal(e.members.length, 1);
    assert.deepEqual(e.status, { open: {} });
  });

  it("members join and the equb starts when full", async () => {
    for (const kp of [abebe, selam]) {
      await program.methods
        .joinEqub()
        .accountsStrict({ member: kp.publicKey, equb: equbPda })
        .signers([kp])
        .rpc();
    }
    const e = await program.account.equb.fetch(equbPda);
    assert.equal(e.members.length, 3);
    assert.deepEqual(e.status, { active: {} });
  });

  it("rejects joining after the equb is full", async () => {
    try {
      await program.methods
        .joinEqub()
        .accountsStrict({ member: abebe.publicKey, equb: equbPda })
        .signers([abebe])
        .rpc();
      assert.fail("should have thrown");
    } catch (err: any) {
      assert.include(String(err), "NotOpen");
    }
  });

  it("emergency vote moves Selam to the front", async () => {
    await program.methods
      .proposeEmergency(selam.publicKey, "Family medical bill")
      .accountsStrict({ member: selam.publicKey, equb: equbPda })
      .signers([selam])
      .rpc();

    let e = await program.account.equb.fetch(equbPda);
    assert.isTrue(e.proposalActive);

    await program.methods
      .voteEmergency(true)
      .accountsStrict({ member: creator.publicKey, equb: equbPda })
      .rpc();

    e = await program.account.equb.fetch(equbPda);
    assert.isFalse(e.proposalActive);
    assert.isTrue(e.members[0].equals(selam.publicKey));
  });

  it("everyone contributes and the pot pays out to Selam", async () => {
    for (const [name, kp] of [
      ["creator", creator],
      ["abebe", abebe],
      ["selam", selam],
    ] as const) {
      const tx = program.methods.contribute().accountsStrict({
        member: kp.publicKey,
        equb: equbPda,
        mint,
        memberToken: ata[name],
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      });
      if (kp !== creator) tx.signers([kp]);
      await tx.rpc();
    }

    const before = await balance("selam");
    await program.methods
      .payout()
      .accountsStrict({
        caller: creator.publicKey,
        equb: equbPda,
        mint,
        vault: vaultPda,
        recipientToken: ata["selam"],
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.equal((await balance("selam")) - before, 3 * USDC);
    const e = await program.account.equb.fetch(equbPda);
    assert.equal(e.currentRound, 1);
    assert.equal(e.paidMask, 0);
  });

  it("refuses to pay the wrong person", async () => {
    try {
      await program.methods
        .payout()
        .accountsStrict({
          caller: creator.publicKey,
          equb: equbPda,
          mint,
          vault: vaultPda,
          recipientToken: ata["selam"],
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("should have thrown");
    } catch (err: any) {
      // nobody has paid round 2 yet
      assert.include(String(err), "NotEveryonePaid");
    }
  });
});
