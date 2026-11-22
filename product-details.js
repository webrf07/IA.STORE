// IA STORE — product details page (product.html?id=...)

import {
  fetchProduct, fetchVisibleProducts, productCard, bindCards, sizeStock, sortedSizes,
  isAvailable, isOnSale, discountPercent, showError,
} from "./products.js";
import {
  CONFIG, esc, money, qs, qsa, toast, addToCart, initPage, observeReveals, categoryLabel, safeHex,
} from "./common.js";

initPage();

const root = qs("#product-root");
const id = new URLSearchParams(location.search).get("id");

async function init() {
  if (!id) return notFound();
  let product;
  try {
    product = await fetchProduct(id);
  } catch (err) {
    return showError(root, err);
  }
  if (!product) return notFound();
  render(product);
  loadRelated(product);
}

function notFound() {
  root.innerHTML = `<div class="notice"><h3>Product not found</h3>
    <p>This product may have been removed or is no longer available.</p>
    <a class="btn btn--outline btn--sm" href="shop.html">Back to Shop</a></div>`;
}

function render(p) {
  document.title = `${p.name} — IA STORE`;
  const avail = isAvailable(p);
  const sale = isOnSale(p);
  const sizes = sortedSizes(p);
  const urlSize = new URLSearchParams(location.search).get("size");

  const state = {
    img: 0,
    color: p.colors[0]?.name || "",
    size: urlSize && sizeStock(p, urlSize) > 0 ? urlSize : "",
    qty: 1,
  };

  qs("#crumbs").innerHTML = `<a href="index.html">Home</a><span>/</span><a href="shop.html">Shop</a>` +
    (p.category ? `<span>/</span><a href="shop.html?category=${esc(p.category)}">${esc(categoryLabel(p.category))}</a>` : "") +
    `<span>/</span><b>${esc(p.name)}</b>`;

  const thumbs = p.images
    .map((src, i) => `<button type="button" class="gallery__thumb${i === 0 ? " is-active" : ""}" data-i="${i}" aria-label="Image ${i + 1}"><img src="${esc(src)}" alt=""></button>`)
    .join("");

  root.innerHTML = `
    <div class="pd__grid">
      <div class="gallery">
        ${p.images.length > 1 ? `<div class="gallery__thumbs" id="thumbs">${thumbs}</div>` : ""}
        <button type="button" class="gallery__main" id="main-btn" aria-label="Zoom image">
          ${p.images[0]
            ? `<img id="main-img" src="${esc(p.images[0])}" alt="${esc(p.name)}">`
            : '<div class="ph ph--lg" aria-hidden="true">IA</div>'}
          ${p.images[0] ? '<span class="zoom-hint">Click to zoom</span>' : ""}
          ${!avail ? '<span class="badge badge--out gallery__badge">Sold out</span>' : sale ? `<span class="badge badge--sale gallery__badge">Sale −${discountPercent(p)}%</span>` : p.isNew ? '<span class="badge badge--new gallery__badge">New</span>' : ""}
        </button>
      </div>

      <div class="pd__info">
        <p class="eyebrow">${esc(categoryLabel(p.category))}</p>
        <h1 class="pd__title">${esc(p.name)}</h1>
        <div class="pd__price">
          <span class="price price--lg">${money(p.price)}</span>
          ${sale ? `<s class="price-old">${money(p.oldPrice)}</s>` : ""}
        </div>
        ${p.description ? `<p class="pd__desc">${esc(p.description).replace(/\n/g, "<br>")}</p>` : ""}

        ${p.colors.length ? `
        <div class="opt">
          <div class="opt__label">Color: <strong id="color-name">${esc(state.color)}</strong></div>
          <div class="swatches" id="colors">
            ${p.colors.map((c, i) => `<button type="button" class="swatch swatch--lg${i === 0 ? " is-active" : ""}" data-color="${esc(c.name)}" title="${esc(c.name)}" aria-label="${esc(c.name)}" style="--c:${safeHex(c.hex)}"></button>`).join("")}
          </div>
        </div>` : ""}

        <div class="opt" id="size-opt">
          <div class="opt__label">Size <span class="opt__hint" id="size-hint"></span></div>
          <div class="chips" id="sizes">
            ${sizes.length
              ? sizes.map((s) => {
                  const out = sizeStock(p, s) <= 0;
                  return `<button type="button" class="chip${out ? " is-out" : ""}${state.size === s ? " is-active" : ""}" data-size="${esc(s)}"${out ? ' disabled title="Out of stock"' : ""}>${esc(s)}</button>`;
                }).join("")
              : '<span class="muted">No sizes available</span>'}
          </div>
        </div>

        <div class="opt">
          <div class="opt__label">Quantity</div>
          <div class="qty">
            <button type="button" id="q-dec" aria-label="Decrease">−</button>
            <span id="q-val" aria-live="polite">1</span>
            <button type="button" id="q-inc" aria-label="Increase">+</button>
          </div>
          <small class="stock-note" id="stock-note"></small>
        </div>

        <button type="button" class="btn btn--primary btn--block btn--lg" id="add-btn" ${avail ? "" : "disabled"}>
          ${avail ? "Add to Cart" : "Sold Out"}
        </button>
        <a class="btn btn--outline btn--block" href="cart.html" id="go-cart" hidden>View Cart</a>

        <ul class="pd__facts">
          <li><b>Delivery</b><span>${esc(CONFIG.policy.delivery)}</span></li>
          <li><b>Exchange</b><span>${esc(CONFIG.policy.exchange)}</span></li>
        </ul>
      </div>
    </div>`;

  /* ---- helpers ---- */
  const maxQty = () => (state.size ? sizeStock(p, state.size) : 10);

  function refreshQty() {
    state.qty = Math.max(1, Math.min(state.qty, maxQty() || 1));
    qs("#q-val").textContent = state.qty;
    qs("#q-dec").disabled = state.qty <= 1;
    qs("#q-inc").disabled = !!state.size && state.qty >= maxQty();
    const note = qs("#stock-note");
    if (state.size) {
      const left = sizeStock(p, state.size);
      note.textContent = left <= 3 ? `Only ${left} left in size ${state.size}` : "";
    } else {
      note.textContent = "";
    }
  }

  function selectImage(i) {
    state.img = i;
    const main = qs("#main-img");
    if (main) main.src = p.images[i];
    qsa(".gallery__thumb").forEach((t) => t.classList.toggle("is-active", Number(t.dataset.i) === i));
  }

  /* ---- events ---- */
  qs("#thumbs")?.addEventListener("click", (e) => {
    const t = e.target.closest("[data-i]");
    if (t) selectImage(Number(t.dataset.i));
  });

  qs("#colors")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    state.color = b.dataset.color;
    qsa("#colors .swatch").forEach((s) => s.classList.toggle("is-active", s === b));
    qs("#color-name").textContent = state.color;
  });

  qs("#sizes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]");
    if (!b || b.disabled) return;
    state.size = b.dataset.size;
    qsa("#sizes .chip").forEach((c) => c.classList.toggle("is-active", c === b));
    qs("#size-opt").classList.remove("has-error");
    qs("#size-hint").textContent = "";
    refreshQty();
  });

  qs("#q-dec").addEventListener("click", () => { state.qty -= 1; refreshQty(); });
  qs("#q-inc").addEventListener("click", () => { state.qty += 1; refreshQty(); });

  qs("#add-btn").addEventListener("click", () => {
    if (sizes.length && !state.size) {
      qs("#size-opt").classList.add("has-error");
      qs("#size-hint").textContent = "— please select a size";
      toast("Please select a size", "error");
      return;
    }
    const stock = sizes.length ? sizeStock(p, state.size) : 0;
    const result = addToCart(
      { productId: p.id, name: p.name, price: p.price, image: p.images[0] || "", size: state.size, color: state.color, qty: state.qty },
      stock
    );
    if (!result.ok) {
      toast(`You already have the maximum available (${stock}) in your cart`, "error");
      return;
    }
    toast(result.capped ? `Added ${result.added} — that's all we have in stock` : "Added to your cart", "success");
    const btn = qs("#add-btn");
    btn.textContent = "Added ✓";
    setTimeout(() => (btn.textContent = "Add to Cart"), 1600);
    qs("#go-cart").hidden = false;
  });

  /* ---- lightbox ---- */
  setupLightbox(p, () => state.img, selectImage);
  refreshQty();
  observeReveals();
}

function setupLightbox(p, getIndex, setIndex) {
  const box = qs("#lightbox");
  const img = qs("#lb-img");
  const count = qs("#lb-count");
  if (!p.images.length) return;
  let index = 0;

  const show = (i) => {
    index = (i + p.images.length) % p.images.length;
    img.src = p.images[index];
    img.classList.remove("is-zoomed");
    img.style.transformOrigin = "50% 50%";
    count.textContent = `${index + 1} / ${p.images.length}`;
    setIndex(index);
  };
  const open = () => {
    box.hidden = false;
    document.body.classList.add("no-scroll");
    show(getIndex());
  };
  const close = () => {
    box.hidden = true;
    document.body.classList.remove("no-scroll");
  };

  qs("#main-btn").addEventListener("click", open);
  qs("#lb-close").addEventListener("click", close);
  qs("#lb-prev").addEventListener("click", () => show(index - 1));
  qs("#lb-next").addEventListener("click", () => show(index + 1));
  qs(".lightbox__stage").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) close();
  });
  img.addEventListener("click", (e) => {
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    img.classList.toggle("is-zoomed");
  });
  img.addEventListener("mousemove", (e) => {
    if (!img.classList.contains("is-zoomed")) return;
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });
  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });
  if (p.images.length < 2) {
    qs("#lb-prev").hidden = true;
    qs("#lb-next").hidden = true;
  }
}

async function loadRelated(p) {
  try {
    const all = await fetchVisibleProducts();
    const same = all.filter((x) => x.id !== p.id && x.category === p.category);
    const others = all.filter((x) => x.id !== p.id && x.category !== p.category);
    const picks = [...same, ...others].slice(0, 4);
    if (!picks.length) return;
    const grid = qs("#related-grid");
    grid.innerHTML = picks.map((x) => productCard(x)).join("");
    bindCards(grid);
    qs("#related-section").hidden = false;
    observeReveals(grid);
  } catch {
    /* related products are optional */
  }
}

init();