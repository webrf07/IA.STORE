// IA STORE — admin authentication, access guard and the shared admin shell (sidebar / top bar).
// Used by admin/login.html (login form) and by every other admin page (requireAdmin + mountShell).

import { auth, db, isConfigured } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { esc, qs } from "./common.js";

/** A user is an admin only if admins/{uid} exists in Firestore (created manually in the console). */
async function isAdminUser(user) {
  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

/** Resolves with the signed-in admin, or redirects to the login page. */
export function requireAdmin() {
  return new Promise((resolve) => {
    if (!isConfigured) {
      location.replace("login.html");
      return;
    }
    const stop = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        stop();
        location.replace("login.html");
        return;
      }
      if (!(await isAdminUser(user))) {
        stop();
        await signOut(auth);
        location.replace("login.html?denied=1");
        return;
      }
      stop();
      resolve(user);
    });
  });
}

export async function logout() {
  await signOut(auth);
  location.replace("login.html");
}

const NAV = [
  { key: "dashboard", href: "dashboard.html", label: "Dashboard", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
  { key: "products", href: "products.html", label: "Products", icon: "M20 7l-8-4-8 4v10l8 4 8-4V7zM4 7l8 4m0 0l8-4m-8 4v10" },
  { key: "orders", href: "orders.html", label: "Orders", icon: "M6 2l-2 4v14a2 2 0 002 2h12a2 2 0 002-2V6l-2-4H6zM4 6h16M16 10a4 4 0 01-8 0" },
];

/** Renders the sidebar + top bar and wires the mobile menu, live "pending orders" badge and logout. */
export function mountShell(active, user, title) {
  const side = qs("#admin-sidebar");
  const top = qs("#admin-top");

  side.innerHTML = `
    <div class="sidebar__brand">IA STORE <small>Admin</small></div>
    <nav class="sidebar__nav" aria-label="Admin">
      ${NAV.map((n) => `
        <a href="${n.href}" class="${n.key === active ? "is-active" : ""}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${n.icon}"/></svg>
          <span>${n.label}</span>
          ${n.key === "orders" ? '<b class="pill" id="pending-badge" hidden>0</b>' : ""}
        </a>`).join("")}
      <a href="../index.html" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7"/></svg>
        <span>View store</span>
      </a>
    </nav>
    <div class="sidebar__foot">
      <div class="sidebar__user" title="${esc(user.email)}">${esc(user.email)}</div>
      <button type="button" class="btn btn--light btn--sm btn--block" id="logout-btn">Log out</button>
    </div>`;

  top.innerHTML = `
    <button type="button" class="admin-burger" id="admin-burger" aria-label="Open menu"><span></span><span></span><span></span></button>
    <h1 class="admin-top__title">${esc(title)}</h1>`;

  const layout = qs(".admin-layout");
  const setOpen = (open) => layout.classList.toggle("is-menu-open", open);
  qs("#admin-burger").addEventListener("click", () => setOpen(!layout.classList.contains("is-menu-open")));
  qs("#admin-backdrop")?.addEventListener("click", () => setOpen(false));
  qs("#logout-btn").addEventListener("click", logout);

  // Live count of new (Pending) orders
  onSnapshot(
    query(collection(db, "orders"), where("status", "==", "Pending")),
    (snap) => {
      const badge = qs("#pending-badge");
      if (!badge) return;
      badge.textContent = snap.size;
      badge.hidden = snap.size === 0;
    },
    () => {}
  );
}

/* ------------------------------------------------------------------ */
/* Login page                                                          */
/* ------------------------------------------------------------------ */
function initLogin() {
  const form = qs("#login-form");
  const errorBox = qs("#login-error");
  const submit = qs("#login-submit");

  if (!isConfigured) {
    errorBox.textContent = "Firebase is not configured yet. Edit js/firebase.js first.";
    submit.disabled = true;
    return;
  }
  if (new URLSearchParams(location.search).get("denied") === "1") {
    errorBox.textContent = "This account is not authorised to access the admin panel.";
  }

  // Already signed in as admin → go straight to the dashboard
  const stop = onAuthStateChanged(auth, async (user) => {
    stop();
    if (user && (await isAdminUser(user))) location.replace("dashboard.html");
  });

  const messages = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "Incorrect email or password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.textContent = "";
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      const cred = await signInWithEmailAndPassword(auth, qs("#email").value.trim(), qs("#password").value);
      if (!(await isAdminUser(cred.user))) {
        await signOut(auth);
        errorBox.textContent = "This account is not authorised to access the admin panel.";
        return;
      }
      location.replace("dashboard.html");
    } catch (err) {
      errorBox.textContent = messages[err.code] || `Sign-in failed (${err.code || "unknown error"}).`;
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });

  qs("#reset-btn").addEventListener("click", async () => {
    const email = qs("#email").value.trim();
    if (!email) {
      errorBox.textContent = "Enter your email above, then click “Forgot password?”.";
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      errorBox.style.color = "var(--ok)";
      errorBox.textContent = "If this email has an account, a reset link has been sent.";
    } catch (err) {
      errorBox.style.color = "";
      errorBox.textContent = messages[err.code] || "Couldn't send the reset email.";
    }
  });
}

if (document.body.dataset.page === "login") initLogin();