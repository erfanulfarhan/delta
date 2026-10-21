# Deploying

Delta runs on four things, and only two of them are deployed by this repo's
main script:

| Piece | Where | Deployed by |
| --- | --- | --- |
| Local endpoint | Cloudflare Worker `delta-local` (plus mirrors `-2`, `-3`, `-4`) | `scripts/deploy-cloudflare.sh` |
| Site | Cloudflare Pages project `deltaspeed` | `scripts/deploy-cloudflare.sh` |
| Raw | Measurement Lab's servers | nothing: M-Lab runs them |
| IP and port tools | Vercel function `delta-sin1`, pinned to Singapore | `scripts/deploy-region.sh sin1` |

```sh
./scripts/deploy-cloudflare.sh
```

It reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from
`~/.erfanul-secrets.env`, deploys the Worker, checks it answers, builds the site
against it and publishes the build to Pages. The site is served at
`https://deltaspeed.pages.dev`. Never assume the subdomain from the project name:
Cloudflare suffixes it when the name is taken globally, which is how an older
project ended up at `delta-b4x.pages.dev`.

## 1. Local endpoint (Cloudflare Worker)

Cloudflare is a BDIX member with a Dhaka PoP, so this is served over local
peering for most Bangladeshi ISPs. The deploy script handles it; by hand:

```sh
npm i -g wrangler
wrangler login                 # or: export CLOUDFLARE_API_TOKEN=...
cd services/worker
wrangler deploy
```

The token needs the **Workers Scripts: Edit** permission. R2 keys will not work;
those are S3-style credentials and cannot deploy a Worker.

Verify it is actually being served from Dhaka:

```sh
curl -s https://delta-local.erfanul100.workers.dev/meta | jq
```

`colo` should read `DAC` (Dhaka). If it reports a foreign PoP, your ISP does not
reach Cloudflare locally and this endpoint is not measuring BDIX for you. In
that case rent a genuinely BDIX-peered VPS and point `VITE_BDIX_URL` at it; the
contract is identical, so nothing else changes.

The mirrors exist only so the browser opens more than one connection (see the
README). They run the same code under different names and are redeployed by
hand when the Worker changes.

## 2. Raw (Measurement Lab)

Nothing to deploy. Raw runs against [M-Lab](https://www.measurementlab.net/)'s
physical servers through its Locate service, which hands out a signed URL per
test. The sites are listed in `apps/web/src/config.ts` (`RAW_SERVERS`); any
M-Lab site that runs MSAK can be added there by its site code.

Check that a site is answering:

```sh
curl -s 'https://locate.measurementlab.net/v2/nearest/msak/throughput1?site=sin01&client_name=delta-speedtest&client_version=check' | jq '.results[0].machine'
```

Using M-Lab comes with obligations, and the site meets them as follows. Keep them
in place when changing the interface:

- **Informed consent before a test.** The notice under the buttons says M-Lab
  publishes every result with the IP address, and links to M-Lab's privacy
  policy. A Raw test only starts from Go in Raw mode or Run both.
- **A published privacy policy** for the client: `/privacy` in the app.
- **A client name.** Every request carries `client_name=delta-speedtest` and a
  version, from `MLAB` in `config.ts`.
- **Failing gracefully.** If Locate or a server is unreachable the run ends with
  a message saying so, and Local keeps working.
- **Rate limit.** M-Lab allows 40 tests a day per client. The interface explains
  the limit when Locate refuses.

### Self-hosting Raw instead (optional)

`services/origin` is a Node endpoint with the same contract as the Worker, for a
VPS of your own in Singapore. `docs/ORACLE-SETUP.md` walks through an Oracle
Always Free box. The interface currently lists only M-Lab sites, so using an
origin again means adding a `RawServer` that runs through the engine's HTTP
path (`run`) rather than `runMlab`.

Two things silently ruin a self-hosted Raw endpoint:

- **HTTPS is mandatory.** The site is served over HTTPS and a browser refuses to
  call an HTTP endpoint from an HTTPS page.
- **Do not proxy the record through Cloudflare.** An orange-clouded record is
  served from Cloudflare's Dhaka PoP, which turns the Raw number into a second
  BDIX number while continuing to display plausible figures. Leave it grey,
  DNS only.

## 3. IP and port tools (Vercel, Singapore)

The reachability check needs a server abroad that can open TCP connections back
to the visitor, which a Worker cannot. It runs from `services/raw-vercel`:

```sh
./scripts/deploy-region.sh sin1
```

The script needs `VERCEL_TOKEN` in `~/.erfanul-secrets.env`. It pins the
functions to `sin1` on the Node runtime and checks `/api/meta` reports that
region. The same project still serves throughput endpoints from when it was the
Raw server; the site no longer calls them.

## 4. Results storage (Supabase), optional

The live site on Pages runs without it: history stays in the browser and there
are no share links. Sharing needs `/api/results`, which is a Vercel function in
`apps/web/api`, so it only works when the site itself is deployed to Vercel.

Create a project, then run `supabase/migrations/20260819000001_results.sql` in
the SQL editor.

The access model is worth understanding before changing it. Browser keys have
**no** policy on `results`, so they can neither read nor write the table. Writes
arrive only through `/api/results`, which checks the endpoints' signed byte
counts and inserts with the service role. Reads of a single result go through
`get_result(short_id)`, so possession of the id is what grants access, which is
what a share link is supposed to mean. Granting `select` on the table would make
every result anyone ever ran enumerable, along with their ISP and city.

Generate one signing secret and set the **same value** everywhere Delta signs or
checks bytes, or every result arrives unverified:

```sh
openssl rand -hex 32
```

- `SIGNING_SECRET` on the Cloudflare Worker (`wrangler secret put SIGNING_SECRET`)
- `SIGNING_SECRET` on the Vercel project that serves the site

Then deploy the site to Vercel with its variables:

```sh
vercel link --yes --token $VERCEL_TOKEN
vercel env add VITE_BDIX_URL production --token $VERCEL_TOKEN

# The anon key is public by design and safe to ship in the bundle, because the
# table has no policy granting it anything.
vercel env add VITE_SUPABASE_URL       production --token $VERCEL_TOKEN
vercel env add VITE_SUPABASE_ANON_KEY  production --token $VERCEL_TOKEN

# Server side only. The service role key bypasses RLS entirely; it must never
# appear in a VITE_ variable, since anything so prefixed is compiled into the
# JavaScript every visitor downloads.
vercel env add SUPABASE_URL              production --token $VERCEL_TOKEN
vercel env add SUPABASE_SERVICE_ROLE_KEY production --token $VERCEL_TOKEN
vercel env add SIGNING_SECRET            production --token $VERCEL_TOKEN
vercel deploy --prod --token $VERCEL_TOKEN
```

Build settings: root directory `apps/web`, build `npm run build`, output `dist`.

Finally, lock down CORS on the Worker so other sites cannot bill your requests
to run their own speedtests:

```sh
wrangler secret put ALLOWED_ORIGINS      # https://deltaspeed.pages.dev
```

## Verification

Delta's endpoints sign what they actually served, and `/api/results` checks a
submitted result against those signatures before marking it `verified`. Only
verified rows reach the ISP leaderboard.

Be clear about the strength of this. It catches fabrication, a client posting
950 Mbps having moved 26 MB, by a factor of ten or more. It does not catch a
careful attacker shaving 50 percent onto a real result: requests still in flight
when a phase ends are aborted and never attested, so a genuine run legitimately
attests well under what its headline figure implies, and the tolerance has to
absorb that. Marginal noise is handled by the leaderboard instead, with medians
and a minimum sample count.

M-Lab signs nothing for Delta, so Raw contributes no attestations. A result is
judged on the larger of its two download figures, so one where Raw beats Local
cannot verify.

If `SIGNING_SECRET` is unset anywhere in the chain, results still save and still
share; they simply never become verified, and the leaderboard stays empty.

## Bandwidth reality check

A free endpoint can hit its own ceiling before your connection does. M-Lab's
servers are on 10 Gbps links and are not the limit for a home line. The Local
Worker can be: if Local reports far below a line you know to be quicker, check
the Worker's own ceiling from a fast host before believing it:

```sh
curl -o /dev/null -s -w '%{speed_download}\n' \
  'https://delta-local.erfanul100.workers.dev/download?bytes=50000000'
```

A figure that matches your reported speed means the endpoint is the bottleneck,
not your connection. Test with any VPN switched off: a VPN reroutes both paths,
and one that splits TCP makes M-Lab measure the VPN's server instead of you.
