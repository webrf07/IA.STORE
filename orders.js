// IA STORE — admin orders: live list, details, status changes (with automatic stock handling).

import { db } from "./firebase.js";
import { requireAdmin, mountShell } from "./auth.js";
import {
  collection, doc, query, orderBy, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ORDER_STATUSES, esc, money, qs, qsa, toast, formatDate, debounce,
} from "./common.js";

/**
 * Changes an order's status in one atomic transaction.
 *
 * Stock rules (the public site cannot change stock, so it happens here):
 *  - Pending / Cancelled  → Confirmed / Shipped / Delivered : stock is deducted ONCE
 *    (fails with a clear message if there is not enough stock) and salesCount goes up.
 *  - Confirmed / Shipped / Delivered → Cancelled / Pending : stock is restored ONCE.
 *  - Moving between Confirmed, Shipped and Delivered never touches stock again.
 */
async function changeStatus(orderId, nextStatus) {
  const orderRef = doc(db, "orders", orderId);
  await runTransaction(db, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error("This order no longer exists.");
    const order = orderSnap.data();

    const shouldBeDeducted = nextStatus !== "Pending" && nextStatus !== "Cancelled";
    const isDeducted = !!order.stockDeducted;
    const sign = shouldBeDeducted && !isDeducted ? -1 : !shouldBeDeducted && isDeducted ? 1 : 0;

    if (sign !== 0) {
      // Group the order lines by product so each product document is read/written once.
      const byProduct = new Map();
      for (const item of order.items || []) {
        if (!byProduct.has(item.productId)) byProduct.set(item.productId, []);
        byProduct.get(item.productId).push(item);
      }
      const ids = [...byProduct.keys()];

      // All reads first…
      const snaps = await Promise.all(ids.map((pid) => tx.get(doc(db, "products", pid))));

      // …then compute and write.
      const updates = [];
      snaps.forEach((snap, idx) => {
        if (!snap.exists()) return; // product was deleted — nothing to adjust
        const product = snap.data();
        const stock = { ...(product.stock || {}) };
        let pieces = 0;
        for (const item of byProduct.get(ids[idx])) {
          const current = Number(stock[item.size]) || 0;
          if (sign < 0 && current < item.qty) {
            throw new Error(`Not enough stock for “${item.name}” (size ${item.size}): ${current} left, ${item.qty} ordered.`);
          }
          stock[item.size] = current + sign * item.qty;
          pieces += item.qty;
        }
        updates.push([
          snap.ref,
          {
            stock,
            sizes: Object.keys(stock),
            salesCount: Math.max(0, (Number(product.salesCount) || 0) - sign * pieces),
            updatedAt: serverTimestamp(),
          },
        ]);
      });
      updates.forEach(([ref, data]) => tx.update(ref, data));
    }

    tx.update(orderRef, {
      status: nextStatus,
      stockDeducted: sign < 0 ? true : sign > 0 ? false : isDeducted,
      updatedAt: serverTimestamp(),
    });
  });
}

async function initOrders() {
  const user = await requireAdmin();
  mountShell("orders", user, "Orders");

  let orders = [];
  let filter = "all";
  let search = "";
  let openId = null;

  const statusSelect = (order, extraClass = "") => `
    <select class="status-select st-${order.status.toLowerCase()} ${extraClass}" data-status data-id="${esc(order.id)}" aria-label="Order status">
      ${ORDER_STATUSES.map((s) => `<option value="${s}"${s === order.status ? " selected" : ""}>${s}</option>`).join("")}
    </select>`;

  function renderTabs() {
    const counts = { all: orders.length };
    ORDER_STATUSES.forEach((s) => (counts[s] = orders.filter((o) => o.status === s).length));
    qs("#order-tabs").innerHTML = ["all", ...ORDER_STATUSES]
      .map((s) => `<button type="button" class="tab${filter === s ? " is-active" : ""}" data-filter="${s}">${s === "all" ? "All" : s} <b>${counts[s]}</b></button>`)
      .join("");
  }

  function renderList() {
    const needle = search.trim().toLowerCase();
    const shown = orders.filter((o) => {
      if (filter !== "all" && o.status !== filter) return false;
      if (!needle) return true;
      return `${o.orderNumber} ${o.customer?.name} ${o.customer?.phone} ${o.customer?.wilaya}`.toLowerCase().includes(needle);
    });
    const list = qs("#orders-list");
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${orders.length ? "No orders match this view." : "No orders yet. They will appear here the moment a customer checks out."}</div>`;
      return;
    }
    list.innerHTML = shown
      .map((o) => `
        <article class="orow${o.status === "Pending" ? " is-new" : ""}" data-id="${esc(o.id)}">
          <div class="orow__num"><strong>${esc(o.orderNumber)}</strong><span class="muted">${formatDate(o.createdAt)}</span></div>
          <div class="orow__cust"><strong>${esc(o.customer?.name)}</strong><span class="muted">${esc(o.customer?.phone)} · ${esc(o.customer?.wilaya)}</span></div>
          <div class="orow__items muted">${(o.items || []).reduce((s, i) => s + i.qty, 0)} item(s)</div>
          <div class="orow__total">${money(o.total)}</div>
          <div>${statusSelect(o)}</div>
          <button type="button" class="btn btn--outline btn--sm" data-open>Details</button>
        </article>`)
      .join("");
  }

  function renderModal() {
    const o = orders.find((x) => x.id === openId);
    if (!o) {
      qs("#order-modal").hidden = true;
      return;
    }
    const c = o.customer || {};
    qs("#om-title").textContent = `Order ${o.orderNumber}`;
    qs("#om-body").innerHTML = `
      <div class="om-top">
        <div><span class="muted">Placed</span><strong>${formatDate(o.createdAt)}</strong></div>
        <div><span class="muted">Status</span>${statusSelect(o)}</div>
        <div><span class="muted">Stock</span><strong>${o.stockDeducted ? "Deducted" : "Not deducted yet"}</strong></div>
      </div>

      <h3>Customer</h3>
      <dl class="kv">
        <dt>Name</dt><dd>${esc(c.name)}</dd>
        <dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>
        <dt>Wilaya / City</dt><dd>${esc(c.wilaya)}</dd>
        <dt>Address</dt><dd>${esc(c.address)}</dd>
        <dt>Notes</dt><dd>${c.notes ? esc(c.notes).replace(/\n/g, "<br>") : '<span class="muted">—</span>'}</dd>
      </dl>

      <h3>Items</h3>
      <ul class="om-items">
        ${(o.items || []).map((i) => `
          <li>
            ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="">` : '<div class="thumb thumb--ph">IA</div>'}
            <div><strong>${esc(i.name)}</strong>
              <span class="muted">${[i.color && `Color: ${esc(i.color)}`, i.size && `Size: ${esc(i.size)}`].filter(Boolean).join(" · ")}</span>
              <span class="muted">${money(i.price)} × ${i.qty}</span></div>
            <b>${money(i.price * i.qty)}</b>
          </li>`).join("")}
      </ul>
      <div class="om-total"><span>Total</span><strong>${money(o.total)}</strong></div>`;
    qs("#order-modal").hidden = false;
  }

  /* Status changes (list + modal share one handler) */
  document.addEventListener("change", async (e) => {
    const select = e.target.closest("select[data-status]");
    if (!select) return;
    const order = orders.find((o) => o.id === select.dataset.id);
    if (!order || select.value === order.status) return;
    const next = select.value;
    select.disabled = true;
    try {
      await changeStatus(order.id, next);
      toast(`Order ${order.orderNumber} → ${next}`, "success");
    } catch (err) {
      console.error(err);
      toast(err.code === "permission-denied" ? "Permission denied — check your Firestore rules." : err.message, "error");
      select.value = order.status; // revert
    } finally {
      select.disabled = false;
    }
  });

  qs("#orders-list").addEventListener("click", (e) => {
    if (e.target.closest("select")) return;
    const row = e.target.closest(".orow");
    if (!row || !(e.target.closest("[data-open]") || e.target.closest(".orow__num") || e.target.closest(".orow__cust"))) return;
    openId = row.dataset.id;
    renderModal();
    document.body.classList.add("no-scroll");
  });
  const closeModal = () => {
    openId = null;
    qs("#order-modal").hidden = true;
    document.body.classList.remove("no-scroll");
  };
  qs("#om-close").addEventListener("click", closeModal);
  qs("#order-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openId) closeModal();
  });

  qs("#order-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-filter]");
    if (!tab) return;
    filter = tab.dataset.filter;
    renderTabs();
    renderList();
  });
  qs("#order-search").addEventListener("input", debounce((e) => {
    search = e.target.value;
    renderList();
  }, 150));

  onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTabs();
      renderList();
      if (openId) renderModal();
    },
    (err) => {
      console.error(err);
      qs("#orders-list").innerHTML = `<div class="empty">Couldn't load orders (${esc(err.code || err.message)}). Check that your account is in the admins collection and that firestore.rules are published.</div>`;
    }
  );
}

initOrders();