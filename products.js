// IA STORE — product data access, product cards, Home page and Shop page logic.

import { db, isConfigured } from "./firebase.js";
import {
  collection, query, where, getDocs, getDoc, doc,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  CATEGORIES, esc, money, initPage, observeReveals, sortSizes, qs, qsa,
  categoryLabel, safeHex,
} from "./common.js";

/* ------------------------------------------------------------------ */
/* Data layer                                                          */
/* ------------------------------------------------------------------ */
export function normalizeProduct(id, d) {
  const stock = {};
  if (d.stock && typeof d.stock === "object") {
    for (const [k, v] of Object.entries(d.stock)) stock[k] = Math.max(0, Number(v) || 0);
  }
  return {
    id,
    name: d.name || "",
    price: Number(d.price) || 0,
    oldPrice: d.oldPrice ? Number(d.oldPrice) : null,
    description: d.description || "",
    category: d.category || "",
    images: Array.isArray(d.images) ? d.images.filter(Boolean) : [],
    colors: Array.isArray(d.colors)
      ? d.colors.filter((c) => c && c.name).map((c) => ({ name: String(c.name), hex: safeHex(c.hex) }))
      : [],
    stock,
    status: d.status === "unavailable" ? "unavailable" : "available",
    visible: d.visible !== false,
    isNew: !!d.isNew,
    isBestSeller: !!d.isBestSeller,
    salesCount: Number(d.salesCount) || 0,
    createdAt: d.createdAt?.toMillis?.() || 0,
  };
}

export const sortedSizes = (p) => sortSizes(Object.keys(p.stock));
export const sizeStock = (p, size) => Number(p.stock[size]) || 0;
export const totalStock = (p) => Object.values(p.stock).reduce((a, b) => a + b, 0);
export const isAvailable = (p) => p.status === "available" && totalStock(p) > 0;
export const isOnSale = (p) => !!p.oldPrice && p.oldPrice > p.price;
export const discountPercent = (p) => (isOnSale(p) ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

/** All products the public is allowed to see (visible === true). */
export async function fetchVisibleProducts() {
  if (!isConfigured) throw new Error("NOT_CONFIGURED");
  const snap = await getDocs(query(collection(db, "products"), where("visible", "==", true)));
  return snap.docs.map((d) => normalizeProduct(d.id, d.data()));
}

/** One product, or null if it does not exist / is hidden. */
export async function fetchProduct(id) {
  if (!isConfigured) throw new Error("NOT_CONFIGURED");
  try {
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) return null;
    const p = normalizeProduct(snap.id, snap.data());
    return p.visible ? p : null;
  } catch (err) {
    if (err?.code === "permission-denied") return null; // hidden products are blocked by the rules
    throw err;
  }
}

/** Friendly error / setup message inside a container. */
export function showError(container, err) {
  if (err?.message === "NOT_CONFIGURED") {
    container.innerHTML = `
      <div class="notice">
        <h3>Connect your Firebase project</h3>
        <p>Open <code>js/firebase.js</code> and paste your Firebase web-app config, then reload this page.
        Step-by-step instructions are in <code>README.md</code>.</p>
      </div>`;
  } else {
    console.error(err);
    container.innerHTML = `
      <div class="notice">
        <h3>We couldn't load the products</h3>
        <p>Please check your connection and Firebase rules, then try again.</p>
      </div>`;
  }
}

/* ------------------------------------------------------------------ */
/* Product card                                                        */
/* ------------------------------------------------------------------ */
export function productCard(p, opts = {}) {
  const avail = isAvailable(p);
  const sale = isOnSale(p);
  const href = `product.html?id=${encodeURIComponent(p.id)}`;

  const badges = [];
  if (!avail) badges.push('<span class="badge badge--out">Sold out</span>');
  else {
    if (sale) badges.push(`<span class="badge badge--sale">Sale −${discountPercent(p)}%</span>`);
    if (p.isNew) badges.push('<span class="badge badge--new">New</span>');
  }

  const media = p.images[0]
    ? `<img class="card__img" src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` +
      (p.images[1] ? `<img class="card__img card__img--alt" src="${esc(p.images[1])}" alt="" loading="lazy">` : "")
    : '<div class="ph" aria-hidden="true">IA</div>';

  const sizes = sortedSizes(p)
    .map((s) => {
      const out = sizeStock(p, s) <= 0;
      return `<button type="button" class="chip chip--sm${out ? " is-out" : ""}" data-size="${esc(s)}"${out ? " disabled" : ""}>${esc(s)}</button>`;
    })
    .join("");

  const dots = p.colors
    .slice(0, 6)
    .map((c) => `<span class="dot" title="${esc(c.name)}" style="background:${safeHex(c.hex)}"></span>`)
    .join("");

  const rank = opts.rank ? `<span class="rank">${String(opts.rank).padStart(2, "0")}</span>` : "";

  return `
    <article class="card${opts.feature ? " card--feature" : ""}${avail ? "" : " is-soldout"} reveal" data-id="${esc(p.id)}">
      <a class="card__media" href="${href}" aria-label="${esc(p.name)}">
        ${media}
        <div class="card__badges">${badges.join("")}</div>
        ${rank}
      </a>
      <div class="card__body">
        <div class="card__cat">${esc(categoryLabel(p.category))}</div>
        <h3 class="card__name"><a href="${href}">${esc(p.name)}</a></h3>
        <div class="card__price">
          <span class="price">${money(p.price)}</span>
          ${sale ? `<s class="price-old">${money(p.oldPrice)}</s>` : ""}
        </div>
        ${dots ? `<div class="card__colors">${dots}</div>` : ""}
        ${sizes ? `<div class="card__sizes" role="group" aria-label="Sizes">${sizes}</div>` : ""}
        <a class="btn btn--outline btn--sm card__view" href="${href}" data-base="${href}">View Details</a>
      </div>
    </article>`;
}

/** Size chips on a card select a size and carry it over to the details page. */
export function bindCards(root) {
  if (!root || root.dataset.cardsBound) return;
  root.dataset.cardsBound = "1";
  root.addEventListener("click", (e) => {
    const chip = e.target.closest(".card .chip[data-size]");
    if (!chip || chip.disabled) return;
    const card = chip.closest(".card");
    const already = chip.classList.contains("is-active");
    qsa(".chip", card).forEach((c) => c.classList.remove("is-active"));
    const view = qs(".card__view", card);
    if (already) {
      view.href = view.dataset.base;
    } else {
      chip.classList.add("is-active");
      view.href = `${view.dataset.base}&size=${encodeURIComponent(chip.dataset.size)}`;
    }
  });
}

const skeleton = (n) =>
  Array.from({ length: n }, () => '<div class="card card--skeleton"><div class="card__media"></div><div class="card__body"><i></i><i></i></div></div>').join("");

/* ------------------------------------------------------------------ */
/* HOME PAGE                                                           */
/* ------------------------------------------------------------------ */
const CATEGORY_IMAGES = {
  shirts: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85",
  polo: "https://images.unsplash.com/photo-1627225924765-552d49cf47ad?auto=format&fit=crop&w=900&q=85",
  pants: "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=85",
  jeans: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=85",
  caps: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=900&q=85",
  jackets: "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=85",
  shoes: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85",
};

function renderCategories(products) {
  const grid = qs("#cat-grid");
  if (!grid) return;
  grid.innerHTML = CATEGORIES.map((c, i) => {
    const fallback = products.find((p) => p.category === c.slug && p.images[0])?.images[0] || "";
    const image = CATEGORY_IMAGES[c.slug] || fallback;
    return `
      <a class="cat${i === CATEGORIES.length - 1 ? " cat--wide" : ""} reveal" href="shop.html?category=${c.slug}">
        <img src="${image}" alt="${esc(c.label)} category" loading="lazy" ${fallback ? `data-fallback="${esc(fallback)}"` : ""}>
        <span class="cat__label"><strong>${esc(c.label)}</strong><em>Explore →</em></span>
      </a>`;
  }).join("");
  observeReveals(grid);
}

async function initHome() {
  renderCategories([]);
  const newGrid = qs("#new-grid");
  newGrid.innerHTML = skeleton(4);

  let products;
  try {
    products = await fetchVisibleProducts();
  } catch (err) {
    showError(newGrid, err);
    return;
  }

  renderCategories(products);

  // New arrivals
  const fresh = products.filter((p) => p.isNew).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  if (fresh.length) {
    newGrid.innerHTML = fresh.map((p) => productCard(p)).join("");
    bindCards(newGrid);
  } else {
    newGrid.innerHTML = `<div class="notice"><h3>${products.length ? "New pieces are on the way" : "Our collection is being prepared"}</h3>
      <p>${products.length ? "Browse the full collection in the shop." : "Products will appear here as soon as they are added."}</p>
      <a class="btn btn--outline btn--sm" href="shop.html">Go to Shop</a></div>`;
  }

  // Best sellers (horizontal showcase)
  const best = products
    .filter((p) => p.isBestSeller)
    .sort((a, b) => b.salesCount - a.salesCount || b.createdAt - a.createdAt)
    .slice(0, 10);
  if (best.length) {
    qs("#best-section").hidden = false;
    const track = qs("#best-track");
    track.innerHTML = best.map((p, i) => productCard(p, { feature: true, rank: i + 1 })).join("");
    bindCards(track);
    const step = () => Math.max(260, track.clientWidth * 0.8);
    qs("#best-prev").addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
    qs("#best-next").addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
  }

  // Promotional section — only when there really are discounted products
  const onSale = products.filter(isOnSale);
  if (onSale.length) {
    const top = Math.max(...onSale.map(discountPercent));
    qs("#promo-title").textContent = `Up to ${top}% off selected pieces`;
    qs("#promo-section").hidden = false;
  }

  observeReveals();
}

/* ------------------------------------------------------------------ */
/* SHOP PAGE                                                           */
/* ------------------------------------------------------------------ */
async function initShop() {
  const grid = qs("#grid");
  grid.innerHTML = skeleton(8);

  let products;
  try {
    products = await fetchVisibleProducts();
  } catch (err) {
    showError(grid, err);
    qs("#result-count").textContent = "";
    return;
  }

  const params = new URLSearchParams(location.search);
  const list = (key) => (params.get(key) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const state = {
    category: CATEGORIES.some((c) => c.slug === params.get("category")) ? params.get("category") : "",
    sizes: new Set(list("size")),
    colors: new Set(list("color").map((c) => c.toLowerCase())),
    min: params.get("min") || "",
    max: params.get("max") || "",
    isNew: params.get("new") === "1",
    best: params.get("best") === "1",
    sale: params.get("sale") === "1",
    inStock: params.get("stock") === "1",
    sort: params.get("sort") || "newest",
    q: (params.get("q") || "").trim(),
  };

  // Option lists built from the real catalogue
  const allSizes = sortSizes([...new Set(products.flatMap((p) => Object.keys(p.stock)))]);
  const colorMap = new Map();
  products.forEach((p) => p.colors.forEach((c) => colorMap.has(c.name.toLowerCase()) || colorMap.set(c.name.toLowerCase(), c)));
  const allColors = [...colorMap.values()];

  const prices = products.map((p) => p.price);
  if (prices.length) {
    qs("#f-min").placeholder = String(Math.min(...prices));
    qs("#f-max").placeholder = String(Math.max(...prices));
  }

  const matches = (p) => {
    if (state.category && p.category !== state.category) return false;
    if (state.sizes.size && ![...state.sizes].some((s) => sizeStock(p, s) > 0)) return false;
    if (state.colors.size && !p.colors.some((c) => state.colors.has(c.name.toLowerCase()))) return false;
    if (state.min !== "" && p.price < Number(state.min)) return false;
    if (state.max !== "" && p.price > Number(state.max)) return false;
    if (state.isNew && !p.isNew) return false;
    if (state.best && !p.isBestSeller) return false;
    if (state.sale && !isOnSale(p)) return false;
    if (state.inStock && !isAvailable(p)) return false;
    if (state.q) {
      const hay = `${p.name} ${p.description} ${categoryLabel(p.category)}`.toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  };

  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    best: (a, b) => Number(b.isBestSeller) - Number(a.isBestSeller) || b.salesCount - a.salesCount || b.createdAt - a.createdAt,
  };

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.category) p.set("category", state.category);
    if (state.sizes.size) p.set("size", [...state.sizes].join(","));
    if (state.colors.size) p.set("color", [...state.colors].join(","));
    if (state.min !== "") p.set("min", state.min);
    if (state.max !== "") p.set("max", state.max);
    if (state.isNew) p.set("new", "1");
    if (state.best) p.set("best", "1");
    if (state.sale) p.set("sale", "1");
    if (state.inStock) p.set("stock", "1");
    if (state.sort !== "newest") p.set("sort", state.sort);
    if (state.q) p.set("q", state.q);
    const qsString = p.toString();
    history.replaceState(null, "", qsString ? `?${qsString}` : location.pathname);
  }

  function renderFilters() {
    qs("#f-category").innerHTML =
      `<button type="button" class="chip${state.category ? "" : " is-active"}" data-cat="">All</button>` +
      CATEGORIES.map((c) => `<button type="button" class="chip${state.category === c.slug ? " is-active" : ""}" data-cat="${c.slug}">${c.label}</button>`).join("");

    qs("#f-size").innerHTML = allSizes.length
      ? allSizes.map((s) => `<button type="button" class="chip${state.sizes.has(s) ? " is-active" : ""}" data-size="${esc(s)}">${esc(s)}</button>`).join("")
      : '<span class="muted">No sizes yet</span>';

    qs("#f-color").innerHTML = allColors.length
      ? allColors.map((c) => {
          const on = state.colors.has(c.name.toLowerCase());
          return `<button type="button" class="swatch${on ? " is-active" : ""}" data-color="${esc(c.name.toLowerCase())}" title="${esc(c.name)}" aria-label="${esc(c.name)}" aria-pressed="${on}" style="--c:${safeHex(c.hex)}"></button>`;
        }).join("")
      : '<span class="muted">No colors yet</span>';

    qs("#f-min").value = state.min;
    qs("#f-max").value = state.max;
    qs("#f-new").checked = state.isNew;
    qs("#f-best").checked = state.best;
    qs("#f-sale").checked = state.sale;
    qs("#f-stock").checked = state.inStock;
    qs("#sort").value = state.sort;
  }

  function renderResults() {
    const items = products.filter(matches).sort(sorters[state.sort] || sorters.newest);
    const label = `${items.length} product${items.length === 1 ? "" : "s"}`;
    qs("#result-count").innerHTML = state.q
      ? `${label} for “${esc(state.q)}” <button type="button" class="linklike" id="clear-q">clear</button>`
      : label;
    qs("#clear-q")?.addEventListener("click", () => {
      state.q = "";
      update();
    });

    if (!items.length) {
      grid.innerHTML = `<div class="notice notice--wide"><h3>No products match your filters</h3>
        <p>${products.length ? "Try removing some filters." : "Products will appear here as soon as they are added."}</p></div>`;
    } else {
      grid.innerHTML = items.map((p) => productCard(p)).join("");
      bindCards(grid);
      observeReveals(grid);
    }
    const active =
      (state.category ? 1 : 0) + state.sizes.size + state.colors.size + (state.min !== "" ? 1 : 0) + (state.max !== "" ? 1 : 0) +
      [state.isNew, state.best, state.sale, state.inStock].filter(Boolean).length;
    const btn = qs("#filters-open");
    btn.textContent = active ? `Filters (${active})` : "Filters";
  }

  function update() {
    renderFilters();
    renderResults();
    syncUrl();
  }

  // Filter events
  const toggle = (set, value) => (set.has(value) ? set.delete(value) : set.add(value));
  qs("#f-category").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.category = b.dataset.cat;
    update();
  });
  qs("#f-size").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]");
    if (!b) return;
    toggle(state.sizes, b.dataset.size);
    update();
  });
  qs("#f-color").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    toggle(state.colors, b.dataset.color);
    update();
  });
  const priceInput = (id, key) =>
    qs(id).addEventListener("change", (e) => {
      const v = e.target.value.trim();
      state[key] = v === "" || Number(v) < 0 ? "" : String(Number(v));
      update();
    });
  priceInput("#f-min", "min");
  priceInput("#f-max", "max");
  [["#f-new", "isNew"], ["#f-best", "best"], ["#f-sale", "sale"], ["#f-stock", "inStock"]].forEach(([id, key]) =>
    qs(id).addEventListener("change", (e) => {
      state[key] = e.target.checked;
      update();
    })
  );
  qs("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    update();
  });
  qs("#clear-filters").addEventListener("click", () => {
    Object.assign(state, {
      category: "", sizes: new Set(), colors: new Set(), min: "", max: "",
      isNew: false, best: false, sale: false, inStock: false, sort: "newest", q: "",
    });
    update();
  });

  // Mobile filter drawer
  const panel = qs("#filters-panel");
  const backdrop = qs("#filters-backdrop");
  const setDrawer = (open) => {
    panel.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-on", open);
    document.body.classList.toggle("no-scroll", open);
  };
  qs("#filters-open").addEventListener("click", () => setDrawer(true));
  qs("#filters-close").addEventListener("click", () => setDrawer(false));
  qs("#filters-apply").addEventListener("click", () => setDrawer(false));
  backdrop.addEventListener("click", () => setDrawer(false));

  update();
}

/* ------------------------------------------------------------------ */
/* Bootstrap (only on the pages that use this file for page logic)     */
/* ------------------------------------------------------------------ */
const page = document.body?.dataset.page;
if (page === "home" || page === "shop") {
  initPage();
  if (page === "home") initHome();
  else initShop();
}