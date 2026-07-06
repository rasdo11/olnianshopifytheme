(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Cart API ---------- */
  const CartAPI = {
    async get() {
      const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      return res.json();
    },
    async add(items) {
      const res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ description: 'Could not add to cart.' }));
        throw new Error(err.description || 'Could not add to cart.');
      }
      return res.json();
    },
    async change(line, quantity) {
      const res = await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line, quantity }),
      });
      return res.json();
    },
    async clear() {
      const res = await fetch('/cart/clear.js', { method: 'POST', headers: { Accept: 'application/json' } });
      return res.json();
    },
  };

  /* ---------- Cart Drawer ---------- */
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
      if (!this.el) return;
      this.el.setAttribute('data-open', 'true');
      this.el.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    },
    close() {
      if (!this.el) return;
      this.el.setAttribute('data-open', 'false');
      this.el.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    },
    async refresh() {
      const res = await fetch(`${window.location.pathname}?section_id=cart-drawer`, {
        headers: { Accept: 'text/html' },
      }).catch(() => null);
      if (res && res.ok) {
        const html = await res.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const incoming = parsed.querySelector('[data-cart-drawer-content]');
        const current = $('#CartDrawerContent');
        if (incoming && current) current.innerHTML = incoming.innerHTML;
      }
      this.updateHeaderCount();
    },
    async updateHeaderCount() {
      const cart = await CartAPI.get();
      const countEl = $('.site-header__cart-count');
      if (countEl) {
        countEl.textContent = cart.item_count;
        countEl.style.display = cart.item_count > 0 ? '' : 'none';
      }
    },
  };

  /* ---------- Product form ---------- */
  function initProductForm() {
    const form = $('[data-product-form]');
    if (!form) return;

    const purchaseOptions = $$('[data-purchase-option]', form);
    const sellingPlanInput = $('[name="selling_plan"]', form);
    const variantInput = $('[name="id"]', form);
    const priceEl = $('[data-product-price]');

    function selectPurchaseOption(value) {
      purchaseOptions.forEach((opt) => {
        opt.setAttribute('data-selected', opt.dataset.purchaseOption === value ? 'true' : 'false');
      });
      if (sellingPlanInput) {
        const selected = purchaseOptions.find((o) => o.dataset.purchaseOption === value);
        const plan = selected && selected.dataset.sellingPlan;
        sellingPlanInput.value = plan || '';
      }
      updatePriceDisplay();
    }

    function updatePriceDisplay() {
      if (!priceEl || !variantInput) return;
      const variantId = variantInput.value;
      const variant = window.__productVariants && window.__productVariants[variantId];
      if (!variant) return;
      const selected = purchaseOptions.find((o) => o.getAttribute('data-selected') === 'true');
      const hasSub = selected && selected.dataset.sellingPlan;
      const basePrice = variant.price;
      const subPrice = Math.round(basePrice * 0.85);
      if (hasSub) {
        priceEl.innerHTML = `<del>${formatMoney(basePrice)}</del> ${formatMoney(subPrice)}`;
      } else {
        priceEl.textContent = formatMoney(basePrice);
      }
    }

    purchaseOptions.forEach((opt) => {
      opt.addEventListener('click', () => selectPurchaseOption(opt.dataset.purchaseOption));
    });

    const variantOptions = $$('[data-variant-option]', form);
    variantOptions.forEach((btn) => {
      btn.addEventListener('click', () => {
        variantOptions.forEach((b) => b.setAttribute('data-selected', b === btn ? 'true' : 'false'));
        if (variantInput) variantInput.value = btn.dataset.variantId;
        updatePriceDisplay();
      });
    });

    // Subscribe card: when its "Add" button is clicked, pre-fill the selling plan input
    form.addEventListener('click', (e) => {
      const subBtn = e.target.closest('[data-selling-plan-id]');
      if (subBtn && sellingPlanInput) {
        sellingPlanInput.value = subBtn.dataset.sellingPlanId;
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('[data-product-submit]', form);
      const clickedSubBtn = e.submitter && e.submitter.dataset.sellingPlanId ? e.submitter : null;
      // If submitter is the subscribe button, ensure selling plan is set
      if (clickedSubBtn && sellingPlanInput) {
        sellingPlanInput.value = clickedSubBtn.dataset.sellingPlanId;
      }
      const activeSubBtn = clickedSubBtn || $('[data-selling-plan-id]', form);
      if (clickedSubBtn) {
        clickedSubBtn.disabled = true;
        clickedSubBtn.textContent = 'Adding…';
      } else if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding…';
      }
      try {
        const payload = {
          id: Number(variantInput.value),
          quantity: Number(($('[name="quantity"]', form) || {}).value || 1),
        };
        if (sellingPlanInput && sellingPlanInput.value) {
          payload.selling_plan = Number(sellingPlanInput.value);
        }
        await CartAPI.add([payload]);
        await Drawer.refresh();
        Drawer.open();
      } catch (err) {
        alert(err.message || 'Could not add to cart.');
      } finally {
        // Reset selling plan so next "Start Now" click doesn't carry it over
        if (sellingPlanInput) sellingPlanInput.value = '';
        if (clickedSubBtn) { clickedSubBtn.disabled = false; clickedSubBtn.textContent = 'Add'; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Start Now'; }
      }
    });
  }

  /* ---------- Cart item qty updates ---------- */
  function initCartDrawerEvents() {
    document.addEventListener('click', async (e) => {
      const inc = e.target.closest('[data-cart-increment]');
      const dec = e.target.closest('[data-cart-decrement]');
      const remove = e.target.closest('[data-cart-remove]');
      if (!inc && !dec && !remove) return;
      e.preventDefault();
      const item = e.target.closest('[data-cart-item]');
      if (!item) return;
      const line = Number(item.dataset.line);
      const currentQty = Number(item.dataset.quantity || 1);
      let nextQty = currentQty;
      if (inc) nextQty = currentQty + 1;
      if (dec) nextQty = Math.max(0, currentQty - 1);
      if (remove) nextQty = 0;
      await CartAPI.change(line, nextQty);
      await Drawer.refresh();
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

    const mobileQuery = window.matchMedia('(max-width: 600px)');

    // Desktop: opacity/active fade
    function goToDesktop(index) {
      slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
      thumbs.forEach((t, i) => t.classList.toggle('is-active', i === index));
      dots.forEach((d, i)   => d.classList.toggle('is-active', i === index));
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
            const idx = Math.round(main.scrollLeft / mobileStep());
            dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
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

    function lbGoTo(index) {
      lbSlides.forEach((s, i) => s.classList.toggle('is-active', i === index));
    }

    function lbOpen(index) {
      lbGoTo(index);
      lightbox.classList.add('is-open');
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function lbClose() {
      lightbox.classList.remove('is-open');
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
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
    }
    function close() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-open');
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

    // Show bar once the main ATC button leaves the viewport
    const observer = new IntersectionObserver(
      ([entry]) => { bar.classList.toggle('is-visible', !entry.isIntersecting); },
      { threshold: 0 }
    );
    observer.observe(mainAtc);

    // Proxy "Start Now" — clears selling plan so it's a one-time purchase
    bar.querySelector('[data-sticky-atc]')?.addEventListener('click', () => {
      const sp = $('[name="selling_plan"]');
      if (sp) sp.value = '';
      mainAtc.click();
    });

    // Proxy "Save 15%" — clicks the subscribe card's Add button
    bar.querySelector('[data-sticky-sub]')?.addEventListener('click', () => {
      $('[data-selling-plan-id]')?.click();
    });
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
      // Fallback: click the Shopify Inbox chat button if injected into DOM
      const inboxBtn = document.querySelector('#shopify-chat, [data-shopify-chat], iframe[title*="chat" i]');
      if (inboxBtn) { inboxBtn.click(); return; }
      // Last resort: fall back to custom modal
      openModal();
    }

    function openModal() {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('#ExpertName')?.focus();
    }
    function closeModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
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
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('.expert-modal__submit');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
          const body = new URLSearchParams(new FormData(form));
          // Build a readable contact body from name + phone
          const name = form.querySelector('[name="contact[name]"]').value.trim();
          const phone = form.querySelector('[name="contact[phone]"]').value.trim();
          const zip = form.querySelector('[name="contact[zip]"]')?.value.trim() || '';
          const channel = form.querySelector('[name="contact[channel]"]:checked')?.value || 'SMS';
          const product = form.querySelector('[name="contact[product]"]')?.value || '';
          body.set('contact[body]', `Expert text request\nName: ${name}\nPhone: ${phone}\nZIP: ${zip}\nContact via: ${channel}\nProduct: ${product}`);
          const res = await fetch('/contact', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          if (res.ok || res.redirected) {
            form.hidden = true;
            if (success) success.hidden = false;
          } else {
            btn.disabled = false;
            btn.textContent = 'Text me';
          }
        } catch (_) {
          btn.disabled = false;
          btn.textContent = 'Text me';
        }
      });
    }
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    Drawer.init();
    initProductForm();
    initCartDrawerEvents();
    initGallery();
    initMobileNav();
    initSwatchCarousels();
    initProductAccordions();
    initStickyBar();
    initExpertModal();
  });
})();
