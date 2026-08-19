# Two Speeds

A speedtest for Bangladesh that measures both paths your connection actually has,
and shows you the gap between them.

`speedtest.net` picks a nearby server inside a BDIX-peered local datacentre, so
its number reflects traffic that never leaves the country. `speedtest.sg` forces
Singapore, so its number reflects your ISP's international (IIG) capacity. Both
are correct, and neither shows you the relationship between them. That ratio is
the number that explains why a connection benchmarking at 90 Mbps still buffers
on YouTube.

## Layout

| Path | What it is |
| --- | --- |
| `packages/engine` | The measurement engine. Framework-free TypeScript, no UI, no notion of a "mode". Takes a base URL. |
| `apps/web` | React interface. Split-world visual, gauges, mode control. |
| `services/mock` | Local endpoint with deliberate throttling, for testing both ends of the speed range. |
| `services/worker` | BDIX endpoint. Cloudflare Worker. |
| `services/origin` | RAW endpoint. Node service for the Singapore host. |

The engine takes a base URL and a label. BDIX and RAW are two values passed in,
not two code paths, which is why adding a third location later is a config entry
rather than a change to measurement code.

## Running locally

Two mocks shaped like a typical Bangladeshi connection, then the app:

```sh
npm install

PORT=8180 MOCK_MBPS=95 MOCK_LATENCY_MS=3   MOCK_JITTER_MS=1  MOCK_LABEL=bdix node services/mock/src/server.js &
PORT=8181 MOCK_MBPS=13 MOCK_LATENCY_MS=175 MOCK_JITTER_MS=12 MOCK_LABEL=raw  node services/mock/src/server.js &

npm run dev -w @speedtest/web
```

`apps/web/.env.local` points the app at them:

```
VITE_BDIX_URL=http://127.0.0.1:8180
VITE_RAW_URL=http://127.0.0.1:8181
```

While those URLs are localhost the interface says so on the page. It never
presents mock figures as though they came from a network.

## Tests

```sh
npm test
```

Unit tests cover the aggregation maths. Integration tests run the real engine
against the shaped mock and assert it measures a 5 Mbps link and a 200 Mbps link
correctly through the same code path, which is the only way those accuracy
decisions are testable at all.

## How the measurement works

Fixed 8-second windows rather than fixed payload sizes, because a payload sized
for a slow line finishes too fast to measure on a quick one. Six concurrent
streams, because one TCP connection cannot saturate a fast link. The opening
20 percent of sample windows is discarded, since TCP slow start makes the start
of every transfer slower than the line, then the slowest and fastest 10 percent
are trimmed before averaging.

Uploads use `XMLHttpRequest` rather than `fetch`, which is a constraint and not
a preference: `fetch` still exposes no upload progress events in most browsers.

The whole measurement runs in a Web Worker. That is a correctness requirement,
not an optimisation. The interface animates a canvas particle field and a
repainting gauge during a test, and on the main thread that work would compete
with the loop draining the download stream, reporting artificially low speeds on
exactly the weakest devices.

## Honesty about BDIX

The BDIX endpoint is a Cloudflare Worker. Cloudflare is a BDIX member with a
Dhaka PoP, so for most Bangladeshi ISPs these requests are served over local
peering. It approximates a BDIX server; it is not a certified one, and the
interface says so rather than overclaiming. Swapping in a real BDIX-peered VPS
later is a base URL change, because both endpoints implement the same contract.

See `docs/superpowers/specs/` for the full design, and `docs/DEPLOYING.md` for
setup.
