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
    const streamSettingsEl  = $("#streamSettings");
    const streamSettingsBtn = $("#streamSettingsBtn");
    const streamSettingsMenu = $("#streamSettingsMenu");
    const hostBadge       = $("#hostBadge");
    const hostNameEl      = $("#hostName");
    const voteOverlay     = $("#voteOverlay");
    const voteCandidates  = $("#voteCandidates");
    const voteTimer       = $("#voteTimer");

    // People / Media elements
    const peopleCount     = $("#peopleCount");
    const userListEl      = $("#userList");
    const webcamGrid      = $("#webcamGrid");
    const toggleMicBtn    = $("#toggleMicBtn");
    const toggleDeafenBtn = $("#toggleDeafenBtn");
    const toggleWebcamBtn = $("#toggleWebcamBtn");
    const micOnIcon       = $("#micOnIcon");
    const micOffIcon      = $("#micOffIcon");
    const camOnIcon       = $("#camOnIcon");
    const camOffIcon      = $("#camOffIcon");
    const deafenOffIcon   = $("#deafenOffIcon");
    const deafenOnIcon    = $("#deafenOnIcon");

    // Permissions elements
    const mediaPermissions = $("#mediaPermissions");
    const permStatusText   = $("#permStatusText");
    const grantPermBtn     = $("#grantPermBtn");

    // User context menu elements
    const userCtxMenu     = $("#userCtxMenu");
    const userCtxName     = $("#userCtxName");
    const userVolSlider   = $("#userVolSlider");
    const userVolLabel    = $("#userVolLabel");
    const userCtxMuteBtn  = $("#userCtxMuteBtn");

    // Countdown elements
    const countdownOverlay  = $("#countdownOverlay");
    const countdownTimeEl   = $("#countdownTime");
    const countdownMinInput = $("#countdownMinutes");
    const startCountdownBtn = $("#startCountdownBtn");
    const cancelCountdownBtn = $("#cancelCountdownBtn");
    const countdownInputDiv = $("#countdownInput");

    // ---- State ----
    let ws = null;
    let userId = null;
    let hostId = null;
    let ignoreEvents = false;
    let isSeeking = false;
    let voteTimerInterval = null;

    // HLS.js state
    let hlsInstance = null;
    let currentHlsUrl = "";  // active .m3u8 URL (empty when not using HLS)

    // Media state (webcam + voice)
    let localMediaStream = null;     // user's mic/webcam MediaStream
    let micEnabled = false;
    let webcamEnabled = false;
    let isDeafened = false;
    let mediaPeers = {};             // userId -> RTCPeerConnection
    let mutedUsers = {};             // userId -> true (locally muted users)
    let userVolumes = {};            // userId -> 0-100 volume level
    let ctxMenuUserId = null;        // userId currently shown in context menu
    let remoteMediaElements = {};    // userId -> { video, audio }
    let currentUserList = [];        // latest user list from server

    // Countdown state
    let countdownInterval = null;
    let countdownEndTime = 0;

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
        destroyHls();

        if (ytId) {
            videoLoading.style.display = "flex";
            loadYouTubeAPI();
            waitForYTAPI(() => createYouTubePlayer(ytId));
        } else if (url.endsWith(".m3u8")) {
            loadHlsStream(url);
        } else {
            videoLoading.style.display = "flex";
            videoPlayer.src = url;
            videoPlayer.load();
        }
    }

    // ======================================================
    //  HLS.js Adaptive Streaming
    // ======================================================

    const qualitySelector = $("#qualitySelector");
    const qualityBtn      = $("#qualityBtn");
    const qualityLabel    = $("#qualityLabel");
    const qualityMenu     = $("#qualityMenu");

    function destroyHls() {
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        currentHlsUrl = "";
        hideQualitySelector();
    }

    function loadHlsStream(url) {
        destroyHls();
        currentHlsUrl = url;

        if (typeof Hls !== "undefined" && Hls.isSupported()) {
            videoLoading.style.display = "flex";
            const hls = new Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
            });
            hlsInstance = hls;

            hls.loadSource(url);
            hls.attachMedia(videoPlayer);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoLoading.style.display = "none";
                showNativePlayer();
                buildQualityMenu(hls);
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
                updateQualityLabel(data.level);
            });

            hls.on(Hls.Events.ERROR, (_e, data) => {
                if (data.fatal) {
                    videoLoading.style.display = "none";
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        toast("Network error loading stream", "error");
                    } else {
                        toast("Failed to load adaptive stream", "error");
                    }
                }
            });
        } else if (videoPlayer.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari native HLS
            videoLoading.style.display = "flex";
            videoPlayer.src = url;
            videoPlayer.load();
        } else {
            toast("Your browser does not support HLS streaming", "error");
        }
    }

    function buildQualityMenu(hls) {
        if (!hls || !hls.levels || hls.levels.length < 2) {
            hideQualitySelector();
            return;
        }
        qualityMenu.innerHTML = "";
        // Auto option
        const autoItem = document.createElement("button");
        autoItem.className = "quality-item active";
        autoItem.textContent = "Auto";
        autoItem.dataset.level = "-1";
        autoItem.addEventListener("click", () => setQuality(hls, -1));
        qualityMenu.appendChild(autoItem);

        hls.levels.forEach((level, i) => {
            const item = document.createElement("button");
            item.className = "quality-item";
            item.textContent = level.height + "p";
            item.dataset.level = String(i);
            item.addEventListener("click", () => setQuality(hls, i));
            qualityMenu.appendChild(item);
        });

        qualitySelector.style.display = "";
        qualityLabel.textContent = "AUTO";
    }

    function setQuality(hls, level) {
        hls.currentLevel = level;  // -1 = auto
        // Update active class
        qualityMenu.querySelectorAll(".quality-item").forEach(el => {
            el.classList.toggle("active", parseInt(el.dataset.level) === level);
        });
        updateQualityLabel(level);
        qualityMenu.style.display = "none";
    }

    function updateQualityLabel(level) {
        if (!hlsInstance) return;
        if (level < 0 || hlsInstance.autoLevelEnabled) {
            const actual = hlsInstance.currentLevel;
            const h = actual >= 0 && hlsInstance.levels[actual] ? hlsInstance.levels[actual].height + "p" : "";
            qualityLabel.textContent = h ? "AUTO" : "AUTO";
        } else if (hlsInstance.levels[level]) {
            qualityLabel.textContent = hlsInstance.levels[level].height + "p";
        }
    }

    function hideQualitySelector() {
        if (qualitySelector) qualitySelector.style.display = "none";
        if (qualityMenu) qualityMenu.style.display = "none";
    }

    // Toggle quality menu
    if (qualityBtn) {
        qualityBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const open = qualityMenu.style.display !== "none";
            qualityMenu.style.display = open ? "none" : "";
        });
    }
    // Close quality menu on outside click
    document.addEventListener("click", () => {
        if (qualityMenu) qualityMenu.style.display = "none";
    });

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
            // Tell server our display name and picture
            const alias = localStorage.getItem("snuggle_alias");
            const name = alias || appData.dataset.userName || "Anonymous";
            const picture = appData.dataset.userPicture || "";
            send({ type: "set_name", name: name, picture: picture });
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
                // If screen sharing is active and we're a viewer, skip video load
                // and wait for WebRTC offer from host
                if (data.screen_share_active && data.user_id !== data.host_id) {
                    hideAllPlayers();
                    videoEmpty.style.display = "";
                    videoEmpty.querySelector("h3").textContent = "Waiting for screen share…";
                    videoEmpty.querySelector("p").textContent = "The host is sharing their screen. Connecting…";
                    break;
                }
                if (data.hls_url) {
                    loadVideo(data.hls_url, data.video_type);
                } else if (data.video_url) {
                    loadVideo(data.video_url, data.video_type);
                }
                if (data.playback_rate) {
                    playerSetRate(data.playback_rate);
                    rateSelect.value = data.playback_rate;
                }
                syncPlayback(data.current_time, data.is_playing);
                // Handle active countdown
                if (data.countdown_end && data.countdown_end > Date.now() / 1000) {
                    startCountdownDisplay(data.countdown_end);
                }
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
                // If host is screen sharing, directly create peer for the new viewer
                if (screenStream && isHost() && data.new_viewer_id) {
                    createPeerForViewer(data.new_viewer_id);
                }
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

            case "hls_ready":
                if (data.hls_url) {
                    toast("Adaptive stream ready — switching to HD", "success");
                    const curTime = getPlayerTime();
                    const wasPlaying = !isPlayerPaused();
                    loadVideo(data.hls_url, "file");
                    // Restore position after HLS loads
                    const waitReady = setInterval(() => {
                        if (activePlayer === "native" && videoPlayer.readyState >= 1) {
                            clearInterval(waitReady);
                            playerSeekTo(curTime);
                            if (wasPlaying) playerPlay();
                        }
                    }, 200);
                    setTimeout(() => clearInterval(waitReady), 15000);
                }
                break;

            case "error":
                toast(data.message || "Action not allowed", "error");
                break;

            // ---- WebRTC screen share ----
            case "screen_share_start":
                addChatEvent("started screen sharing");
                break;

            case "screen_share_stop":
                onRemoteScreenShareStop();
                addChatEvent("stopped screen sharing");
                break;

            case "webrtc_offer":
                handleWebRTCOffer(data.offer, data.user_id);
                break;

            case "webrtc_answer":
                handleWebRTCAnswer(data.answer, data.user_id);
                break;

            case "webrtc_ice":
                handleWebRTCIce(data.candidate, data.user_id);
                break;

            case "viewer_list":
                // Host received list of viewers to send offers to
                if (screenStream && isHost() && data.viewers) {
                    data.viewers.forEach(vid => createPeerForViewer(vid));
                }
                break;

            // ---- User list ----
            case "user_list":
                currentUserList = data.users || [];
                renderUserList();
                break;

            // ---- Countdown ----
            case "countdown_start":
                startCountdownDisplay(data.countdown_end);
                addChatEvent("started a countdown timer");
                break;

            case "countdown_cancel":
                stopCountdownDisplay();
                addChatEvent("cancelled the countdown");
                break;

            // ---- Minigame (bot) ----
            case "minigame":
                handleMinigameMessage(data);
                break;

            // ---- WebRTC media mesh (webcam + voice) ----
            case "media_offer":
                handleMediaOffer(data.offer, data.user_id, data.media_types || []);
                break;

            case "media_answer":
                handleMediaAnswer(data.answer, data.user_id);
                break;

            case "media_ice":
                handleMediaIce(data.candidate, data.user_id);
                break;

            case "media_state":
                updateRemoteMediaState(data.user_id, data.webcam, data.mic);
                break;

            case "media_stop":
                cleanupMediaPeer(data.user_id);
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
    const screenShareInput = $("#screenShareInput");
    srcTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            srcTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            urlInputDiv.style.display      = tab.dataset.source === "url"    ? "" : "none";
            uploadInputDiv.style.display   = tab.dataset.source === "upload" ? "" : "none";
            if (screenShareInput) screenShareInput.style.display = tab.dataset.source === "screen" ? "" : "none";
            if (countdownInputDiv) countdownInputDiv.style.display = tab.dataset.source === "countdown" ? "" : "none";
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
                toast("Video uploaded! Transcoding for adaptive quality...", "success");
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

    // ======================================================
    //  WebRTC Screen Sharing
    // ======================================================

    const startScreenBtn = $("#startScreenShare");
    const stopScreenBtn  = $("#stopScreenShare");

    let screenStream = null;           // host's captured MediaStream
    let peerConnections = {};          // host side: userId -> RTCPeerConnection
    let viewerPC = null;               // viewer side: single RTCPeerConnection

    const rtcConfig = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };

    // ---- Stream quality settings (cogwheel) ----
    let targetVideoBitrate = 3000000;   // default: High (3 Mbps)
    let targetAudioBitrate = 256000;    // default: 256 kbps

    if (streamSettingsBtn) {
        streamSettingsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            streamSettingsMenu.style.display = streamSettingsMenu.style.display === "none" ? "" : "none";
        });
    }
    // Close menu on outside click
    document.addEventListener("click", () => {
        if (streamSettingsMenu) streamSettingsMenu.style.display = "none";
    });
    if (streamSettingsMenu) {
        streamSettingsMenu.addEventListener("click", (e) => e.stopPropagation());
    }

    // Handle video bitrate items
    document.querySelectorAll("[data-vbitrate]").forEach(btn => {
        btn.addEventListener("click", () => {
            targetVideoBitrate = parseInt(btn.dataset.vbitrate, 10);
            document.querySelectorAll("[data-vbitrate]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            applyBitrateToSenders();
        });
    });
    // Handle audio bitrate items
    document.querySelectorAll("[data-abitrate]").forEach(btn => {
        btn.addEventListener("click", () => {
            targetAudioBitrate = parseInt(btn.dataset.abitrate, 10);
            document.querySelectorAll("[data-abitrate]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            applyBitrateToSenders();
        });
    });

    // Apply bitrate limits to all active peer connection senders (host side)
    async function applyBitrateToSenders() {
        for (const pc of Object.values(peerConnections)) {
            for (const sender of pc.getSenders()) {
                if (!sender.track) continue;
                const params = sender.getParameters();
                if (!params.encodings || params.encodings.length === 0) {
                    params.encodings = [{}];
                }
                if (sender.track.kind === "video") {
                    params.encodings[0].maxBitrate = targetVideoBitrate;
                } else if (sender.track.kind === "audio") {
                    params.encodings[0].maxBitrate = targetAudioBitrate;
                }
                try { await sender.setParameters(params); } catch (_) { /* ignore */ }
            }
        }
    }

    function showStreamSettings() {
        if (streamSettingsEl) streamSettingsEl.style.display = "";
    }
    function hideStreamSettings() {
        if (streamSettingsEl) streamSettingsEl.style.display = "none";
        if (streamSettingsMenu) streamSettingsMenu.style.display = "none";
    }

    // --- Host: start screen capture ---
    if (startScreenBtn) {
        startScreenBtn.addEventListener("click", async () => {
            if (!isHost()) { toast("Only the host can share their screen", "error"); return; }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                toast("Screen sharing is not supported in your browser. Make sure you're using HTTPS.", "error");
                return;
            }
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always", frameRate: { ideal: 30 } },
                    audio: {
                        sampleRate: 48000,
                        channelCount: 2,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });
            } catch (err) {
                if (err.name === "NotAllowedError") {
                    toast("Screen share was cancelled", "info");
                } else {
                    toast("Screen share failed: " + err.message, "error");
                }
                return;
            }

            // Show the stream locally
            hideAllPlayers();
            videoPlayer.srcObject = screenStream;
            videoPlayer.muted = true;
            videoPlayer.play().catch(() => {});
            showNativePlayer();
            startScreenBtn.style.display = "none";
            stopScreenBtn.style.display = "";
            showStreamSettings();

            // Notify all viewers via WebSocket
            send({ type: "screen_share_start" });

            // Create peer connections for every current viewer
            const roomInfo = await fetch(`/api/rooms/${ROOM_CODE}`).then(r => r.json()).catch(() => null);
            // We'll send offers as viewers request them via the sync re-request

            // When host stops sharing via browser chrome button
            screenStream.getVideoTracks()[0].addEventListener("ended", () => {
                stopScreenShare();
            });

            // Send offers to all current room members
            sendOffersToAll();
        });
    }

    if (stopScreenBtn) {
        stopScreenBtn.addEventListener("click", () => stopScreenShare());
    }

    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }
        // Close all host-side peer connections
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};

        videoPlayer.srcObject = null;
        hideAllPlayers();
        videoEmpty.style.display = "";

        if (startScreenBtn) startScreenBtn.style.display = "";
        if (stopScreenBtn) stopScreenBtn.style.display = "none";
        hideStreamSettings();

        send({ type: "screen_share_stop" });
        addChatEvent("stopped screen sharing");
    }

    // Host: send WebRTC offers to every viewer in the room
    async function sendOffersToAll() {
        // Request the server tell us who's connected via a viewer_update
        // We'll piggyback on the ws connection list known server-side
        // For simplicity, we broadcast offer and let signaling route to each user
        send({ type: "request_viewer_list" });
    }

    // Host: create a peer connection for a specific viewer
    async function createPeerForViewer(viewerId) {
        if (!screenStream || peerConnections[viewerId]) return;

        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections[viewerId] = pc;

        screenStream.getTracks().forEach(track => {
            pc.addTrack(track, screenStream);
        });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "webrtc_ice", target: viewerId, candidate: e.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
                pc.close();
                delete peerConnections[viewerId];
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: "webrtc_offer", target: viewerId, offer: pc.localDescription });

        // Apply current bitrate limits to this peer's senders
        for (const sender of pc.getSenders()) {
            if (!sender.track) continue;
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            params.encodings[0].maxBitrate = sender.track.kind === "video" ? targetVideoBitrate : targetAudioBitrate;
            try { await sender.setParameters(params); } catch (_) {}
        }
    }

    // Viewer: handle incoming WebRTC offer from host
    async function handleWebRTCOffer(offer, fromUserId) {
        // Close existing viewer connection if any
        if (viewerPC) { viewerPC.close(); viewerPC = null; }

        const pc = new RTCPeerConnection(rtcConfig);
        viewerPC = pc;

        pc.ontrack = (e) => {
            hideAllPlayers();
            videoPlayer.srcObject = e.streams[0];
            videoPlayer.muted = false;
            videoPlayer.play().catch(() => {});
            showNativePlayer();
            // Hide normal video controls for screen share — it's live
            videoControls.style.display = "none";
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "webrtc_ice", target: fromUserId, candidate: e.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") {
                toast("Screen share connection lost", "error");
                onRemoteScreenShareStop();
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "webrtc_answer", target: fromUserId, answer: pc.localDescription });
    }

    // Host: handle incoming WebRTC answer from a viewer
    async function handleWebRTCAnswer(answer, fromUserId) {
        const pc = peerConnections[fromUserId];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    // Both: handle incoming ICE candidate
    async function handleWebRTCIce(candidate, fromUserId) {
        let pc;
        if (isHost()) {
            pc = peerConnections[fromUserId];
        } else {
            pc = viewerPC;
        }
        if (pc && candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) { /* ignore late candidates */ }
        }
    }

    // Viewer: host stopped screen share remotely
    function onRemoteScreenShareStop() {
        if (viewerPC) { viewerPC.close(); viewerPC = null; }
        videoPlayer.srcObject = null;
        hideAllPlayers();
        videoEmpty.style.display = "";
        videoEmpty.querySelector("h3").textContent = "No Video Loaded";
        videoEmpty.querySelector("p").textContent = "Add a video URL or upload a file below to start watching.";
    }

    // ======================================================
    //  Sidebar Tabs (Chat / People)
    // ======================================================

    const sidebarTabs = document.querySelectorAll(".sidebar-tab");
    const chatPanel   = $("#chatPanel");
    const peoplePanel = $("#peoplePanel");

    sidebarTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            sidebarTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const panel = tab.dataset.panel;
            chatPanel.classList.toggle("active", panel === "chat");
            peoplePanel.classList.toggle("active", panel === "people");
        });
    });

    // ======================================================
    //  Media Permissions
    // ======================================================

    async function checkMediaPermissions() {
        if (!navigator.permissions || !navigator.permissions.query) {
            // Browser doesn't support permissions API — hide banner, rely on getUserMedia prompt
            if (mediaPermissions) mediaPermissions.style.display = "none";
            return;
        }
        try {
            const [mic, cam] = await Promise.all([
                navigator.permissions.query({ name: "microphone" }),
                navigator.permissions.query({ name: "camera" }),
            ]);
            updatePermBanner(mic.state, cam.state);
            mic.addEventListener("change", () => updatePermBanner(mic.state, cam.state));
            cam.addEventListener("change", () => updatePermBanner(mic.state, cam.state));
        } catch {
            // Permissions API not supported for these — hide banner
            if (mediaPermissions) mediaPermissions.style.display = "none";
        }
    }

    function updatePermBanner(micState, camState) {
        if (!mediaPermissions) return;
        const micOk = micState === "granted";
        const camOk = camState === "granted";
        if (micOk && camOk) {
            mediaPermissions.classList.add("granted");
            permStatusText.textContent = "Camera & mic allowed";
            grantPermBtn.style.display = "none";
        } else if (micState === "denied" || camState === "denied") {
            mediaPermissions.classList.add("denied");
            mediaPermissions.classList.remove("granted");
            const denied = [];
            if (micState === "denied") denied.push("mic");
            if (camState === "denied") denied.push("camera");
            permStatusText.textContent = denied.join(" & ") + " blocked — check browser settings";
            grantPermBtn.textContent = "Retry";
            grantPermBtn.style.display = "";
        } else {
            mediaPermissions.classList.remove("granted", "denied");
            const needed = [];
            if (!micOk) needed.push("mic");
            if (!camOk) needed.push("camera");
            permStatusText.textContent = (needed.join(" & ") || "Camera & mic") + " access needed";
            grantPermBtn.textContent = "Allow Access";
            grantPermBtn.style.display = "";
        }
    }

    if (grantPermBtn) {
        grantPermBtn.addEventListener("click", async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                // Immediately stop — we just wanted the permission grant
                stream.getTracks().forEach(t => t.stop());
                toast("Camera & microphone access granted", "success");
                checkMediaPermissions();
            } catch (err) {
                if (err.name === "NotAllowedError") {
                    toast("Permission denied — check your browser's site settings", "error");
                } else {
                    toast("Could not access media devices: " + err.message, "error");
                }
                checkMediaPermissions();
            }
        });
    }

    // Check on load
    checkMediaPermissions();

    // ======================================================
    //  User Context Menu (right-click volume control)
    // ======================================================

    function showUserCtxMenu(e, uid) {
        e.preventDefault();
        const user = currentUserList.find(u => u.user_id === uid);
        if (!user) return;

        ctxMenuUserId = uid;
        userCtxName.textContent = user.name;

        const vol = userVolumes[uid] !== undefined ? userVolumes[uid] : 100;
        userVolSlider.value = vol;
        userVolLabel.textContent = vol + "%";

        const isMuted = !!mutedUsers[uid];
        userCtxMuteBtn.textContent = isMuted ? "Unmute" : "Mute";
        userCtxMuteBtn.classList.toggle("muted", isMuted);

        // Position near cursor, clamped to viewport
        userCtxMenu.style.display = "";
        const menuW = userCtxMenu.offsetWidth || 200;
        const menuH = userCtxMenu.offsetHeight || 120;
        let x = e.clientX;
        let y = e.clientY;
        if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
        if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
        if (x < 4) x = 4;
        if (y < 4) y = 4;
        userCtxMenu.style.left = x + "px";
        userCtxMenu.style.top  = y + "px";
    }

    function hideUserCtxMenu() {
        if (userCtxMenu) userCtxMenu.style.display = "none";
        ctxMenuUserId = null;
    }

    // Close context menu on click elsewhere or Escape
    document.addEventListener("click", (e) => {
        if (userCtxMenu && !userCtxMenu.contains(e.target)) hideUserCtxMenu();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hideUserCtxMenu();
    });

    if (userVolSlider) {
        userVolSlider.addEventListener("input", () => {
            const vol = parseInt(userVolSlider.value, 10);
            userVolLabel.textContent = vol + "%";
            if (ctxMenuUserId) {
                userVolumes[ctxMenuUserId] = vol;
                applyUserVolume(ctxMenuUserId);
            }
        });
    }

    if (userCtxMuteBtn) {
        userCtxMuteBtn.addEventListener("click", () => {
            if (!ctxMenuUserId) return;
            toggleMuteUser(ctxMenuUserId);
            const isMuted = !!mutedUsers[ctxMenuUserId];
            userCtxMuteBtn.textContent = isMuted ? "Unmute" : "Mute";
            userCtxMuteBtn.classList.toggle("muted", isMuted);
        });
    }

    function applyUserVolume(uid) {
        const elems = remoteMediaElements[uid];
        if (elems && elems.audio) {
            const vol = userVolumes[uid] !== undefined ? userVolumes[uid] : 100;
            elems.audio.volume = vol / 100;
        }
    }

    // ======================================================
    //  User List
    // ======================================================

    function renderUserList() {
        if (!userListEl) return;
        userListEl.innerHTML = "";
        if (peopleCount) peopleCount.textContent = currentUserList.length;
        viewerCount.textContent = currentUserList.length;

        currentUserList.forEach(u => {
            const item = document.createElement("div");
            item.className = "user-list-item" + (u.user_id === userId ? " is-me" : "");

            const avatar = document.createElement("img");
            avatar.className = "user-list-avatar";
            avatar.src = u.picture || "/static/assets/kitty.png";
            avatar.alt = "";
            avatar.referrerPolicy = "no-referrer";

            const nameSpan = document.createElement("span");
            nameSpan.className = "user-list-name";
            nameSpan.textContent = u.name + (u.user_id === userId ? " (You)" : "");

            const badges = document.createElement("span");
            badges.className = "user-list-badges";
            if (u.is_host) {
                const star = document.createElement("span");
                star.className = "user-list-host-badge";
                star.title = "Host";
                star.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
                badges.appendChild(star);
            }

            // Mute button (can't mute yourself)
            if (u.user_id !== userId) {
                const muteUserBtn = document.createElement("button");
                muteUserBtn.className = "user-list-mute-btn" + (mutedUsers[u.user_id] ? " muted" : "");
                muteUserBtn.title = mutedUsers[u.user_id] ? "Unmute this user" : "Mute this user";
                muteUserBtn.innerHTML = mutedUsers[u.user_id]
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
                muteUserBtn.addEventListener("click", () => toggleMuteUser(u.user_id));
                badges.appendChild(muteUserBtn);
            }

            item.appendChild(avatar);
            item.appendChild(nameSpan);
            item.appendChild(badges);

            // Right-click context menu for volume (not on yourself)
            if (u.user_id !== userId) {
                item.addEventListener("contextmenu", (e) => showUserCtxMenu(e, u.user_id));
                // Show volume indicator if not default
                const vol = userVolumes[u.user_id];
                if (vol !== undefined && vol < 100) {
                    const volBadge = document.createElement("span");
                    volBadge.className = "user-list-vol-badge";
                    volBadge.textContent = vol + "%";
                    badges.appendChild(volBadge);
                }
            }

            userListEl.appendChild(item);
        });
    }

    function toggleMuteUser(uid) {
        if (mutedUsers[uid]) {
            delete mutedUsers[uid];
        } else {
            mutedUsers[uid] = true;
        }
        // Mute/unmute the remote audio for this user
        applyMuteState(uid);
        renderUserList();
    }

    function applyMuteState(uid) {
        const elems = remoteMediaElements[uid];
        if (elems && elems.audio) {
            elems.audio.muted = !!(mutedUsers[uid] || isDeafened);
            const vol = userVolumes[uid] !== undefined ? userVolumes[uid] : 100;
            elems.audio.volume = vol / 100;
        }
    }

    // ======================================================
    //  Countdown Timer
    // ======================================================

    if (startCountdownBtn) {
        startCountdownBtn.addEventListener("click", () => {
            const mins = parseInt(countdownMinInput.value, 10);
            if (!mins || mins < 1 || mins > 1440) {
                toast("Enter 1–1440 minutes", "error");
                return;
            }
            send({ type: "countdown_start", minutes: mins });
        });
    }

    if (cancelCountdownBtn) {
        cancelCountdownBtn.addEventListener("click", () => {
            send({ type: "countdown_cancel" });
        });
    }

    function startCountdownDisplay(endTime) {
        countdownEndTime = endTime;
        if (countdownInterval) clearInterval(countdownInterval);

        countdownOverlay.style.display = "flex";
        if (cancelCountdownBtn) {
            cancelCountdownBtn.style.display = isHost() ? "" : "none";
        }

        function tick() {
            const remaining = Math.max(0, countdownEndTime - (Date.now() / 1000));
            if (remaining <= 0) {
                stopCountdownDisplay();
                toast("Countdown finished!", "success");
                // Auto-play if host
                if (isHost() && isPlayerPaused()) {
                    playerPlay();
                }
                return;
            }
            const h = Math.floor(remaining / 3600);
            const m = Math.floor((remaining % 3600) / 60);
            const s = Math.floor(remaining % 60);
            if (h > 0) {
                countdownTimeEl.textContent = `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
            } else {
                countdownTimeEl.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
            }
        }
        tick();
        countdownInterval = setInterval(tick, 1000);
    }

    function stopCountdownDisplay() {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        countdownOverlay.style.display = "none";
        countdownEndTime = 0;
    }

    // ======================================================
    //  WebRTC Media Mesh (Webcam + Voice Chat)
    // ======================================================

    const mediaRtcConfig = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };

    // Toggle Mic
    if (toggleMicBtn) {
        toggleMicBtn.addEventListener("click", async () => {
            if (!micEnabled) {
                await startLocalMedia(true, webcamEnabled);
            } else {
                // Disable mic track
                if (localMediaStream) {
                    localMediaStream.getAudioTracks().forEach(t => { t.enabled = false; t.stop(); });
                    // Remove audio tracks from stream
                    localMediaStream.getAudioTracks().forEach(t => localMediaStream.removeTrack(t));
                }
                micEnabled = false;
                updateMediaUI();
                send({ type: "media_state", webcam: webcamEnabled, mic: micEnabled });
                // If both off, stop everything
                if (!webcamEnabled) stopLocalMedia();
            }
        });
    }

    // Toggle Webcam
    if (toggleWebcamBtn) {
        toggleWebcamBtn.addEventListener("click", async () => {
            if (!webcamEnabled) {
                await startLocalMedia(micEnabled, true);
            } else {
                if (localMediaStream) {
                    localMediaStream.getVideoTracks().forEach(t => { t.enabled = false; t.stop(); });
                    localMediaStream.getVideoTracks().forEach(t => localMediaStream.removeTrack(t));
                }
                webcamEnabled = false;
                updateMediaUI();
                removeLocalWebcamPreview();
                send({ type: "media_state", webcam: webcamEnabled, mic: micEnabled });
                if (!micEnabled) stopLocalMedia();
            }
        });
    }

    // Toggle Deafen
    if (toggleDeafenBtn) {
        toggleDeafenBtn.addEventListener("click", () => {
            isDeafened = !isDeafened;
            deafenOffIcon.style.display = isDeafened ? "none" : "";
            deafenOnIcon.style.display  = isDeafened ? "" : "none";
            toggleDeafenBtn.classList.toggle("active", isDeafened);
            // Mute/unmute all remote audio
            for (const uid of Object.keys(remoteMediaElements)) {
                applyMuteState(uid);
            }
            toast(isDeafened ? "Deafened" : "Undeafened", "info");
        });
    }

    function updateMediaUI() {
        micOnIcon.style.display  = micEnabled ? "" : "none";
        micOffIcon.style.display = micEnabled ? "none" : "";
        toggleMicBtn.classList.toggle("active", micEnabled);

        camOnIcon.style.display  = webcamEnabled ? "" : "none";
        camOffIcon.style.display = webcamEnabled ? "none" : "";
        toggleWebcamBtn.classList.toggle("active", webcamEnabled);
    }

    async function startLocalMedia(wantAudio, wantVideo) {
        const constraints = {};
        if (wantAudio) constraints.audio = { echoCancellation: true, noiseSuppression: true };
        if (wantVideo) constraints.video = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            if (!localMediaStream) {
                localMediaStream = new MediaStream();
            }

            // Add new tracks
            stream.getTracks().forEach(t => {
                // Remove existing track of same kind
                localMediaStream.getTracks().filter(et => et.kind === t.kind).forEach(et => {
                    et.stop();
                    localMediaStream.removeTrack(et);
                });
                localMediaStream.addTrack(t);
            });

            micEnabled = wantAudio;
            webcamEnabled = wantVideo;
            updateMediaUI();

            // Show local webcam preview
            if (webcamEnabled) showLocalWebcamPreview();

            // Broadcast state
            send({ type: "media_state", webcam: webcamEnabled, mic: micEnabled });

            // Create/update peer connections with all other users
            connectMediaPeers();

        } catch (err) {
            if (err.name === "NotAllowedError") {
                toast("Permission denied for camera/microphone", "error");
            } else {
                toast("Could not access media device: " + err.message, "error");
            }
        }
    }

    function stopLocalMedia() {
        if (localMediaStream) {
            localMediaStream.getTracks().forEach(t => t.stop());
            localMediaStream = null;
        }
        micEnabled = false;
        webcamEnabled = false;
        updateMediaUI();
        removeLocalWebcamPreview();

        // Close all media peer connections
        for (const uid of Object.keys(mediaPeers)) {
            mediaPeers[uid].close();
            delete mediaPeers[uid];
        }
        send({ type: "media_stop" });
    }

    function showLocalWebcamPreview() {
        removeLocalWebcamPreview();
        const container = document.createElement("div");
        container.className = "webcam-tile";
        container.id = "localWebcam";
        const video = document.createElement("video");
        video.srcObject = localMediaStream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        const label = document.createElement("span");
        label.className = "webcam-label";
        label.textContent = "You";
        container.appendChild(video);
        container.appendChild(label);
        webcamGrid.appendChild(container);
    }

    function removeLocalWebcamPreview() {
        const el = document.getElementById("localWebcam");
        if (el) el.remove();
    }

    function connectMediaPeers() {
        // Create offers to all users we know about
        currentUserList.forEach(u => {
            if (u.user_id === userId) return;
            if (mediaPeers[u.user_id]) return; // already connected
            createMediaPeer(u.user_id, true);
        });
    }

    function createMediaPeer(remoteId, isInitiator) {
        if (mediaPeers[remoteId]) {
            mediaPeers[remoteId].close();
        }

        const pc = new RTCPeerConnection(mediaRtcConfig);
        mediaPeers[remoteId] = pc;

        // Add local tracks if we have them
        if (localMediaStream) {
            localMediaStream.getTracks().forEach(track => {
                pc.addTrack(track, localMediaStream);
            });
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "media_ice", target: remoteId, candidate: e.candidate });
            }
        };

        pc.ontrack = (e) => {
            handleRemoteTrack(remoteId, e.streams[0], e.track);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
                pc.close();
                delete mediaPeers[remoteId];
            }
        };

        if (isInitiator) {
            pc.createOffer().then(offer => {
                return pc.setLocalDescription(offer);
            }).then(() => {
                const mediaTypes = [];
                if (micEnabled) mediaTypes.push("audio");
                if (webcamEnabled) mediaTypes.push("video");
                send({ type: "media_offer", target: remoteId, offer: pc.localDescription, media_types: mediaTypes });
            }).catch(() => {});
        }

        return pc;
    }

    function handleRemoteTrack(remoteId, stream, track) {
        if (!remoteMediaElements[remoteId]) {
            remoteMediaElements[remoteId] = {};
        }

        if (track.kind === "video") {
            // Create or update webcam tile
            let tileId = "webcam-" + remoteId;
            let tile = document.getElementById(tileId);
            if (!tile) {
                tile = document.createElement("div");
                tile.className = "webcam-tile";
                tile.id = tileId;
                const video = document.createElement("video");
                video.autoplay = true;
                video.playsInline = true;
                video.srcObject = stream;
                const label = document.createElement("span");
                label.className = "webcam-label";
                const user = currentUserList.find(u => u.user_id === remoteId);
                label.textContent = user ? user.name : "User";
                tile.appendChild(video);
                tile.appendChild(label);
                webcamGrid.appendChild(tile);
                remoteMediaElements[remoteId].video = video;
            } else {
                const video = tile.querySelector("video");
                if (video) {
                    video.srcObject = stream;
                    remoteMediaElements[remoteId].video = video;
                }
            }
        }

        if (track.kind === "audio") {
            let audio = remoteMediaElements[remoteId].audio;
            if (!audio) {
                audio = document.createElement("audio");
                audio.autoplay = true;
                document.body.appendChild(audio);
                remoteMediaElements[remoteId].audio = audio;
            }
            audio.srcObject = stream;
            audio.muted = !!(mutedUsers[remoteId] || isDeafened);
            const vol = userVolumes[remoteId] !== undefined ? userVolumes[remoteId] : 100;
            audio.volume = vol / 100;
        }
    }

    async function handleMediaOffer(offer, fromUserId, mediaTypes) {
        const pc = createMediaPeer(fromUserId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "media_answer", target: fromUserId, answer: pc.localDescription });
    }

    async function handleMediaAnswer(answer, fromUserId) {
        const pc = mediaPeers[fromUserId];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    async function handleMediaIce(candidate, fromUserId) {
        const pc = mediaPeers[fromUserId];
        if (pc && candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (_) {}
        }
    }

    function updateRemoteMediaState(uid, hasWebcam, hasMic) {
        // Update UI indicators if needed
        // Remove webcam tile if they stopped video
        if (!hasWebcam) {
            const tile = document.getElementById("webcam-" + uid);
            if (tile) tile.remove();
            if (remoteMediaElements[uid]) delete remoteMediaElements[uid].video;
        }
    }

    function cleanupMediaPeer(uid) {
        if (mediaPeers[uid]) {
            mediaPeers[uid].close();
            delete mediaPeers[uid];
        }
        // Remove webcam tile
        const tile = document.getElementById("webcam-" + uid);
        if (tile) tile.remove();
        // Remove audio element
        if (remoteMediaElements[uid]) {
            if (remoteMediaElements[uid].audio) {
                remoteMediaElements[uid].audio.srcObject = null;
                remoteMediaElements[uid].audio.remove();
            }
            delete remoteMediaElements[uid];
        }
    }

    // ======================================================
    //  Mini-games (Drinking Game Bot)
    // ======================================================

    const startGameBtn   = $("#startGameBtn");
    const minigameBanner = $("#minigameBanner");
    const minigameBannerText = $("#minigameBannerText");
    const stopGameBtn    = $("#stopGameBtn");

    // Start a drinking game vote (host only)
    if (startGameBtn) {
        startGameBtn.addEventListener("click", () => {
            if (!isHost()) { toast("Only the host can start a mini-game", "error"); return; }
            send({ type: "minigame_start" });
        });
    }

    // Stop an active game (host only)
    if (stopGameBtn) {
        stopGameBtn.addEventListener("click", () => {
            send({ type: "minigame_stop" });
        });
    }

    function handleMinigameMessage(data) {
        switch (data.subtype) {
            case "opt_in_vote":
                showOptInVote(data.timeout);
                break;
            case "opt_in_result":
                // Remove opt-in vote card from chat
                removeMinigameCard("opt-in-card");
                break;
            case "topic_vote":
                showTopicVote(data.topics, data.timeout);
                break;
            case "topic_result":
                removeMinigameCard("topic-card");
                break;
            case "game_active":
                showGameBanner(data.topic);
                break;
            case "game_stopped":
                hideGameBanner();
                if (data.cooldown && isHost()) startGameCooldown(data.cooldown);
                break;
        }
    }

    function showOptInVote(timeout) {
        const near = isNearBottom();
        const card = document.createElement("div");
        card.className = "chat-minigame-card opt-in-card";
        card.innerHTML = `
            <div class="minigame-card-header">
                <span class="minigame-card-icon">🎲</span>
                <span class="minigame-card-title">Drinking Game?</span>
                <span class="minigame-card-timer" id="optInTimer">${timeout}s</span>
            </div>
            <p class="minigame-card-desc">Vote whether to start a drinking game!</p>
            <div class="minigame-card-actions">
                <button class="minigame-vote-btn yes" data-vote="yes">👍 Yes!</button>
                <button class="minigame-vote-btn no" data-vote="no">👎 No</button>
            </div>
        `;
        chatMessages.appendChild(card);

        const timerEl = card.querySelector("#optInTimer");
        let remaining = timeout;
        const interval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(interval);
                timerEl.textContent = "...";
            } else {
                timerEl.textContent = remaining + "s";
            }
        }, 1000);

        card.querySelector('[data-vote="yes"]').addEventListener("click", () => {
            send({ type: "minigame_opt_in", vote: true });
            disableCardButtons(card);
        });
        card.querySelector('[data-vote="no"]').addEventListener("click", () => {
            send({ type: "minigame_opt_in", vote: false });
            disableCardButtons(card);
        });

        if (near) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showTopicVote(topics, timeout) {
        const near = isNearBottom();
        const card = document.createElement("div");
        card.className = "chat-minigame-card topic-card";
        let buttonsHtml = "";
        topics.forEach((topic, idx) => {
            buttonsHtml += `<button class="minigame-topic-btn" data-choice="${idx}">${escapeHtml(topic)}</button>`;
        });
        card.innerHTML = `
            <div class="minigame-card-header">
                <span class="minigame-card-icon">🍻</span>
                <span class="minigame-card-title">Pick a Game!</span>
                <span class="minigame-card-timer" id="topicTimer">${timeout}s</span>
            </div>
            <div class="minigame-topic-list">${buttonsHtml}</div>
        `;
        chatMessages.appendChild(card);

        const timerEl = card.querySelector("#topicTimer");
        let remaining = timeout;
        const interval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(interval);
                timerEl.textContent = "...";
            } else {
                timerEl.textContent = remaining + "s";
            }
        }, 1000);

        card.querySelectorAll(".minigame-topic-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const choice = parseInt(btn.dataset.choice, 10);
                send({ type: "minigame_topic_vote", choice: choice });
                disableCardButtons(card);
                btn.classList.add("voted");
            });
        });

        if (near) chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function disableCardButtons(card) {
        card.querySelectorAll("button").forEach(b => { b.disabled = true; });
    }

    function removeMinigameCard(className) {
        const cards = chatMessages.querySelectorAll("." + className);
        cards.forEach(c => {
            c.querySelectorAll("button").forEach(b => { b.disabled = true; });
        });
    }

    function showGameBanner(topic) {
        if (minigameBanner) {
            minigameBanner.style.display = "flex";
            minigameBannerText.textContent = topic;
            if (stopGameBtn) stopGameBtn.style.display = isHost() ? "" : "none";
        }
    }

    function hideGameBanner() {
        if (minigameBanner) {
            minigameBanner.style.display = "none";
            minigameBannerText.textContent = "";
        }
    }

    let _gameCooldownInterval = null;
    function startGameCooldown(seconds) {
        if (!startGameBtn) return;
        startGameBtn.disabled = true;
        let remaining = seconds;
        startGameBtn.textContent = remaining + "s";
        _gameCooldownInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(_gameCooldownInterval);
                _gameCooldownInterval = null;
                startGameBtn.disabled = false;
                startGameBtn.textContent = "🎲";
            } else {
                startGameBtn.textContent = remaining + "s";
            }
        }, 1000);
    }

    // ---- Init ----
    const storedAlias = localStorage.getItem("snuggle_alias");
    const userName = storedAlias || appData.dataset.userName;
    if (userName) nicknameInput.value = userName;
    loadRoomInfo();
    connectWS();

    // Auto-start screen share if redirected from home page with ?screen=1
    if (new URLSearchParams(window.location.search).get("screen") === "1") {
        // Wait for WS to connect and host status to be set
        const waitForHost = setInterval(() => {
            if (userId && isHost() && startScreenBtn) {
                clearInterval(waitForHost);
                startScreenBtn.click();
            }
        }, 500);
        setTimeout(() => clearInterval(waitForHost), 10000);
    }
})();
