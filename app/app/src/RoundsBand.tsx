/**
 * Round progress drawn as a tibeb band: each finished round is a woven
 * block, the current round is half-woven, later rounds are bare thread.
 */
export function RoundsBand({ total, done }: { total: number; done: number }) {
  const finished = done >= total
  return (
    <section className="rounds" aria-label={finished ? `All ${total} rounds finished` : `Round ${done + 1} of ${total}`}>
      <div className="rounds-head">
        <h2>Rounds</h2>
        <span className="quiet">
          {finished ? `All ${total} finished` : `${done} of ${total} paid out`}
        </span>
      </div>
      <ol className="band" style={{ ['--n' as string]: total }}>
        {[...Array(total)].map((_, i) => (
          <li
            key={i}
            className={i < done ? 'b-done' : i === done && !finished ? 'b-now' : 'b-later'}
            title={`Round ${i + 1}`}
          >
            <span className="b-label">{i + 1}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
