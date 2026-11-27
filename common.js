// IA STORE — shared helpers: config, formatting, cart store, header/footer, toasts.
// This file has NO Firebase dependency so it can be used by every page.

/* ------------------------------------------------------------------ */
/* Store configuration — edit freely                                   */
/* ------------------------------------------------------------------ */
export const CONFIG = {
  storeName: "IA STORE",
  currency: "DA", // shown after every price
  lowStockTotal: 5, // a product with 1..5 pieces in total is "low stock"
  lowStockSize: 2, // a single size with 1..2 pieces is highlighted in the admin
  policy: {
    delivery:
      "Cash on delivery. We call you to confirm your order and delivery details before shipping.",
    exchange:
      "Need another size? Contact us after delivery to arrange an exchange for unworn items.",
  },
};

export const CATEGORIES = [
  { slug: "jackets", label: "JACKET" },
  { slug: "shoes", label: "SHOES" },
  { slug: "jeans", label: "JEANS" },
  { slug: "caps", label: "CAPS" },
  { slug: "pants", label: "CLASSIC PANTS" },
  { slug: "hoodie", label: "HOODIE" },
  { slug: "shirts", label: "T-SHIRT" },
];

export const SIZE_PRESETS = {
  letters: ["S", "M", "L", "XL"],
  waist: ["S", "M", "L", "XL"],
  shoes: ["39", "40", "41", "42", "43", "44"],
  one: ["One Size"],
};

export const CATEGORY_SIZE_PRESET = {
  jackets: "letters",
  shoes: "shoes",
  jeans: "letters",
  caps: "letters",
  pants: "letters",
  hoodie: "letters",
  shirts: "letters",
};

export const ORDER_STATUSES = ["Pending", "Confirmed", "Shipped", "Delivered", "Cancelled"];

export const WILAYAS = [
  "Adrar", "Chlef", "Laghouat", "Oum El Bouaghi", "Batna", "Béjaïa", "Biskra", "Béchar",
  "Blida", "Bouira", "Tamanrasset", "Tébessa", "Tlemcen", "Tiaret", "Tizi Ouzou", "Algiers",
  "Djelfa", "Jijel", "Sétif", "Saïda", "Skikda", "Sidi Bel Abbès", "Annaba", "Guelma",
  "Constantine", "Médéa", "Mostaganem", "M'Sila", "Mascara", "Ouargla", "Oran", "El Bayadh",
  "Illizi", "Bordj Bou Arréridj", "Boumerdès", "El Tarf", "Tindouf", "Tissemsilt", "El Oued",
  "Khenchela", "Souk Ahras", "Tipaza", "Mila", "Aïn Defla", "Naâma", "Aïn Témouchent",
  "Ghardaïa", "Relizane", "Timimoun", "Bordj Badji Mokhtar", "Ouled Djellal", "Béni Abbès",
  "In Salah", "In Guezzam", "Touggourt", "Djanet", "El M'Ghair", "El Meniaa",
];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export const money = (n) => `${Number(n || 0).toLocaleString("en-US")} ${CONFIG.currency}`;

export function safeHex(hex) {
  return /^#[0-9a-f]{3,8}$/i.test(String(hex || "")) ? hex : "#cccccc";
}

export function categoryLabel(slug) {
  return CATEGORIES.find((c) => c.slug === slug)?.label || slug || "";
}

const SIZE_ORDER = [...SIZE_PRESETS.letters, ...SIZE_PRESETS.waist, ...SIZE_PRESETS.shoes, "One Size"];
export function sortSizes(list) {
  const rank = (s) => {
    const i = SIZE_ORDER.indexOf(String(s));
    return i === -1 ? 1000 : i;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function formatDate(value) {
  const d = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return d
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
export function toast(message, type = "info") {
  let wrap = qs(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    wrap.setAttribute("aria-live", "polite");
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

/* ------------------------------------------------------------------ */
/* Cart store (localStorage)                                           */
/* ------------------------------------------------------------------ */
export const CART_KEY = "ia_store_cart_v1";

export function getCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode) — cart will live for this page only */
  }
  window.dispatchEvent(new CustomEvent("cart:changed"));
}

export const cartKey = (i) => `${i.productId}|${i.size}|${i.color}`;
export const cartCount = () => getCart().reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

/**
 * Adds an item. `maxQty` is the available stock for that size.
 * Returns { ok, added, capped }.
 */
export function addToCart(item, maxQty = Infinity) {
  const cart = getCart();
  const key = cartKey(item);
  const existing = cart.find((i) => cartKey(i) === key);
  const current = existing ? existing.qty : 0;
  const allowed = Math.max(0, Math.min(item.qty, maxQty - current));
  if (allowed <= 0) return { ok: false, added: 0, capped: true };
  if (existing) {
    existing.qty += allowed;
    existing.price = item.price;
    existing.name = item.name;
    existing.image = item.image;
  } else {
    cart.push({ ...item, qty: allowed });
  }
  saveCart(cart);
  return { ok: true, added: allowed, capped: allowed < item.qty };
}

/* ------------------------------------------------------------------ */
/* Layout: header / footer                                             */
/* ------------------------------------------------------------------ */
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const ICON_BAG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>';

function renderHeader() {
  const host = qs("#site-header");
  if (!host) return;
  const path = location.pathname.split("/").pop() || "index.html";
  const params = new URLSearchParams(location.search);
  let active = "";
  if (path === "index.html" || path === "") active = location.hash === "#about" ? "about" : location.hash === "#categories" ? "categories" : "home";
  else if (path === "shop.html") active = params.get("new") === "1" ? "new" : "shop";
  else if (path === "product.html") active = "shop";

  const link = (key, href, label) =>
    `<a href="${href}" data-nav="${key}" class="${active === key ? "is-active" : ""}">${label}</a>`;

  host.innerHTML = `
    <header class="nav" id="nav">
      <div class="nav__inner">
        <button class="nav__burger" id="burger" aria-label="Open menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <a class="nav__logo" href="index.html" aria-label="IA STORE — home" id="nav-logo">
          <img src="logo.png.png" alt="IA STORE" height="40">
        </a>
        <nav class="nav__links" id="nav-links" aria-label="Main">
          ${link("home", "index.html", "Home")}
          ${link("shop", "shop.html", "Shop")}
          ${link("categories", "index.html#categories", "Categories")}
          ${link("new", "shop.html?new=1", "New Arrivals")}
          ${link("about", "index.html#about", "About Us")}
        </nav>
        <div class="nav__actions">
          <button class="nav__btn" id="search-btn" aria-label="Search">${ICON_SEARCH}</button>
          <a class="nav__btn nav__cart" href="cart.html" aria-label="Shopping cart">
            ${ICON_BAG}<span class="nav__count" id="cart-count" hidden>0</span>
          </a>
        </div>
      </div>
    </header>
    <div class="nav__backdrop" id="nav-backdrop"></div>
    <div class="search" id="search-overlay" hidden>
      <form class="search__form" id="search-form" role="search" action="shop.html" method="get">
        <input class="search__input" id="search-input" name="q" type="search" placeholder="Search products…" autocomplete="off" aria-label="Search products">
        <button class="btn btn--light btn--sm" type="submit">Search</button>
        <button class="search__close" type="button" id="search-close" aria-label="Close search">×</button>
      </form>
    </div>`;

  // Logo: use images/logo.png when it exists, otherwise fall back to a text wordmark.
  const img = qs("#nav-logo img");
  img?.addEventListener("error", () => {
    const span = document.createElement("span");
    span.className = "wordmark";
    span.textContent = "IA STORE";
    img.replaceWith(span);
  });

  // Mobile menu
  const burger = qs("#burger");
  const header = qs("#nav");
  const setMenu = (open) => {
    header.classList.toggle("nav--open", open);
    qs("#nav-backdrop").classList.toggle("is-on", open);
    burger.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("no-scroll", open);
  };
  burger.addEventListener("click", () => setMenu(!header.classList.contains("nav--open")));
  qs("#nav-backdrop").addEventListener("click", () => setMenu(false));
  qsa("#nav-links a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

  // Search overlay
  const overlay = qs("#search-overlay");
  const input = qs("#search-input");
  const setSearch = (open) => {
    overlay.hidden = !open;
    if (open) setTimeout(() => input.focus(), 30);
  };
  qs("#search-btn").addEventListener("click", () => setSearch(overlay.hidden));
  qs("#search-close").addEventListener("click", () => setSearch(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSearch(false);
      setMenu(false);
    }
  });

  // Shadow once the page is scrolled
  const onScroll = () => header.classList.toggle("nav--scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function renderFooter() {
  const host = qs("#site-footer");
  if (!host) return;
  const year = new Date().getFullYear();
  host.innerHTML = `
    <footer class="footer">
      <div class="footer__inner">
        <div class="footer__brand">
          <div class="footer__logo">IA STORE</div>
          <p>Smart Casual menswear. Classic elegance, modern edge.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <a href="shop.html">All products</a>
          <a href="shop.html?new=1">New Arrivals</a>
          <a href="shop.html?best=1">Best Sellers</a>
          <a href="shop.html?sale=1">Sale</a>
        </div>
        <div>
          <h4>Categories</h4>
          ${CATEGORIES.slice(0, 4).map((c) => `<a href="shop.html?category=${c.slug}">${c.label}</a>`).join("")}
        </div>
        <div>
          <h4>Customer care</h4>
          <p class="footer__note">${esc(CONFIG.policy.delivery)}</p>
          <p class="footer__note">${esc(CONFIG.policy.exchange)}</p>
        </div>
      </div>
      <div class="footer__bar">
        <span>© ${year} IA STORE. All rights reserved.</span>
        <a href="login.html">Staff</a>
      </div>
    </footer>`;
}

export function updateCartBadge() {
  const badge = qs("#cart-count");
  if (!badge) return;
  const n = cartCount();
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = n === 0;
}

/* Scroll-reveal animations */
let revealObserver;
export function observeReveals(root = document) {
  const els = qsa(".reveal:not(.is-in)", root);
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-in"));
    return;
  }
  revealObserver ||= new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          revealObserver.unobserve(e.target);
        }
      }),
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => revealObserver.observe(el));
}

/* Images that fail to load: try data-fallback once, otherwise hide the image. */
function brokenImageHandler(e) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fallback) {
    const next = img.dataset.fallback;
    delete img.dataset.fallback;
    img.src = next;
  } else {
    img.classList.add("is-broken");
  }
}

/** Call once on every public page. */
export function initPage() {
  document.documentElement.classList.add("js");
  document.addEventListener("error", brokenImageHandler, true);
  renderHeader();
  renderFooter();
  updateCartBadge();
  window.addEventListener("cart:changed", updateCartBadge);
  window.addEventListener("storage", (e) => {
    if (e.key === CART_KEY) updateCartBadge();
  });
  window.addEventListener("hashchange", () => {
    qsa("#nav-links a").forEach((a) => {
      const href = a.getAttribute("href");
      a.classList.toggle("is-active", href === `index.html${location.hash}` || (!location.hash && href === "index.html"));
    });
  });
  observeReveals();
}
