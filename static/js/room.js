/* SnuggleStream — Room Page Logic */
(function () {
    "use strict";

    const $ = (s, c) => (c || document).querySelector(s);
    const ROOM_CODE = window.ROOM_CODE;

    // ---- Elements ----
    const videoPlayer     = $("#videoPlayer");
    const videoEmpty      = $("#videoEmpty");
    const videoControls   = $("#videoControls");
    const playPauseBtn    = $("#playPauseBtn");
    const playIcon        = $("#playIcon");
    const pauseIcon       = $("#pauseIcon");
    const progressBar     = $("#progressBar");
    const progressFilled  = $("#progressFilled");
    const progressThumb   = $("#progressThumb");
    const progressBuffered= $("#progressBuffered");
    const timeDisplay     = $("#timeDisplay");
    const muteBtn         = $("#muteBtn");
    const volIcon         = $("#volIcon");
    const muteIcon        = $("#muteIcon");
    const volumeSlider    = $("#volumeSlider");
    const rateSelect      = $("#rateSelect");
    const fullscreenBtn   = $("#fullscreenBtn");
    const viewerCount     = $("#viewerCount");
    const roomNameEl      = $("#roomName");
    const codeBadge       = $("#roomCodeBadge");
    const chatMessages    = $("#chatMessages");
    const chatForm        = $("#chatForm");
    const chatInput       = $("#chatInput");
    const nicknameInput   = $("#nicknameInput");
    const videoUrlInput   = $("#videoUrlInput");
    const loadUrlBtn      = $("#loadUrlBtn");
    const urlInputDiv     = $("#urlInput");
    const uploadInputDiv  = $("#uploadInput");
    const roomFileInput   = $("#roomFileInput");
    const fileDropRoom    = $("#fileDropRoom");
    const uploadProgress  = $("#uploadProgress");
    const uploadBarFill   = $("#uploadBarFill");
    const uploadPercent   = $("#uploadPercent");
    const toastContainer  = $("#toastContainer");

    // ---- State ----
    let ws = null;
    let userId = null;
    let ignoreEvents = false;   // flag to prevent echo loops
    let isSeeking = false;

    // ---- WebSocket ----
    function connectWS() {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//${location.host}/ws/${ROOM_CODE}`);

        ws.onopen = () => toast("Connected to room", "success");

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            handleMessage(data);
        };

        ws.onclose = (e) => {
            if (e.code === 4004) {
                toast("Room not found", "error");
                setTimeout(() => window.location.href = "/", 2000);
                return;
            }
            toast("Disconnected. Reconnecting...", "error");
            setTimeout(connectWS, 2000);
        };

        ws.onerror = () => {};
    }

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    // ---- Handle incoming messages ----
    function handleMessage(data) {
        switch (data.type) {
            case "sync":
                userId = data.user_id;
                viewerCount.textContent = data.viewers;
                if (data.video_url) loadVideo(data.video_url, data.video_type);
                if (data.playback_rate) {
                    videoPlayer.playbackRate = data.playback_rate;
                    rateSelect.value = data.playback_rate;
                }
                // Seek then play/pause
                syncPlayback(data.current_time, data.is_playing);
                break;

            case "play":
                addChatEvent("started playing");
                syncPlayback(data.current_time, true);
                break;

            case "pause":
                addChatEvent("paused");
                syncPlayback(data.current_time, false);
                break;

            case "seek":
                addChatEvent("seeked to " + formatTime(data.current_time));
                syncPlayback(data.current_time, null);
                break;

            case "video_change":
                loadVideo(data.video_url, data.video_type);
                addChatEvent("changed the video");
                break;

            case "rate_change":
                videoPlayer.playbackRate = data.rate;
                rateSelect.value = data.rate;
                addChatEvent(`set speed to ${data.rate}x`);
                break;

            case "viewer_update":
                viewerCount.textContent = data.viewers;
                break;

            case "chat":
                addChatMessage(data.nickname, data.text, data.user_id === userId);
                break;
        }
    }

    function syncPlayback(time, shouldPlay) {
        ignoreEvents = true;
        if (time !== undefined && time !== null && Math.abs(videoPlayer.currentTime - time) > 0.5) {
            videoPlayer.currentTime = time;
        }
        if (shouldPlay === true && videoPlayer.paused && videoPlayer.src) {
            videoPlayer.play().catch(() => {});
        } else if (shouldPlay === false && !videoPlayer.paused) {
            videoPlayer.pause();
        }
        setTimeout(() => { ignoreEvents = false; }, 200);
    }

    // ---- Load video ----
    function loadVideo(url, type) {
        if (!url) return;
        videoEmpty.style.display = "none";
        videoPlayer.style.display = "";
        videoControls.style.display = "";
        videoPlayer.src = url;
        videoPlayer.load();
    }

    // ---- Video event handlers ----
    videoPlayer.addEventListener("play", () => {
        updatePlayPauseIcon();
        if (ignoreEvents) return;
        send({ type: "play", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("pause", () => {
        updatePlayPauseIcon();
        if (ignoreEvents) return;
        send({ type: "pause", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("seeked", () => {
        if (ignoreEvents) return;
        send({ type: "seek", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("timeupdate", () => {
        if (isSeeking) return;
        const dur = videoPlayer.duration || 0;
        const cur = videoPlayer.currentTime || 0;
        const pct = dur ? (cur / dur) * 100 : 0;
        progressFilled.style.width = pct + "%";
        progressThumb.style.left   = pct + "%";
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    });

    videoPlayer.addEventListener("progress", () => {
        if (videoPlayer.buffered.length > 0) {
            const end = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const dur = videoPlayer.duration || 1;
            progressBuffered.style.width = (end / dur * 100) + "%";
        }
    });

    // ---- Custom Controls ----
    playPauseBtn.addEventListener("click", () => {
        if (videoPlayer.paused) videoPlayer.play().catch(() => {});
        else videoPlayer.pause();
    });

    function updatePlayPauseIcon() {
        playIcon.style.display  = videoPlayer.paused ? "" : "none";
        pauseIcon.style.display = videoPlayer.paused ? "none" : "";
    }

    // Progress bar seeking
    progressBar.addEventListener("mousedown", (e) => { isSeeking = true; seekFromEvent(e); });
    document.addEventListener("mousemove", (e) => { if (isSeeking) seekFromEvent(e); });
    document.addEventListener("mouseup", () => {
        if (isSeeking) {
            isSeeking = false;
            send({ type: "seek", current_time: videoPlayer.currentTime });
        }
    });

    function seekFromEvent(e) {
        const rect = progressBar.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        videoPlayer.currentTime = pct * (videoPlayer.duration || 0);
        progressFilled.style.width = (pct * 100) + "%";
        progressThumb.style.left   = (pct * 100) + "%";
    }

    // Volume
    muteBtn.addEventListener("click", () => {
        videoPlayer.muted = !videoPlayer.muted;
        volIcon.style.display  = videoPlayer.muted ? "none" : "";
        muteIcon.style.display = videoPlayer.muted ? "" : "none";
    });
    volumeSlider.addEventListener("input", () => {
        videoPlayer.volume = volumeSlider.value;
        videoPlayer.muted = false;
        volIcon.style.display  = "";
        muteIcon.style.display = "none";
    });

    // Rate
    rateSelect.addEventListener("change", () => {
        videoPlayer.playbackRate = parseFloat(rateSelect.value);
        send({ type: "rate_change", rate: videoPlayer.playbackRate });
    });

    // Fullscreen
    fullscreenBtn.addEventListener("click", () => {
        const container = $("#videoContainer");
        if (document.fullscreenElement) document.exitFullscreen();
        else container.requestFullscreen().catch(() => {});
    });

    // ---- Source tabs (room) ----
    const srcTabs = document.querySelectorAll(".source-tabs-room .tab");
    srcTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            srcTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            urlInputDiv.style.display    = tab.dataset.source === "url" ? "" : "none";
            uploadInputDiv.style.display = tab.dataset.source === "upload" ? "" : "none";
        });
    });

    // Load URL
    loadUrlBtn.addEventListener("click", () => {
        const url = videoUrlInput.value.trim();
        if (!url) return;
        loadVideo(url, "url");
        send({ type: "video_change", video_url: url, video_type: "url" });
        toast("Video loaded", "success");
    });

    // Upload in room
    fileDropRoom.addEventListener("click", () => roomFileInput.click());
    fileDropRoom.addEventListener("dragover", e => { e.preventDefault(); fileDropRoom.style.borderColor = "var(--primary)"; });
    fileDropRoom.addEventListener("dragleave", () => { fileDropRoom.style.borderColor = ""; });
    fileDropRoom.addEventListener("drop", e => {
        e.preventDefault();
        fileDropRoom.style.borderColor = "";
        if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });
    roomFileInput.addEventListener("change", () => {
        if (roomFileInput.files.length) uploadFile(roomFileInput.files[0]);
    });

    async function uploadFile(file) {
        uploadProgress.style.display = "";
        uploadBarFill.style.width = "0%";
        uploadPercent.textContent = "0%";

        const fd = new FormData();
        fd.append("room_code", ROOM_CODE);
        fd.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                uploadBarFill.style.width = pct + "%";
                uploadPercent.textContent = pct + "%";
            }
        };
        xhr.onload = () => {
            uploadProgress.style.display = "none";
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                loadVideo(data.video_url, "file");
                send({ type: "video_change", video_url: data.video_url, video_type: "file" });
                toast("Video uploaded!", "success");
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    toast(err.detail || "Upload failed", "error");
                } catch {
                    toast("Upload failed", "error");
                }
            }
        };
        xhr.onerror = () => {
            uploadProgress.style.display = "none";
            toast("Upload failed", "error");
        };
        xhr.send(fd);
    }

    // ---- Copy room code ----
    codeBadge.addEventListener("click", () => {
        navigator.clipboard.writeText(ROOM_CODE).then(() => toast("Code copied!", "info"));
    });

    // ---- Chat ----
    chatForm.addEventListener("submit", e => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        const nickname = nicknameInput.value.trim() || "Anonymous";
        send({ type: "chat", text, nickname });
        chatInput.value = "";
    });

    function addChatMessage(name, text, isMe) {
        const div = document.createElement("div");
        div.className = "chat-msg";
        div.innerHTML = `<span class="chat-msg-name" style="${isMe ? 'color:var(--accent)' : ''}">${escapeHtml(name)}</span><span class="chat-msg-text">${escapeHtml(text)}</span>`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addChatEvent(text) {
        const div = document.createElement("div");
        div.className = "chat-msg-event";
        div.textContent = `• ${text}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ---- Load Room Info ----
    async function loadRoomInfo() {
        try {
            const res = await fetch(`/api/rooms/${ROOM_CODE}`);
            if (!res.ok) { window.location.href = "/"; return; }
            const room = await res.json();
            roomNameEl.textContent = room.name;
            document.title = `${room.name} — SnuggleStream`;
        } catch {
            // retry on WS connect
        }
    }

    // ---- Keyboard shortcuts ----
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        switch (e.key) {
            case " ":
            case "k":
                e.preventDefault();
                if (videoPlayer.paused) videoPlayer.play().catch(() => {});
                else videoPlayer.pause();
                break;
            case "f":
                fullscreenBtn.click();
                break;
            case "m":
                muteBtn.click();
                break;
            case "ArrowLeft":
                videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
                send({ type: "seek", current_time: videoPlayer.currentTime });
                break;
            case "ArrowRight":
                videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + 10);
                send({ type: "seek", current_time: videoPlayer.currentTime });
                break;
        }
    });

    // ---- Utilities ----
    function formatTime(sec) {
        if (!sec || isNaN(sec)) return "0:00";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        return `${m}:${s.toString().padStart(2, "0")}`;
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function toast(msg, type = "info") {
        const div = document.createElement("div");
        div.className = `toast ${type}`;
        div.textContent = msg;
        toastContainer.appendChild(div);
        setTimeout(() => div.remove(), 3500);
    }

    // ---- Init ----
    if (window.USER_NAME) nicknameInput.value = window.USER_NAME;
    loadRoomInfo();
    connectWS();
})();
