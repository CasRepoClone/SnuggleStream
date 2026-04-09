/* Background hearts & flowers particle animation */
(function () {
    const EMOJIS = ["❤️","💗","💖","💕","🌸","🌺","🌷","🩷"];
    const COUNT  = 18;                // particles on screen at once
    const MIN_DUR = 12;               // min animation duration (s)
    const MAX_DUR = 24;               // max animation duration (s)

    const container = document.createElement("div");
    container.className = "bg-particles";
    container.setAttribute("aria-hidden", "true");
    document.body.prepend(container);

    function rand(min, max) { return Math.random() * (max - min) + min; }

    function spawn() {
        const el = document.createElement("span");
        el.className = "bg-particle";
        el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

        // Start near top-left quadrant
        const startX = rand(-5, 30);   // % from left
        const startY = rand(-5, 20);   // % from top

        // Drift toward bottom-right
        const dx = rand(300, 900);
        const dy = rand(400, 1000);
        const rot = Math.floor(rand(-120, 120)) + "deg";
        const dur = rand(MIN_DUR, MAX_DUR);
        const size = rand(0.9, 1.6);

        el.style.left = startX + "%";
        el.style.top  = startY + "%";
        el.style.fontSize = size + "rem";
        el.style.setProperty("--dx", dx + "px");
        el.style.setProperty("--dy", dy + "px");
        el.style.setProperty("--rot", rot);
        el.style.animationDuration = dur + "s";
        el.style.animationDelay = rand(0, MAX_DUR) + "s";

        container.appendChild(el);

        // Remove and respawn when animation ends
        el.addEventListener("animationiteration", function () {
            el.style.left = rand(-5, 30) + "%";
            el.style.top  = rand(-5, 20) + "%";
        });
    }

    for (let i = 0; i < COUNT; i++) spawn();
})();
