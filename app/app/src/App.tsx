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
import { SeatRing, type Seat } from './SeatRing'
import { RoundsBand } from './RoundsBand'

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
    window.scrollTo({ top: 0 })
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
  const isMine = (e: EqubView) => !!me && e.data.members.some((m) => m.equals(me))
  const mine = equbs.filter(isMine)
  const open = equbs.filter((e) => e.status === 'open' && !isMine(e))

  return (
    <div className="page">
      <header className="masthead">
        <button className="brand" onClick={() => setSelected(null)} aria-label="Equb home">
          <BrandMark />
          <span className="brand-word">Equb</span>
          <span className="brand-geez" lang="am">እቁብ</span>
        </button>
        <div className="masthead-right">
          <span className="net" title="Runs on Solana's test network with test USDC">
            <span className="net-dot" aria-hidden /> Devnet
          </span>
          <WalletMultiButton />
        </div>
      </header>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.text}</span>
          {toast.sig && (
            <a href={explorerTx(toast.sig)} target="_blank" rel="noreferrer">
              See the transaction
            </a>
          )}
          <button className="toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {selected && !current ? (
        <main className="detail">
          <button className="back" onClick={() => setSelected(null)}>All equbs</button>
          <p className="quiet">{loading ? 'Loading this equb…' : 'We couldn’t find this equb on devnet. Check the link and try again.'}</p>
        </main>
      ) : current ? (
        <EqubDetail
          e={current}
          me={me}
          busy={busy}
          onBack={() => setSelected(null)}
          connection={connection}
          actions={{
            join: () =>
              run('join', () => joinEqub(program, me!, current.address), 'You joined. Your seat is saved.'),
            contribute: () =>
              run('contribute', () => contribute(program, me!, current), 'Contribution sent to the pot.'),
            payout: () =>
              run('payout', () => payout(program, me!, current), 'Pot paid out.'),
            propose: (ben: PublicKey, reason: string) =>
              run(
                'propose',
                () => proposeEmergency(program, me!, current.address, ben, reason),
                'Request sent. Members can vote now.',
              ),
            vote: (yes: boolean) =>
              run(
                'vote',
                () => voteEmergency(program, me!, current.address, yes),
                yes ? 'You approved the request.' : 'You declined the request.',
              ),
          }}
        />
      ) : (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <h1>Your equb, without anyone holding the cash.</h1>
              <p className="lede">
                Start a savings circle with family and friends in any city. Everyone
                pays in USDC each round. A Solana program keeps the pot and pays each
                member in turn, so nobody can walk off with it.
              </p>
              <CreateForm
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
                    'Equb created. Copy the invite link to add members.',
                  )
                }
              />
            </div>
            <div className="hero-ring" aria-hidden>
              <SeatRing
                seats={DEMO_SEATS}
                centerAmount="300"
                centerCaption="USDC this round"
                animatePot
              />
            </div>
          </section>

          <section className="lists">
            {me && (
              <EqubList
                title="Your equbs"
                empty="You haven’t joined an equb yet."
                items={mine}
                me={me}
                onPick={setSelected}
              />
            )}
            <EqubList
              title="Open equbs you can join"
              empty={loading ? 'Looking for open equbs…' : 'No open equbs right now. Start one and share the link.'}
              items={open}
              me={me}
              onPick={setSelected}
            />
          </section>

          <section className="steps" aria-labelledby="how">
            <h2 id="how">How a round works</h2>
            <ol>
              <li>
                <b>Start it.</b> Pick the amount per round and how many people.
              </li>
              <li>
                <b>Invite.</b> Share the link. The equb begins when every seat is taken.
              </li>
              <li>
                <b>Pay in.</b> Each member sends their share. When all have paid, the pot goes to the next seat.
              </li>
              <li>
                <b>Need it early?</b> Ask the group. If most members agree, you move to the front.
              </li>
            </ol>
          </section>
        </main>
      )}

      <footer className="foot">
        Built for the MLH Solana Hackathon. Runs on Solana devnet with test USDC.
      </footer>
    </div>
  )
}

const DEMO_SEATS: Seat[] = [
  { label: '1', state: 'received' },
  { label: '2', state: 'next', paid: true },
  { label: '3', state: 'waiting', paid: true },
  { label: '4', state: 'waiting', paid: true },
  { label: '5', state: 'waiting' },
  { label: '6', state: 'waiting', paid: true },
]

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      {[...Array(6)].map((_, i) => {
        const a = (-90 + i * 60) * (Math.PI / 180)
        return (
          <circle
            key={i}
            cx={16 + 11 * Math.cos(a)}
            cy={16 + 11 * Math.sin(a)}
            r={i === 0 ? 4.2 : 2.6}
            className={i === 0 ? 'bm-next' : i < 3 ? 'bm-paid' : 'bm-wait'}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- create

function CreateForm(props: {
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
    if (!(a > 0)) return setErr('Enter an amount above 0.')
    if (!(m >= 2 && m <= 10)) return setErr('An equb needs 2 to 10 members.')
    setErr('')
    props.onCreate(name.trim(), a, m)
  }

  const pot = Number(amount) * Number(members)

  return (
    <form className="create" onSubmit={submit} noValidate>
      <h2>Start an equb</h2>
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          maxLength={32}
          placeholder="DC family equb"
          onChange={(e) => { setName(e.target.value); setErr('') }}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>USDC per round</span>
          <input
            type="number" inputMode="decimal" min="0.01" step="0.01" value={amount}
            onChange={(e) => { setAmount(e.target.value); setErr('') }}
          />
        </label>
        <label className="field">
          <span>Members</span>
          <input
            type="number" inputMode="numeric" min="2" max="10" value={members}
            onChange={(e) => { setMembers(e.target.value); setErr('') }}
          />
        </label>
      </div>
      {pot > 0 && Number.isFinite(pot) && (
        <p className="pot-preview">
          Each round, one person receives <b>{pot.toLocaleString()} USDC</b>.
        </p>
      )}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn btn-main" disabled={props.disabled || props.busy}>
        {props.disabled ? 'Connect a wallet to start' : props.busy ? 'Creating…' : 'Create equb'}
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
        <p className="quiet">{props.empty}</p>
      ) : (
        <ul>
          {props.items.map((e) => (
            <li key={e.address.toString()}>
              <button className="row" onClick={() => props.onPick(e.address.toString())}>
                <MiniRing e={e} />
                <span className="row-main">
                  <b>{e.data.name}</b>
                  <span className="quiet">
                    {toUsdc(e.data.contribution)} USDC a round, {e.data.members.length} of {e.data.maxMembers} seats taken
                  </span>
                </span>
                <StatusText e={e} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MiniRing({ e }: { e: EqubView }) {
  const n = e.data.maxMembers
  return (
    <svg className="mini-ring" viewBox="0 0 40 40" aria-hidden>
      {[...Array(n)].map((_, i) => {
        const a = (-90 + (i * 360) / n) * (Math.PI / 180)
        const filled = i < e.data.members.length
        const received = e.status !== 'open' && i < e.data.currentRound
        const next = e.status === 'active' && i === e.data.currentRound
        return (
          <circle
            key={i}
            cx={20 + 14 * Math.cos(a)}
            cy={20 + 14 * Math.sin(a)}
            r={next ? 4.4 : 3.2}
            className={next ? 'mr-next' : received ? 'mr-done' : filled ? 'mr-taken' : 'mr-open'}
          />
        )
      })}
    </svg>
  )
}

function StatusText({ e }: { e: EqubView }) {
  const n = e.data.maxMembers
  if (e.status === 'open') {
    const left = n - e.data.members.length
    return <span className="status s-open">{left} seat{left === 1 ? '' : 's'} open</span>
  }
  if (e.status === 'complete') return <span className="status s-done">Complete</span>
  return <span className="status s-active">Round {e.data.currentRound + 1} of {n}</span>
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
  const seatsLeft = d.maxMembers - n
  const myIdx = me ? d.members.findIndex((m) => m.equals(me)) : -1
  const isMember = myIdx >= 0
  const paidCount = [...Array(n)].filter((_, i) => hasBit(d.paidMask, i)).length
  const everyonePaid = e.status === 'active' && paidCount === n
  const next = e.status === 'active' ? d.members[d.currentRound] : null
  const pot = d.contribution.muln(d.maxMembers)

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

  const nameOf = (m: PublicKey) => (me && m.equals(me) ? 'You' : short(m))

  const seats: Seat[] = [...Array(d.maxMembers)].map((_, i) => {
    const m = d.members[i]
    if (!m) return { label: String(i + 1), state: 'open' }
    const received = e.status !== 'open' && i < d.currentRound
    const isNext = e.status === 'active' && i === d.currentRound
    return {
      label: String(i + 1),
      state: received ? 'received' : isNext ? 'next' : 'waiting',
      paid: e.status === 'active' && !received && hasBit(d.paidMask, i),
      you: !!me && m.equals(me),
    }
  })

  return (
    <main className="detail">
      <button className="back" onClick={props.onBack}>All equbs</button>

      <div className="detail-head">
        <h1>{d.name}</h1>
        <StatusText e={e} />
      </div>
      <p className="quiet byline">
        Started by {me && d.creator.equals(me) ? 'you' : short(d.creator)}.{' '}
        <a href={explorerAddr(e.address.toString())} target="_blank" rel="noreferrer">
          Check it on Solana Explorer
        </a>
      </p>

      <div className="detail-grid">
        <div className="ring-col">
          <SeatRing
            seats={seats}
            centerAmount={toUsdc(vault)}
            centerCaption="USDC in the pot now"
          />
          <p className="ring-proof">
            The pot sits in a vault only the program can move.{' '}
            <a href={explorerAddr(d.vault.toString())} target="_blank" rel="noreferrer">
              Verify the vault
            </a>
          </p>
          <ul className="legend" aria-label="Seat colors">
            <li><i className="lg lg-next" /> Next to receive</li>
            <li><i className="lg lg-paid" /> Paid this round</li>
            <li><i className="lg lg-done" /> Already received</li>
            {isMember && <li><i className="lg lg-you" /> Your seat</li>}
          </ul>
        </div>

        <div className="side-col">
          <div className="action">
            {!me ? (
              <p>Connect a wallet to join or pay in.</p>
            ) : e.status === 'open' && !isMember ? (
              <>
                <p>{seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left. Your place in line is the next open seat.</p>
                <button className="btn btn-main" disabled={!!busy} onClick={actions.join}>
                  {busy === 'join' ? 'Joining…' : 'Join this equb'}
                </button>
              </>
            ) : e.status === 'open' ? (
              <>
                <p>Waiting for {seatsLeft} more member{seatsLeft === 1 ? '' : 's'}. The first round starts when every seat is taken.</p>
                <button className="btn btn-line" onClick={share}>{copied ? 'Link copied' : 'Copy invite link'}</button>
              </>
            ) : everyonePaid ? (
              <>
                <p>Everyone has paid. The pot is ready for seat {d.currentRound + 1}.</p>
                <button className="btn btn-main" disabled={!!busy} onClick={actions.payout}>
                  {busy === 'payout' ? 'Paying out…' : `Pay ${toUsdc(d.contribution.muln(n))} USDC to ${next && me.equals(next) ? 'you' : short(next!)}`}
                </button>
              </>
            ) : isMember && !hasBit(d.paidMask, myIdx) ? (
              <>
                <p>Round {d.currentRound + 1} is open. {paidCount} of {n} paid so far.</p>
                <button className="btn btn-main" disabled={!!busy} onClick={actions.contribute}>
                  {busy === 'contribute' ? 'Sending…' : `Pay ${toUsdc(d.contribution)} USDC`}
                </button>
              </>
            ) : isMember && e.status === 'active' ? (
              <p>You’ve paid for round {d.currentRound + 1}. Waiting on {n - paidCount} more.</p>
            ) : e.status === 'complete' ? (
              <p>Every member has received the pot. This equb is finished.</p>
            ) : (
              <p>This equb is full and running.</p>
            )}
          </div>

          <dl className="facts">
            <div><dt>Each person pays</dt><dd>{toUsdc(d.contribution)} USDC</dd></div>
            <div><dt>Pot each round</dt><dd>{toUsdc(pot)} USDC</dd></div>
            <div><dt>Paid this round</dt><dd>{e.status === 'active' ? `${paidCount} of ${n}` : 'Not started'}</dd></div>
          </dl>

          {e.status === 'active' && (
            <Emergency e={e} me={me} myIdx={myIdx} busy={busy} propose={actions.propose} vote={actions.vote} nameOf={nameOf} />
          )}
        </div>
      </div>

      {e.status !== 'open' && (
        <RoundsBand total={d.maxMembers} done={d.currentRound} />
      )}

      <section className="order">
        <h2>Payout order</h2>
        <ol>
          {[...Array(d.maxMembers)].map((_, i) => {
            const m = d.members[i]
            const s = seats[i]
            return (
              <li key={i} className={`o-${s.state}`}>
                <span className="o-who">{m ? nameOf(m) : 'Open seat'}</span>
                <span className="o-note">
                  {s.state === 'received'
                    ? 'Received'
                    : s.state === 'next'
                      ? 'Receives next'
                      : s.paid
                        ? 'Paid this round'
                        : e.status === 'active'
                          ? 'Not paid yet'
                          : ''}
                </span>
              </li>
            )
          })}
        </ol>
      </section>
    </main>
  )
}

function Emergency(props: {
  e: EqubView
  me?: PublicKey
  myIdx: number
  busy: string | null
  propose: (ben: PublicKey, reason: string) => void
  vote: (yes: boolean) => void
  nameOf: (m: PublicKey) => string
}) {
  const { e, me, myIdx, busy, nameOf } = props
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
    return (
      <div className="emergency live">
        <h2>{nameOf(d.proposalBeneficiary)} asked to receive the next pot</h2>
        {d.proposalReason && <blockquote>{d.proposalReason}</blockquote>}
        <div className="votes" role="img" aria-label={`${yes} of ${needed} approvals needed`}>
          {[...Array(needed)].map((_, i) => (
            <span key={i} className={i < yes ? 'v on' : 'v'} />
          ))}
        </div>
        <p className="quiet">
          {yes} of {needed} approvals needed. {voted} of {n} members have voted.
        </p>
        {myIdx >= 0 && !iVoted ? (
          <div className="btn-pair">
            <button className="btn btn-main" disabled={!!busy} onClick={() => props.vote(true)}>
              {busy === 'vote' ? 'Sending…' : 'Approve'}
            </button>
            <button className="btn btn-line" disabled={!!busy} onClick={() => props.vote(false)}>
              Decline
            </button>
          </div>
        ) : myIdx >= 0 ? (
          <p className="quiet">You’ve voted.</p>
        ) : null}
      </div>
    )
  }

  if (myIdx < 0 || eligible.length === 0) return null

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!ben) return setErr('Choose who needs the pot.')
    if (!reason.trim()) return setErr('Add a short reason so the group can decide.')
    setErr('')
    props.propose(new PublicKey(ben), reason.trim())
  }

  return (
    <form className="emergency" onSubmit={submit} noValidate>
      <h2>Need the pot sooner?</h2>
      <p className="quiet">
        Ask the group. If {needed} of {n} members approve, that person moves to the front of the line.
      </p>
      <label className="field">
        <span>Who needs it</span>
        <select value={ben} onChange={(ev) => { setBen(ev.target.value); setErr('') }}>
          {eligible.map(({ m }) => (
            <option key={m.toString()} value={m.toString()}>
              {me && m.equals(me) ? 'Me' : short(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Reason</span>
        <input
          value={reason}
          maxLength={64}
          placeholder="School fees due Friday"
          onChange={(ev) => { setReason(ev.target.value); setErr('') }}
        />
      </label>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn btn-line" disabled={!!busy}>
        {busy === 'propose' ? 'Sending…' : 'Ask the group'}
      </button>
    </form>
  )
}
