# Combined BDIX + RAW Speedtest: Design

Date: 2026-08-19
Status: Approved, ready for implementation planning

## Problem

In Bangladesh, two speedtest sites give two very different numbers for the same
connection, and both are correct.

- speedtest.net auto selects a nearby server that sits inside a BDIX peered
  local datacenter. That traffic never leaves the country and runs at full local
  port speed. Users read this as their "BDIX speed".
- speedtest.sg forces a Singapore server, so the test crosses the ISP's IIG
  (international) bandwidth, which on a typical home package is a fraction of the
  local capacity. Users read this as their "raw" speed.

Neither site shows the relationship between the two, which is the number that
actually explains a Bangladeshi user's internet experience. This project puts
both paths behind one interface and makes the gap between them visible.

## What this is not

There is no free Speedtest.net API that can be called from a website. Ookla's
Web SDK requires a purchased licence, and their other APIs are network operator
products. The free `speedtest` CLI and the unofficial npm and Python wrappers
all share a disqualifying flaw for this use case: they run on a server and
measure that server's connection, not the visitor's. Throughput to a visitor can
only be measured in the visitor's own browser, against servers whose location we
control. That is why every speedtest site operates its own server fleet, and it
is why this project needs two endpoints of its own.

## Architecture

Four separable pieces.

| Piece | Responsibility | Depends on | Runs on |
| --- | --- | --- | --- |
| Measurement engine | Turn a base URL into a measured result. No framework, no UI. | Browser fetch, XHR, Web Worker | Visitor's browser |
| Endpoints | Serve and absorb bytes, report client metadata. | Nothing in this repo | CF Worker (Dhaka), Oracle VM (Singapore) |
| Results service | Persist runs, mint share links, aggregate the leaderboard. | Supabase | Vercel function |
| Interface | Split world visual, gauges, mode control. | Measurement engine | Vercel |

The central decision: **the engine takes a base URL as a parameter and has no
concept of a mode.** BDIX and RAW are two values passed in, not two code paths.
Everything that makes this project distinctive lives in configuration and
presentation, not in measurement logic. Adding a third location later is a
config entry.

### Endpoint selection

| Mode | Host | Why |
| --- | --- | --- |
| BDIX | Cloudflare Worker | Cloudflare is a BDIX member with a Dhaka PoP, so for most BD ISPs this is genuinely served over local peering. Free, full CORS control, and `request.cf` supplies ISP and ASN at no cost. |
| RAW | Oracle Cloud Always Free ARM VM, Singapore region | Permanent free tier with 10 TB per month of egress. A real international path across the ISP's IIG capacity, which is exactly what speedtest.sg measures. |

Vercel is deliberately excluded from byte transfer. Its bandwidth is metered and
a speedtest consumes a free tier in roughly two thousand runs. Vercel hosts the
React app and the results function only.

The BDIX side is an approximation of a true BDIX server, not identical to one.
The interface must label it as local peering rather than claim certified BDIX
measurement. If a real BDIX peered VPS is provisioned later it drops in as a
base URL change, because the contract below is host agnostic.

## Endpoint contract

Both hosts implement the same four routes.

```
GET  /ping                    -> 204, empty body
GET  /download?bytes=N&salt=S -> N bytes of incompressible random data
POST /upload                  -> body read and discarded, 204
GET  /meta                    -> { ip, isp, asn, city, country, server }
```

Required response headers on every route:

```
Access-Control-Allow-Origin: <site origin>
Timing-Allow-Origin: *
Cache-Control: no-store, no-cache, must-revalidate
```

Three requirements that determine whether the numbers mean anything:

1. **The payload must be incompressible.** A body of zeros gets transparently
   compressed by intermediate proxies and produces fabricated gigabit readings.
   The generator emits random bytes and compression is explicitly disabled.
2. **Caching must be defeated on both sides.** `no-store` plus a per request
   `salt` query parameter, otherwise a second run measures the local disk.
3. **`Timing-Allow-Origin` must be present**, or Resource Timing returns
   redacted values cross origin and fallback timing paths break.

`/meta` is served only by the Cloudflare Worker. Workers expose
`request.cf.asOrganization`, `city` and `country` directly, which is accurate
enough for the connection info panel and costs nothing. The Oracle host serves
bytes only. This asymmetry is intentional and does not affect the engine, which
requests metadata once per session rather than per mode.

## Measurement method

### Phases

A run is four phases in sequence: latency, download, upload, aggregate.

**Latency.** N sequential `GET /ping` requests. Ping is the median round trip
time. Jitter is the mean absolute deviation of successive differences between
round trip times. Sequential rather than parallel, since concurrent requests
queue against each other and inflate both figures.

**Download.** Four to six concurrent `fetch` streams, read through a
`ReadableStream` reader, with bytes and timestamps accumulated as chunks arrive.

**Upload.** Four to six concurrent POSTs of pre generated random blobs, tracked
via `XMLHttpRequest.upload.onprogress`. `fetch` still provides no upload progress
events in most browsers, so XHR is the only route to a live upload curve. This is
a constraint, not a preference.

**Aggregate.** Samples become a curve and a single figure.

### Decisions that determine accuracy

**Fixed duration, not fixed payload size.** Each transfer phase runs for a fixed
wall clock window of roughly eight seconds. A fixed payload size cannot serve
both ends of the range: it takes a minute on a 5 Mbps connection and completes
in 200 ms on a 900 Mbps one, which is too short to measure anything. Chunk size
adapts within the window based on observed throughput.

**Parallel streams are mandatory.** A single TCP connection cannot saturate a
fast link because of receive window and per flow shaping limits. Single stream
measurement systematically understates fast connections.

**The ramp is discarded.** TCP slow start guarantees the opening of every
transfer is slower than the link. Samples are bucketed into 100 ms windows, the
opening window is dropped, and the result is a trimmed mean over what remains.
Reporting a raw average across the whole transfer understates every connection
and understates fast ones most.

**Transfers are aborted at the duration boundary** via `AbortController`, so a
fast connection does not silently consume free tier egress after the measurement
window has closed.

### Threading

Stream reading and byte accounting run inside a **Web Worker**. This is a
correctness requirement rather than an optimisation, for the reason set out
below.

## The animation constraint

Heavy animation is a headline requirement of this project, and heavy animation
depresses measured throughput. A particle field and a repainting gauge compete
for the same main thread that is supposed to be draining the download stream.
The effect is worst on low powered devices, which means the measurement is least
accurate for exactly the users whose connections are most in question.

The interface is therefore designed around the measurement rather than layered
on top of it:

- Stream reading and byte accounting live in a Web Worker and are never blocked
  by paint.
- The particle field renders to a single canvas, not to DOM nodes.
- All other motion animates `transform` and `opacity` only, keeping it on the
  compositor.
- A genuine `prefers-reduced-motion` path preserves every number and every
  transition of meaning while dropping the field. It is a supported mode, not a
  degradation.

Any implementation that animates during measurement on the main thread is
incorrect, regardless of how it looks.

## Interface: the split world

Two visual worlds occupy one page and the mode control slides between them.

**BDIX world.** Warm green and amber. The server node sits close to the viewer.
Dense particle field, short and fast light trails. Everything reads as near.

**RAW world.** Cool cyan and blue. The server node sits far toward the edge of
the frame. Sparse field, long slow trails that take visible time to cross.
Everything reads as distant.

Identical layout and identical gauge in both. Only colour temperature and
apparent distance invert. Switching modes translates the field horizontally and
shifts the palette, so the difference between the two paths registers before any
number is read.

**Run both** divides the frame down the centre, runs BDIX then RAW back to back,
and resolves to a ratio counter animating up to a figure such as `x 7.4`. That
ratio is the reason the project exists and is the one thing neither source site
can display.

### Motion inventory

| Moment | Treatment |
| --- | --- |
| Entry | Signal acquisition sequence resolving into the idle world |
| Idle | Slow drifting gradient field, topology suggesting particle motion |
| Mode switch | Horizontal world translation with palette temperature shift |
| During test | Light packets traversing between viewer node and server node, density and velocity bound to live throughput |
| Gauge | SVG arc with trailing glow, spring driven numerals, ticks illuminating progressively |
| Live graph | Throughput trace drawing in real time |
| Result | Staggered card entrance; in run both mode, the ratio counter |

## Results, sharing, history

Supabase table `results`, keyed by a short nanoid.

Recorded per run: mode, download Mbps, upload Mbps, ping ms, jitter ms, ISP, ASN,
city, country, timestamp. Runs in `both` mode record the paired figures and the
derived ratio.

Row level security permits anonymous insert and public read of a single row by
id. There is no public table wide read. History is stored locally in the browser
first, so the product works without accounts.

`/r/:id` renders a share card for a single result.

## Leaderboard and its honesty problem

An ISP leaderboard built on anonymous inserts can be poisoned by anyone with a
script, and a leaderboard that can be trivially poisoned is worse than none,
because it presents fabricated data with the authority of aggregate statistics.

Mitigations, in ascending order of strength:

1. Median rather than mean per ISP, so individual outliers cannot move a ranking.
2. A minimum sample count before an ISP is listed at all.
3. Plausibility bounds rejecting physically implausible figures.
4. **Server side verification.** The endpoint knows exactly how many bytes it
   served and over what interval, so it issues a signed token carrying those
   facts. `/api/results` verifies the claimed speed against the token before a
   result is eligible for aggregation.

Items 1 through 3 are heuristics. Item 4 is the actual fix, and it ships in the
same phase as the leaderboard. Unverified results remain viewable and shareable
as personal results but are excluded from aggregation.

## Testing

**The mock endpoint server is the centrepiece.** A local server implementing the
endpoint contract with deliberate throttling, so a 5 Mbps path and a 900 Mbps
path can both be exercised deterministically rather than hoped for. Without it,
the accuracy decisions above are untestable.

- Unit tests over aggregation, ramp trimming, jitter calculation and adaptive
  sizing, against synthetic sample arrays.
- Playwright end to end runs against the mock, including a run asserting the
  reduced motion path preserves every reported figure.
- Contract tests against both live endpoints verifying CORS headers, cache
  headers, and that the download payload is genuinely incompressible.

## Stack

Vite, React, TypeScript, Tailwind, shadcn/ui, Motion for animation, deployed on
Vercel. Cloudflare Workers for the BDIX endpoint. Oracle Cloud Always Free ARM
instance for the RAW endpoint. Supabase for results.

Repository location is `~/dev/speedtest`. Not Desktop, which is iCloud synced;
sync renames files inside dependency trees and breaks builds with errors that
never indicate the cause.

## Phases

1. Measurement engine, mock endpoint server, full test suite. No interface.
2. Both endpoints deployed and contract tests passing against them.
3. Interface shell, split world, gauge, single mode operating end to end.
4. Mode toggle, run both, ratio presentation.
5. Supabase persistence, share links, local history.
6. Leaderboard with signed verification tokens.

Phases 1 and 2 decide whether the project produces real numbers. Everything
after them is presentation over a foundation that is either sound or is not.

## Open items

None blocking. Two to confirm during implementation:

- Whether the user's ISP routes to Cloudflare's Dhaka PoP, verified with a real
  measurement in phase 2. If a significant share of BD traffic reaches a foreign
  Cloudflare PoP instead, the BDIX side needs a real BDIX peered VPS and phase 2
  expands.
- Oracle Always Free ARM capacity in the Singapore region is intermittently
  unavailable to new accounts. If provisioning fails, an alternative Singapore
  host is needed for the RAW endpoint.
