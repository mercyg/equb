import { useId } from 'react'

export type Seat = {
  label: string
  state: 'received' | 'next' | 'waiting' | 'open'
  paid?: boolean
  you?: boolean
}

const C = 200
const R = 142

/**
 * The equb drawn as what it is: people seated in a circle, with the pot
 * moving to the next seat each round. The ring itself is woven like the
 * tibeb border on a netela.
 */
export function SeatRing(props: {
  seats: Seat[]
  centerAmount: string
  centerCaption: string
  animatePot?: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const n = props.seats.length
  const sr = n <= 6 ? 30 : n <= 8 ? 26 : 22
  const pos = (i: number) => {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180)
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) }
  }
  const nextIdx = props.seats.findIndex((s) => s.state === 'next')
  const target = nextIdx >= 0 ? pos(nextIdx) : null

  return (
    <svg className="seat-ring" viewBox="0 0 400 400" role="img" aria-label={`${n} seats in the circle`}>
      <defs>
        <pattern id={`tibeb-${uid}`} width="24" height="12" patternUnits="userSpaceOnUse">
          <rect width="24" height="12" className="tb-ground" />
          <path d="M0 12 L6 0 L12 12 Z" className="tb-a" />
          <path d="M12 0 L18 12 L24 0 Z" className="tb-b" />
          <rect x="5" y="5" width="2" height="2" className="tb-c" />
          <rect x="17" y="5" width="2" height="2" className="tb-d" />
        </pattern>
      </defs>

      <circle cx={C} cy={C} r={R} className="ring-weave" stroke={`url(#tibeb-${uid})`} />
      <circle cx={C} cy={C} r={R - 7} className="ring-edge" />
      <circle cx={C} cy={C} r={R + 7} className="ring-edge" />

      <g className={props.animatePot ? 'center-text delayed' : 'center-text'}>
        <text x={C} y={C - 4} className="center-amount">{props.centerAmount}</text>
        <text x={C} y={C + 24} className="center-caption">{props.centerCaption}</text>
      </g>

      {props.seats.map((s, i) => {
        const { x, y } = pos(i)
        return (
          <g key={i} className={`seat seat-${s.state}`}>
            {s.you && <circle cx={x} cy={y} r={sr + 8} className="seat-you" />}
            <circle cx={x} cy={y} r={sr} className="seat-disc" />
            <text x={x} y={y} className="seat-num">{s.label}</text>
            {s.paid && (
              <g className="seat-paid" transform={`translate(${x + sr * 0.72} ${y - sr * 0.72})`}>
                <circle r="9" />
                <path d="M-4 0.5 L-1.2 3.2 L4 -2.6" />
              </g>
            )}
          </g>
        )
      })}

      {props.animatePot && target && (
        <g
          className="pot-coin"
          style={{
            ['--tx' as string]: `${target.x - C}px`,
            ['--ty' as string]: `${target.y - C}px`,
          }}
        >
          <circle cx={C} cy={C} r="13" />
        </g>
      )}
    </svg>
  )
}
