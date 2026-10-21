# Delta

Δ is the difference between two measurements, which is what this site reports.
Bangladesh is also the world's largest river delta.

**Live: https://deltaspeed.pages.dev**

| | |
| --- | --- |
| Site | https://deltaspeed.pages.dev (Cloudflare Pages) |
| Local | `local1.erfanul.me` to `local4.erfanul.me`, one Cloudflare Worker (`delta-local`, PoP `DAC`) on a zone with HTTP/3 off |
| Raw | [Measurement Lab](https://www.measurementlab.net/) servers in Singapore (`sin01`), Mumbai (`bom02`) and Tokyo (`hnd02`) |
| IP and port tools | https://delta-sin1.vercel.app/api (Vercel function, Singapore) |

A speedtest for Bangladesh that measures both paths your connection actually has,
and shows you the gap between them: **Local** (BDIX peering, never leaves the
country) against **Raw** (Singapore, Mumbai or Tokyo, across your ISP's
international capacity).

`speedtest.net` picks a nearby server inside a BDIX-peered local datacentre, so
its number reflects traffic that never leaves the country. Picking a Singapore
server instead reflects your ISP's international (IIG) capacity. Both are
correct, and neither shows you the relationship between them. That ratio is the
number that explains why a connection benchmarking at 90 Mbps still buffers on
YouTube.

## Layout

| Path | What it is |
| --- | --- |
| `packages/engine` | The measurement engine. Framework-free TypeScript, no UI. Local takes a base URL; Raw takes an M-Lab site code. |
| `apps/web` | React interface. Split-world visual, gauges, mode control. |
| `services/mock` | Shaped mocks for testing both ends of the speed range: `server.js` for Local, `msak.js` for M-Lab. |
| `services/worker` | Local endpoint. Cloudflare Worker. |
| `services/raw-vercel` | IP and port tools, run from Singapore. Formerly the Raw endpoint. |
| `services/origin` | Optional self-hosted Raw endpoint for a VPS, if you would rather not use M-Lab. |
| `packages/attest` | Signed byte-count attestation, shared by Delta's endpoints and the verifier. |
| `supabase/` | Schema. Browser keys can neither read nor write the results table. |

## Running locally

Two mocks shaped like a typical Bangladeshi connection, then the app:

```sh
npm install

PORT=8180 MOCK_MBPS=95 MOCK_LATENCY_MS=3 MOCK_JITTER_MS=1 MOCK_LABEL=bdix node services/mock/src/server.js &
PORT=8181 MOCK_MBPS=13 MOCK_UP_MBPS=8 MOCK_RTT_MS=175 node services/mock/src/msak.js &

npm run dev -w @speedtest/web
```

`apps/web/.env.local` points the app at them:

```
VITE_BDIX_URL=http://127.0.0.1:8180
VITE_MLAB_LOCATE_URL=http://127.0.0.1:8181
```

Leave `VITE_MLAB_LOCATE_URL` out to test Raw against the real M-Lab servers.
While either URL is localhost the interface says so on the page. It never
presents mock figures as though they came from a network.

## Tests

```sh
npm test
```

Unit tests cover the aggregation maths. Integration tests run the real engine
against the shaped mocks and assert it measures slow and fast links correctly
through the same code path, which is the only way those accuracy decisions are
testable at all. The M-Lab mock can also deliver frames in bursts and imitate a
proxy that acknowledges data early, the two conditions that broke naive
counting on a real path.

## How the measurement works

Both paths are reduced to a figure by the same statistic, so the ratio between
them means something. Each transfer runs for a fixed 8 seconds rather than a
fixed payload, because a payload sized for a slow line finishes too fast to
measure on a quick one. Throughput is bucketed into 100 ms windows, the opening
20 percent is discarded because TCP slow start makes the start of every transfer
slower than the line, and the slowest 30 percent of the rest are dropped before
averaging. That last step matches Ookla's published method, so the figures are
comparable with what speedtest.net shows.

The whole measurement runs in a Web Worker. That is a correctness requirement,
not an optimisation. The interface animates a gauge and a particle field during
a test, and on the main thread that work would compete with the loop draining
the download, reporting artificially low speeds on exactly the weakest devices.

### Local

Eight concurrent HTTP streams to a Cloudflare Worker. Uploads use
`XMLHttpRequest`, because `fetch` still exposes no upload progress in most
browsers.

The Worker is reached through custom domains on `erfanul.me`, a Cloudflare zone
with HTTP/3 switched off, and not through `workers.dev`. Chrome's HTTP/3 (QUIC)
runs in user space and gave out long before the line did: on a wired 1 Gbps
connection the same Worker read 501 Mbps in Chrome over HTTP/3 and 826 over
HTTP/2, against 833 for plain curl. `workers.dev` always advertises HTTP/3, and
only a zone of your own can turn it off. Raw is unaffected, because WebSockets
run over TCP. HTTP/3 was also why a single connection used to be a ceiling
(eight streams to one origin read 234 Mbps on a 470 Mbps line); over HTTP/2
one connection carried 841 Mbps.

There are four hostnames, `local1` to `local4`, for a different reason.
Cloudflare answers each with two anycast addresses, and an ISP can route the
two to different places: on the line Delta was tuned on, one address was served
from Dhaka and the other from Marseille, and Chrome chose between them per
hostname, sending about a third of connections to France. So before measuring,
the engine asks each hostname which PoP its connection reached, times it, and
measures only through the ones on the nearest PoP. If none got there, it falls
back to the Worker's `workers.dev` addresses, which are different ones.

### Raw

Raw runs on [Measurement Lab](https://www.measurementlab.net/), a non-profit
open measurement platform, using its multi-stream MSAK protocol: four WebSocket
streams per direction with BBR congestion control. M-Lab's servers are physical
machines on 10 Gbps transit links (TATA in Singapore and Mumbai, BIGLOBE in
Tokyo), with no CDN in front, so a test really does cross your ISP's
international capacity and the server is not the bottleneck of a home line.
Delta implements the protocol itself instead of using M-Lab's `msak-js`, so that
Raw goes through the same statistic as Local.

Raw used to run on Vercel functions pinned to Singapore. They were the wrong
instrument: Vercel answers from the nearest edge and then hauls the request to
the function, so its ping included the haul (401 ms on a path whose real round
trip was 166 ms), and the functions' streaming capped throughput at around
126 Mbps.

- **Download** is counted from the server kernel's acknowledged-byte counter,
  placed on the server's own clock. Counting WebSocket messages as they reach
  the page is too coarse on its own: messages grow to 1 MB and can land several
  at once. The browser's own count is kept as well, and if it falls clearly
  below the server's (a VPN or mobile "TCP optimiser" acknowledging data on the
  client's behalf, or a device that cannot keep up), what reached the browser is
  used instead.
- **Upload** is counted from the server kernel's received-byte counter, since
  the browser can only see bytes handed to its own socket buffer.
- **Ping** is the server kernel's minimum round trip time, and **jitter** its
  RTT variation, measured while data flows. Behind a TCP-splitting proxy these
  describe the path from M-Lab to the proxy, not to you.

M-Lab publishes every test it runs, including the client's IP address, as open
data. The interface says so next to the buttons that start a Raw test, and links
to M-Lab's privacy policy, as M-Lab requires of third-party clients. Delta's own
privacy page is at `/privacy`. M-Lab allows 40 tests a day per client, and the
interface explains the limit if it is reached.

## Honesty about BDIX

The Local endpoint is a Cloudflare Worker. Cloudflare is a BDIX member with a
Dhaka PoP, so for most Bangladeshi ISPs these requests are served over local
peering. It approximates a BDIX server; it is not a certified one, and the
interface says so rather than overclaiming. Swapping in a real BDIX-peered VPS
later is a base URL change, because the Worker and `services/origin` implement
the same contract.

## Results, sharing and the leaderboard

A finished run is written to local history immediately, with no backend
involved, so the site works fully unconfigured. Where Supabase is configured it
is also saved through `/api/results` and gets a share link at `/r/:id`.

The ISP leaderboard counts only verified results. Verification works by having
each of Delta's endpoints sign the byte count it actually served; the browser
collects those signatures and the API function checks them against the claimed
result before storing it. The signing key never reaches the browser, so a client
can discard tokens and under-report but cannot invent bytes that were never
sent. M-Lab signs nothing for Delta, so Raw figures carry no attestation, and a
result whose Raw download exceeds its Local one cannot verify.

This catches fabrication by a factor of ten or more, not a careful 50 percent
shave. See `docs/DEPLOYING.md` for why, and for the access model on the results
table.

See `docs/superpowers/specs/` for the original design, and `docs/DEPLOYING.md`
for setup.
