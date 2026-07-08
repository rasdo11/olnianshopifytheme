# OLNIAN Shopify theme workflow

This theme is connected to Shopify and can be edited from both GitHub and the Shopify Theme Editor. To avoid repeatedly resolving conflicts and to preserve image/copy selections made in the Theme Editor, use the ownership rules below.

## Source-of-truth rules

### Shopify Theme Editor owns content and placement

Treat these files as Shopify/editor-owned after the theme is connected and being merchandised:

- `templates/index.json`
- `templates/product*.json`
- `templates/page*.json`
- `config/settings_data.json`

These files store selected images, section order, section/block settings, copy, page-specific layout choices, and theme setting values. If a merchant changes an image or copy in the Theme Editor, Shopify's GitHub integration can commit that change back to the connected branch.

### Code owns structure, styling, and behavior

Treat these files as code-owned:

- `sections/*.liquid`
- `snippets/*.liquid`
- `assets/theme.css`
- `assets/theme.js`
- `layout/theme.liquid`
- `config/settings_schema.json`
- `locales/*.json`

These files define section capabilities, schemas, styles, scripts, layout markup, translation strings, and Theme Editor controls.

## Before making code changes

1. Start from the latest Shopify-connected branch.
2. Pull the newest changes that Shopify may have committed from the Theme Editor.
3. Create a short-lived feature branch.
4. Avoid editing editor-owned JSON unless the task explicitly requires layout/default-content changes.

Recommended flow:

```bash
git checkout main
git pull
git checkout -b codex/<short-task-name>
```

If the working environment does not have a remote configured, confirm that the local branch was created from the latest pushed Shopify/GitHub state before editing.

## Conflict policy

When conflicts happen, use this default policy unless the task says otherwise:

- For `templates/*.json` and `config/settings_data.json`, preserve the Shopify-connected branch content so Theme Editor image/copy choices are not lost.
- For Liquid, CSS, JS, schema, and locale files, preserve the code branch changes, then review manually.
- If a JSON template must be changed by code, copy forward any current image, product, collection, copy, and section-order choices from the Shopify-connected branch before committing.

## Image and media policy

- Homepage/editorial images should normally be selected in the Theme Editor.
- Product page galleries should normally use Shopify product media from the product admin.
- Do not hard-code product gallery images into shared product templates unless intentionally creating a template-level fallback or campaign-specific product template.
- If a section needs better crop behavior, add schema controls in the section file and CSS behavior in `assets/theme.css` rather than overwriting selected media in JSON.

## Safe update checklist

Before opening or updating a PR:

- [ ] Pull latest Shopify-connected branch changes.
- [ ] Confirm editor-owned JSON was not changed accidentally.
- [ ] If JSON was changed intentionally, verify current Theme Editor image/copy choices were preserved.
- [ ] Run JSON/schema validation for section schemas and JSON templates.
- [ ] Run theme/lint checks when available.
- [ ] In the final note, tell the merchant whether they need to reselect any images. The default answer should be no.

## When pushing to a theme preview

If a merchant is about to push current code to a theme preview:

1. Make sure the branch includes the latest Theme Editor commits.
2. Push code changes first.
3. Open the Shopify preview and verify image selections, section order, product media, and cart/product flows.
4. If the preview is correct, continue making content edits from the Theme Editor so they sync back to the connected branch.
