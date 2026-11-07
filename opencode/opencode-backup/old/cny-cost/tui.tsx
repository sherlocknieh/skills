import { createMemo, createSignal } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"

const FALLBACK_RATE = 7.2
const REFRESH_MS = 6 * 60 * 60 * 1000

// Free, key-less USD -> CNY sources, tried in order.
const SOURCES = [
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
  "https://open.er-api.com/v6/latest/USD",
]

async function fetchRate(): Promise<number | undefined> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = (await res.json()) as { rates?: Record<string, number> }
      const value = data?.rates?.CNY
      if (typeof value === "number" && value > 0) return value
    } catch {
      // try the next source
    }
  }
  return undefined
}

function format(usd: number, rate: number) {
  const cny = usd * rate
  if (cny === 0) return "¥0.00"
  return cny < 0.01 ? `¥${cny.toFixed(4)}` : `¥${cny.toFixed(2)}`
}

function CostLine(props: { sessionID?: string; rate: () => number }) {
  const context = usePlugin()
  const text = createMemo(() => {
    if (!props.sessionID) return ""
    const usd = context.data.session.cost(props.sessionID) ?? 0
    return format(usd, props.rate())
  })
  return <text fg={context.theme.text.base}>{text()}</text>
}

export default Plugin.define({
  id: "cny.cost",
  async setup(context) {
    const [rate, setRate] = createSignal(FALLBACK_RATE)

    const refresh = async () => {
      const value = await fetchRate()
      if (value !== undefined) setRate(value)
    }
    void refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    const unregister = context.ui.slot({
      append: "prompt.footer.status",
      render: ({ sessionID }) => <CostLine sessionID={sessionID} rate={rate} />,
    })

    return () => {
      clearInterval(timer)
      unregister?.()
    }
  },
})
