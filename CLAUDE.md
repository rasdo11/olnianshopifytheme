# OLNIAN Shopify Theme

Shopify theme for **OLNIAN** ("Pure Supplements for Her"), store `ep7d2z-wd.myshopify.com` (custom domain `olnian.com`).

## Repo / deploy model

This folder is a git repo tracking `github.com/rasdo11/olnianshopifytheme` (branch `main`), connected via Shopify's native GitHub theme integration. Workflow:

1. Edit theme files locally.
2. `git commit` + `git push origin main`.
3. Shopify auto-syncs the push to the connected theme. **Verify in the admin (Online Store → Themes) which theme is currently live and whether it's the GitHub-connected one** — as of 2026-08-01 the connected theme was "olnianshopifytheme/main" (#143927509058) and was about to be published live, replacing "Olnian Creatine update" (#144474079298). Don't assume; check `shopify theme list --store ep7d2z-wd.myshopify.com` first.

If the connected theme is NOT live, GitHub pushes will not affect the live site — you must also run:
```
shopify theme push --live --store ep7d2z-wd.myshopify.com
```

**Gotcha:** Liquid's `assign` does not support `contains` as a boolean expression (`{%- assign x = arr contains y -%}` is a syntax error). Use an `if`/`else` to set the boolean instead. This broke the live theme briefly during initial development — always check `shopify theme push` output for an explicit error block, not just "pushed successfully".

## Product handles (verified via Admin API, not guessed from links/filenames)

| Product | Handle |
|---|---|
| Premium Creatine Monohydrate | `creatine-monohydrate` |
| Creatine Hydration Powder | `creatine-hydration-powder` |
| Colostrum Powder | `colostrum-powder` |
| Magnesium Glycinate | `magnesium-glycinate` |
| NAD+ (unlisted) | `nad` |
| GLP-1 Nutrient Support (unlisted) | `glp-1-nutrient-support` |
| Gold Subscription Gift (unlisted, the physical gold jar lid) | `gold-jar-founding-gift` |

Don't infer handles from `footer.liquid` links or template filenames (`product.colostrum.json` etc.) — they can be stale. Confirm via `mcp__claude_ai_Shopify__search_products` when it matters.

## Gold Subscription

Only `creatine-monohydrate`, `creatine-hydration-powder`, and `colostrum-powder` get "Gold Subscription" treatment (the "Save X% + free gift with purchase" purchase-option note and the `gold-jar-offer` snippet, which states the two-delivery minimum). This is gated in `sections/main-product.liquid` via `_is_gold_product` (from `_offer_handles`). All other subscribable products show plain "Subscribe & Save" — no gift. If asked to change which products get gold treatment, edit `_offer_handles` AND the gift map / discounts (below).

**Cancellation terms (confirmed by the owner 2026-09-23):** Gold subscriptions have a two-delivery minimum; customers can skip or cancel anytime only after the second delivery. Never write "cancel anytime" on Gold products (`product.json`, `product.hydration.json`, `product.colostrum.json` templates, `gold-jar-offer` snippet). Whether non-Gold subscriptions share the minimum is unconfirmed.

## Unsubscribe page

`/pages/unsubscribe` uses `templates/page.unsubscribe.json` → `sections/unsubscribe-form.liquid`. It submits a Shopify **contact** form, which emails the request to the store inbox; someone must then unsubscribe the customer in Admin. Never use a `customer` form there: that is the newsletter signup form and subscribes the person. The email popup and indexing are disabled on that template in `layout/theme.liquid`.

## Cart and Gold gift flow

All cart writes go through `CartAPI` in `assets/theme.js`: one queue, line items addressed by key, each write requests the `cart-drawer` section in the same response (no follow-up `/cart.js`). `sections/cart-drawer.liquid` exposes `data-cart-count` and `data-gifts` (JSON: one object per gift line, `{id, key, qty, qualifies}`) on `#CartDrawerContent`.

**Two gift products, mapped per product** (both UNLISTED, so `all_products` can't resolve them — it returns an unusable variant, which silently hid the offer AND the gift before 2026-09-23; map variant ids directly instead). In `main-product.liquid` a `case product.handle` sets `_gift_variant_id` + `_gift_offer`, and `gold-jar-offer.liquid` takes `offer:` to switch the copy:

| Product(s) | Gift product | Gift variant id | Price | Copy |
|---|---|---|---|---|
| `creatine-monohydrate`, `creatine-hydration-powder` | `gold-jar-founding-gift` | `44542256840770` | $16.99 | gold lid + pink scoop |
| `colostrum-powder` | `gold-subscription-gift-colostrum` | `45260558434370` | $6.99 | gold lid only |

Each gift is added by the product-form submit in `theme.js`. The gift variant reaches JS as a **plain hidden input** `[data-gold-gift-variant]` inside the buy form (rendered when the offer shows), NOT a `{% form %}` tag attribute — the form tag did not render a numeric custom attribute, which is why the gift never added before 2026-09-23. The gift is added when the shopper subscribes, and only if the cart doesn't already hold that gift. After every write, `theme.js` (`_reconcileGift`) removes any gift that no longer "qualifies" and trims each to 1. A gift qualifies only while a subscribed line of a product that earns it is in the cart (`cart-drawer.liquid` computes this: founding ← creatine/hydration subs, colostrum ← colostrum sub).

Each gift is made free by an automatic BXGY discount — **a gift with no matching discount would be charged**:
- "Gold Subscription Gift" (`DiscountAutomaticNode/1569031225410`): buys creatine-monohydrate/creatine-hydration-powder → free gold-jar-founding-gift.
- "Gold Subscription Gift (Colostrum)" (`DiscountAutomaticNode/1591626694722`, created 2026-09-23): buys colostrum-powder → free gold-subscription-gift-colostrum.

Keep the handle/id map in `main-product.liquid`, the qualification handles in `cart-drawer.liquid`, and the BXGY discounts' "Customer buys" in sync. Stock isn't visible to Liquid (gifts are unlisted), so switch off "Show founding offer box" on a product's template when its gift's 200 sell out.

Subscription prices come from `selling_plan_allocations` (never `price × 0.85`).

## Header shipping tooltip

`sections/header-group.json` → `header.settings.utility_tooltip` drives a CSS-only hover bubble on the "Free Shipping" header link (`sections/header.liquid`, `data-shipping-tooltip` attr, styled in `assets/theme.css` via `content: attr(...)`). Schema default lives in `sections/header.liquid`; keep both in sync when changing the copy.

## Other themes on the store (mostly stale drafts, not in git)

`Horizon` (#142082146370), `olnian-shopify` (#142083194946), `Olnian-White` (#142188380226), `Buy box preview` (#144550068290) — unpublished, last touched pre-session. Not part of the GitHub-connected workflow.

## GitHub repo notes

`rasdo11/olnianshopifytheme` also has ~10 stale branches from other AI coding tools (`claude/gift-subscription-product-change-vwm3eb`, `codex/analyze-gaps-between-themes-and-plan-updates*`) predating this session's work. Not reviewed/merged — check before assuming `main` reflects all past effort on this store.

## Verifying changes on the live site

`olnian.com` / `ep7d2z-wd.myshopify.com` rate-limits rapid automated requests (curl/WebFetch) — space out verification requests by 15s+ and expect occasional 429s. Don't loop-retry aggressively.
