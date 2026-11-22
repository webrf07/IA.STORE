// IA STORE — cart logic. Exports helpers used by checkout.js and runs the cart page when #cart-root exists.

import { fetchProduct, sizeStock, sortedSizes } from "./products.js";
import {
  getCart, saveCart, cartKey, esc, money, qs, toast, initPage, observeReveals,
} from "./common.js";

/* ------------------------------------------------------------------ */
/* Shared: check the saved cart against the live catalogue             */
/* ------------------------------------------------------------------ */
export async function loadCartProducts(cart = getCart()) {
  const ids = [...new Set(cart.map((i) => i.productId))];
  const entries = await Promise.all(ids.map(async (pid) => [pid, await fetchProduct(pid)]));
  return new Map(entries);
}

/**
 * Pure: turns cart items + a products map into display lines.
 * status: ok | missing | soldout | size_out
 */
export function buildLines(cart, products) {
  let changed = false;
  const lines = cart.map((item) => {
    const product = products.get(item.productId) || null;
    let status = "ok";
    let maxQty = 0;
    if (!product) status = "missing";
    else if (product.status !== "available") status = "soldout";
    else {
      maxQty = sizeStock(product, item.size);
      if (sizeStock(product, item.size) <= 0 && sortedSizes(product).length) status = "size_out";
    }
    if (status === "ok") {
      if (item.price !== product.price) { item.price = product.price; changed = true; }
      item.name = product.name;
      item.image = product.images[0] || "";
      if (item.qty > maxQty) { item.qty = maxQty; changed = true; }
      if (item.qty < 1) { item.qty = 1; changed = true; }
      if (product.colors.length && !product.colors.some((c) => c.name === item.color)) {
        item.color = product.colors[0].name;
        changed = true;
      }
    }
    return { item, product, status, maxQty };
  });
  const valid = lines.filter((l) => l.status === "ok");
  return {
    lines,
    changed,
    total: valid.reduce((s, l) => s + l.item.price * l.item.qty, 0),
    count: valid.reduce((s, l) => s + l.item.qty, 0),
    hasIssues: lines.some((l) => l.status !== "ok"),
  };
}

/** Fetches live data, corrects quantities/prices, saves the cart and returns the result. */
export async function reconcileCart() {
  const cart = getCart();
  if (!cart.length) return { lines: [], changed: false, total: 0, count: 0, hasIssues: false, products: new Map() };
  const products = await loadCartProducts(cart);
  const result = buildLines(cart, products);
  if (result.changed) saveCart(result.lines.map((l) => l.item));
  return { ...result, products };
}

/* ------------------------------------------------------------------ */
/* Cart page                                                           */
/* ------------------------------------------------------------------ */
const WARN = {
  missing: "This product is no longer available.",
  soldout: "This product is currently unavailable.",
  size_out: "This size is out of stock. Choose another size or remove it.",
};

async function initCartPage(rootEl) {
  initPage();
  rootEl.innerHTML = '<div class="cart-loading">Loading your cart…</div>';

  let products;
  try {
    const first = await reconcileCart();
    products = first.products;
  } catch (err) {
    rootEl.innerHTML = `<div class="notice"><h3>We couldn't load your cart</h3>
      <p>${err?.message === "NOT_CONFIGURED" ? "Connect Firebase in js/firebase.js first." : "Please check your connection and try again."}</p></div>`;
    return;
  }

  function render() {
    const cart = getCart();
    if (!cart.length) {
      rootEl.innerHTML = `<div class="notice"><h3>Your cart is empty</h3>
        <p>Discover our latest pieces and add your favourites.</p>
        <a class="btn btn--primary" href="shop.html">Continue shopping</a></div>`;
      return;
    }
    const result = buildLines(cart, products);
    if (result.changed) saveCart(result.lines.map((l) => l.item));

    const rows = result.lines.map(({ item, product, status, maxQty }) => {
      const key = cartKey(item);
      const sizes = product ? sortedSizes(product).filter((s) => sizeStock(product, s) > 0 || s === item.size) : [item.size];
      const warn = status !== "ok" ? `<p class="line__warn">${WARN[status]}</p>` : "";
      return `
        <article class="line${status !== "ok" ? " is-bad" : ""} reveal" data-key="${esc(key)}">
          <a class="line__img" href="product.html?id=${encodeURIComponent(item.productId)}">
            ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}">` : '<div class="ph">IA</div>'}
          </a>
          <div class="line__info">
            <a class="line__name" href="product.html?id=${encodeURIComponent(item.productId)}">${esc(item.name)}</a>
            ${item.color ? `<div class="line__meta">Color: ${esc(item.color)}</div>` : ""}
            ${item.size ? `<label class="line__size">Size
              <select data-action="size" aria-label="Size">
                ${sizes.map((s) => `<option value="${esc(s)}"${s === item.size ? " selected" : ""}>${esc(s)}${product && sizeStock(product, s) <= 0 ? " (out of stock)" : ""}</option>`).join("")}
              </select></label>` : ""}
            <div class="line__unit">${money(item.price)}</div>
            ${warn}
          </div>
          <div class="qty line__qty">
            <button type="button" data-action="dec" aria-label="Decrease"${status !== "ok" || item.qty <= 1 ? " disabled" : ""}>−</button>
            <span>${item.qty}</span>
            <button type="button" data-action="inc" aria-label="Increase"${status !== "ok" || item.qty >= maxQty ? " disabled" : ""}>+</button>
          </div>
          <div class="line__total">${status === "ok" ? money(item.price * item.qty) : "—"}</div>
          <button type="button" class="line__remove" data-action="remove" aria-label="Remove ${esc(item.name)}">×</button>
        </article>`;
    }).join("");

    rootEl.innerHTML = `
      <div class="cart__layout">
        <div class="cart__lines">${rows}</div>
        <aside class="summary">
          <h2>Order summary</h2>
          <div class="summary__row"><span>Items (${result.count})</span><span>${money(result.total)}</span></div>
          <div class="summary__row"><span>Delivery</span><span class="muted">Confirmed by phone</span></div>
          <div class="summary__row summary__total"><span>Total</span><span>${money(result.total)}</span></div>
          ${result.hasIssues ? '<p class="line__warn">Remove or fix the highlighted items to continue.</p>' : ""}
          <a class="btn btn--primary btn--block${result.hasIssues || !result.count ? " is-disabled" : ""}" href="checkout.html" ${result.hasIssues || !result.count ? 'aria-disabled="true" tabindex="-1"' : ""}>Proceed to checkout</a>
          <a class="btn btn--outline btn--block" href="shop.html">Continue shopping</a>
        </aside>
      </div>`;
    observeReveals(rootEl);
  }

  /* Event delegation for every control in the cart */
  const findItem = (el) => {
    const row = el.closest(".line");
    if (!row) return null;
    const cart = getCart();
    return { row, cart, item: cart.find((i) => cartKey(i) === row.dataset.key) };
  };

  rootEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.tagName === "SELECT") return;
    const found = findItem(btn);
    if (!found?.item) return;
    const { cart, item } = found;
    const product = products.get(item.productId);
    const action = btn.dataset.action;

    if (action === "remove") {
      saveCart(cart.filter((i) => i !== item));
    } else if (action === "inc") {
      const max = product ? sizeStock(product, item.size) : item.qty;
      if (item.qty < max) item.qty += 1;
      else toast(`Only ${max} available in this size`, "error");
      saveCart(cart);
    } else if (action === "dec") {
      if (item.qty > 1) item.qty -= 1;
      saveCart(cart);
    }
    render();
  });

  rootEl.addEventListener("change", (e) => {
    const select = e.target.closest('select[data-action="size"]');
    if (!select) return;
    const found = findItem(select);
    if (!found?.item) return;
    const { cart, item } = found;
    const product = products.get(item.productId);
    const newSize = select.value;
    const newStock = product ? sizeStock(product, newSize) : 0;
    if (newStock <= 0) {
      toast("That size is out of stock", "error");
      render();
      return;
    }
    const twin = cart.find((i) => i !== item && i.productId === item.productId && i.color === item.color && i.size === newSize);
    if (twin) {
      twin.qty = Math.min(twin.qty + item.qty, newStock);
      saveCart(cart.filter((i) => i !== item));
    } else {
      item.size = newSize;
      item.qty = Math.min(item.qty, newStock);
      saveCart(cart);
    }
    render();
  });

  render();
}

const rootEl = qs("#cart-root");
if (rootEl) initCartPage(rootEl);