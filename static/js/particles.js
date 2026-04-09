/* Background hearts & flowers particle animation — Web Animations API */
(function () {
    const EMOJIS = ["❤️","💗","💖","💕","🌸","🌺","🌷","🩷"];
    const COUNT  = 18;
    const MIN_DUR = 12000;
    const MAX_DUR = 24000;

    const container = document.createElement("div");
    container.className = "bg-particles";
    container.setAttribute("aria-hidden", "true");
    document.body.prepend(container);

    function rand(min, max) { return Math.random() * (max - min) + min; }

    function launch(el) {
        var startX = rand(-5, 30) + "%";
        var startY = rand(-5, 20) + "%";
        var dx     = rand(300, 900);
        var dy     = rand(400, 1000);
        var rot    = Math.floor(rand(-120, 120));
        var dur    = rand(MIN_DUR, MAX_DUR);

        el.style.left = startX;
        el.style.top  = startY;

        var anim = el.animate([
            { opacity: 0, transform: "translate(0,0) rotate(0deg) scale(.7)" },
            { opacity: 0.45, transform: "translate(" + (dx * 0.08) + "px," + (dy * 0.08) + "px) rotate(" + (rot * 0.08) + "deg) scale(.68)", offset: 0.08 },
            { opacity: 0.3, transform: "translate(" + (dx * 0.8) + "px," + (dy * 0.8) + "px) rotate(" + (rot * 0.8) + "deg) scale(.54)", offset: 0.8 },
            { opacity: 0, transform: "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(.5)" }
        ], { duration: dur, easing: "linear" });

        anim.onfinish = function () { launch(el); };
    }

    for (var i = 0; i < COUNT; i++) {
        var el = document.createElement("span");
        el.className = "bg-particle";
        el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        el.style.fontSize = rand(0.9, 1.6) + "rem";
        container.appendChild(el);

        // Stagger initial starts
        (function (e, delay) {
            setTimeout(function () { launch(e); }, delay);
        })(el, rand(0, MAX_DUR));
    }
})();
