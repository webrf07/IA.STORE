// IA STORE — admin: Dashboard (stats + inventory) and Products (add / edit / delete / hide / images).
// Everything here reads and writes the real Firestore / Storage data.

import { db, storage } from "./firebase.js";
import { requireAdmin, mountShell } from "./auth.js";
import {
  collection, doc, onSnapshot, updateDoc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";
import {
  CATEGORIES, CATEGORY_SIZE_PRESET, SIZE_PRESETS, CONFIG, esc, money, qs, qsa, toast,
  categoryLabel, sortSizes, debounce, safeHex,
} from "./common.js";
import { normalizeProduct, totalStock, sortedSizes } from "./products.js";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */
function stockState(p) {
  const total = totalStock(p);
  if (total === 0) return "out";
  if (total <= CONFIG.lowStockTotal) return "low";
  return "ok";
}

const STOCK_LABEL = { ok: "In stock", low: "Low stock", out: "Out of stock" };

const thumb = (p) =>
  p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="">` : '<div class="thumb thumb--ph">IA</div>';

function describeError(err) {
  if (err?.code === "permission-denied" || err?.code === "storage/unauthorized") {
    return "Permission denied. Publish firestore.rules / storage.rules and make sure your account is listed in the admins collection.";
  }
  return err?.message || "Something went wrong.";
}

function listenProducts(callback) {
  return onSnapshot(
    collection(db, "products"),
    (snap) => {
      const items = snap.docs.map((d) => normalizeProduct(d.id, d.data()));
      items.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
      callback(items);
    },
    (err) => toast(describeError(err), "error")
  );
}

/* ------------------------------------------------------------------ */
/* DASHBOARD                                                           */
/* ------------------------------------------------------------------ */
async function initDashboard() {
  const user = await requireAdmin();
  mountShell("dashboard", user, "Dashboard");

  let products = [];
  let orders = [];
  let filter = "all";
  let search = "";
  const drafts = {}; // unsaved stock edits: { productId: { size: value } }

  function renderStats() {
    const visible = products.filter((p) => p.visible).length;
    const low = products.filter((p) => stockState(p) === "low").length;
    const out = products.filter((p) => stockState(p) === "out").length;
    const pending = orders.filter((o) => o.status === "Pending").length;
    const revenue = orders.filter((o) => o.status === "Delivered").reduce((s, o) => s + (Number(o.total) || 0), 0);
    const cards = [
      ["Products", products.length, `${visible} visible in store`],
      ["Low stock", low, `${CONFIG.lowStockTotal} pieces or fewer`, low ? "warn" : ""],
      ["Out of stock", out, "Nothing left to sell", out ? "bad" : ""],
      ["New orders", pending, "Waiting for confirmation", pending ? "warn" : ""],
      ["All orders", orders.length, `Delivered revenue: ${money(revenue)}`],
    ];
    qs("#stats").innerHTML = cards
      .map(([label, value, note, tone]) => `
        <div class="stat${tone ? ` stat--${tone}` : ""}">
          <span class="stat__label">${label}</span>
          <strong class="stat__value">${value}</strong>
          <span class="stat__note">${note}</span>
        </div>`)
      .join("");
  }

  function renderInventory() {
    const list = qs("#inv-list");
    const needle = search.trim().toLowerCase();
    const shown = products.filter((p) => {
      if (filter !== "all" && stockState(p) !== filter) return false;
      if (needle && !`${p.name} ${categoryLabel(p.category)}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    qs("#cnt-low").textContent = products.filter((p) => stockState(p) === "low").length;
    qs("#cnt-out").textContent = products.filter((p) => stockState(p) === "out").length;

    if (!shown.length) {
      list.innerHTML = `<div class="empty">${products.length ? "No products match this view." : "No products yet. Add your first product from the Products page."}</div>`;
      return;
    }

    list.innerHTML = shown
      .map((p) => {
        const state = stockState(p);
        const sizes = sortedSizes(p);
        const draft = drafts[p.id] || {};
        const cells = sizes.length
          ? sizes
              .map((s) => {
                const value = draft[s] ?? p.stock[s];
                const n = Number(value) || 0;
                const cls = n === 0 ? "sz--out" : n <= CONFIG.lowStockSize ? "sz--low" : "";
                return `<label class="sz ${cls}"><span>${esc(s)}</span><input type="number" min="0" step="1" inputmode="numeric" data-size="${esc(s)}" value="${esc(value)}" aria-label="Stock for size ${esc(s)}"></label>`;
              })
              .join("")
          : '<span class="muted">No sizes — edit the product to add sizes.</span>';
        return `
          <div class="inv-row${drafts[p.id] ? " is-dirty" : ""}" data-id="${esc(p.id)}">
            <div class="inv-row__prod">${thumb(p)}<div><strong>${esc(p.name)}</strong><span class="muted">${esc(categoryLabel(p.category))}${p.visible ? "" : " · Hidden"}${p.status === "unavailable" ? " · Unavailable" : ""}</span></div></div>
            <span class="tag tag--${state}">${STOCK_LABEL[state]} · ${totalStock(p)}</span>
            <div class="inv-row__sizes">${cells}</div>
            <button type="button" class="btn btn--sm" data-save${sizes.length ? "" : " disabled"}>Save</button>
          </div>`;
      })
      .join("");
  }

  qs("#inv-list").addEventListener("input", (e) => {
    const input = e.target.closest("input[data-size]");
    if (!input) return;
    const row = input.closest(".inv-row");
    (drafts[row.dataset.id] ||= {})[input.dataset.size] = input.value;
    row.classList.add("is-dirty");
    const n = Number(input.value) || 0;
    const cell = input.closest(".sz");
    cell.classList.toggle("sz--out", n === 0);
    cell.classList.toggle("sz--low", n > 0 && n <= CONFIG.lowStockSize);
  });

  qs("#inv-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-save]");
    if (!btn) return;
    const row = btn.closest(".inv-row");
    const p = products.find((x) => x.id === row.dataset.id);
    if (!p) return;

    const stock = { ...p.stock };
    for (const input of qsa("input[data-size]", row)) {
      const raw = input.value.trim();
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        toast(`Enter a whole number (0 or more) for size ${input.dataset.size}`, "error");
        input.focus();
        return;
      }
      stock[input.dataset.size] = n;
    }
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "products", p.id), { stock, sizes: Object.keys(stock), updatedAt: serverTimestamp() });
      delete drafts[p.id];
      toast("Stock updated", "success");
    } catch (err) {
      toast(describeError(err), "error");
    } finally {
      btn.disabled = false;
    }
  });

  qs("#inv-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-filter]");
    if (!tab) return;
    filter = tab.dataset.filter;
    qsa("#inv-tabs .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    renderInventory();
  });
  qs("#inv-search").addEventListener("input", debounce((e) => {
    search = e.target.value;
    renderInventory();
  }, 150));

  // Do not wipe numbers the owner is typing when live data arrives
  let pendingRender = false;
  const safeRender = () => {
    if (document.activeElement?.closest?.("#inv-list") && document.activeElement.tagName === "INPUT") {
      pendingRender = true;
      return;
    }
    renderInventory();
  };
  qs("#inv-list").addEventListener("focusout", () => {
    if (pendingRender) {
      pendingRender = false;
      setTimeout(renderInventory, 0);
    }
  });

  listenProducts((items) => {
    products = items;
    renderStats();
    safeRender();
  });
  onSnapshot(collection(db, "orders"), (snap) => {
    orders = snap.docs.map((d) => d.data());
    renderStats();
  }, () => {});
}

/* ------------------------------------------------------------------ */
/* PRODUCTS                                                            */
/* ------------------------------------------------------------------ */
const MAX_IMAGES = 8;

/** Resize + re-encode to JPEG so uploads are fast on mobile and cheap to store. */
async function compressImage(file, maxSide = 1600, quality = 0.86) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Fallback for browsers where createImageBitmap can't decode the file
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`"${file.name}" is not a supported image (use JPG, PNG or WebP).`));
      };
      img.src = url;
    });
    bitmap.width = bitmap.naturalWidth;
    bitmap.height = bitmap.naturalHeight;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Could not process the image.");
  return blob;
}

/** Upload with visible progress and a timeout so the form never stays stuck silently. */
function uploadImageWithProgress(fileRef, blob, saveBtn, index, total) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, blob, { contentType: "image/jpeg" });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };
    const timeout = setTimeout(() => {
      task.cancel();
      finish(reject, new Error("Image upload timed out. Check your internet connection and Firebase Storage setup/rules, then try again."));
    }, 90000);
    task.on("state_changed", (snapshot) => {
      const percent = snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0;
      saveBtn.textContent = `Uploading image ${index} of ${total} (${percent}%)…`;
    }, (err) => {
      const messages = {
        "storage/unauthorized": "Firebase Storage denied the upload. Publish storage.rules and verify that your signed-in account has a document in admins/{your-user-uid}.",
        "storage/unauthenticated": "Your admin session has expired. Sign in again and retry.",
        "storage/retry-limit-exceeded": "Firebase Storage could not complete the upload after several retries. Check your connection.",
        "storage/canceled": "The image upload was canceled.",
        "storage/bucket-not-found": "The Firebase Storage bucket was not found. Check the Storage bucket value in firebase.js.",
        "storage/unknown": "Firebase Storage returned an unknown upload error. Check the browser console and Storage service status.",
      };
      finish(reject, new Error(messages[err.code] || `Image upload failed (${err.code || "unknown"}): ${err.message || "No details returned"}`));
    }, () => finish(resolve, task.snapshot));
  });
}

async function deleteStoredImages(urls) {
  await Promise.all(
    urls
      .filter((u) => u.includes("firebasestorage.googleapis.com") || u.includes("firebasestorage.app"))
      .map((u) => deleteObject(ref(storage, u)).catch(() => {}))
  );
}

async function initProducts() {
  const user = await requireAdmin();
  mountShell("products", user, "Products");

  let products = [];
  let search = "";
  let catFilter = "";

  // Form state
  let editing = null; // product being edited, or null for a new one
  let imgs = []; // [{ url } | { file, preview }]
  let colors = []; // [{ name, hex }]
  let stock = {}; // { size: qty }
  let sizeType = "clothing"; // clothing | shoes

  const modal = qs("#modal");
  const form = qs("#product-form");
  const formError = qs("#form-error");

  qs("#f-category").innerHTML =
    '<option value="">Select category…</option>' + CATEGORIES.map((c) => `<option value="${c.slug}">${c.label}</option>`).join("");
  qs("#p-cat").innerHTML =
    '<option value="">All categories</option>' + CATEGORIES.map((c) => `<option value="${c.slug}">${c.label}</option>`).join("");

  /* ---- list ---- */
  function renderList() {
    const needle = search.trim().toLowerCase();
    const shown = products.filter((p) => {
      if (catFilter && p.category !== catFilter) return false;
      if (needle && !`${p.name} ${categoryLabel(p.category)}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    qs("#p-count").textContent = `${shown.length} of ${products.length}`;
    const list = qs("#plist");
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${products.length ? "No products match your search." : "No products yet. Click “Add Product” to create your first one."}</div>`;
      return;
    }
    list.innerHTML = shown
      .map((p) => {
        const state = stockState(p);
        const flags = [
          !p.visible && '<span class="tag tag--muted">Hidden</span>',
          p.status === "unavailable" && '<span class="tag tag--out">Unavailable</span>',
          p.isNew && '<span class="tag tag--navy">New</span>',
          p.isBestSeller && '<span class="tag tag--navy">Best seller</span>',
        ].filter(Boolean).join("");
        return `
          <article class="prow${p.visible ? "" : " is-hidden"}" data-id="${esc(p.id)}">
            <div class="prow__main">${thumb(p)}
              <div>
                <strong>${esc(p.name)}</strong>
                <span class="muted">${esc(categoryLabel(p.category))} · ${sortedSizes(p).join(", ") || "no sizes"}</span>
                <div class="prow__flags">${flags}</div>
              </div>
            </div>
            <div class="prow__price">${money(p.price)}${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ""}</div>
            <div><span class="tag tag--${state}">${STOCK_LABEL[state]} · ${totalStock(p)}</span></div>
            <div class="prow__actions">
              <button type="button" class="btn btn--outline btn--sm" data-act="edit">Edit</button>
              <button type="button" class="btn btn--outline btn--sm" data-act="visible">${p.visible ? "Hide" : "Show"}</button>
              <button type="button" class="btn btn--outline btn--sm" data-act="status">${p.status === "available" ? "Mark unavailable" : "Mark available"}</button>
              <button type="button" class="btn btn--danger btn--sm" data-act="delete">Delete</button>
            </div>
          </article>`;
      })
      .join("");
  }

  qs("#plist").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const p = products.find((x) => x.id === btn.closest(".prow").dataset.id);
    if (!p) return;

    try {
      if (btn.dataset.act === "edit") {
        openModal(p);
      } else if (btn.dataset.act === "visible") {
        await updateDoc(doc(db, "products", p.id), { visible: !p.visible, updatedAt: serverTimestamp() });
        toast(p.visible ? "Product hidden from the store" : "Product is now visible", "success");
      } else if (btn.dataset.act === "status") {
        await updateDoc(doc(db, "products", p.id), {
          status: p.status === "available" ? "unavailable" : "available",
          updatedAt: serverTimestamp(),
        });
        toast("Status updated", "success");
      } else if (btn.dataset.act === "delete") {
        if (!confirm(`Delete “${p.name}” permanently?\nIt will disappear from the store. This cannot be undone.`)) return;
        await deleteDoc(doc(db, "products", p.id));
        deleteStoredImages(p.images);
        toast("Product deleted", "success");
      }
    } catch (err) {
      toast(describeError(err), "error");
    }
  });

  qs("#p-search").addEventListener("input", debounce((e) => { search = e.target.value; renderList(); }, 150));
  qs("#p-cat").addEventListener("change", (e) => { catFilter = e.target.value; renderList(); });

  /* ---- modal pieces ---- */
  function renderColors() {
    qs("#c-list").innerHTML = colors.length
      ? colors.map((c, i) => `<span class="tag-chip"><i style="background:${safeHex(c.hex)}"></i><code>${esc(c.hex)}</code><button type="button" data-rm-color="${i}" aria-label="Remove color ${esc(c.hex)}">×</button></span>`).join("")
      : '<span class="muted">No colors added.</span>';
    qs("#c-add").disabled = colors.length >= 10;
    qs("#c-hex").disabled = colors.length >= 10;
    qs("#color-limit").textContent = `${colors.length}/10 colors`;
  }

  function renderSizes() {
    const presets = sizeType === "shoes" ? SIZE_PRESETS.shoes : SIZE_PRESETS.letters;
    qs("#sz-list").innerHTML = presets.map((s) => {
      const selected = Object.prototype.hasOwnProperty.call(stock, s);
      return `
        <label class="size-choice ${selected ? "is-selected" : ""}">
          <input type="checkbox" data-size-toggle="${esc(s)}" ${selected ? "checked" : ""}>
          <b>${esc(s)}</b>
          ${selected ? `<input class="size-qty" type="number" min="0" step="1" inputmode="numeric" value="${esc(stock[s])}" data-size="${esc(s)}" aria-label="Stock for size ${esc(s)}">` : ""}
        </label>`;
    }).join("");
  }

  function renderImages() {
    qs("#img-list").innerHTML = imgs.length
      ? imgs.map((im, i) => `
          <div class="img-tile">
            <img src="${esc(im.url || im.preview)}" alt="">
            ${i === 0 ? '<span class="img-tile__main">Main</span>' : `<button type="button" class="img-tile__make" data-main="${i}">Make main</button>`}
            <button type="button" class="img-tile__rm" data-rm-img="${i}" aria-label="Remove image">×</button>
          </div>`).join("")
      : '<span class="muted">No images yet.</span>';
  }

  qs("#c-add").addEventListener("click", () => {
    if (colors.length >= 10) { toast("Maximum 10 colors per product", "error"); return; }
    const hex = qs("#c-hex").value.toUpperCase();
    if (colors.some((c) => c.hex.toUpperCase() === hex)) { toast("That color is already added", "error"); return; }
    colors.push({ name: hex, hex });
    renderColors();
  });
  qs("#c-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm-color]");
    if (!b) return;
    colors.splice(Number(b.dataset.rmColor), 1);
    renderColors();
  });

  qs("#sz-type").addEventListener("change", () => {
    const nextType = qs("#sz-type").value;
    if (nextType === sizeType) return;
    if (Object.keys(stock).length && !confirm("Changing the size system will clear the current size quantities. Continue?")) {
      qs("#sz-type").value = sizeType;
      return;
    }
    stock = {};
    sizeType = nextType;
    renderSizes();
  });
  qs("#sz-list").addEventListener("change", (e) => {
    const toggle = e.target.closest("input[data-size-toggle]");
    if (!toggle) return;
    const size = toggle.dataset.sizeToggle;
    if (toggle.checked) stock[size] = 0;
    else delete stock[size];
    renderSizes();
  });
  qs("#sz-list").addEventListener("input", (e) => {
    const input = e.target.closest("input[data-size]");
    if (input) stock[input.dataset.size] = input.value;
  });

  qs("#f-files").addEventListener("change", (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith("image/"));
    for (const file of files) {
      if (imgs.length >= MAX_IMAGES) {
        toast(`Maximum ${MAX_IMAGES} images per product`, "error");
        break;
      }
      imgs.push({ file, preview: URL.createObjectURL(file) });
    }
    e.target.value = "";
    renderImages();
  });
  qs("#img-list").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-img]");
    const main = e.target.closest("[data-main]");
    if (rm) {
      const [removed] = imgs.splice(Number(rm.dataset.rmImg), 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
    } else if (main) {
      const [moved] = imgs.splice(Number(main.dataset.main), 1);
      imgs.unshift(moved);
    } else return;
    renderImages();
  });

  /* ---- open / close ---- */
  function openModal(product = null) {
    editing = product;
    formError.textContent = "";
    form.reset();
    qs("#modal-title").textContent = product ? "Edit Product" : "Add Product";
    qs("#save-btn").textContent = product ? "Save changes" : "Add product";

    imgs = product ? product.images.map((url) => ({ url })) : [];
    colors = product ? product.colors.map((c) => ({ ...c })) : [];
    stock = product ? { ...product.stock } : {};
    const existingSizes = Object.keys(stock);
    sizeType = existingSizes.length && existingSizes.every((s) => ["39", "40", "41", "42", "43", "44"].includes(s)) ? "shoes" : "clothing";
    qs("#sz-type").value = sizeType;

    qs("#f-name").value = product?.name || "";
    qs("#f-category").value = product?.category || "";
    qs("#f-status").value = product?.status || "available";
    qs("#f-price").value = product ? product.price : "";
    qs("#f-old").value = product?.oldPrice || "";
    qs("#f-desc").value = product?.description || "";
    qs("#f-new").checked = product ? product.isNew : true;
    qs("#f-best").checked = product ? product.isBestSeller : false;
    qs("#f-visible").checked = product ? product.visible : true;

    renderColors();
    renderSizes();
    renderImages();
    modal.hidden = false;
    document.body.classList.add("no-scroll");
    qs("#modal-body").scrollTop = 0;
    qs("#f-name").focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("no-scroll");
    imgs.forEach((im) => im.preview && URL.revokeObjectURL(im.preview));
    imgs = [];
  }

  qs("#add-btn").addEventListener("click", () => openModal(null));
  qs("#modal-close").addEventListener("click", closeModal);
  qs("#cancel-btn").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden && !qs("#save-btn").disabled) closeModal();
  });

  /* ---- save ---- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.textContent = "";

    const name = qs("#f-name").value.trim();
    const category = qs("#f-category").value;
    const price = Number(qs("#f-price").value);
    const oldRaw = qs("#f-old").value.trim();
    const oldPrice = oldRaw === "" ? null : Number(oldRaw);

    if (name.length < 2) return fail("Please enter the product name.");
    if (!category) return fail("Please choose a category.");
    if (!(price > 0)) return fail("Please enter a valid price.");
    if (oldPrice !== null && !(oldPrice > price)) return fail("The old price must be higher than the current price (or leave it empty).");
    if (!imgs.length) return fail("Add at least one image.");

    const cleanStock = {};
    for (const [size, raw] of Object.entries(stock)) {
      const n = Number(raw);
      if (String(raw).trim() === "" || !Number.isInteger(n) || n < 0) return fail(`Stock for size ${size} must be a whole number (0 or more).`);
      cleanStock[size] = n;
    }
    if (!Object.keys(cleanStock).length) return fail("Add at least one size with its stock quantity.");

    const saveBtn = qs("#save-btn");
    saveBtn.disabled = true;
    try {
      const docRef = editing ? doc(db, "products", editing.id) : doc(collection(db, "products"));

      // Upload new images (kept in the order chosen by the owner)
      const urls = [];
      for (let i = 0; i < imgs.length; i++) {
        const im = imgs[i];
        if (im.url) {
          urls.push(im.url);
          continue;
        }
        saveBtn.textContent = `Preparing image ${i + 1} of ${imgs.length}…`;
        const blob = await compressImage(im.file);
        if (blob.size >= 6 * 1024 * 1024) throw new Error("The compressed image is still 6 MB or larger. Choose a smaller image.");
        const fileRef = ref(storage, `products/${docRef.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
        await uploadImageWithProgress(fileRef, blob, saveBtn, i + 1, imgs.length);
        saveBtn.textContent = `Getting image link ${i + 1} of ${imgs.length}…`;
        urls.push(await getDownloadURL(fileRef));
      }

      saveBtn.textContent = "Saving…";
      const data = {
        name,
        category,
        price,
        oldPrice,
        description: qs("#f-desc").value.trim(),
        images: urls,
        colors,
        stock: cleanStock,
        sizes: Object.keys(cleanStock),
        status: qs("#f-status").value,
        visible: qs("#f-visible").checked,
        isNew: qs("#f-new").checked,
        isBestSeller: qs("#f-best").checked,
        updatedAt: serverTimestamp(),
      };

      if (editing) {
        await updateDoc(docRef, data);
        const removed = editing.images.filter((u) => !urls.includes(u));
        if (removed.length) deleteStoredImages(removed);
      } else {
        await setDoc(docRef, { ...data, salesCount: 0, createdAt: serverTimestamp() });
      }
      toast(editing ? "Product updated" : "Product added", "success");
      closeModal();
    } catch (err) {
      console.error(err);
      fail(describeError(err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = editing ? "Save changes" : "Add product";
    }
  });

  function fail(message) {
    formError.textContent = message;
    qs("#modal-body").scrollTo({ top: qs("#modal-body").scrollHeight, behavior: "smooth" });
  }

  listenProducts((items) => {
    products = items;
    renderList();
  });
}

/* ------------------------------------------------------------------ */
const page = document.body.dataset.page;
if (page === "dashboard") initDashboard();
else if (page === "products") initProducts();