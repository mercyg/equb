use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// `anchor keys sync` replaces this with your program's real ID.
declare_id!("FD2ZBE2jZ864YojyFbnT5qmmu6qgjah9jENPXFjJd6PF");

pub const MAX_MEMBERS: usize = 10;
pub const MAX_NAME: usize = 32;
pub const MAX_REASON: usize = 64;

#[program]
pub mod equb {
    use super::*;

    /// Start a new equb. The creator is automatically member #1.
    pub fn create_equb(
        ctx: Context<CreateEqub>,
        equb_id: u64,
        name: String,
        contribution: u64,
        max_members: u8,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME, EqubError::NameTooLong);
        require!(contribution > 0, EqubError::InvalidAmount);
        require!(
            max_members >= 2 && (max_members as usize) <= MAX_MEMBERS,
            EqubError::InvalidMemberCount
        );

        let equb = &mut ctx.accounts.equb;
        equb.creator = ctx.accounts.creator.key();
        equb.mint = ctx.accounts.mint.key();
        equb.vault = ctx.accounts.vault.key();
        equb.equb_id = equb_id;
        equb.name = name;
        equb.contribution = contribution;
        equb.max_members = max_members;
        equb.members = vec![ctx.accounts.creator.key()];
        equb.current_round = 0;
        equb.paid_mask = 0;
        equb.status = Status::Open;
        equb.bump = ctx.bumps.equb;
        equb.vault_bump = ctx.bumps.vault;
        equb.clear_proposal();

        emit!(EqubCreated {
            equb: equb.key(),
            creator: equb.creator,
            contribution,
            max_members,
        });
        Ok(())
    }

    /// Join an open equb. When the last seat fills, the equb starts.
    pub fn join_equb(ctx: Context<JoinEqub>) -> Result<()> {
        let equb = &mut ctx.accounts.equb;
        let member = ctx.accounts.member.key();

        require!(equb.status == Status::Open, EqubError::NotOpen);
        require!(equb.member_index(&member).is_none(), EqubError::AlreadyMember);
        require!(
            equb.members.len() < equb.max_members as usize,
            EqubError::EqubFull
        );

        equb.members.push(member);
        if equb.members.len() == equb.max_members as usize {
            equb.status = Status::Active;
        }

        emit!(MemberJoined {
            equb: equb.key(),
            member,
            seats_filled: equb.members.len() as u8,
        });
        Ok(())
    }

    /// Pay this round's contribution into the equb's vault.
    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        let equb = &ctx.accounts.equb;
        require!(equb.status == Status::Active, EqubError::NotActive);

        let idx = equb
            .member_index(&ctx.accounts.member.key())
            .ok_or(EqubError::NotMember)?;
        require!(!equb.has_paid(idx), EqubError::AlreadyPaid);

        let amount = equb.contribution;
        let decimals = ctx.accounts.mint.decimals;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.member_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.member.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        let equb = &mut ctx.accounts.equb;
        equb.paid_mask |= 1 << idx;

        emit!(Contributed {
            equb: equb.key(),
            member: ctx.accounts.member.key(),
            round: equb.current_round,
            amount,
        });
        Ok(())
    }

    /// Once everyone has paid, send the whole pot to this round's recipient.
    /// Anyone can trigger it — the program decides who gets paid, not the caller.
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let equb = &ctx.accounts.equb;
        require!(equb.status == Status::Active, EqubError::NotActive);
        require!(equb.everyone_paid(), EqubError::NotEveryonePaid);

        let recipient = equb.members[equb.current_round as usize];
        require_keys_eq!(
            ctx.accounts.recipient_token.owner,
            recipient,
            EqubError::WrongRecipient
        );

        let pot = equb
            .contribution
            .checked_mul(equb.members.len() as u64)
            .ok_or(EqubError::Overflow)?;
        let decimals = ctx.accounts.mint.decimals;

        let creator = equb.creator;
        let id_bytes = equb.equb_id.to_le_bytes();
        let bump = [equb.bump];
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"equb", creator.as_ref(), id_bytes.as_ref(), &bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.equb.to_account_info(),
                },
                signer_seeds,
            ),
            pot,
            decimals,
        )?;

        let equb = &mut ctx.accounts.equb;
        let round = equb.current_round;
        equb.paid_mask = 0;
        equb.current_round += 1;
        equb.clear_proposal();
        if equb.current_round as usize == equb.members.len() {
            equb.status = Status::Complete;
        }

        emit!(PaidOut {
            equb: equb.key(),
            recipient,
            round,
            amount: pot,
        });
        Ok(())
    }

    /// Emergency: ask the group to move `beneficiary` up so they receive
    /// the very next pot. The proposer automatically votes yes.
    pub fn propose_emergency(
        ctx: Context<MemberAction>,
        beneficiary: Pubkey,
        reason: String,
    ) -> Result<()> {
        let equb = &mut ctx.accounts.equb;
        require!(equb.status == Status::Active, EqubError::NotActive);
        require!(reason.len() <= MAX_REASON, EqubError::ReasonTooLong);
        require!(!equb.proposal_active, EqubError::ProposalAlreadyActive);

        let proposer_idx = equb
            .member_index(&ctx.accounts.member.key())
            .ok_or(EqubError::NotMember)?;
        let ben_idx = equb
            .member_index(&beneficiary)
            .ok_or(EqubError::NotMember)?;
        // Must not have received a pot yet, and must not already be next.
        require!(
            ben_idx > equb.current_round as usize,
            EqubError::InvalidBeneficiary
        );

        equb.proposal_active = true;
        equb.proposal_beneficiary = beneficiary;
        equb.proposal_reason = reason;
        equb.yes_mask = 1 << proposer_idx;
        equb.voted_mask = 1 << proposer_idx;

        emit!(EmergencyProposed {
            equb: equb.key(),
            beneficiary,
            proposer: ctx.accounts.member.key(),
        });

        equb.try_resolve_proposal()?;
        Ok(())
    }

    /// Vote on the open emergency request. A simple majority approves it.
    pub fn vote_emergency(ctx: Context<MemberAction>, approve: bool) -> Result<()> {
        let equb = &mut ctx.accounts.equb;
        require!(equb.proposal_active, EqubError::NoActiveProposal);

        let idx = equb
            .member_index(&ctx.accounts.member.key())
            .ok_or(EqubError::NotMember)?;
        require!(equb.voted_mask & (1 << idx) == 0, EqubError::AlreadyVoted);

        equb.voted_mask |= 1 << idx;
        if approve {
            equb.yes_mask |= 1 << idx;
        }

        equb.try_resolve_proposal()?;
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Equb {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub equb_id: u64,
    #[max_len(MAX_NAME)]
    pub name: String,
    pub contribution: u64,
    pub max_members: u8,
    /// Join order == payout order (an approved emergency reorders it).
    #[max_len(MAX_MEMBERS)]
    pub members: Vec<Pubkey>,
    pub current_round: u8,
    /// Bit i set => members[i] has paid this round.
    pub paid_mask: u16,
    pub status: Status,
    pub bump: u8,
    pub vault_bump: u8,

    pub proposal_active: bool,
    pub proposal_beneficiary: Pubkey,
    #[max_len(MAX_REASON)]
    pub proposal_reason: String,
    pub yes_mask: u16,
    pub voted_mask: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Status {
    Open,
    Active,
    Complete,
}

impl Equb {
    pub fn member_index(&self, key: &Pubkey) -> Option<usize> {
        self.members.iter().position(|m| m == key)
    }

    pub fn has_paid(&self, idx: usize) -> bool {
        self.paid_mask & (1 << idx) != 0
    }

    pub fn everyone_paid(&self) -> bool {
        let n = self.members.len() as u32;
        self.paid_mask.count_ones() == n
    }

    pub fn clear_proposal(&mut self) {
        self.proposal_active = false;
        self.proposal_beneficiary = Pubkey::default();
        self.proposal_reason = String::new();
        self.yes_mask = 0;
        self.voted_mask = 0;
    }

    /// Approve on a strict majority of yes votes; reject once a majority
    /// is no longer reachable.
    pub fn try_resolve_proposal(&mut self) -> Result<()> {
        let n = self.members.len() as u32;
        let yes = self.yes_mask.count_ones();
        let voted = self.voted_mask.count_ones();
        let no = voted - yes;
        let needed = n / 2 + 1;

        if yes >= needed {
            let ben_idx = self
                .member_index(&self.proposal_beneficiary)
                .ok_or(EqubError::NotMember)?;
            let next = self.current_round as usize;

            // Swap payout positions, and keep this round's paid bits in sync.
            self.members.swap(next, ben_idx);
            let bit_next = (self.paid_mask >> next) & 1;
            let bit_ben = (self.paid_mask >> ben_idx) & 1;
            if bit_next != bit_ben {
                self.paid_mask ^= (1 << next) | (1 << ben_idx);
            }

            emit!(EmergencyResolved {
                beneficiary: self.proposal_beneficiary,
                approved: true,
            });
            self.clear_proposal();
        } else if no > n - needed {
            emit!(EmergencyResolved {
                beneficiary: self.proposal_beneficiary,
                approved: false,
            });
            self.clear_proposal();
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
#[instruction(equb_id: u64)]
pub struct CreateEqub<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Equb::INIT_SPACE,
        seeds = [b"equb", creator.key().as_ref(), equb_id.to_le_bytes().as_ref()],
        bump
    )]
    pub equb: Account<'info, Equb>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// Token account owned by the equb PDA that holds everyone's contributions.
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", equb.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = equb,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinEqub<'info> {
    pub member: Signer<'info>,
    #[account(mut)]
    pub equb: Account<'info, Equb>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    pub member: Signer<'info>,

    #[account(mut, has_one = mint, has_one = vault)]
    pub equb: Account<'info, Equb>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = member,
        token::token_program = token_program,
    )]
    pub member_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    /// Anyone may crank the payout.
    pub caller: Signer<'info>,

    #[account(mut, has_one = mint, has_one = vault)]
    pub equb: Account<'info, Equb>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MemberAction<'info> {
    pub member: Signer<'info>,
    #[account(mut)]
    pub equb: Account<'info, Equb>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct EqubCreated {
    pub equb: Pubkey,
    pub creator: Pubkey,
    pub contribution: u64,
    pub max_members: u8,
}

#[event]
pub struct MemberJoined {
    pub equb: Pubkey,
    pub member: Pubkey,
    pub seats_filled: u8,
}

#[event]
pub struct Contributed {
    pub equb: Pubkey,
    pub member: Pubkey,
    pub round: u8,
    pub amount: u64,
}

#[event]
pub struct PaidOut {
    pub equb: Pubkey,
    pub recipient: Pubkey,
    pub round: u8,
    pub amount: u64,
}

#[event]
pub struct EmergencyProposed {
    pub equb: Pubkey,
    pub beneficiary: Pubkey,
    pub proposer: Pubkey,
}

#[event]
pub struct EmergencyResolved {
    pub beneficiary: Pubkey,
    pub approved: bool,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum EqubError {
    #[msg("Name is too long (max 32 characters)")]
    NameTooLong,
    #[msg("Reason is too long (max 64 characters)")]
    ReasonTooLong,
    #[msg("Contribution must be greater than zero")]
    InvalidAmount,
    #[msg("An equb needs between 2 and 10 members")]
    InvalidMemberCount,
    #[msg("This equb is no longer accepting members")]
    NotOpen,
    #[msg("This equb is not active")]
    NotActive,
    #[msg("You are already a member")]
    AlreadyMember,
    #[msg("This equb is full")]
    EqubFull,
    #[msg("You are not a member of this equb")]
    NotMember,
    #[msg("You already paid this round")]
    AlreadyPaid,
    #[msg("Not everyone has paid this round yet")]
    NotEveryonePaid,
    #[msg("That token account doesn't belong to this round's recipient")]
    WrongRecipient,
    #[msg("Math overflow")]
    Overflow,
    #[msg("There is already an emergency request open")]
    ProposalAlreadyActive,
    #[msg("There is no emergency request open")]
    NoActiveProposal,
    #[msg("That member has already received a pot or is already next")]
    InvalidBeneficiary,
    #[msg("You already voted")]
    AlreadyVoted,
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn equb_with(n: usize) -> Equb {
        Equb {
            creator: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            equb_id: 1,
            name: "Test".into(),
            contribution: 50,
            max_members: n as u8,
            members: (0..n).map(|_| Pubkey::new_unique()).collect(),
            current_round: 0,
            paid_mask: 0,
            status: Status::Active,
            bump: 255,
            vault_bump: 255,
            proposal_active: false,
            proposal_beneficiary: Pubkey::default(),
            proposal_reason: String::new(),
            yes_mask: 0,
            voted_mask: 0,
        }
    }

    fn propose(e: &mut Equb, proposer: usize, ben: usize) {
        e.proposal_active = true;
        e.proposal_beneficiary = e.members[ben];
        e.yes_mask = 1 << proposer;
        e.voted_mask = 1 << proposer;
        e.try_resolve_proposal().unwrap();
    }

    fn vote(e: &mut Equb, who: usize, yes: bool) {
        e.voted_mask |= 1 << who;
        if yes {
            e.yes_mask |= 1 << who;
        }
        e.try_resolve_proposal().unwrap();
    }

    #[test]
    fn everyone_paid_counts_bits() {
        let mut e = equb_with(4);
        assert!(!e.everyone_paid());
        e.paid_mask = 0b0111;
        assert!(!e.everyone_paid());
        e.paid_mask = 0b1111;
        assert!(e.everyone_paid());
    }

    #[test]
    fn majority_approves_and_moves_beneficiary_up() {
        let mut e = equb_with(5); // needs 3 yes
        let ben = e.members[4];
        let was_next = e.members[0];
        e.paid_mask = 0b10000; // only the beneficiary has paid so far
        propose(&mut e, 2, 4);
        assert!(e.proposal_active);
        vote(&mut e, 3, true);
        assert!(e.proposal_active);
        vote(&mut e, 4, true); // 3rd yes
        assert!(!e.proposal_active);
        assert_eq!(e.members[0], ben);
        assert_eq!(e.members[4], was_next);
        // paid bit followed the beneficiary to slot 0
        assert_eq!(e.paid_mask, 0b00001);
    }

    #[test]
    fn rejected_once_majority_impossible() {
        let mut e = equb_with(4); // needs 3 yes
        let before = e.members.clone();
        propose(&mut e, 1, 3);
        vote(&mut e, 0, false);
        assert!(e.proposal_active); // 1 yes, 1 no, 2 left: still possible
        vote(&mut e, 2, false); // 1 yes, 2 no: max 2 yes => rejected
        assert!(!e.proposal_active);
        assert_eq!(e.members, before);
    }

    #[test]
    fn two_member_equb_needs_both() {
        let mut e = equb_with(2);
        e.current_round = 0;
        propose(&mut e, 1, 1);
        assert!(e.proposal_active);
        vote(&mut e, 0, true);
        assert!(!e.proposal_active);
        assert_eq!(e.member_index(&e.members[0]), Some(0));
    }
}
