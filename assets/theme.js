(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Dialog focus management (shared by every modal) ----------
     Modal dialogs have to keep Tab inside themselves while open and hand focus back to
     whatever opened them. None of them did, so keyboard users tabbed straight out of an
     open dialog into the page behind it, and on close were dumped at the top of the
     document. One implementation, reused by the cart drawer, expert modal, nav overlay
     and lightbox. (Closed dialogs are taken out of the tab order by `visibility: hidden`
     in theme.css — this handles the open state.) */
  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const DialogFocus = {
    _open: [],
    capture(el, initial) {
      if (!el || this._open.some((r) => r.el === el)) return;
      const trigger = document.activeElement;
      const onKeydown = (e) => {
        if (e.key !== 'Tab') return;
        const items = $$(FOCUSABLE, el).filter((n) => n.offsetWidth || n.offsetHeight || n.getClientRects().length);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      el.addEventListener('keydown', onKeydown);
      this._open.push({ el, trigger, onKeydown });
      // Move focus in, otherwise Tab would resume from wherever it was in the page behind.
      const target = (typeof initial === 'string' ? $(initial, el) : initial) || $(FOCUSABLE, el);
      if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch (_) {} }, 60);
    },
    release(el) {
      const i = this._open.findIndex((r) => r.el === el);
      if (i === -1) return;
      const rec = this._open.splice(i, 1)[0];
      rec.el.removeEventListener('keydown', rec.onKeydown);
      if (rec.trigger && document.contains(rec.trigger)) {
        try { rec.trigger.focus({ preventScroll: true }); } catch (_) {}
      }
    },
  };

  /* ---------- Cart API ----------
     Every cart write goes through CartAPI.run(), one at a time, so rapid taps can't race
     each other. Each write also asks Shopify to render the cart drawer section in the same
     response (bundled section rendering): a normal add is one round trip, and the header
     count and Gold gift state come back in that markup instead of a separate /cart.js call. */
  const DRAWER_SECTION = 'cart-drawer';
  const cartRoot = () => (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  class CartError extends Error {
    // uncertain: the request may or may not have reached Shopify (network drop). Such a
    // write is never replayed; the drawer is re-read from the server instead.
    constructor(message, uncertain) { super(message); this.uncertain = !!uncertain; }
  }

  const CartAPI = {
    _queue: Promise.resolve(),
    run(task) {
      const next = this._queue.then(task, task);
      this._queue = next.catch(() => {});
      return next;
    },
    async _write(path, body, fallback, reconcile = true) {
      let res;
      try {
        res = await fetch(`${cartRoot()}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(Object.assign({}, body, { sections: DRAWER_SECTION, sections_url: window.location.pathname })),
        });
      } catch (_) {
        await Drawer.refresh();
        throw new CartError("We couldn't confirm your cart was updated. Please check it before checking out.", true);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new CartError(data.description || data.message || fallback);
      // The cart changed. A missing or unusable section render is a display problem only:
      // fall back to one plain re-render, never to repeating the write.
      if (!Drawer.render(data.sections && data.sections[DRAWER_SECTION])) await Drawer.refresh();
      if (reconcile) await this._reconcileGift();
      return data;
    },
    // The Gold gift is only free next to a subscribed Creatine / Hydration line (see
    // cart-drawer.liquid). Remove it when that line is gone and keep at most one. A discount
    // can split the gift over several lines, so trim one line per pass (bounded).
    async _reconcileGift() {
      for (let pass = 0; pass < 3; pass++) {
        const s = Drawer.state();
        const target = s.giftQualifies ? 1 : 0;
        if (!s.giftKey || s.giftQty <= target) return;
        const lineTarget = Math.max(0, s.giftLineQty - (s.giftQty - target));
        try {
          await this._write('cart/change.js', { id: s.giftKey, quantity: lineTarget }, 'Could not update cart.', false);
        } catch (_) { return; /* leave it; checkout still shows the real price */ }
      }
    },
    add(items) {
      return this.run(() => this._write('cart/add.js', { items }, 'Could not add to cart.'));
    },
    // key: the line item key (stable across reorders, unlike a line number).
    // sellingPlan: omit to keep the plan, null for one-time, or a plan id.
    change(key, quantity, sellingPlan) {
      const payload = { id: key, quantity };
      if (sellingPlan !== undefined) payload.selling_plan = sellingPlan;
      return this.run(() => this._write('cart/change.js', payload, 'Could not update cart.'));
    },
    applyDiscount(code) {
      return this.run(() => this._write('cart/update.js', { discount: code }, 'Could not apply discount.'));
    },
  };

  /* ---------- Cart Drawer ---------- */
  const STATE_ATTRS = ['data-cart-count', 'data-gift-qty', 'data-gift-key', 'data-gift-line-qty', 'data-gift-qualifies'];
  const Drawer = {
    el: null,
    init() {
      this.el = $('#CartDrawer');
      if (!this.el) return;
      document.addEventListener('click', (e) => {
        const openTrigger = e.target.closest('[data-cart-open]');
        const closeTrigger = e.target.closest('[data-cart-close]');
        if (openTrigger) { e.preventDefault(); this.open(); }
        if (closeTrigger) { e.preventDefault(); this.close(); }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) this.close();
      });
    },
    isOpen() { return this.el && this.el.getAttribute('data-open') === 'true'; },
    open() {
      if (!this.el || this.isOpen()) return;
      this.el.setAttribute('data-open', 'true');
      this.el.setAttribute('aria-hidden', 'false');
      // Lets CSS pull the 10% off tab out of the way of the Checkout button.
      document.body.classList.add('cart-open');
      if (!window.Shopify || !window.Shopify.designMode) document.body.style.overflow = 'hidden';
      DialogFocus.capture(this.el, '.cart-drawer__close');
    },
    close() {
      if (!this.el) return;
      this.el.setAttribute('data-open', 'false');
      this.el.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('cart-open');
      document.body.style.overflow = '';
      DialogFocus.release(this.el);
    },
    state() {
      const c = $('#CartDrawerContent');
      const get = (a) => (c && c.getAttribute(a)) || '';
      return {
        count: Number(get('data-cart-count') || 0),
        giftQty: Number(get('data-gift-qty') || 0),
        giftKey: get('data-gift-key'),
        giftLineQty: Number(get('data-gift-line-qty') || 0),
        giftQualifies: get('data-gift-qualifies') === 'true',
      };
    },
    // Swap in server-rendered drawer markup. Returns false if there was nothing usable.
    render(html) {
      if (!html) return false;
      const incoming = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-cart-drawer-content]');
      const current = $('#CartDrawerContent');
      if (!incoming || !current) return false;
      const focus = this._rememberFocus(current);
      current.innerHTML = incoming.innerHTML;
      STATE_ATTRS.forEach((a) => current.setAttribute(a, incoming.getAttribute(a) || ''));
      this.syncCount();
      this._restoreFocus(current, focus);
      return true;
    },
    async refresh() {
      try {
        const res = await fetch(`${window.location.pathname}?section_id=${DRAWER_SECTION}`, { headers: { Accept: 'text/html' } });
        if (res.ok && this.render(await res.text())) return true;
      } catch (_) {}
      this.notice("We couldn't refresh your cart here.", true);
      return false;
    },
    syncCount() {
      const count = this.state().count;
      const countEl = $('.site-header__cart-count');
      if (countEl) {
        countEl.textContent = count;
        countEl.style.display = count > 0 ? '' : 'none';
      }
    },
    notice(message, withCartLink) {
      const el = $('[data-cart-notice]');
      if (!el) { alert(message); return; }
      el.textContent = message + (withCartLink ? ' ' : '');
      if (withCartLink) {
        const a = document.createElement('a');
        a.href = `${cartRoot()}cart`;
        a.textContent = 'View your cart';
        el.appendChild(a);
      }
      el.hidden = false;
    },
    // Replacing the markup would otherwise drop keyboard focus to <body> after every +/−.
    _rememberFocus(root) {
      const a = document.activeElement;
      if (!a || !root.contains(a)) return null;
      const item = a.closest('[data-cart-item]');
      const attr = ['data-cart-increment', 'data-cart-decrement', 'data-cart-remove'].find((x) => a.hasAttribute(x));
      return { key: item && item.dataset.key, attr, id: a.id };
    },
    _restoreFocus(root, memo) {
      if (!memo) return;
      let target = memo.id ? root.querySelector(`#${CSS.escape(memo.id)}`) : null;
      if (!target && memo.key && memo.attr) {
        const item = $$('[data-cart-item]', root).find((n) => n.dataset.key === memo.key);
        target = item && item.querySelector(`[${memo.attr}]`);
      }
      target = target || root.querySelector('.cart-drawer__close');
      if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
    },
  };

  /* ---------- Product form ---------- */
  function initProductForm() {
    const form = $('[data-product-form]');
    if (!form) return;

    const subBadge = $('[data-sub-badge]', form);
    const stickySub = document.querySelector('[data-sticky-sub]');
    const dynamicCheckout = $('[data-dynamic-checkout]', form);
    const sellingPlanInput = $('[name="selling_plan"]', form);
    const variantInput = $('[name="id"]', form);
    const priceEl = $('[data-product-price]');
    const submitBtn = $('[data-product-submit]', form);
    const defaultLabel = (submitBtn && submitBtn.dataset.defaultLabel) || 'Add to Cart';

    function planForVariant(id) {
      const v = window.__productVariants && window.__productVariants[id];
      return v && v.sellingPlanId ? String(v.sellingPlanId) : '';
    }

    // When the Subscribe / One-time toggle is on the page, the shopper's choice (mirrored
    // on form.dataset.purchaseMode by the toggle script in main-product.liquid) decides the
    // mode, and this function must never override it. Without the toggle, a variant with a
    // selling plan is subscription-only (Premium → Gold Subscription); the rest are one-time.
    const hasPurchaseToggle = !!document.querySelector('[data-purchase-options]');
    function applyState() {
      const variant = variantInput && window.__productVariants[variantInput.value];
      const variantPlan = variantInput ? planForVariant(variantInput.value) : '';
      const wantsSub = !hasPurchaseToggle || form.dataset.purchaseMode !== 'onetime';
      const planId = wantsSub ? variantPlan : '';
      const isSub = !!planId;

      if (sellingPlanInput) sellingPlanInput.value = isSub ? planId : '';
      if (subBadge) subBadge.hidden = !isSub;
      if (stickySub) stickySub.hidden = !isSub;
      // Express checkout doesn't apply to subscriptions, so hide it (and its "or").
      if (dynamicCheckout) dynamicCheckout.hidden = isSub;

      if (priceEl && variant) {
        const base = variant.price;
        if (isSub) {
          const sub = typeof variant.subPrice === 'number' ? variant.subPrice : base;
          priceEl.innerHTML = `${sub < base ? `<del>${formatMoney(base)}</del> ` : ''}${formatMoney(sub)}<span class="product__price-per">/mo</span>`;
        } else {
          priceEl.textContent = formatMoney(base);
        }
      }

      if (submitBtn && !(variant && variant.available === false)) {
        submitBtn.textContent = defaultLabel;
      }
    }

    function showVariantImage() {
      if (!variantInput || !window.__pdpGallery) return;
      const v = window.__productVariants[variantInput.value];
      // Fall back to the first image (index 0) when a variant has no image of its
      // own, so re-selecting Premium reverts the hero to the main jar.
      const idx = v && typeof v.mediaIndex === 'number' && v.mediaIndex >= 0 ? v.mediaIndex : 0;
      window.__pdpGallery.goTo(idx);
    }

    const variantOptions = $$('[data-variant-option]', form);
    variantOptions.forEach((btn) => {
      btn.addEventListener('click', () => {
        variantOptions.forEach((b) => b.setAttribute('data-selected', b === btn ? 'true' : 'false'));
        if (variantInput) variantInput.value = btn.dataset.variantId;
        applyState();
        showVariantImage();
      });
    });

    // Set by main-product.liquid only while the Gold founding offer is shown and the gift
    // is in stock. Replaces the separate submit handler gold-jar-offer.liquid used to run.
    const giftVariant = Number(form.dataset.goldGiftVariant || 0);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn && submitBtn.disabled) return;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding…'; }
      const payload = {
        id: Number(variantInput.value),
        quantity: Number(($('[name="quantity"]', form) || {}).value || 1),
      };
      if (sellingPlanInput && sellingPlanInput.value) {
        payload.selling_plan = Number(sellingPlanInput.value);
      }
      try {
        // One round trip: the add returns the re-rendered drawer.
        await CartAPI.add([payload]);
        Drawer.open();
      } catch (err) {
        if (err.uncertain) { Drawer.open(); Drawer.notice(err.message, true); }
        else alert(err.message || 'Could not add to cart.');
        finish();
        return;
      }
      // Gold gift: a second, separate write so a sold-out gift can never block the
      // subscription itself. Skipped if the cart already holds one or doesn't qualify.
      const s = Drawer.state();
      if (giftVariant && payload.selling_plan && s.giftQualifies && s.giftQty === 0) {
        try {
          await CartAPI.add([{ id: giftVariant, quantity: 1 }]);
        } catch (_) {
          Drawer.notice("Your subscription is in your cart, but we couldn't add the free Gold gift. It may have just sold out.");
        }
      }
      finish();
    });

    function finish() {
      if (submitBtn) submitBtn.disabled = false;
      // Re-sync (restores label + selling plan for the next add, keeping the
      // shopper's chosen purchase mode)
      applyState();
    }

    // Sync the initial variant (Premium → Gold Subscription) on load.
    applyState();
  }

  /* ---------- Cart item qty updates ---------- */
  function initCartDrawerEvents() {
    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-cart-discount-form]');
      if (!form) return;
      e.preventDefault();

      const input = $('[name="discount"]', form);
      const submit = $('[type="submit"]', form);
      const status = $('[data-cart-discount-status]', form);
      const code = input ? input.value.trim() : '';
      if (!code) return;

      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      if (status) status.textContent = '';

      const invalidMessage = form.dataset.invalidMessage;
      const errorMessage = form.dataset.errorMessage;
      // The write re-renders the drawer, replacing this form, so messages go to the new one.
      const setStatus = (msg) => {
        const el = $('[data-cart-discount-status]');
        if (el) el.textContent = msg;
      };
      try {
        const cart = await CartAPI.applyDiscount(code);
        const codes = Array.isArray(cart.discount_codes) ? cart.discount_codes : [];
        const requestedCode = codes.find((discount) => (
          discount.code && discount.code.toLowerCase() === code.toLowerCase()
        ));
        if (requestedCode && requestedCode.applicable === false) setStatus(invalidMessage);
      } catch (err) {
        setStatus(errorMessage || err.message);
      } finally {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    });

    // Latest quantity the shopper asked for, per line key, while writes are pending. Taps
    // build on this rather than on the (possibly stale) rendered quantity, and a burst of
    // taps collapses into as few writes as needed to reach the final number.
    const qtyIntent = new Map();
    const lineIdentity = new Map(); // key -> { variantId, planId }, to follow a re-keyed line
    const flushing = new Set();

    // Shopify can re-key a line when its discounts change. Find the same line (variant +
    // selling plan) in the cart a write returned; null if it's gone or ambiguous.
    function resolveKey(key, cart) {
      const items = (cart && cart.items) || [];
      if (items.some((i) => i.key === key)) return key;
      const id = lineIdentity.get(key);
      if (!id) return null;
      const matches = items.filter((i) => (
        String(i.variant_id) === id.variantId &&
        String((i.selling_plan_allocation && i.selling_plan_allocation.selling_plan.id) || '') === id.planId
      ));
      return matches.length === 1 ? matches[0].key : null;
    }

    function showIntent(key) {
      if (!qtyIntent.has(key)) return;
      const item = $$('[data-cart-item]').find((n) => n.dataset.key === key);
      if (!item) return;
      const qtyEl = $('[data-cart-qty]', item);
      if (qtyEl) qtyEl.textContent = qtyIntent.get(key);
      item.setAttribute('aria-busy', 'true');
    }

    async function flushQty(startKey) {
      if (flushing.has(startKey)) return; // the running loop picks up the newest intent
      let key = startKey;
      flushing.add(key);
      try {
        while (qtyIntent.has(key)) {
          const qty = qtyIntent.get(key);
          let cart;
          try {
            cart = await CartAPI.change(key, qty);
          } catch (err) {
            qtyIntent.delete(key);
            if (!err.uncertain) await Drawer.refresh();
            Drawer.notice(err.message, err.uncertain);
            break;
          }
          if (qtyIntent.get(key) === qty) { qtyIntent.delete(key); break; }
          // A newer tap is waiting. Carry it to the line's current key before writing again.
          const nextKey = qty > 0 ? resolveKey(key, cart) : null;
          if (!nextKey) {
            qtyIntent.delete(key);
            await Drawer.refresh();
            Drawer.notice("Some quantity changes couldn't be applied. Please check your cart.");
            break;
          }
          if (nextKey !== key) {
            // A tap already made on the re-rendered line is newer; otherwise move ours over.
            if (!qtyIntent.has(nextKey)) qtyIntent.set(nextKey, qtyIntent.get(key));
            lineIdentity.set(nextKey, lineIdentity.get(key));
            qtyIntent.delete(key);
            flushing.delete(key);
            if (flushing.has(nextKey)) break; // that line already has its own loop
            key = nextKey;
            flushing.add(key);
          }
          showIntent(key);
        }
      } finally {
        flushing.delete(key);
      }
    }

    document.addEventListener('click', async (e) => {
      const inc = e.target.closest('[data-cart-increment]');
      const dec = e.target.closest('[data-cart-decrement]');
      const remove = e.target.closest('[data-cart-remove]');
      const sellingPlanOption = e.target.closest('[data-cart-selling-plan]');
      if (!inc && !dec && !remove && !sellingPlanOption) return;
      e.preventDefault();
      const item = e.target.closest('[data-cart-item]');
      if (!item || !item.dataset.key) return;
      const key = item.dataset.key;
      const renderedQty = Number(item.dataset.quantity || 1);

      if (sellingPlanOption) {
        if (sellingPlanOption.getAttribute('aria-pressed') === 'true') return;
        const optionButtons = $$('[data-cart-selling-plan]', item);
        optionButtons.forEach((button) => {
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
        });
        const sellingPlan = sellingPlanOption.dataset.sellingPlan
          ? Number(sellingPlanOption.dataset.sellingPlan)
          : null;
        try {
          await CartAPI.change(key, qtyIntent.get(key) || renderedQty, sellingPlan);
        } catch (err) {
          if (!err.uncertain) await Drawer.refresh();
          Drawer.notice(item.dataset.updateError || err.message, err.uncertain);
        }
        return;
      }

      lineIdentity.set(key, { variantId: item.dataset.variantId || '', planId: item.dataset.sellingPlanId || '' });
      const base = qtyIntent.has(key) ? qtyIntent.get(key) : renderedQty;
      let nextQty = base;
      if (inc) nextQty = base + 1;
      if (dec) nextQty = Math.max(0, base - 1);
      if (remove) nextQty = 0;
      if (nextQty === base) return;
      qtyIntent.set(key, nextQty);
      showIntent(key);
      flushQty(key);
    });

    const stepper = $('[data-quantity-stepper]');
    if (stepper) {
      const input = stepper.querySelector('input');
      stepper.querySelector('[data-qty-up]')?.addEventListener('click', () => {
        input.value = Math.min(99, Number(input.value) + 1);
      });
      stepper.querySelector('[data-qty-down]')?.addEventListener('click', () => {
        input.value = Math.max(1, Number(input.value) - 1);
      });
    }
  }

  /* ---------- Quick add (product cards) ---------- */
  function initQuickAdd() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-quick-add]');
      if (!btn) return;
      e.preventDefault();
      if (btn.disabled) return;
      const variantId = Number(btn.dataset.variantId);
      if (!variantId) return;
      btn.disabled = true;
      btn.setAttribute('data-loading', 'true');
      const label = btn.textContent;
      btn.textContent = 'Adding…';
      try {
        const payload = { id: variantId, quantity: 1 };
        // Cross-sell / rail cards can opt into the product's subscription plan.
        if (btn.dataset.sellingPlan) payload.selling_plan = Number(btn.dataset.sellingPlan);
        // One round trip: the add returns the re-rendered drawer, so it opens populated.
        await CartAPI.add([payload]);
        Drawer.open();
      } catch (err) {
        if (err.uncertain) { Drawer.open(); Drawer.notice(err.message, true); }
        else alert(err.message || 'Could not add to cart.');
      } finally {
        btn.disabled = false;
        btn.removeAttribute('data-loading');
        btn.textContent = label;
      }
    });
  }

  /* ---------- Helpers ---------- */
  function formatMoney(cents) {
    if (window.Shopify && window.Shopify.formatMoney) {
      return window.Shopify.formatMoney(cents, window.moneyFormat || '${{amount}}');
    }
    return '$' + (cents / 100).toFixed(2);
  }

  /* ---------- PDP Gallery + Lightbox ---------- */
  function initGallery() {
    const gallery = document.querySelector('.pdp-gallery');
    if (!gallery) return;
    const slides  = $$('.pdp-gallery__slide', gallery);
    const thumbs  = $$('.pdp-gallery__thumb', gallery);
    const dots    = $$('.pdp-gallery__dot', gallery);
    const main    = gallery.querySelector('.pdp-gallery__main');

    // Must match the PDP breakpoint in theme.css, where the gallery becomes a horizontal
    // scroll-snap carousel. (Was 600px, which left 600–900px scrolling a static container.)
    const mobileQuery = window.matchMedia('(max-width: 900px)');

    // Desktop: opacity/active fade
    // Keeps aria-current on the active dot so the gallery position is announced, not just shown.
    function markActiveDot(index) {
      dots.forEach((d, i) => {
        const on = i === index;
        d.classList.toggle('is-active', on);
        if (on) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    }

    function goToDesktop(index) {
      slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
      thumbs.forEach((t, i) => t.classList.toggle('is-active', i === index));
      markActiveDot(index);
    }

    // Per-slide scroll step = slide width + flex gap (slides peek at ~88% width)
    function mobileStep() {
      const first = slides[0];
      if (!first || !main) return main ? main.offsetWidth : 0;
      const cs = getComputedStyle(main);
      const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
      return first.getBoundingClientRect().width + gap;
    }

    // Mobile: scroll to slide position, dots sync via scroll event
    function goToMobile(index) {
      if (!main) return;
      main.scrollTo({ left: index * mobileStep(), behavior: 'smooth' });
    }

    function goTo(index) {
      if (mobileQuery.matches) goToMobile(index);
      else goToDesktop(index);
    }

    // Expose so variant selection (initProductForm) can switch the hero image
    window.__pdpGallery = { goTo };

    if (slides.length > 1) {
      thumbs.forEach((t) => t.addEventListener('click', () => goTo(Number(t.dataset.thumb))));
      dots.forEach((d)   => d.addEventListener('click', () => goTo(Number(d.dataset.dot))));

      // Mobile: sync dots on scroll (debounced)
      if (main) {
        let scrollTimer;
        main.addEventListener('scroll', () => {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            if (!mobileQuery.matches) return;
            markActiveDot(Math.round(main.scrollLeft / mobileStep()));
          }, 60);
        }, { passive: true });

        // Desktop only: touch swipe (mobile uses native scroll-snap)
        let startX = 0;
        main.addEventListener('touchstart', (e) => {
          if (mobileQuery.matches) return;
          startX = e.touches[0].clientX;
        }, { passive: true });
        main.addEventListener('touchend', (e) => {
          if (mobileQuery.matches) return;
          const dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) < 40) return;
          const current = slides.findIndex((s) => s.classList.contains('is-active'));
          goToDesktop(dx < 0 ? Math.min(current + 1, slides.length - 1) : Math.max(current - 1, 0));
        }, { passive: true });
      }
    }

    // ── Lightbox ──────────────────────────────────────────────
    const lightbox = document.getElementById('PdpLightbox');
    if (!lightbox) return;
    // Move to <body> so position:fixed is never clipped by a sticky/transform ancestor
    document.body.appendChild(lightbox);

    const lbSlides = $$('.pdp-lightbox__slide', lightbox);

    // Full-size images carry no src until the lightbox is used (see main-product.liquid);
    // load the shown slide and its neighbours so swiping stays instant.
    function lbLoad(index) {
      const slide = lbSlides[index];
      const img = slide && slide.querySelector('img[data-lightbox-src]');
      if (!img) return;
      if (img.dataset.lightboxSrcset) img.srcset = img.dataset.lightboxSrcset;
      img.src = img.dataset.lightboxSrc;
      img.removeAttribute('data-lightbox-src');
    }

    function lbGoTo(index) {
      lbSlides.forEach((s, i) => s.classList.toggle('is-active', i === index));
      [index, index + 1, index - 1].forEach(lbLoad);
    }

    function lbOpen(index) {
      lbGoTo(index);
      lightbox.classList.add('is-open');
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      DialogFocus.capture(lightbox, '[data-lightbox-close]');
    }

    function lbClose() {
      lightbox.classList.remove('is-open');
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      DialogFocus.release(lightbox);
    }

    function lbCurrentIndex() {
      return lbSlides.findIndex((s) => s.classList.contains('is-active'));
    }

    // Attach click to every open-trigger button directly (more reliable than event delegation)
    $$('[data-lightbox-open]', gallery).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        lbOpen(Number(btn.dataset.lightboxOpen));
      });
    });

    // Prev / Next
    lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => {
      lbGoTo(Math.max(lbCurrentIndex() - 1, 0));
    });
    lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', () => {
      lbGoTo(Math.min(lbCurrentIndex() + 1, lbSlides.length - 1));
    });

    // Close button + backdrop click
    lightbox.querySelector('[data-lightbox-close]')?.addEventListener('click', lbClose);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) lbClose();
    });

    // Keyboard: Escape closes, arrows navigate
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') lbClose();
      if (e.key === 'ArrowLeft')  lbGoTo(Math.max(lbCurrentIndex() - 1, 0));
      if (e.key === 'ArrowRight') lbGoTo(Math.min(lbCurrentIndex() + 1, lbSlides.length - 1));
    });

    // Touch swipe inside lightbox
    if (lbSlides.length > 1) {
      const lbImages = lightbox.querySelector('.pdp-lightbox__images');
      if (lbImages) {
        let lbStartX = 0;
        lbImages.addEventListener('touchstart', (e) => { lbStartX = e.touches[0].clientX; }, { passive: true });
        lbImages.addEventListener('touchend', (e) => {
          const dx = e.changedTouches[0].clientX - lbStartX;
          if (Math.abs(dx) < 40) return;
          const cur = lbCurrentIndex();
          lbGoTo(dx < 0 ? Math.min(cur + 1, lbSlides.length - 1) : Math.max(cur - 1, 0));
        }, { passive: true });
      }
    }
  }

  /* ---------- Mobile nav (full-screen takeover) ---------- */
  function initMobileNav() {
    const toggle = $('#SiteNavToggle');
    const overlay = $('#SiteNavOverlay');
    if (!toggle || !overlay) return;

    function open() {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      toggle.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('nav-open');
      DialogFocus.capture(overlay, '.site-nav-overlay__close');
    }
    function close() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-open');
      DialogFocus.release(overlay);
    }

    toggle.addEventListener('click', () => {
      if (overlay.classList.contains('is-open')) close();
      else open();
    });
    // Close via the X, a link tap, or clicking the overlay backdrop
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-nav-close]') || e.target.closest('a') || e.target === overlay) {
        close();
      }
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
    });
  }

  /* ---------- Product-card swatch carousels ---------- */
  function initSwatchCarousels() {
    // Chevrons live inside the card <a>; stop them from navigating.
    document.addEventListener('click', (e) => {
      const prev = e.target.closest('[data-swatch-prev]');
      const next = e.target.closest('[data-swatch-next]');
      if (!prev && !next) return;
      e.preventDefault();
      e.stopPropagation();
      const wrap = (prev || next).closest('.sku-card__swatches');
      const track = wrap && wrap.querySelector('[data-swatch-track]');
      if (!track) return;
      const delta = Math.max(track.clientWidth * 0.7, 60);
      track.scrollBy({ left: next ? delta : -delta, behavior: 'smooth' });
    });

    // Hide chevrons when all swatches already fit (no overflow).
    function syncNav() {
      $$('.sku-card__swatches').forEach((wrap) => {
        const track = wrap.querySelector('[data-swatch-track]');
        if (!track) return;
        const overflowing = track.scrollWidth > track.clientWidth + 2;
        wrap.querySelectorAll('.sku-card__swatch-nav').forEach((btn) => {
          btn.style.display = overflowing ? '' : 'none';
        });
      });
    }
    syncNav();
    window.addEventListener('resize', syncNav);
  }

  /* ---------- Product page accordions ---------- */
  function initProductAccordions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.product__accordion__btn');
      if (!btn) return;
      const acc  = btn.closest('.product__accordion');
      if (!acc) return;
      const body = acc.querySelector('.product__accordion__body');
      const icon = btn.querySelector('.product__accordion__icon');
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      if (body) body.hidden = isOpen;
      if (icon) icon.textContent = isOpen ? '+' : '−';
    });
  }

  /* ---------- Sticky buy bar ---------- */
  function initStickyBar() {
    const bar = document.getElementById('PdpStickyBar');
    const mainAtc = $('[data-product-submit]');
    if (!bar || !mainAtc) return;

    // Same move the lightbox needs above, and for the same reason: the bar is rendered
    // inside <section class="product page-enter">, so any transform/clip on an ancestor
    // makes position:fixed resolve against that section instead of the viewport — the bar
    // then parks itself off-screen at the bottom of the section and never appears. It's
    // fixed-position chrome, so its place in the DOM doesn't matter otherwise.
    document.body.appendChild(bar);

    // Reserve space at the end of the page so the bar never covers the footer (mobile only,
    // via the CSS rule scoped to this class).
    document.body.classList.add('has-sticky-buy');

    // Show the bar once the real Add to Cart has scrolled out of view. Deliberately a plain
    // rect check rather than an IntersectionObserver: one source of truth, no dependence on
    // observer callbacks firing, and trivial to reason about when it misbehaves.
    function update() {
      const r = mainAtc.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const offscreen = r.bottom <= 0 || r.top >= viewportH;
      bar.classList.toggle('is-visible', offscreen);
      // Separate from .has-sticky-buy (set once, for the page's bottom padding): this one
      // tracks whether the bar is actually on screen, so the 10% off tab can ride above it
      // when it's up and drop back down to the bottom row when it slides away.
      document.body.classList.toggle('sticky-buy-visible', offscreen);
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();

    // The sticky button submits the real product form, so it always carries whatever
    // purchase option (subscribe / one-time) the customer selected above.
    bar.querySelector('[data-sticky-atc]')?.addEventListener('click', () => mainAtc.click());
    bar.querySelector('[data-sticky-sub]')?.addEventListener('click', () => mainAtc.click());
  }

  /* ---------- Expert modal ---------- */
  function initExpertModal() {
    const modal = $('#ExpertModal');
    if (!modal) return;

    function openInbox() {
      // Shopify Inbox JS API
      if (window.ShopifyChat && typeof window.ShopifyChat.open === 'function') {
        window.ShopifyChat.open();
        return;
      }
      // Fallback: click the Shopify Inbox chat button if injected into DOM.
      // Deliberately no iframe selector here — calling .click() on an iframe does nothing,
      // so matching one used to swallow the tap and open neither chat nor the modal.
      const inboxBtn = document.querySelector('#shopify-chat button, [data-shopify-chat] button, #shopify-chat, [data-shopify-chat]');
      if (inboxBtn && typeof inboxBtn.click === 'function' && inboxBtn.tagName !== 'IFRAME') {
        inboxBtn.click();
        return;
      }
      // Last resort: fall back to custom modal
      openModal();
    }

    function openModal() {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      // Stop the page behind the modal from scrolling (it used to scroll under the overlay).
      document.body.style.overflow = 'hidden';
      // Only auto-focus the first field on devices with a real pointer. On touch, focusing an
      // input pops the keyboard and shoves the viewport around the moment the modal appears.
      const landing = window.matchMedia('(pointer: fine)').matches ? '#ExpertName' : '.expert-modal__close';
      DialogFocus.capture(modal, landing);
    }
    function closeModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      DialogFocus.release(modal);
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-expert-modal-open]')) openInbox();
      if (e.target.closest('[data-expert-modal-close]')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });

    const form = $('#ExpertModalForm');
    const success = modal.querySelector('.expert-modal__success');
    const errorEl = modal.querySelector('.expert-modal__error');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('.expert-modal__submit');
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        if (errorEl) errorEl.hidden = true;

        function fail() {
          btn.disabled = false;
          btn.textContent = label;
          if (errorEl) errorEl.hidden = false;
        }

        try {
          const body = new URLSearchParams(new FormData(form));
          // Readable summary for the notification email, so the inbox gets one glanceable block.
          const name = form.querySelector('[name="contact[name]"]').value.trim();
          const email = form.querySelector('[name="contact[email]"]').value.trim();
          const product = form.querySelector('[name="contact[product]"]')?.value || '';
          body.set('contact[body]', `Expert request\nName: ${name}\nEmail: ${email}\nViewing: ${product}`);

          const res = await fetch('/contact', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

          // Shopify redirects to ?contact_posted=true on success, but RE-RENDERS the page with
          // a 200 and no redirect when validation fails. The old check (res.ok || res.redirected)
          // therefore reported success on every rejected submission.
          const posted = res.redirected || /contact_posted=true/.test(res.url || '');
          if (res.ok && posted) {
            // Opted in: also create a tagged subscriber. Shopify Flow triggers on the
            // "expert-request" tag, waits 10 minutes, then sends the follow-up questions.
            // Best-effort — the lead is already captured above, so a failure here must not
            // turn a successful submission into an error for the customer.
            const optIn = form.querySelector('[name="contact[opt_in]"]');
            if (optIn && optIn.checked) {
              const sub = new URLSearchParams();
              sub.set('form_type', 'customer');
              sub.set('utf8', '✓');
              sub.set('contact[email]', email);
              sub.set('contact[first_name]', name);
              sub.set('contact[tags]', 'expert-request,newsletter');
              await fetch('/contact', {
                method: 'POST',
                body: sub,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              }).catch(() => null);
            }
            form.hidden = true;
            if (success) success.hidden = false;
          } else {
            fail();
          }
        } catch (_) {
          fail();
        }
      });
    }
  }



  /* ---------- Dynamic mobile experience ---------- */
  function initEmailPopup() {
    const popup = $('[data-email-popup]');
    if (!popup) return;
    const storageKey = 'olnianEmailPopupSubmitted';
    // Set on popup submit, read once on the page the form returns to. Shopify marks every
    // customer form on that page as posted, so this is how we know the popup was the one used.
    const pendingKey = 'olnianEmailPopupPending';
    let pending = false;
    try {
      pending = sessionStorage.getItem(pendingKey) === 'true';
      sessionStorage.removeItem(pendingKey);
    } catch (_) {}
    const result = popup.querySelector('[data-email-popup-result]');
    const outcome = result ? result.dataset.emailPopupResult : '';
    // Only a server-confirmed signup (from the popup, footer or inline form) retires the offer.
    if (outcome === 'success') {
      try { localStorage.setItem(storageKey, 'true'); } catch (_) {}
    }
    // Show the popup's own result, success or error, instead of silently hiding it.
    const showResult = pending && !!outcome;
    if (!showResult) {
      try {
        if (localStorage.getItem(storageKey) === 'true') return;
      } catch (_) {}
    }
    const delay = Number(popup.dataset.popupDelay || 5) * 1000;
    const peekMs = Number(popup.dataset.peekDuration || 3) * 1000;
    let peekTimer;
    const makeReady = () => {
      popup.classList.add('is-ready');
      popup.setAttribute('aria-hidden', 'false');
      // Arrive expanded, hold, then shrink back to the pill. Skipped when the merchant
      // sets the duration to 0 or clears the peek text.
      if (peekMs > 0 && popup.querySelector('.email-popup__tab-peek')) {
        popup.classList.add('is-peeking');
        peekTimer = setTimeout(() => popup.classList.remove('is-peeking'), peekMs);
      }
    };
    const endPeek = () => {
      clearTimeout(peekTimer);
      popup.classList.remove('is-peeking');
    };
    const open = (focusInput = true) => {
      endPeek();
      popup.classList.add('is-open');
      popup.setAttribute('aria-hidden', 'false');
      if (!window.Shopify || !window.Shopify.designMode) document.body.style.overflow = 'hidden';
      const input = popup.querySelector('input[type="email"]');
      if (input && focusInput) setTimeout(() => input.focus({ preventScroll: true }), 120);
    };
    const close = () => {
      popup.classList.remove('is-open');
      popup.classList.add('is-ready');
      popup.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = '';
    };
    if (showResult) {
      popup.classList.add('is-ready');
      open(outcome === 'error');
    } else {
      setTimeout(makeReady, delay);
    }
    popup.addEventListener('click', (e) => {
      if (e.target.closest('[data-email-popup-open]')) open();
      if (e.target.closest('[data-email-popup-close]')) close();
      const copyBtn = e.target.closest('[data-email-popup-copy]');
      if (copyBtn) copyCode(copyBtn);
    });
    function copyCode(btn) {
      const codeEl = popup.querySelector('[data-email-popup-code]');
      if (!codeEl) return;
      const done = () => { btn.textContent = btn.dataset.copiedLabel || 'Copied'; };
      const fallback = () => {
        // Select the code so a long-press / Ctrl+C still works without the Clipboard API.
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try { if (document.execCommand('copy')) done(); } catch (_) {}
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codeEl.textContent.trim()).then(done, fallback);
      } else {
        fallback();
      }
    }
    popup.addEventListener('submit', () => {
      try { sessionStorage.setItem(pendingKey, 'true'); } catch (_) {}
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popup.classList.contains('is-open')) close();
    });
  }

  function initHeroVideoToggle() {
    const mobileQuery = window.matchMedia('(max-width: 600px)');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = !!(navigator.connection && navigator.connection.saveData);

    $$('.hero__video').forEach((video) => {
      const mediaFrame = video.closest('.hero__image');
      const playButton = mediaFrame ? mediaFrame.querySelector('[data-hero-video-play]') : null;

      const syncState = () => {
        if (!mediaFrame) return;
        mediaFrame.classList.toggle('is-video-paused', video.paused);
        mediaFrame.classList.toggle('is-video-playing', !video.paused);
        // The control is a play/pause toggle, so its name and glyph have to follow state.
        if (playButton) {
          playButton.setAttribute('aria-label', video.paused ? 'Play hero video' : 'Pause hero video');
          const glyph = playButton.querySelector('span');
          if (glyph) glyph.textContent = video.paused ? '▶' : '❚❚';
        }
      };

      // The markup ships the source as data-src so nothing downloads until we decide the
      // video should play (see hero-editorial.liquid).
      const attachSource = () => {
        const pending = $$('source[data-src]', video);
        if (!pending.length) return;
        pending.forEach((source) => {
          source.src = source.dataset.src;
          source.removeAttribute('data-src');
        });
        video.load();
      };

      const playVideo = () => {
        attachSource();
        video.play().catch(() => {}).finally(syncState);
      };

      const pauseVideo = () => {
        video.pause();
        syncState();
      };

      video.addEventListener('playing', () => {
        if (mediaFrame) mediaFrame.classList.add('is-video-started');
      });
      video.addEventListener('play', syncState);
      video.addEventListener('pause', syncState);

      // Autoplay only on larger screens, without reduced motion or Save-Data, and only once
      // the hero is actually on screen.
      const mayAutoplay = () => !mobileQuery.matches && !reduceMotion.matches && !saveData;
      if (mayAutoplay()) {
        if ('IntersectionObserver' in window) {
          const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              io.disconnect();
              if (mayAutoplay()) playVideo();
            }
          });
          io.observe(video);
        } else {
          playVideo();
        }
      }
      syncState();

      if (playButton) {
        playButton.addEventListener('click', (event) => {
          event.stopPropagation();
          if (video.paused) playVideo();
          else pauseVideo();
        });
      }

      video.addEventListener('click', () => {
        if (video.paused) playVideo();
        else pauseVideo();
      });

      if (mobileQuery.addEventListener) {
        mobileQuery.addEventListener('change', (event) => {
          if (event.matches) pauseVideo();
          else syncState();
        });
      }
    });
  }

  function initScrollMotion() {
    const enableFade = document.body.dataset.scrollFade === 'true';
    const enableParallax = document.body.dataset.scrollParallax === 'true';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (enableFade && !reduceMotion && 'IntersectionObserver' in window) {
      const fadeTargets = $$('main h1, main h2, main .hero__sub, main .brand-intro__body, main .category-feature__body, main .sku-card, main .proof__card, main .newsletter__inner');
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      fadeTargets.forEach((el) => {
        el.classList.add('motion-fade');
        observer.observe(el);
      });
    }
    if (enableParallax && !reduceMotion) {
      const strength = Number(document.body.dataset.parallaxStrength || 15);
      const parallaxTargets = $$('main .hero__image, main .category-feature__media, main .batch-story__image, main .pdp-gallery__main');
      parallaxTargets.forEach((el) => el.classList.add('motion-parallax'));
      let ticking = false;
      const update = () => {
        parallaxTargets.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          const viewportMid = window.innerHeight / 2;
          const progress = (midpoint - viewportMid) / window.innerHeight;
          const offset = Math.max(Math.min(progress * strength, strength), -strength);
          el.style.transform = `translate3d(0, ${offset * -1}px, 0)`;
        });
        ticking = false;
      };
      const request = () => {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      };
      update();
      window.addEventListener('scroll', request, { passive: true });
      window.addEventListener('resize', request);
    }
  }


  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    Drawer.init();
    initProductForm();
    initCartDrawerEvents();
    initQuickAdd();
    initGallery();
    initMobileNav();
    initSwatchCarousels();
    initProductAccordions();
    initStickyBar();
    initExpertModal();
    initEmailPopup();
    initHeroVideoToggle();
    initScrollMotion();
  });
})();
