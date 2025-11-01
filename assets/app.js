
(() => {
  const PAGE_SIZE = 20;

  const $ = s => document.querySelector(s);

  const state = { page: 1 };

  const nowYear = new Date().getFullYear();
  $("#y").textContent = nowYear;

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts)/1000);
    if (s < 60) return `${s} sn önce`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m} dk önce`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h} sa önce`;
    const d = Math.floor(h/24);
    if (d < 7) return `${d} gün önce`;
    const dt = new Date(ts);
    return dt.toLocaleString("tr-TR");
  }

  function currentPageFromHash() {
    const m = location.hash.match(/page=(\d+)/);
    return m ? Math.max(1, parseInt(m[1],10)) : 1;
  }

  async function fetchJSON(url, opts={}) {
    const res = await fetch(url, { headers: {"Content-Type":"application/json"}, ...opts });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadPage(p=1) {
    const data = await fetchJSON(`/.netlify/functions/api?op=list&page=${p}&size=${PAGE_SIZE}`);
    const feed = $("#feed");
    feed.innerHTML = "";

    $("#pageInfo").textContent = `Sayfa ${data.page}/${data.pages} • Toplam ${data.total} içerik`;
    $("#prevBtn").disabled = data.page <= 1;
    $("#nextBtn").disabled = data.page >= data.pages;

    if (!data.items.length) {
      const empty = document.createElement("div");
      empty.className = "post";
      empty.innerHTML = "<p>Henüz içerik yok. İlk uyuzluğu sen yaz.</p>";
      feed.appendChild(empty);
      return;
    }

    data.items.forEach(item => {
      const card = document.createElement("article");
      card.className = "post";

      const text = document.createElement("p");
      text.textContent = item.text;
      card.appendChild(text);

      if (item.hidden) {
        const hidden = document.createElement("div");
        hidden.className = "hiddenNote";
        hidden.textContent = `Bu içerik 10+ şikayet nedeniyle gizlendi.`;
        card.appendChild(hidden);
      } else {
        const meta = document.createElement("div");
        meta.className = "meta";

        const time = document.createElement("span");
        time.textContent = timeAgo(item.ts);
        meta.appendChild(time);

        const starBadge = document.createElement("span");
        starBadge.className = "badge star";
        starBadge.textContent = `⭐ ${item.stars || 0}`;
        meta.appendChild(starBadge);

        const repBadge = document.createElement("span");
        repBadge.className = "badge rep";
        repBadge.textContent = `${item.reports || 0} şikayet`;
        meta.appendChild(repBadge);

        const spacer = document.createElement("div");
        spacer.className = "spacer";
        meta.appendChild(spacer);

        const starBtn = document.createElement("button");
        starBtn.className = "btn star";
        starBtn.textContent = "⭐";
        starBtn.title = "Beğen";
        starBtn.addEventListener("click", async () => {
          await fetchJSON(`/.netlify/functions/api?op=star`, { method:"POST", body: JSON.stringify({ id: item.id }) });
          await loadPage(state.page);
          await loadHighlights();
        });
        meta.appendChild(starBtn);

        const btn = document.createElement("button");
        btn.className = "btn report";
        btn.textContent = "Şikayet et";
        btn.addEventListener("click", async () => {
          await fetchJSON(`/.netlify/functions/api?op=report`, { method:"POST", body: JSON.stringify({ id: item.id }) });
          await loadPage(state.page);
        });
        meta.appendChild(btn);

        card.appendChild(meta);
      }

      $("#feed").appendChild(card);
    });
  }

  async function submitHandler(e) {
    e.preventDefault();
    $("#formError").hidden = true;
    $("#formOK").hidden = true;
    const text = ($("#content").value || "").trim();
    if (text.length < 8) {
      return showErr("Biraz daha detay yaz (en az 8 karakter).");
    }
    const consent = $("#consentBox").checked;
    try {
      await fetchJSON("/.netlify/functions/api?op=create", {
        method: "POST",
        body: JSON.stringify({ text, consent })
      });
      $("#content").value = "";
      $("#formOK").hidden = false;
      $("#consentBox").checked = false;
      location.hash = "#page=1";
      await loadPage(1);
      await loadHighlights();
    } catch (err) {
      showErr(err.message.replace(/["{}]/g,""));
    }
  }

  function showErr(msg) {
    const el = $("#formError");
    el.textContent = msg;
    el.hidden = false;
  }

  async function loadHighlights() {
    const data = await fetchJSON("/.netlify/functions/api?op=highlights&days=7&limit=5");
    const box = $("#highlights");
    box.innerHTML = "";
    if (!data.items.length) {
      box.innerHTML = `<p class="tiny">Bu hafta henüz öne çıkan içerik yok.</p>`;
      return;
    }
    data.items.forEach(item => {
      const card = document.createElement("div");
      card.className = "post";
      card.innerHTML = `<p>${item.text}</p><div class="meta"><span>${new Date(item.ts).toLocaleString("tr-TR")}</span><span class="spacer"></span><span class="badge star">⭐ ${item.stars||0}</span></div>`;
      box.appendChild(card);
    });
  }

  // Controls
  $("#composeForm").addEventListener("submit", submitHandler);
  $("#prevBtn").addEventListener("click", () => { if (state.page>1){ state.page--; location.hash = `#page=${state.page}`; loadPage(state.page); } });
  $("#nextBtn").addEventListener("click", () => { state.page++; location.hash = `#page=${state.page}`; loadPage(state.page); });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") { $("#prevBtn").click(); }
    else if (ev.key === "ArrowRight") { $("#nextBtn").click(); }
  });

  window.addEventListener("hashchange", () => {
    state.page = currentPageFromHash();
    loadPage(state.page);
  });

  // init
  state.page = currentPageFromHash();
  loadPage(state.page);
  loadHighlights();
})();
