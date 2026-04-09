/* SnuggleStream — Ambient Mood Glow for Video
 *
 * Samples the currently playing video and projects a soft coloured glow
 * behind the video container, similar to YouTube's ambient mode.
 *
 * Works with the native <video> element only (YouTube embeds block
 * cross-origin canvas reads due to their iframe sandbox).
 */
(function () {
    "use strict";

    var SAMPLE_INTERVAL = 1000; // ms between glow updates
    var CANVAS_SIZE = 8;        // tiny canvas — we only need rough colours

    var videoEl = document.getElementById("videoPlayer");
    var container = document.getElementById("videoContainer");
    if (!videoEl || !container) return;

    // Create the glow layer inside the video container
    var glowDiv = document.createElement("div");
    glowDiv.className = "video-mood-glow";
    var glowCanvas = document.createElement("canvas");
    glowCanvas.width = CANVAS_SIZE;
    glowCanvas.height = CANVAS_SIZE;
    glowDiv.appendChild(glowCanvas);
    container.insertBefore(glowDiv, container.firstChild);

    var ctx = glowCanvas.getContext("2d", { willReadFrequently: true });
    var intervalId = null;

    function sampleFrame() {
        if (videoEl.paused || videoEl.ended || videoEl.readyState < 2) {
            return;
        }
        try {
            ctx.drawImage(videoEl, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
            if (!glowDiv.classList.contains("active")) {
                glowDiv.classList.add("active");
            }
        } catch (_) {
            // Cross-origin or tainted canvas — silently stop
            stop();
        }
    }

    function start() {
        if (intervalId) return;
        intervalId = setInterval(sampleFrame, SAMPLE_INTERVAL);
        sampleFrame();
    }

    function stop() {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        glowDiv.classList.remove("active");
    }

    videoEl.addEventListener("play", start);
    videoEl.addEventListener("playing", start);
    videoEl.addEventListener("pause", function () {
        /* keep the last glow visible while paused — don't clear */
    });
    videoEl.addEventListener("ended", stop);
    videoEl.addEventListener("emptied", stop);
    videoEl.addEventListener("error", stop);

    // If video is already playing when this script loads
    if (!videoEl.paused && videoEl.readyState >= 2) {
        start();
    }
})();
