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

Only `creatine-monohydrate`, `creatine-hydration-powder`, and `colostrum-powder` get "Gold Subscription" treatment (badge with exclusive perks, "Gold Gift Pack ⊙ Free Shipping ⊙ Cancel Anytime" purchase-option copy, and the `gold-jar-offer` snippet). This is gated in `sections/main-product.liquid` via an `_is_gold_product` flag computed near the top of the product form, from `_offer_handles`. All other subscribable products show plain "Subscribe & Save" with "Free shipping · cancel anytime" — no gold badge. If asked to change which products get gold treatment, edit `_offer_handles` there (and verify handles per the table above).

## Header shipping tooltip

`sections/header-group.json` → `header.settings.utility_tooltip` drives a CSS-only hover bubble on the "Free Shipping" header link (`sections/header.liquid`, `data-shipping-tooltip` attr, styled in `assets/theme.css` via `content: attr(...)`). Schema default lives in `sections/header.liquid`; keep both in sync when changing the copy.

## Other themes on the store (mostly stale drafts, not in git)

`Horizon` (#142082146370), `olnian-shopify` (#142083194946), `Olnian-White` (#142188380226), `Buy box preview` (#144550068290) — unpublished, last touched pre-session. Not part of the GitHub-connected workflow.

## GitHub repo notes

`rasdo11/olnianshopifytheme` also has ~10 stale branches from other AI coding tools (`claude/gift-subscription-product-change-vwm3eb`, `codex/analyze-gaps-between-themes-and-plan-updates*`) predating this session's work. Not reviewed/merged — check before assuming `main` reflects all past effort on this store.

## Verifying changes on the live site

`olnian.com` / `ep7d2z-wd.myshopify.com` rate-limits rapid automated requests (curl/WebFetch) — space out verification requests by 15s+ and expect occasional 429s. Don't loop-retry aggressively.
