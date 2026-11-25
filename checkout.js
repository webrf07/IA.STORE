// IA STORE — checkout page: validates the cart against live stock and saves the order in Firestore.

import { db } from "./firebase.js";
import {
  collection, addDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { reconcileCart } from "./cart.js";
import {
  WILAYAS, esc, money, qs, toast, initPage, saveCart,
} from "./common.js";

initPage();

const form = qs("#checkout-form");
const summary = qs("#summary");
const emptyBox = qs("#checkout-empty");
const successBox = qs("#success");
const submitBtn = qs("#place-order");
const errorBox = qs("#form-error");

qs("#wilaya-list").innerHTML = WILAYAS.map((w) => `<option value="${esc(w)}"></option>`).join("");

function showEmpty(message) {
  form.hidden = true;
  summary.hidden = true;
  emptyBox.hidden = false;
  if (message) qs("#checkout-empty-text").textContent = message;
}

function renderSummary(result) {
  const rows = result.lines
    .map(({ item, status }) => `
      <li class="sum-item${status !== "ok" ? " is-bad" : ""}">
        <div class="sum-item__img">${item.image ? `<img src="${esc(item.image)}" alt="">` : '<div class="ph">IA</div>'}<span>${item.qty}</span></div>
        <div class="sum-item__info">
          <strong>${esc(item.name)}</strong>
          <small>${[item.color && `Color: ${esc(item.color)}`, item.size && `Size: ${esc(item.size)}`].filter(Boolean).join(" · ")}</small>
          ${status !== "ok" ? '<small class="line__warn">Unavailable — please update your cart</small>' : ""}
        </div>
        <div class="sum-item__price">${status === "ok" ? money(item.price * item.qty) : "—"}</div>
      </li>`)
    .join("");
  qs("#sum-items").innerHTML = rows;
  qs("#sum-subtotal").textContent = money(result.total);
  qs("#sum-total").textContent = money(result.total);
}

let current;
async function init() {
  try {
    current = await reconcileCart();
  } catch (err) {
    showEmpty(err?.message === "NOT_CONFIGURED" ? "Connect Firebase in js/firebase.js first." : "We couldn't verify your cart. Please try again.");
    return;
  }
  if (!current.lines.length) return showEmpty();
  renderSummary(current);
  if (current.hasIssues) {
    errorBox.innerHTML = 'Some items are no longer available. <a href="cart.html">Update your cart</a> to continue.';
    submitBtn.disabled = true;
  }
}

function makeOrderNumber() {
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `IA-${Date.now().toString(36).toUpperCase().slice(-6)}${rand}`;
}

function validate(data) {
  if (data.name.length < 3) return "Please enter your full name.";
  if (!/^[0-9+()\s-]{8,20}$/.test(data.phone)) return "Please enter a valid phone number.";
  if (data.wilaya.length < 2) return "Please enter your wilaya / city.";
  if (data.address.length < 5) return "Please enter your full address.";
  return "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";

  const data = {
    name: qs("#c-name").value.trim(),
    phone: qs("#c-phone").value.trim(),
    wilaya: qs("#c-wilaya").value.trim(),
    address: qs("#c-address").value.trim(),
    notes: qs("#c-notes").value.trim(),
  };
  const problem = validate(data);
  if (problem) {
    errorBox.textContent = problem;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Placing your order…";

  try {
    // Re-check stock and prices right before saving.
    const fresh = await reconcileCart();
    if (!fresh.lines.length) return showEmpty();
    if (fresh.hasIssues) {
      renderSummary(fresh);
      errorBox.innerHTML = 'Some items are no longer available. <a href="cart.html">Update your cart</a> to continue.';
      submitBtn.textContent = "Place order";
      return;
    }

    const orderNumber = makeOrderNumber();
    await addDoc(collection(db, "orders"), {
      orderNumber,
      customer: data,
      items: fresh.lines.map(({ item }) => ({
        productId: item.productId,
        name: item.name,
        image: item.image || "",
        price: item.price,
        size: item.size || "",
        color: item.color || "",
        qty: item.qty,
      })),
      total: fresh.total,
      status: "Pending",
      stockDeducted: false,
      createdAt: serverTimestamp(),
    });

    saveCart([]);
    form.hidden = true;
    summary.hidden = true;
    qs("#order-number").textContent = orderNumber;
    successBox.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error(err);
    toast("We couldn't place your order. Please try again.", "error");
    errorBox.textContent = "Something went wrong while saving your order. Please try again in a moment.";
    submitBtn.textContent = "Place order";
  } finally {
    if (!successBox.hidden) return;
    submitBtn.disabled = current?.hasIssues ?? false;
    if (!submitBtn.disabled) submitBtn.textContent = "Place order";
  }
});

init();