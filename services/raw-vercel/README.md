# Singapore function: IP and port tools (formerly the Raw endpoint)

**What the site uses it for now:** `/api/ipinfo` and `/api/portcheck`, the
shared-IP check and the inbound reachability test. Both need a server abroad
that can open TCP connections back to the visitor, which a Cloudflare Worker
cannot do.

**What it no longer does:** carry Raw's speed test. Raw runs on Measurement
Lab's servers (see the main README for why), and the site no longer calls this
project's `/ping`, `/download`, `/upload` or `/meta`. They still exist, and so
do the region projects (`delta-bom1`, `delta-hnd1`) and Singapore mirrors
(`delta-sin1-2` to `-4`) deployed for that job; those can be deleted.

The notes below describe it as it was built, as the Raw endpoint. Deployed as
its own Vercel project so its bandwidth is metered separately from the site.

## Why Vercel, and why not the Edge runtime

Vercel has no Dhaka PoP, so traffic from Bangladesh to a function here crosses
the ISP's international (IIG) capacity. That is precisely what Raw measures, and
it is why the Local endpoint cannot do this job: a Cloudflare Worker is served
from Dhaka over BDIX peering and never leaves the country.

`vercel.json` pins these functions to `sin1` (Singapore) on the **Node** runtime.
Using the Edge runtime here would be a silent, total failure: Edge functions run
at the PoP nearest the visitor, so the measurement would collapse back to
whatever is closest and report an international speed that was never measured.

## Bandwidth

This is the one real cost. Vercel meters egress, and a speedtest exists to
consume it: one download phase moves roughly `speed x 8 seconds` of data, so a
20 Mbps international line burns about 20 MB per test. The 100 GB free
allowance is therefore a few thousand tests. Watch it if the site gets shared
widely, and move to a plain VPS if it becomes the limiting factor.

## Deploy

```sh
cd services/raw-vercel
vercel link --yes --token "$VERCEL_TOKEN"
vercel env add SIGNING_SECRET production --token "$VERCEL_TOKEN"   # same value as the Worker
vercel deploy --prod --token "$VERCEL_TOKEN"
```

Then point the site at it and redeploy. Note the **`/api` suffix**: Vercel serves
functions under `/api`, and the engine appends `/ping`, `/download` and so on to
whatever base URL it is given.

```sh
VITE_RAW_URL=https://<deployment>.vercel.app/api ./scripts/deploy-cloudflare.sh
```

## Verifying it is actually in Singapore

```sh
curl -s https://<deployment>.vercel.app/api/meta
```

`region` must read `sin1`. If it reports anything else the functions are not
pinned and the numbers are meaningless.
