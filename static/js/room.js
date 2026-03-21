/* SnuggleStream — Room Page Logic */
(function () {
    "use strict";

    const $ = (s, c) => (c || document).querySelector(s);
    const appData = document.getElementById("appData");
    const ROOM_CODE = appData.dataset.roomCode;

    // ---- Elements ----
    const videoPlayer     = $("#videoPlayer");
    const youtubeDiv      = $("#youtubePlayer");
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
    const videoLoading    = $("#videoLoading");
    const toastContainer  = $("#toastContainer");
    const hostBadge       = $("#hostBadge");
    const hostNameEl      = $("#hostName");
    const voteOverlay     = $("#voteOverlay");
    const voteCandidates  = $("#voteCandidates");
    const voteTimer       = $("#voteTimer");

    // ---- State ----
    let ws = null;
    let userId = null;
    let hostId = null;
    let ignoreEvents = false;
    let isSeeking = false;
    let voteTimerInterval = null;

    function isHost() { return userId && userId === hostId; }

    // ---- YouTube IFrame API ----
    let ytPlayer = null;
    let ytReady = false;
    let ytApiLoaded = false;
    let activePlayer = "none"; // "native" | "youtube" | "none"
    let ytTimeUpdateInterval = null;

    function loadYouTubeAPI() {
        if (ytApiLoaded) return;
        ytApiLoaded = true;
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = function () {
        ytReady = true;
    };

    function extractYouTubeId(url) {
        try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            if (host === "youtu.be" || host === "www.youtu.be") {
                const id = u.pathname.split("/")[1];
                return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
            }
            if (host.includes("youtube.com")) {
                if (u.pathname === "/watch" || u.pathname === "/watch/") {
                    const id = u.searchParams.get("v");
                    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
                }
                for (const prefix of ["/embed/", "/v/", "/shorts/"]) {
                    if (u.pathname.startsWith(prefix)) {
                        const id = u.pathname.slice(prefix.length).split("/")[0];
                        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
                    }
                }
            }
        } catch {}
        return null;
    }

    function isYouTubeUrl(url) {
        return extractYouTubeId(url) !== null;
    }

    // ---- URL Validation ----
    const ALLOWED_VIDEO_EXTS = [".mp4", ".webm", ".mkv", ".avi", ".mov", ".m3u8", ".mpd", ".ts", ".m4s", ".ogg", ".ogv"];

    function isValidVideoUrl(url) {
        if (!url) return false;
        if (url.startsWith("/media/")) return true;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
        if (isYouTubeUrl(url)) return true;
        try {
            const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
            return ALLOWED_VIDEO_EXTS.some(ext => path.endsWith(ext));
        } catch {
            return false;
        }
    }

    // ======================================================
    //  Host Controls — UI state
    // ======================================================

    function updateHostUI() {
        const host = isHost();
        // Visual indicator on controls
        playPauseBtn.classList.toggle("host-disabled", !host);
        progressBar.classList.toggle("host-disabled", !host);
        rateSelect.disabled = !host;

        // Source panel visibility — only host can change video
        const sourcePanel = $(".source-panel-room");
        if (sourcePanel) sourcePanel.style.display = host ? "" : "none";

        // Host badge
        if (hostBadge) {
            hostBadge.classList.toggle("is-you", host);
            hostBadge.title = host ? "You are the host" : "Room host";
        }
    }

    // ======================================================
    //  Unified Player Interface
    // ======================================================

    function hideAllPlayers() {
        videoPlayer.style.display = "none";
        youtubeDiv.style.display = "none";
        videoControls.style.display = "none";
        videoEmpty.style.display = "none";
        videoLoading.style.display = "none";
        if (ytTimeUpdateInterval) { clearInterval(ytTimeUpdateInterval); ytTimeUpdateInterval = null; }
    }

    function showNativePlayer() {
        activePlayer = "native";
        videoPlayer.style.display = "";
        youtubeDiv.style.display = "none";
        videoControls.style.display = "";
    }

    function showYouTubePlayer() {
        activePlayer = "youtube";
        videoPlayer.style.display = "none";
        videoPlayer.pause();
        videoPlayer.removeAttribute("src");
        youtubeDiv.style.display = "";
        videoControls.style.display = "";
    }

    // --- Get/set for active player ---
    function getPlayerTime() {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.getCurrentTime === "function") {
            return ytPlayer.getCurrentTime();
        }
        return videoPlayer.currentTime || 0;
    }

    function getPlayerDuration() {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.getDuration === "function") {
            return ytPlayer.getDuration();
        }
        return videoPlayer.duration || 0;
    }

    function isPlayerPaused() {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.getPlayerState === "function") {
            const state = ytPlayer.getPlayerState();
            return state !== 1; // 1 = PLAYING
        }
        return videoPlayer.paused;
    }

    function playerPlay() {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.playVideo === "function") {
            ytPlayer.playVideo();
        } else if (activePlayer === "native") {
            videoPlayer.play().catch(() => {});
        }
    }

    function playerPause() {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.pauseVideo === "function") {
            ytPlayer.pauseVideo();
        } else if (activePlayer === "native") {
            videoPlayer.pause();
        }
    }

    function playerSeekTo(time) {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.seekTo === "function") {
            ytPlayer.seekTo(time, true);
        } else {
            videoPlayer.currentTime = time;
        }
    }

    function playerSetRate(rate) {
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.setPlaybackRate === "function") {
            ytPlayer.setPlaybackRate(rate);
        } else {
            videoPlayer.playbackRate = rate;
        }
    }

    // ---- Load video (unified) ----
    function loadVideo(url, type) {
        if (!url) return;
        if (!isValidVideoUrl(url)) {
            toast("Invalid URL. Must be a YouTube link or direct video file (.mp4, .webm, etc.)", "error");
            return;
        }

        const ytId = extractYouTubeId(url);
        hideAllPlayers();

        if (ytId) {
            videoLoading.style.display = "flex";
            loadYouTubeAPI();
            waitForYTAPI(() => createYouTubePlayer(ytId));
        } else {
            videoLoading.style.display = "flex";
            videoPlayer.src = url;
            videoPlayer.load();
        }
    }

    function waitForYTAPI(callback) {
        if (ytReady) { callback(); return; }
        const check = setInterval(() => {
            if (ytReady) { clearInterval(check); callback(); }
        }, 100);
    }

    function createYouTubePlayer(videoId) {
        if (ytPlayer && typeof ytPlayer.destroy === "function") {
            ytPlayer.destroy();
            ytPlayer = null;
        }
        youtubeDiv.innerHTML = "";
        const innerDiv = document.createElement("div");
        innerDiv.id = "ytPlayerInner";
        youtubeDiv.appendChild(innerDiv);

        ytPlayer = new YT.Player("ytPlayerInner", {
            videoId: videoId,
            width: "100%",
            height: "100%",
            playerVars: {
                autoplay: 0,
                controls: 0,
                modestbranding: 1,
                rel: 0,
                iv_load_policy: 3,
                disablekb: 1,
                fs: 0,
                playsinline: 1,
                origin: location.origin,
            },
            events: {
                onReady: onYTReady,
                onStateChange: onYTStateChange,
            },
        });
    }

    function onYTReady() {
        videoLoading.style.display = "none";
        showYouTubePlayer();
        startYTTimeUpdates();
    }

    function onYTStateChange(event) {
        updatePlayPauseIcon();
        if (ignoreEvents || !isHost()) return;
        const state = event.data;
        if (state === YT.PlayerState.PLAYING) {
            send({ type: "play", current_time: ytPlayer.getCurrentTime() });
        } else if (state === YT.PlayerState.PAUSED) {
            send({ type: "pause", current_time: ytPlayer.getCurrentTime() });
        }
    }

    function startYTTimeUpdates() {
        if (ytTimeUpdateInterval) clearInterval(ytTimeUpdateInterval);
        ytTimeUpdateInterval = setInterval(() => {
            if (activePlayer !== "youtube" || !ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
            const dur = ytPlayer.getDuration() || 0;
            const cur = ytPlayer.getCurrentTime() || 0;
            const pct = dur ? (cur / dur) * 100 : 0;
            progressFilled.style.width = pct + "%";
            progressThumb.style.left   = pct + "%";
            timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
            if (typeof ytPlayer.getVideoLoadedFraction === "function") {
                progressBuffered.style.width = (ytPlayer.getVideoLoadedFraction() * 100) + "%";
            }
        }, 250);
    }

    // ---- WebSocket ----
    function connectWS() {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//${location.host}/ws/${ROOM_CODE}`);

        ws.onopen = () => {
            toast("Connected to room", "success");
            // Tell server our display name
            const name = appData.dataset.userName || "Anonymous";
            send({ type: "set_name", name: name });
        };

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
                hostId = data.host_id;
                viewerCount.textContent = data.viewers;
                updateHostUI();
                updateHostName(data.host_name);
                if (data.video_url) loadVideo(data.video_url, data.video_type);
                if (data.playback_rate) {
                    playerSetRate(data.playback_rate);
                    rateSelect.value = data.playback_rate;
                }
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
                playerSetRate(data.rate);
                rateSelect.value = data.rate;
                addChatEvent(`set speed to ${data.rate}x`);
                break;

            case "viewer_update":
                viewerCount.textContent = data.viewers;
                break;

            case "host_update":
                hostId = data.host_id;
                updateHostUI();
                updateHostName(data.host_name);
                addChatEvent(`${escapeHtml(data.host_name)} is now the host`);
                break;

            case "vote_start":
                showVoteOverlay(data.candidates, data.timeout);
                playerPause();
                addChatEvent("Host left — voting for new host...");
                break;

            case "vote_result":
                hideVoteOverlay();
                hostId = data.host_id;
                updateHostUI();
                updateHostName(data.host_name);
                addChatEvent(`${escapeHtml(data.host_name)} was voted as the new host`);
                toast(`${data.host_name} is the new host!`, "success");
                break;

            case "chat":
                addChatMessage(data.nickname, data.text, data.user_id === userId);
                break;

            case "gif":
                addChatGif(data.nickname, data.url, data.user_id === userId);
                break;

            case "chat_blocked":
                toast(data.reason || "Message blocked", "error");
                break;

            case "error":
                toast(data.message || "Action not allowed", "error");
                break;
        }
    }

    function updateHostName(name) {
        if (hostNameEl) hostNameEl.textContent = name || "Host";
    }

    function syncPlayback(time, shouldPlay) {
        ignoreEvents = true;
        const currentTime = getPlayerTime();
        if (time !== undefined && time !== null && Math.abs(currentTime - time) > 0.5) {
            playerSeekTo(time);
        }
        if (shouldPlay === true && isPlayerPaused()) {
            playerPlay();
        } else if (shouldPlay === false && !isPlayerPaused()) {
            playerPause();
        }
        setTimeout(() => { ignoreEvents = false; }, 200);
    }

    // ======================================================
    //  Voting System UI
    // ======================================================

    function showVoteOverlay(candidates, timeout) {
        voteOverlay.style.display = "flex";
        voteCandidates.innerHTML = "";
        candidates.forEach(c => {
            const btn = document.createElement("button");
            btn.className = "vote-btn";
            btn.textContent = c.name + (c.user_id === userId ? " (You)" : "");
            btn.addEventListener("click", () => {
                send({ type: "vote", candidate_id: c.user_id });
                // Disable all buttons after voting
                voteCandidates.querySelectorAll(".vote-btn").forEach(b => {
                    b.disabled = true;
                    b.classList.remove("voted");
                });
                btn.classList.add("voted");
                toast("Vote cast!", "info");
            });
            voteCandidates.appendChild(btn);
        });

        // Countdown timer
        let remaining = timeout;
        voteTimer.textContent = `(${remaining}s remaining)`;
        if (voteTimerInterval) clearInterval(voteTimerInterval);
        voteTimerInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(voteTimerInterval);
                voteTimerInterval = null;
                voteTimer.textContent = "(tallying votes...)";
            } else {
                voteTimer.textContent = `(${remaining}s remaining)`;
            }
        }, 1000);
    }

    function hideVoteOverlay() {
        voteOverlay.style.display = "none";
        if (voteTimerInterval) { clearInterval(voteTimerInterval); voteTimerInterval = null; }
    }

    // ======================================================
    //  Native <video> event handlers
    // ======================================================

    videoPlayer.addEventListener("canplay", () => {
        if (activePlayer !== "youtube") {
            videoLoading.style.display = "none";
            showNativePlayer();
        }
    });
    videoPlayer.addEventListener("error", () => {
        if (activePlayer !== "youtube") {
            videoLoading.style.display = "none";
            toast("Failed to load video", "error");
        }
    });

    videoPlayer.addEventListener("play", () => {
        updatePlayPauseIcon();
        if (ignoreEvents || !isHost()) return;
        send({ type: "play", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("pause", () => {
        updatePlayPauseIcon();
        if (ignoreEvents || !isHost()) return;
        send({ type: "pause", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("seeked", () => {
        if (ignoreEvents || !isHost()) return;
        send({ type: "seek", current_time: videoPlayer.currentTime });
    });

    videoPlayer.addEventListener("timeupdate", () => {
        if (isSeeking || activePlayer === "youtube") return;
        const dur = videoPlayer.duration || 0;
        const cur = videoPlayer.currentTime || 0;
        const pct = dur ? (cur / dur) * 100 : 0;
        progressFilled.style.width = pct + "%";
        progressThumb.style.left   = pct + "%";
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    });

    videoPlayer.addEventListener("progress", () => {
        if (activePlayer === "youtube") return;
        if (videoPlayer.buffered.length > 0) {
            const end = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const dur = videoPlayer.duration || 1;
            progressBuffered.style.width = (end / dur * 100) + "%";
        }
    });

    // ---- Custom Controls ----
    playPauseBtn.addEventListener("click", () => {
        if (!isHost()) { toast("Only the host can control playback", "error"); return; }
        if (isPlayerPaused()) playerPlay();
        else playerPause();
    });

    function updatePlayPauseIcon() {
        const paused = isPlayerPaused();
        playIcon.style.display  = paused ? "" : "none";
        pauseIcon.style.display = paused ? "none" : "";
    }

    // Progress bar seeking
    progressBar.addEventListener("mousedown", (e) => {
        if (!isHost()) { toast("Only the host can seek", "error"); return; }
        isSeeking = true;
        seekFromEvent(e);
    });
    document.addEventListener("mousemove", (e) => { if (isSeeking) seekFromEvent(e); });
    document.addEventListener("mouseup", () => {
        if (isSeeking) {
            isSeeking = false;
            send({ type: "seek", current_time: getPlayerTime() });
        }
    });

    function seekFromEvent(e) {
        const rect = progressBar.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const time = pct * (getPlayerDuration() || 0);
        playerSeekTo(time);
        progressFilled.style.width = (pct * 100) + "%";
        progressThumb.style.left   = (pct * 100) + "%";
    }

    // Volume (local only — anyone can control their own volume)
    muteBtn.addEventListener("click", () => {
        if (activePlayer === "youtube" && ytPlayer) {
            if (ytPlayer.isMuted()) { ytPlayer.unMute(); volIcon.style.display = ""; muteIcon.style.display = "none"; }
            else { ytPlayer.mute(); volIcon.style.display = "none"; muteIcon.style.display = ""; }
        } else {
            videoPlayer.muted = !videoPlayer.muted;
            volIcon.style.display  = videoPlayer.muted ? "none" : "";
            muteIcon.style.display = videoPlayer.muted ? "" : "none";
        }
    });
    volumeSlider.addEventListener("input", () => {
        const vol = parseFloat(volumeSlider.value);
        if (activePlayer === "youtube" && ytPlayer && typeof ytPlayer.setVolume === "function") {
            ytPlayer.setVolume(vol * 100);
            ytPlayer.unMute();
        } else {
            videoPlayer.volume = vol;
            videoPlayer.muted = false;
        }
        volIcon.style.display  = "";
        muteIcon.style.display = "none";
    });

    // Rate (host only)
    rateSelect.addEventListener("change", () => {
        if (!isHost()) { toast("Only the host can change speed", "error"); rateSelect.value = 1; return; }
        const rate = parseFloat(rateSelect.value);
        playerSetRate(rate);
        send({ type: "rate_change", rate: rate });
    });

    // Fullscreen (anyone)
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

    // Load URL (host only — panel is hidden for non-hosts)
    loadUrlBtn.addEventListener("click", () => {
        const url = videoUrlInput.value.trim();
        if (!url) return;
        if (!isValidVideoUrl(url)) {
            toast("Only YouTube links or direct video files are allowed (.mp4, .webm, etc.)", "error");
            return;
        }
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

    // ---- Smart auto-scroll: only scroll down if user is near the bottom ----
    function isNearBottom() {
        return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
    }

    // ---- Chat ----
    chatForm.addEventListener("submit", e => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        const nickname = nicknameInput.value.trim() || "Anonymous";
        send({ type: "chat", text, nickname });
        chatInput.value = "";
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    function addChatMessage(name, text, isMe) {
        const near = isMe || isNearBottom();
        const div = document.createElement("div");
        div.className = "chat-msg";
        div.innerHTML = `<span class="chat-msg-name" style="${isMe ? 'color:var(--accent)' : ''}">${escapeHtml(name)}</span><span class="chat-msg-text">${escapeHtml(text)}</span>`;
        chatMessages.appendChild(div);
        if (near) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addChatGif(name, url, isMe) {
        const near = isMe || isNearBottom();
        const div = document.createElement("div");
        div.className = "chat-msg";
        const nameSpan = `<span class="chat-msg-name" style="${isMe ? 'color:var(--accent)' : ''}">${escapeHtml(name)}</span>`;
        div.innerHTML = nameSpan;
        const img = document.createElement("img");
        img.className = "chat-msg-gif";
        img.src = url;
        img.alt = "GIF";
        img.loading = "lazy";
        img.onload = () => { if (near) chatMessages.scrollTop = chatMessages.scrollHeight; };
        div.appendChild(img);
        chatMessages.appendChild(div);
        if (near) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addChatEvent(text) {
        const near = isNearBottom();
        const div = document.createElement("div");
        div.className = "chat-msg-event";
        div.textContent = `• ${text}`;
        chatMessages.appendChild(div);
        if (near) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ---- GIF Picker ----
    const gifBtn = $("#gifBtn");
    const gifPicker = $("#gifPicker");
    const gifSearchInput = $("#gifSearchInput");
    const gifGrid = $("#gifGrid");
    const gifPickerClose = $("#gifPickerClose");
    let gifSearchTimeout = null;

    gifBtn.addEventListener("click", () => {
        const open = gifPicker.style.display !== "none";
        gifPicker.style.display = open ? "none" : "";
        gifBtn.classList.toggle("active", !open);
        if (!open) gifSearchInput.focus();
    });

    gifPickerClose.addEventListener("click", () => {
        gifPicker.style.display = "none";
        gifBtn.classList.remove("active");
    });

    gifSearchInput.addEventListener("input", () => {
        clearTimeout(gifSearchTimeout);
        const q = gifSearchInput.value.trim();
        if (!q) {
            gifGrid.innerHTML = '<p class="gif-picker-hint">Type to search for GIFs</p>';
            return;
        }
        gifSearchTimeout = setTimeout(() => searchGifs(q), 400);
    });

    async function searchGifs(query) {
        gifGrid.innerHTML = '<p class="gif-picker-hint">Searching...</p>';
        try {
            const res = await fetch(`/api/giphy/search?q=${encodeURIComponent(query)}&limit=20`);
            if (res.status === 503) {
                gifGrid.innerHTML = '<p class="gif-picker-hint">GIF search not configured</p>';
                return;
            }
            if (!res.ok) throw new Error();
            const data = await res.json();
            if (!data.results || !data.results.length) {
                gifGrid.innerHTML = '<p class="gif-picker-hint">No GIFs found</p>';
                return;
            }
            gifGrid.innerHTML = "";
            data.results.forEach(g => {
                const img = document.createElement("img");
                img.src = g.preview;
                img.alt = "GIF";
                img.loading = "lazy";
                img.addEventListener("click", () => sendGif(g.url));
                gifGrid.appendChild(img);
            });
        } catch {
            gifGrid.innerHTML = '<p class="gif-picker-hint">Search failed</p>';
        }
    }

    function sendGif(url) {
        const nickname = nicknameInput.value.trim() || "Anonymous";
        send({ type: "gif", url, nickname });
        gifPicker.style.display = "none";
        gifBtn.classList.remove("active");
        gifSearchInput.value = "";
        gifGrid.innerHTML = '<p class="gif-picker-hint">Type to search for GIFs</p>';
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
                if (!isHost()) { toast("Only the host can control playback", "error"); return; }
                if (isPlayerPaused()) playerPlay();
                else playerPause();
                break;
            case "f":
                fullscreenBtn.click();
                break;
            case "m":
                muteBtn.click();
                break;
            case "ArrowLeft":
                if (!isHost()) return;
                playerSeekTo(Math.max(0, getPlayerTime() - 10));
                send({ type: "seek", current_time: getPlayerTime() });
                break;
            case "ArrowRight":
                if (!isHost()) return;
                playerSeekTo(Math.min(getPlayerDuration() || 0, getPlayerTime() + 10));
                send({ type: "seek", current_time: getPlayerTime() });
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
    const userName = appData.dataset.userName;
    if (userName) nicknameInput.value = userName;
    loadRoomInfo();
    connectWS();
})();
