/* SnuggleStream — Home Page Logic */
(function () {
    "use strict";

    const $  = (s, c) => (c || document).querySelector(s);
    const $$ = (s, c) => [...(c || document).querySelectorAll(s)];

    // Detect auth from both the global flag and the DOM
    const isAuthed = window.__isAuthenticated === true || !!$(".user-info");

    // ---- Auth gate ----
    function showAuthOverlay() {
        $("#appMain").classList.add("blurred");
        $("#authOverlay").style.display = "";
    }

    function requireAuth() {
        if (isAuthed) return true;
        showAuthOverlay();
        return false;
    }

    // Dismiss overlay
    const authOverlay = $("#authOverlay");
    if (authOverlay) {
        authOverlay.addEventListener("click", e => {
            if (e.target === authOverlay) {
                authOverlay.style.display = "none";
                $("#appMain").classList.remove("blurred");
            }
        });
    }

    // ---- Source tabs ----
    let selectedSource = "url";
    const tabs = $$(".source-tabs .tab");
    const urlPanel    = $("#urlPanel");
    const filePanel   = $("#filePanel");
    const screenPanel = $("#screenPanel");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            selectedSource = tab.dataset.source;
            urlPanel.style.display    = selectedSource === "url"    ? "" : "none";
            filePanel.style.display   = selectedSource === "file"   ? "" : "none";
            if (screenPanel) screenPanel.style.display = selectedSource === "screen" ? "" : "none";
        });
    });

    // ---- File drop ----
    const fileDrop  = $("#fileDrop");
    const fileInput = $("#videoFile");
    const fileInfo  = $("#fileInfo");
    let selectedFile = null;

    if (fileDrop) {
        fileDrop.addEventListener("click", () => fileInput.click());
        fileDrop.addEventListener("dragover",  e => { e.preventDefault(); fileDrop.classList.add("dragover"); });
        fileDrop.addEventListener("dragleave", () => fileDrop.classList.remove("dragover"));
        fileDrop.addEventListener("drop", e => {
            e.preventDefault();
            fileDrop.classList.remove("dragover");
            if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener("change", () => {
            if (fileInput.files.length) pickFile(fileInput.files[0]);
        });
    }

    function pickFile(f) {
        selectedFile = f;
        fileInfo.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        fileInfo.style.display = "";
    }

    // ---- Create Room ----
    const createForm = $("#createForm");
    const createBtn  = $("#createBtn");
    const overlay    = $("#loadingOverlay");
    const loadingTxt = $("#loadingText");

    createForm.addEventListener("submit", async e => {
        e.preventDefault();
        if (!requireAuth()) return;
        const name = $("#roomName").value.trim();
        if (!name) return;

        overlay.style.display = "flex";
        loadingTxt.textContent = "Creating room...";

        try {
            const body = {
                name,
                video_url: selectedSource === "url" ? ($("#videoUrl").value.trim()) : "",
                video_type: selectedSource === "file" ? "file" : "url",
                is_private: $("#privateToggle").checked,
            };
            if (selectedSource === "later" || selectedSource === "screen") {
                body.video_url = "";
                body.video_type = "url";
            }

            const res = await fetch("/api/rooms", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.status === 401) {
                overlay.style.display = "none";
                showAuthOverlay();
                return;
            }
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to create room");
            }
            const room = await res.json();

            // Upload file if chosen
            if (selectedSource === "file" && selectedFile) {
                loadingTxt.textContent = "Uploading video...";
                const fd = new FormData();
                fd.append("room_code", room.code);
                fd.append("file", selectedFile);
                const up = await fetch("/api/upload", { method: "POST", body: fd });
                if (!up.ok) {
                    const err = await up.json();
                    throw new Error(err.detail || "Upload failed");
                }
            }

            window.location.href = `/room/${room.code}${selectedSource === "screen" ? "?screen=1" : ""}`;
        } catch (err) {
            overlay.style.display = "none";
            alert(err.message);
        }
    });

    // ---- Join Room ----
    const joinForm = $("#joinForm");
    joinForm.addEventListener("submit", async e => {
        e.preventDefault();
        if (!requireAuth()) return;
        const code = $("#roomCode").value.trim().toUpperCase();
        if (!code) return;
        // Check room exists first
        try {
            const res = await fetch(`/api/rooms/${code}/check`);
            if (res.status === 401) { showAuthOverlay(); return; }
            if (res.status === 429) {
                const err = await res.json();
                alert(err.detail || "Too many requests. Wait a moment and try again.");
                return;
            }
            if (!res.ok) throw new Error("Room not found. Check the code.");
            window.location.href = `/room/${code}`;
        } catch (err) {
            alert(err.message);
        }
    });

    // ---- Load active rooms ----
    async function loadRooms() {
        if (!isAuthed) return;
        try {
            const res = await fetch("/api/rooms");
            if (!res.ok) return;
            const rooms = await res.json();
            const container = $("#activeRooms");
            const list = $("#roomsList");
            if (rooms.length === 0) {
                container.style.display = "none";
                return;
            }
            container.style.display = "";
            list.innerHTML = rooms.map(r => `
                <li data-code="${r.code}">
                    <span class="room-li-name">${escapeHtml(r.name)}</span>
                    <span class="room-li-meta">
                        <span class="room-li-viewers">${r.viewers} watching</span>
                        <span>${r.code}</span>
                    </span>
                </li>
            `).join("");
            list.querySelectorAll("li").forEach(li => {
                li.addEventListener("click", () => {
                    if (!requireAuth()) return;
                    window.location.href = `/room/${li.dataset.code}`;
                });
            });
        } catch {
            // ignore
        }
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    loadRooms();
    setInterval(loadRooms, 10000);

    // ---- Alias Setting ----
    const aliasInput = $("#aliasInput");
    const randomAliasBtn = $("#randomAliasBtn");

    function generateAnonAlias() {
        const num = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
        return "anon_" + num;
    }

    if (aliasInput) {
        // Load saved alias or generate default
        const saved = localStorage.getItem("snuggle_alias");
        if (saved) {
            aliasInput.value = saved;
        } else {
            const defaultAlias = generateAnonAlias();
            aliasInput.value = defaultAlias;
            localStorage.setItem("snuggle_alias", defaultAlias);
        }

        // Save on change
        aliasInput.addEventListener("input", () => {
            const val = aliasInput.value.trim();
            if (val) {
                localStorage.setItem("snuggle_alias", val);
            } else {
                localStorage.removeItem("snuggle_alias");
            }
        });
    }

    if (randomAliasBtn) {
        randomAliasBtn.addEventListener("click", () => {
            const alias = generateAnonAlias();
            if (aliasInput) aliasInput.value = alias;
            localStorage.setItem("snuggle_alias", alias);
        });
    }
})();
