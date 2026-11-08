import { useCallback, useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import {
  useAnchorWallet,
  useConnection,
} from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  type EqubView,
  contribute,
  createEqub,
  errorMessage,
  explorerAddr,
  explorerTx,
  fetchAllEqubs,
  fetchVaultBalance,
  getProgram,
  hasBit,
  joinEqub,
  payout,
  proposeEmergency,
  short,
  toUsdc,
  voteEmergency,
} from './lib/equb'

type Toast = { kind: 'ok' | 'err'; text: string; sig?: string }

export default function App() {
  const { connection } = useConnection()
  const wallet = useAnchorWallet()
  const me = wallet?.publicKey
  const program = useMemo(
    () => getProgram(connection, wallet),
    [connection, wallet],
  )

  const [equbs, setEqubs] = useState<EqubView[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(location.search).get('equb'),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const refresh = useCallback(async () => {
    try {
      setEqubs(await fetchAllEqubs(program))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [program])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const url = new URL(location.href)
    if (selected) url.searchParams.set('equb', selected)
    else url.searchParams.delete('equb')
    history.replaceState(null, '', url)
  }, [selected])

  const run = async (label: string, fn: () => Promise<string>, done: string) => {
    if (!me) return setToast({ kind: 'err', text: 'Connect your wallet first.' })
    setBusy(label)
    setToast(null)
    try {
      const sig = await fn()
      setToast({ kind: 'ok', text: done, sig })
      await refresh()
    } catch (e) {
      console.error(e)
      setToast({ kind: 'err', text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const current = equbs.find((e) => e.address.toString() === selected)
  const mine = me
    ? equbs.filter((e) => e.data.members.some((m) => m.equals(me)))
    : []
  const open = equbs.filter(
    (e) => e.status === 'open' && !(me && e.data.members.some((m) => m.equals(me))),
  )

  return (
    <div className="shell">
      <header className="top">
        <button className="brand" onClick={() => setSelected(null)}>
          <span className="mark" aria-hidden>
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray="14 5" />
              <circle cx="32" cy="14" r="6" fill="currentColor" />
            </svg>
          </span>
          Equb
        </button>
        <div className="top-right">
          <span className="net">Devnet</span>
          <WalletMultiButton />
        </div>
      </header>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.text}</span>
          {toast.sig && (
            <a href={explorerTx(toast.sig)} target="_blank" rel="noreferrer">
              View on Solana Explorer ↗
            </a>
          )}
          <button aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {current ? (
        <EqubDetail
          e={current}
          me={me}
          busy={busy}
          onBack={() => setSelected(null)}
          connection={connection}
          actions={{
            join: () =>
              run('join', () => joinEqub(program, me!, current.address), 'You joined the equb.'),
            contribute: () =>
              run('contribute', () => contribute(program, me!, current), 'Contribution received. 🙌'),
            payout: () =>
              run('payout', () => payout(program, me!, current), 'Pot paid out!'),
            propose: (ben: PublicKey, reason: string) =>
              run(
                'propose',
                () => proposeEmergency(program, me!, current.address, ben, reason),
                'Emergency request sent to the group.',
              ),
            vote: (yes: boolean) =>
              run(
                'vote',
                () => voteEmergency(program, me!, current.address, yes),
                yes ? 'You voted yes.' : 'You voted no.',
              ),
          }}
        />
      ) : (
        <>
          <section className="hero">
            <p className="eyebrow">እቁብ · rotating savings, on-chain</p>
            <h1>
              Save together.
              <br />
              <em>Nobody runs off with the pot.</em>
            </h1>
            <p className="lede">
              Start an equb with family and friends anywhere in the world. Everyone
              chips in USDC each round, and a Solana program — not a person — holds the
              money and pays each member in turn.
            </p>
          </section>

          <div className="grid">
            <CreateCard
              disabled={!me}
              busy={busy === 'create'}
              onCreate={(name, amount, members) =>
                run(
                  'create',
                  async () => {
                    const { sig, equb } = await createEqub(program, me!, name, amount, members)
                    setSelected(equb.toString())
                    return sig
                  },
                  'Equb created. Share the link so members can join.',
                )
              }
            />

            <div className="lists">
              {me && (
                <EqubList
                  title="Your equbs"
                  empty="You're not in any equb yet."
                  items={mine}
                  me={me}
                  onPick={setSelected}
                />
              )}
              <EqubList
                title="Open to join"
                empty={loading ? 'Loading…' : 'No open equbs right now. Start one!'}
                items={open}
                me={me}
                onPick={setSelected}
              />
            </div>
          </div>

          <section className="how">
            <h2>How it works</h2>
            <ol>
              <li><b>Create</b> an equb: amount per round and number of members.</li>
              <li><b>Invite</b> people with a link. It starts when every seat is filled.</li>
              <li><b>Contribute</b> each round. The pot pays the next person automatically.</li>
              <li><b>Emergency?</b> Ask the group. A majority vote moves you to the front.</li>
            </ol>
          </section>
        </>
      )}

      <footer className="foot">
        Built for the MLH Solana Hackathon · funds are devnet USDC (test money)
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------- create

function CreateCard(props: {
  disabled: boolean
  busy: boolean
  onCreate: (name: string, amount: number, members: number) => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('1')
  const [members, setMembers] = useState('3')
  const [err, setErr] = useState('')

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const a = Number(amount)
    const m = Number(members)
    if (!name.trim()) return setErr('Give your equb a name.')
    if (name.length > 32) return setErr('Keep the name under 32 characters.')
    if (!(a > 0)) return setErr('Amount must be more than 0.')
    if (!(m >= 2 && m <= 10)) return setErr('Choose 2 to 10 members.')
    setErr('')
    props.onCreate(name.trim(), a, m)
  }

  const pot = Number(amount) * Number(members)

  return (
    <form className="card create" onSubmit={submit}>
      <h2>Start an equb</h2>
      <label>
        Name
        <input
          value={name}
          maxLength={32}
          placeholder="e.g. DC Family Equb"
          onChange={(e) => { setName(e.target.value); setErr('') }}
        />
      </label>
      <div className="row">
        <label>
          Each round (USDC)
          <input
            type="number" min="0.01" step="0.01" value={amount}
            onChange={(e) => { setAmount(e.target.value); setErr('') }}
          />
        </label>
        <label>
          Members
          <input
            type="number" min="2" max="10" value={members}
            onChange={(e) => { setMembers(e.target.value); setErr('') }}
          />
        </label>
      </div>
      {pot > 0 && Number.isFinite(pot) && (
        <p className="hint">
          Each round, one member receives <b>{pot.toLocaleString()} USDC</b>.
        </p>
      )}
      {err && <p className="err">{err}</p>}
      <button className="btn primary" disabled={props.disabled || props.busy}>
        {props.disabled ? 'Connect wallet to start' : props.busy ? 'Creating…' : 'Create equb'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- list

function EqubList(props: {
  title: string
  empty: string
  items: EqubView[]
  me?: PublicKey
  onPick: (addr: string) => void
}) {
  return (
    <section className="list">
      <h2>{props.title}</h2>
      {props.items.length === 0 ? (
        <p className="muted">{props.empty}</p>
      ) : (
        props.items.map((e) => (
          <button key={e.address.toString()} className="item" onClick={() => props.onPick(e.address.toString())}>
            <span className="item-main">
              <b>{e.data.name}</b>
              <span className="muted">
                {toUsdc(e.data.contribution)} USDC / round · {e.data.members.length}/{e.data.maxMembers} members
              </span>
            </span>
            <StatusPill e={e} />
          </button>
        ))
      )}
    </section>
  )
}

function StatusPill({ e }: { e: EqubView }) {
  const label =
    e.status === 'open'
      ? 'Filling seats'
      : e.status === 'complete'
        ? 'Complete'
        : `Round ${e.data.currentRound + 1} of ${e.data.members.length}`
  return <span className={`pill ${e.status}`}>{label}</span>
}

// ---------------------------------------------------------------- detail

function EqubDetail(props: {
  e: EqubView
  me?: PublicKey
  busy: string | null
  onBack: () => void
  connection: import('@solana/web3.js').Connection
  actions: {
    join: () => void
    contribute: () => void
    payout: () => void
    propose: (ben: PublicKey, reason: string) => void
    vote: (yes: boolean) => void
  }
}) {
  const { e, me, busy, actions } = props
  const d = e.data
  const n = d.members.length
  const myIdx = me ? d.members.findIndex((m) => m.equals(me)) : -1
  const isMember = myIdx >= 0
  const paidCount = [...Array(n)].filter((_, i) => hasBit(d.paidMask, i)).length
  const everyonePaid = e.status === 'active' && paidCount === n
  const next = e.status === 'active' ? d.members[d.currentRound] : null

  const [vault, setVault] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    fetchVaultBalance(props.connection, d.vault).then(setVault)
  }, [props.connection, d.vault, d.paidMask, d.currentRound])

  const share = async () => {
    await navigator.clipboard.writeText(location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <section className="detail">
      <button className="back" onClick={props.onBack}>← All equbs</button>

      <div className="detail-head">
        <div>
          <h1>{d.name}</h1>
          <p className="muted">
            Started by {me && d.creator.equals(me) ? 'you' : short(d.creator)} ·{' '}
            <a href={explorerAddr(e.address.toString())} target="_blank" rel="noreferrer">
              View program account ↗
            </a>
          </p>
        </div>
        <StatusPill e={e} />
      </div>

      <div className="stats">
        <Stat label="Each round" value={`${toUsdc(d.contribution)} USDC`} />
        <Stat label="Pot per round" value={`${toUsdc(d.contribution.muln(d.maxMembers))} USDC`} />
        <Stat
          label="Held by the program"
          value={`${toUsdc(vault)} USDC`}
          href={explorerAddr(d.vault.toString())}
        />
        <Stat label="Paid this round" value={e.status === 'active' ? `${paidCount} / ${n}` : '—'} />
      </div>

      {/* ---- primary action ---- */}
      <div className="action-bar">
        {!me ? (
          <p className="muted">Connect your wallet to take part.</p>
        ) : e.status === 'open' && !isMember ? (
          <button className="btn primary" disabled={!!busy} onClick={actions.join}>
            {busy === 'join' ? 'Joining…' : `Join · ${d.maxMembers - n} seat${d.maxMembers - n === 1 ? '' : 's'} left`}
          </button>
        ) : e.status === 'open' ? (
          <>
            <p>
              Waiting for {d.maxMembers - n} more member{d.maxMembers - n === 1 ? '' : 's'}. Share the link:
            </p>
            <button className="btn" onClick={share}>{copied ? 'Copied!' : 'Copy invite link'}</button>
          </>
        ) : e.status === 'active' && everyonePaid ? (
          <button className="btn primary" disabled={!!busy} onClick={actions.payout}>
            {busy === 'payout' ? 'Paying out…' : `Pay ${toUsdc(d.contribution.muln(n))} USDC to ${next && me.equals(next) ? 'you' : short(next!)}`}
          </button>
        ) : e.status === 'active' && isMember && !hasBit(d.paidMask, myIdx) ? (
          <button className="btn primary" disabled={!!busy} onClick={actions.contribute}>
            {busy === 'contribute' ? 'Sending…' : `Contribute ${toUsdc(d.contribution)} USDC`}
          </button>
        ) : e.status === 'active' && isMember ? (
          <p>✓ You've paid this round. Waiting on {n - paidCount} other{n - paidCount === 1 ? '' : 's'}.</p>
        ) : e.status === 'complete' ? (
          <p>🎉 Every member has received the pot. This equb is complete.</p>
        ) : (
          <p className="muted">This equb is full and running.</p>
        )}
      </div>

      <div className="detail-grid">
        <Rotation e={e} me={me} />
        {e.status === 'active' && (
          <Emergency e={e} me={me} myIdx={myIdx} busy={busy} propose={actions.propose} vote={actions.vote} />
        )}
      </div>
    </section>
  )
}

function Stat(props: { label: string; value: string; href?: string }) {
  return (
    <div className="stat">
      <span className="muted">{props.label}</span>
      <b>{props.value}</b>
      {props.href && (
        <a href={props.href} target="_blank" rel="noreferrer">verify ↗</a>
      )}
    </div>
  )
}

function Rotation({ e, me }: { e: EqubView; me?: PublicKey }) {
  const d = e.data
  const seats = [...Array(d.maxMembers)].map((_, i) => d.members[i])
  return (
    <div className="card">
      <h2>Payout order</h2>
      <ol className="rotation">
        {seats.map((m, i) => {
          const received = e.status !== 'open' && i < d.currentRound
          const isNext = e.status === 'active' && i === d.currentRound
          const paid = e.status === 'active' && m && hasBit(d.paidMask, i)
          return (
            <li key={i} className={received ? 'done' : isNext ? 'next' : ''}>
              <span className="pos">{i + 1}</span>
              <span className="who">
                {m ? (
                  <>
                    {short(m)}
                    {me && m.equals(me) && <span className="you">you</span>}
                  </>
                ) : (
                  <span className="muted">Open seat</span>
                )}
              </span>
              <span className="tag">
                {received ? 'Received ✓' : isNext ? 'Next to receive' : ''}
              </span>
              {e.status === 'active' && m && (
                <span className={`dot ${paid ? 'paid' : ''}`} title={paid ? 'Paid this round' : 'Not paid yet'} />
              )}
            </li>
          )
        })}
      </ol>
      {e.status === 'active' && <p className="muted small">● paid this round</p>}
    </div>
  )
}

function Emergency(props: {
  e: EqubView
  me?: PublicKey
  myIdx: number
  busy: string | null
  propose: (ben: PublicKey, reason: string) => void
  vote: (yes: boolean) => void
}) {
  const { e, me, myIdx, busy } = props
  const d = e.data
  const n = d.members.length
  const needed = Math.floor(n / 2) + 1
  const yes = [...Array(n)].filter((_, i) => hasBit(d.yesMask, i)).length
  const voted = [...Array(n)].filter((_, i) => hasBit(d.votedMask, i)).length
  const iVoted = myIdx >= 0 && hasBit(d.votedMask, myIdx)
  const eligible = d.members
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => i > d.currentRound)

  const [ben, setBen] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (me && eligible.some(({ m }) => m.equals(me))) setBen(me.toString())
    else if (eligible[0]) setBen(eligible[0].m.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.currentRound, me?.toString()])

  if (d.proposalActive) {
    const who = me && d.proposalBeneficiary.equals(me) ? 'You' : short(d.proposalBeneficiary)
    return (
      <div className="card emergency live">
        <h2>Emergency request</h2>
        <p>
          <b>{who}</b> asked to receive the next pot.
        </p>
        {d.proposalReason && <blockquote>“{d.proposalReason}”</blockquote>}
        <div className="meter" aria-label={`${yes} of ${needed} yes votes`}>
          <div style={{ width: `${Math.min(100, (yes / needed) * 100)}%` }} />
        </div>
        <p className="muted small">
          {yes} yes of {needed} needed · {voted}/{n} voted
        </p>
        {myIdx >= 0 && !iVoted ? (
          <div className="row">
            <button className="btn primary" disabled={!!busy} onClick={() => props.vote(true)}>
              {busy === 'vote' ? '…' : 'Approve'}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => props.vote(false)}>
              Decline
            </button>
          </div>
        ) : myIdx >= 0 ? (
          <p className="muted">You've voted.</p>
        ) : null}
      </div>
    )
  }

  if (myIdx < 0 || eligible.length === 0) return null

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!ben) return setErr('Pick who needs the pot.')
    if (!reason.trim()) return setErr('Add a short reason so the group can decide.')
    setErr('')
    props.propose(new PublicKey(ben), reason.trim())
  }

  return (
    <form className="card emergency" onSubmit={submit}>
      <h2>Need it sooner?</h2>
      <p className="muted">
        In a real equb, the group can let someone take the pot early in an emergency.
        If a majority ({needed} of {n}) approves, they move to the front of the line.
      </p>
      <label>
        Who needs it
        <select value={ben} onChange={(ev) => { setBen(ev.target.value); setErr('') }}>
          {eligible.map(({ m }) => (
            <option key={m.toString()} value={m.toString()}>
              {me && m.equals(me) ? 'Me' : short(m)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input
          value={reason}
          maxLength={64}
          placeholder="e.g. Medical bill, school fees"
          onChange={(ev) => { setReason(ev.target.value); setErr('') }}
        />
      </label>
      {err && <p className="err">{err}</p>}
      <button className="btn" disabled={!!busy}>
        {busy === 'propose' ? 'Sending…' : 'Ask the group'}
      </button>
    </form>
  )
}
