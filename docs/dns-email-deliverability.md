# olnian.com — DNS changes for email deliverability

Audit date: 2026-08-05. DNS hosted at BargainHost (`ns1.bargainhosts.co.uk`, `ns2.bargainhosts.co.uk`).

## Why

Marketing email sent through Shopify from an `@olnian.com` address currently has **no SPF authorization and no DKIM signature under olnian.com**, because:

- `include:shops.shopify.com` resolves to `v=spf1 ~all` — it authorizes zero IP addresses. Shopify moved to a CNAME-based setup; this include is dead weight.
- No Shopify DKIM key is published under `olnian.com`. The only DKIM keys present are `zmail._domainkey` (Zoho) and `default._domainkey` (host default).

Result: Shopify mail fails DMARC alignment, recipients see "via shopifyemail.com", and Shopify may rewrite the From address to `store+xxxx@shopifyemail.com`.

Mail sent by hand through Zoho (`ross@`, `hello@`, `michelle@olnian.com`) is already authenticated correctly and is unaffected by these changes.

---

## Step 0 — before touching anything

Lower the TTL on the records being changed from `14400` (4 hours) to `300` (5 minutes). Make the edits, verify, then raise the TTL back. This turns a mistake into a 5-minute problem instead of a 4-hour one.

---

## Step 1 — get the Shopify CNAMEs

Shopify admin → **Settings → Notifications → Sender email → Authenticate your domain**.

Shopify generates **4 CNAME records unique to this store**. They are not available through the Admin API and cannot be predicted — they must be copied out of the admin UI. They cover both DKIM and SPF for Shopify's sending.

Record them here before sending to BargainHost:

| Type | Name / Host | Value / Points to | TTL |
|---|---|---|---|
| CNAME | `<from Shopify #1>` | `<from Shopify #1>` | 300 |
| CNAME | `<from Shopify #2>` | `<from Shopify #2>` | 300 |
| CNAME | `<from Shopify #3>` | `<from Shopify #3>` | 300 |
| CNAME | `<from Shopify #4>` | `<from Shopify #4>` | 300 |

---

## Step 2 — replace the SPF record

There is exactly one SPF record on `olnian.com`. **Edit it in place — do not add a second one.** Two SPF records on the same name is a permanent error and fails SPF outright.

**Current:**
```
v=spf1 +a +mx +ip4:45.42.212.220 include:shops.shopify.com  include:zohomail.com ~all
```

**Replace with:**
```
v=spf1 include:zohomail.com ~all
```

What was removed and why:

| Removed | Reason |
|---|---|
| `+a` | Authorizes `23.227.38.65`, which is Shopify's **storefront** IP, not a mail server |
| `+mx` | Authorizes Zoho's **inbound** MX hosts to send outbound mail. Wrong direction, and unnecessary |
| `ip4:45.42.212.220` | BargainHost **shared** hosting. You inherit every other tenant on that box's sending reputation |
| `include:shops.shopify.com` | Resolves to `v=spf1 ~all` — authorizes nothing |

> **Conservative variant:** if anything still sends mail from the BargainHost cPanel server (a legacy contact form, a cron script), keep that IP:
> ```
> v=spf1 ip4:45.42.212.220 include:zohomail.com ~all
> ```
> The site itself is on Shopify (`olnian.com` A → `23.227.38.65`) and mail is on Zoho, so the cPanel box is most likely unused for outbound — but confirm before dropping it.

Shopify's SPF is handled by the Step 1 CNAMEs. **Do not add a Shopify include back into this record.**

---

## Step 3 — tidy the DMARC record

**Current** (`_dmarc.olnian.com`):
```
v=DMARC1; p=none; rua=mailto:ross@olnian.com; fo=1
```

**Replace with:**
```
v=DMARC1; p=none; rua=mailto:ross@olnian.com
```

`fo=1` requests forensic reports but there is no `ruf=` address for them to go to, so it does nothing. Keep `p=none` for now — do not tighten it until Step 5.

---

## Step 4 — do NOT delete these

Some DNS panels replace all records of a type when you edit one. These must survive:

| Name | Type | Purpose |
|---|---|---|
| `olnian.com` | MX | `mx.zoho.com` (10), `mx2.zoho.com` (20), `mx3.zoho.com` (50) — **all inbound mail** |
| `olnian.com` | TXT | `google-site-verification=db5LiBAu0LWxUhgvSHW0xJbJ4-NnIjHqjKdYGdl6R7s` |
| `olnian.com` | TXT | `zoho-verification=zb05973347.zmverify.zoho.com` |
| `zmail._domainkey.olnian.com` | TXT | Zoho DKIM key — deleting this breaks your working email |
| `olnian.com` | A | `23.227.38.65` (Shopify storefront) |
| `www.olnian.com` | CNAME | `olnian.com` |

---

## Notes for whoever edits the zone

- **Name field:** many panels auto-append the domain. If the field already shows `.olnian.com`, enter `_dmarc`, not `_dmarc.olnian.com`. Entering the full name in an auto-appending panel produces `_dmarc.olnian.com.olnian.com`, which silently does nothing.
- **CNAME values:** enter exactly as Shopify gives them. Do not append `.olnian.com` to the target.
- **SPF:** one record only, edited in place.
- Propagation is typically minutes at TTL 300, but allow up to 48h before concluding something failed.

---

## Step 5 — verify, then ramp

After propagation:

```bash
# SPF — should show the new short record, and only one
dig +short TXT olnian.com

# DMARC
dig +short TXT _dmarc.olnian.com

# Shopify DKIM — each of the 4 CNAMEs should resolve
dig +short CNAME <shopify-cname-name>.olnian.com
```

Then confirm in Shopify admin that the domain shows as **authenticated**.

**Seed test before any real send.** Send to a Gmail, a Yahoo, and an Outlook address. In Gmail: open the message → ⋮ → *Show original*. You need all three:

```
SPF:   PASS
DKIM:  PASS   with d=olnian.com   ← not d=shopifyemail.com
DMARC: PASS
```

If DKIM shows `d=shopifyemail.com`, authentication has not taken effect yet — do not send.

**Then ramp.** The store has 5 orders total, and the domain has no bulk-sending history. Going from zero to a full blast is itself a spam signal regardless of authentication:

1. Start with a few hundred of your most engaged contacts
2. Ramp over 2–3 weeks, watching the `rua` reports arriving at `ross@olnian.com`
3. After ~2 weeks clean, move DMARC to `p=quarantine; pct=25`
4. Then `p=quarantine` (full), then `p=reject`

---

## Separate issue: cold outreach

Partnership and influencer outreach is currently going out from `ross@olnian.com` to recipients who did not opt in. Spam complaints from that accrue to `olnian.com`'s reputation and will follow legitimate marketing into the spam folder.

Move cold outreach to a **separate domain** (e.g. `olnian-partners.com`) with its own authentication. This is standard practice and firewalls the primary domain's reputation from prospecting activity.

---

## Current state reference (as audited 2026-08-05)

Clean signals — no action needed:

- `olnian.com` not listed on Spamhaus DBL, SURBL, SpamEatingMonkey, or NordSpam
- `45.42.212.220` not listed on Spamhaus ZEN, SpamCop, Barracuda, SORBS, or PSBL
- SPF lookup count is 5 of the permitted 10
- No ESP (Klaviyo, Mailchimp, Omnisend) is configured — Shopify Email is the only marketing path

Not present, not blocking: MTA-STS, TLS-RPT, BIMI. BIMI would require DMARC at `p=quarantine` or stricter first, so it is a post-Step-5 consideration at best.
