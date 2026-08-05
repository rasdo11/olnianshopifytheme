# olnian.com — email deliverability audit

Audit date: 2026-08-05. DNS hosted at BargainHost (`ns1.bargainhosts.co.uk`, `ns2.bargainhosts.co.uk`).

## Summary

**Shopify email domain authentication is correctly set up.** All six CNAMEs are published and resolving, all four DKIM keys are valid, and both sending paths align under DMARC. There is no blocker to sending marketing email.

What remains is SPF hygiene, a DMARC tightening path, and one behavioral risk (cold outreach on the primary domain).

> **Correction:** an earlier version of this document claimed Shopify authentication was missing and treated it as a blocker. That was wrong. It was based on brute-forcing a wordlist of common DKIM selectors, which never reaches store-specific names like `ofm` or a nested name like `pdk1._domainkey.mailern2d`. A selector scan can prove presence but never absence.

---

## Verified working

Shopify admin shows **Authenticated**. Confirmed against live DNS:

| Record | Resolves to | Status |
|---|---|---|
| `ofm._domainkey` | `dkim1.d04843a6720.p362.email.myshopify.com` → `ofm.domainkey.u56385055.wl056.sendgrid.net` | valid 2048-bit RSA key |
| `ofm2._domainkey` | `dkim2.d04843a6720.p362.email.myshopify.com` → `ofm2.domainkey.u56385055.wl056.sendgrid.net` | valid 2048-bit RSA key |
| `pdk1._domainkey.mailern2d` | `dkim3.3b63404553d2.p308.email.myshopify.com` → `pdk1._domainkey.ea35286.dkim2.us.mgsend.org` | valid 2048-bit RSA key |
| `pdk2._domainkey.mailern2d` | `dkim4.3b63404553d2.p308.email.myshopify.com` → `pdk2._domainkey.ea35286.dkim2.us.mgsend.org` | valid 2048-bit RSA key |
| `mailerofm` | `d04843a6720.p362.email.myshopify.com` | bounce domain, SPF `include:sendgrid.net` |
| `mailern2d` | `3b63404553d2.p308.email.myshopify.com` | bounce domain, SPF `include:mailgun.org` |

Shopify runs **two sending paths** behind these records:

| Path | Bounce (Return-Path) domain | DKIM selectors | DKIM `d=` | Alignment |
|---|---|---|---|---|
| SendGrid (p362) | `mailerofm.olnian.com` | `ofm`, `ofm2` | `olnian.com` | strict **and** relaxed |
| Mailgun (p308) | `mailern2d.olnian.com` | `pdk1`, `pdk2` | `mailern2d.olnian.com` | **relaxed only** |

Both Return-Path domains are subdomains of `olnian.com` and carry their own SPF, so SPF aligns on both paths. DMARC therefore passes.

### ⚠️ Do not set `adkim=s` or `aspf=s`

The current DMARC record has no alignment tags, so it defaults to **relaxed** — which is what the Mailgun path needs. Its DKIM signature is `d=mailern2d.olnian.com`, a subdomain. Under strict alignment (`adkim=s`) that path would start failing DMARC while the SendGrid path kept passing, producing intermittent, hard-to-diagnose delivery failures. Leave alignment relaxed.

### Corroborating evidence

Shopify order notifications are arriving with `From: michelle@olnian.com` intact — **not** rewritten to `store+67862396994@shopifyemail.com`. Shopify's own settings screen describes that rewrite as the fallback used "if authentication or DMARC isn't set up." The absence of rewriting is direct confirmation that authentication is live.

### Clean signals

- `olnian.com` not listed on Spamhaus DBL, SURBL, SpamEatingMonkey, or NordSpam
- `45.42.212.220` not listed on Spamhaus ZEN, SpamCop, Barracuda, SORBS, or PSBL
- Zoho path (`ross@`, `hello@`, `michelle@olnian.com` sent by hand) authenticates correctly via `include:zohomail.com` + `zmail._domainkey`
- Root SPF lookup count is 5 of the permitted 10

---

## Optional cleanup — SPF hygiene

**Low priority. Not blocking, and it does not affect Shopify at all** — Shopify authenticates through its own bounce domains, so the root SPF record is only consulted for mail sent directly through Zoho.

**Current:**
```
v=spf1 +a +mx +ip4:45.42.212.220 include:shops.shopify.com  include:zohomail.com ~all
```

**Could be reduced to:**
```
v=spf1 include:zohomail.com ~all
```

| Mechanism | Why it can go |
|---|---|
| `+a` | Authorizes `23.227.38.65`, Shopify's **storefront** IP, not a mail server |
| `+mx` | Authorizes Zoho's **inbound** MX hosts to send outbound. Wrong direction |
| `ip4:45.42.212.220` | BargainHost **shared** hosting — you inherit other tenants' sending reputation |
| `include:shops.shopify.com` | Resolves to `v=spf1 ~all`, which authorizes zero IPs. Legacy; superseded by the CNAME setup |

Removing `include:shops.shopify.com` is safe precisely because Shopify does not rely on it — the six CNAMEs do that work.

> **Before dropping `ip4:45.42.212.220`:** confirm nothing still sends from the BargainHost cPanel box (legacy contact form, cron script). The storefront is on Shopify and mail is on Zoho, so it is very likely unused — but if unsure, keep it:
> ```
> v=spf1 ip4:45.42.212.220 include:zohomail.com ~all
> ```

Edit the existing record **in place**. Two SPF records on the same name is a permanent error that fails SPF outright.

---

## Optional cleanup — DMARC

**Current** (`_dmarc.olnian.com`):
```
v=DMARC1; p=none; rua=mailto:ross@olnian.com; fo=1
```

`fo=1` requests forensic reports but there is no `ruf=` address to receive them, so it does nothing. Tidy to:
```
v=DMARC1; p=none; rua=mailto:ross@olnian.com
```

Note there are still no `adkim=`/`aspf=` tags — keep it that way (see the warning above).

### Enforcement path

Because authentication genuinely passes on both paths, you can move past `p=none`:

1. Watch the `rua` aggregate reports arriving at `ross@olnian.com` for ~2 weeks of real sending
2. Confirm both the SendGrid and Mailgun paths show `dmarc=pass` in those reports
3. `v=DMARC1; p=quarantine; pct=25; rua=mailto:ross@olnian.com`
4. Then `p=quarantine` at full percentage
5. Then `p=reject`

Do not skip ahead. The reports are what tell you whether some forgotten sender (a form, an invoicing app) is still sending as `olnian.com`.

---

## The real remaining risks

Authentication was never the weak link. These two are.

### 1. Cold outreach from the primary domain

Partnership and influencer outreach is going out from `ross@olnian.com` to recipients who did not opt in. Spam complaints there accrue to `olnian.com`'s reputation and will follow legitimate marketing into the spam folder — authentication does not protect against this, because the mail is perfectly authenticated spam from the receiver's perspective.

Move cold outreach to a **separate domain** (e.g. `olnian-partners.com`) with its own authentication. Standard practice, and it firewalls the primary domain.

### 2. No sending history

The store has 5 orders total (#1001–1005) and the domain has no bulk-send history. Going from zero to a full blast is itself a spam signal regardless of authentication.

- Start with a few hundred of your most engaged contacts
- Ramp over 2–3 weeks
- Confirm the list is genuinely opt-in — with 5 purchasers, a large list did not come from customers

---

## Pre-send check

Seed a Gmail, a Yahoo, and an Outlook address. In Gmail: open the message → ⋮ → *Show original*. Expect:

```
SPF:   PASS
DKIM:  PASS   with d=olnian.com  or  d=mailern2d.olnian.com
DMARC: PASS
```

Both `d=` values are correct — which one appears depends on whether that send went out via the SendGrid or the Mailgun path.

Re-verify the records any time DNS is edited at BargainHost:

```bash
for n in ofm._domainkey ofm2._domainkey \
         pdk1._domainkey.mailern2d pdk2._domainkey.mailern2d \
         mailerofm mailern2d; do
  echo "$n: $(dig +short CNAME $n.olnian.com)"
done
```

> Note: querying these DKIM records over UDP without EDNS0 returns an empty answer, because the 2048-bit keys exceed the 512-byte UDP limit and the response is truncated. `dig` handles this automatically. Hand-rolled resolvers and some online checkers do not, and will report the records as missing when they are fine.

### Do not delete

If editing the zone, these must survive:

| Name | Type | Purpose |
|---|---|---|
| the six CNAMEs above | CNAME | **Shopify email authentication** |
| `olnian.com` | MX | `mx.zoho.com` (10), `mx2` (20), `mx3` (50) — all inbound mail |
| `zmail._domainkey.olnian.com` | TXT | Zoho DKIM key |
| `olnian.com` | TXT | `google-site-verification=db5LiBAu0LWxUhgvSHW0xJbJ4-NnIjHqjKdYGdl6R7s` |
| `olnian.com` | TXT | `zoho-verification=zb05973347.zmverify.zoho.com` |
| `olnian.com` | A | `23.227.38.65` (Shopify storefront) |
| `www.olnian.com` | CNAME | `olnian.com` |

---

## Not present, not blocking

MTA-STS, TLS-RPT, BIMI. BIMI would require DMARC at `p=quarantine` or stricter plus a verified mark certificate, so it is a post-enforcement consideration at best.
