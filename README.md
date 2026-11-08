# Equb: save together on Solana

**Equb (እቁብ)** is a rotating savings circle used by millions of Ethiopians, and by billions of people worldwide under names like *susu*, *tanda* and *chit fund*. Everyone puts in the same amount each round, and one member takes the whole pot. The circle keeps going until everyone has had a turn.

The weak point has always been **trust**. Someone has to hold the cash, and sometimes they disappear with it.

This app hands that job to a Solana program. Members contribute **USDC** into a vault that only the program controls. The program pays each round's pot to the next person in line, and nobody can redirect it.

### What's different here: the emergency vote
In a real equb, the group can let someone take the pot early when life happens: a medical bill, school fees, a funeral back home. Any member can open an **emergency request**. If a majority approves, that member moves to the front of the payout line, on-chain.

### Built for the diaspora
Members can be in DC, Toronto, London and Addis. Everyone pays in USDC in about a second, for a fraction of a cent.

---

## Run it (≈10 minutes)

### 1. Create the Anchor project and drop in the code
```bash
anchor init equb --template single --test-template mocha
cd equb
```
Copy these files from this folder into the new project, replacing the existing ones:
- `programs/equb/src/lib.rs`
- `programs/equb/Cargo.toml`
- `tests/equb.ts`
- the whole `app/` folder

Then:
```bash
yarn add -D @solana/spl-token      # or: npm i -D @solana/spl-token
anchor keys sync                    # writes your real program ID into lib.rs + Anchor.toml
anchor build
anchor test                         # spins up a local validator; expect 6 passing tests
```

### 2. Deploy to devnet
```bash
solana config set --url devnet
solana balance                      # need ~2-3 SOL; faucet.solana.com if low
anchor deploy --provider.cluster devnet
```

### 3. Run the web app
```bash
cd app
npm install
npm run sync-idl                    # copies target/idl/equb.json into the app
npm run dev                         # open http://localhost:5173
```

### 4. Get devnet USDC
https://faucet.circle.com → choose **Solana Devnet** → paste your wallet address.
In Phantom, switch to devnet: Settings → Developer Settings → Testnet mode → Solana Devnet.

**Plan B if the USDC faucet is slow:** make your own test dollar.
```bash
spl-token create-token --decimals 6          # prints MINT
spl-token create-account <MINT>
spl-token mint <MINT> 1000
spl-token transfer <MINT> 100 <FRIEND_WALLET> --fund-recipient --allow-unfunded-recipient
echo "VITE_USDC_MINT=<MINT>" > app/.env       # restart npm run dev
```

---

## Demo with several members
Phantom lets you create multiple accounts (click the account name, then **Add account**). Give each one a little SOL for fees:
```bash
solana transfer <ACCOUNT_2_ADDRESS> 0.2 --allow-unfunded-recipient
```
Give each one some USDC too, then switch accounts in Phantom to join, contribute, and vote.

---

## How it works

| Instruction | Who | What it does |
|---|---|---|
| `create_equb` | anyone | Sets the amount per round and seat count (2–10). Creates a USDC vault owned by the equb's PDA. The creator is seat #1. |
| `join_equb` | anyone | Takes the next seat. The equb starts automatically when the last seat fills. |
| `contribute` | member | Moves this round's USDC from the member's wallet into the vault. Each member can pay once per round. |
| `payout` | anyone | Once everyone has paid, sends the full pot to this round's recipient. The **program** picks the recipient, not the caller. |
| `propose_emergency` | member | Asks the group to move a member (who hasn't received yet) to the front of the line. The proposer's yes vote counts automatically. |
| `vote_emergency` | member | Approve or decline. A strict majority approves and reorders the line. The request closes as soon as a majority can no longer be reached. |

**Security notes**
- The vault's authority is the equb PDA, so only program logic can move funds out.
- `payout` checks that the receiving token account belongs to `members[current_round]`.
- Mint and vault are pinned with `has_one`, so nobody can swap in a different token.
- Payment state is a bitmask that moves along with members when an emergency vote reorders the line.

## What's next
- Collateral up front, so a member who already got paid can't stop contributing (the "runner" problem)
- Scheduled rounds with reminders and late-payment grace periods
- Cash-out to local currency through licensed partners where regulation allows
