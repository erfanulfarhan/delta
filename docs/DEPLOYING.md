# Deploying

Three pieces go live independently: the BDIX endpoint, the RAW endpoint, and the
site. The site is useless without both endpoints, so do them first.

## 1. BDIX endpoint (Cloudflare Worker)

Cloudflare is a BDIX member with a Dhaka PoP, so this is served over local
peering for most Bangladeshi ISPs.

```sh
npm i -g wrangler
wrangler login                 # or: export CLOUDFLARE_API_TOKEN=...
cd services/worker
wrangler deploy
```

The token needs the **Workers Scripts: Edit** permission. Your existing R2 keys
will not work; those are S3-style credentials and cannot deploy a Worker.

Note the `*.workers.dev` URL it prints. That is `VITE_BDIX_URL`.

Verify it is actually being served from Dhaka:

```sh
curl -s https://<your-worker>.workers.dev/meta | jq
```

`colo` should read `DAC` (Dhaka). If it reports a foreign PoP, your ISP does not
reach Cloudflare locally and this endpoint is not measuring BDIX for you. In
that case rent a genuinely BDIX-peered VPS and point `VITE_BDIX_URL` at it; the
contract is identical, so nothing else changes.

## 2. RAW endpoint (Oracle Cloud, Singapore)

Provision an **Always Free** `VM.Standard.A1.Flex` instance in the **Singapore**
region. ARM capacity there is often unavailable to new accounts; retry, or pick
another Singapore host. Any host works as long as it is genuinely in Singapore
and not behind a CDN.

Open port 443 in both the OCI security list and the instance firewall. Oracle
images block everything by default, which is the usual reason a fresh box looks
dead:

```sh
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Install and run:

```sh
sudo apt update && sudo apt install -y nodejs caddy
sudo useradd -r -s /bin/false speedtest
sudo mkdir -p /opt/speedtest-origin
sudo cp -r services/origin/src /opt/speedtest-origin/
sudo chown -R speedtest /opt/speedtest-origin

sudo cp services/origin/speedtest-origin.service /etc/systemd/system/
sudo systemctl enable --now speedtest-origin
```

Point a domain's A record **directly at the instance IP**, edit the hostname in
`services/origin/Caddyfile`, install it at `/etc/caddy/Caddyfile`, and
`sudo systemctl restart caddy`. Caddy gets a certificate automatically.

Two things that will silently ruin the measurement:

- **HTTPS is mandatory.** The site is served over HTTPS and a browser refuses to
  call an HTTP endpoint from an HTTPS page. Without TLS the RAW test simply
  fails.
- **Do not proxy this record through Cloudflare.** An orange-clouded record is
  served from Cloudflare's Dhaka PoP, which turns the RAW number into a second
  BDIX number. The whole comparison silently becomes meaningless while
  continuing to display plausible figures. Leave it grey / DNS-only.

Verify from outside:

```sh
curl -s https://raw.yourdomain.com/health
```

## 3. Results storage (Supabase)

Create a project, then run `supabase/migrations/20260819000001_results.sql` in
the SQL editor.

The access model is worth understanding before changing it. Browser keys have
**no** policy on `results`, so they can neither read nor write the table. Writes
arrive only through `/api/results`, which checks the endpoints' signed byte
counts and inserts with the service role. Reads of a single result go through
`get_result(short_id)`, so possession of the id is what grants access, which is
what a share link is supposed to mean. Granting `select` on the table would make
every result anyone ever ran enumerable, along with their ISP and city.

Generate one signing secret and set the **same value** in all three places, or
every result arrives unverified:

```sh
openssl rand -hex 32
```

- `SIGNING_SECRET` on the Cloudflare Worker (`wrangler secret put SIGNING_SECRET`)
- `SIGNING_SECRET` on the Oracle host (in the systemd unit)
- `SIGNING_SECRET` on Vercel

## 4. The site (Vercel)

```sh
npm i -g vercel
export VERCEL_TOKEN=...        # non-interactive; put it in ~/.erfanul-secrets.env
vercel link --yes --token $VERCEL_TOKEN
vercel env add VITE_BDIX_URL production --token $VERCEL_TOKEN
vercel env add VITE_RAW_URL  production --token $VERCEL_TOKEN

# Storage. The anon key is public by design and safe to ship in the bundle,
# because the table has no policy granting it anything.
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

Only the site goes on Vercel. Keep the byte-pushing endpoints off it: Vercel
bills bandwidth, and a speedtest consumes a free tier in roughly two thousand
runs.

Finally, lock down CORS. Set `ALLOWED_ORIGINS` on both endpoints to your real
origin so other sites cannot bill your egress to run their own speedtests:

```sh
wrangler secret put ALLOWED_ORIGINS      # https://yourdomain.com
```

## Verification

The endpoints sign what they actually served, and `/api/results` checks a
submitted result against those signatures before marking it `verified`. Only
verified rows reach the ISP leaderboard.

Be clear about the strength of this. It catches fabrication, a client posting
950 Mbps having moved 26 MB, by a factor of ten or more. It does not catch a
careful attacker shaving 50 percent onto a real result: requests still in flight
when a phase ends are aborted and never attested, so a genuine run legitimately
attests well under what its headline figure implies, and the tolerance has to
absorb that. Marginal noise is handled by the leaderboard instead, with medians
and a minimum sample count.

If `SIGNING_SECRET` is unset anywhere in the chain, results still save and still
share; they simply never become verified, and the leaderboard stays empty.

## Bandwidth reality check

Free-tier endpoints have their own ceilings, and a fast connection can hit the
endpoint's limit rather than its own. If a test reports far below a line you
know to be quicker, confirm what you are actually measuring before believing it:

```sh
# Ceiling of the endpoint itself, measured from a fast host
curl -o /dev/null -s -w '%{speed_download}\n' \
  'https://<endpoint>/download?bytes=50000000'
```

A result that matches your reported speed means the endpoint is the bottleneck,
not your connection.
