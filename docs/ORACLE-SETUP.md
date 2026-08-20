# Setting up the Oracle Singapore box (Raw endpoint)

What you do in the browser, and what to hand over afterwards. Roughly 15 minutes.

The goal is a plain host with a direct public IP in Singapore. That is the whole
point: Vercel proxies through a nearby edge, which is why its ping reads 128 ms
instead of the true ~50 ms and why its throughput caps around 126 Mbps.

## 0. Account

<https://cloud.oracle.com> → *Start for free*, or sign in if you have one.

Signup asks for a card to verify identity. It is not charged, and Always Free
resources stay free after the 30-day trial credit expires. Choose **Singapore
(ap-singapore-1)** as your home region during signup if you can, because the
home region cannot be changed later and Always Free capacity is tied to it.

## 1. Create the instance

Menu (top left) → **Compute** → **Instances** → **Create instance**.

Check the **region selector in the top right reads Singapore** before anything
else.

| Field | Value |
| --- | --- |
| Name | `delta-raw-sg` |
| Image | **Canonical Ubuntu 24.04** (must be the **aarch64** build) |
| Shape | **VM.Standard.A1.Flex**, **4 OCPUs**, **24 GB** memory |
| Assign public IPv4 address | **Yes** |
| Boot volume | leave default (~50 GB) |

**The shape is the one thing that must be right.** Click *Change shape* →
*Ampere* → `VM.Standard.A1.Flex` and drag OCPUs to 4.

The console defaults to `VM.Standard.E2.1.Micro`, which Oracle caps at
**50 Mbps of internet bandwidth**. That is unusable for a speed test. A1.Flex
gets **1 Gbps per OCPU**, so 4 OCPUs is 4 Gbps.

### SSH key

Under *Add SSH keys*, either upload a public key you already have, or pick
**Generate a key pair for me** and click **Save private key**.

Then move the downloaded key somewhere stable and lock its permissions, because
SSH refuses to use a world-readable key:

```sh
mkdir -p ~/.ssh
mv ~/Downloads/ssh-key-*.key ~/.ssh/oracle-delta
chmod 600 ~/.ssh/oracle-delta
```

**Do not paste the private key into chat.** Save it to that path and hand over
the path instead. A key pasted into a conversation lives in the transcript
forever; a path reveals nothing.

Click **Create**, wait for the state to go orange → **green RUNNING**, then copy
the **Public IP address**.

### If it says "Out of host capacity"

Common, and not a mistake on your part: Always Free Arm capacity in popular
regions is often exhausted. Try a different availability domain in the same
region, or retry at a quieter hour. It does free up.

## 2. Open the ports in the VCN

Oracle blocks inbound traffic in two independent places. This is the first, and
the step most people miss.

Menu → **Networking** → **Virtual cloud networks** → your VCN →
**Security Lists** → **Default Security List** → **Add Ingress Rules**.

Add these two, leaving the existing SSH rule alone:

| Stateless | Source CIDR | Protocol | Destination port |
| --- | --- | --- | --- |
| No | `0.0.0.0/0` | TCP | `80` |
| No | `0.0.0.0/0` | TCP | `443` |

Port 80 is needed for the TLS certificate check; 443 serves the endpoint.

The second place is the instance's own iptables, which I will handle over SSH.

## 3. A hostname

HTTPS is not optional: the site is served over HTTPS and a browser refuses to
call a plain-HTTP endpoint from an HTTPS page. Let's Encrypt will not issue a
certificate for a bare IP address, so the box needs a name.

Either point a subdomain of a domain you own at the public IP with an **A
record**, or get a free one from <https://www.duckdns.org> (sign in, pick a
subdomain, paste the IP).

**Do not proxy the record through Cloudflare.** An orange-clouded record is
served from Cloudflare's Dhaka PoP, which turns the international measurement
back into a local one while still displaying entirely plausible numbers. Leave
it grey / DNS-only.

## 4. Hand over

Three things:

1. The **public IP**
2. The **path to the private key** (e.g. `~/.ssh/oracle-delta`), not the key itself
3. The **hostname** you pointed at it

Sanity check it is reachable first:

```sh
ssh -i ~/.ssh/oracle-delta ubuntu@<PUBLIC_IP> 'uname -m && nproc'
```

`aarch64` and `4` confirms you got the right shape. If SSH hangs, the VCN
ingress rule for SSH is missing or the instance is still booting.

## What happens next

I take it from there: open port 443 in the instance firewall and persist it,
install Node and Caddy, deploy `services/origin` under systemd, obtain the
certificate, point `VITE_RAW_URL` at the new host, redeploy the site, and verify
that the region is genuinely Singapore, that ping reports ~50 ms rather than
128 ms, and that throughput clears your 500-600 Mbps.

## What this does not fix

Local. Oracle has no Bangladesh region, so nothing here can sit inside BDIX.
Your ~1 Gbps local speed still needs a BDIX-peered VPS in Dhaka; until then
Local stays capped by the Cloudflare Worker at about 465 Mbps.
