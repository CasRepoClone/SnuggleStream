/* Background hearts & flowers — unique @keyframes per particle */
(function () {
    var EMOJIS  = ["\u2764\uFE0F","\uD83D\uDC97","\uD83D\uDC96","\uD83D\uDC95","\uD83C\uDF38","\uD83C\uDF3A","\uD83C\uDF37","\uD83E\uDE77"];
    var COUNT   = 18;
    var MIN_DUR = 12;
    var MAX_DUR = 24;

    function rand(a, b) { return Math.random() * (b - a) + a; }

    // Build all keyframes CSS first
    var css = "";
    var particles = [];

    for (var i = 0; i < COUNT; i++) {
        var dx  = Math.round(rand(300, 900));
        var dy  = Math.round(rand(400, 1000));
        var rot = Math.round(rand(-120, 120));
        var dur = rand(MIN_DUR, MAX_DUR).toFixed(1);
        var del = rand(0, MAX_DUR).toFixed(1);
        var sx  = rand(-5, 30).toFixed(2);
        var sy  = rand(-5, 20).toFixed(2);
        var fs  = rand(0.9, 1.6).toFixed(2);
        var name = "snuggle-p" + i;

        css += "@keyframes " + name + "{" +
            "0%{opacity:0;transform:translate(0px,0px) rotate(0deg) scale(0.7);}" +
            "8%{opacity:0.45;transform:translate(" + Math.round(dx*0.08) + "px," + Math.round(dy*0.08) + "px) rotate(" + Math.round(rot*0.08) + "deg) scale(0.68);}" +
            "80%{opacity:0.3;transform:translate(" + Math.round(dx*0.8) + "px," + Math.round(dy*0.8) + "px) rotate(" + Math.round(rot*0.8) + "deg) scale(0.54);}" +
            "100%{opacity:0;transform:translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(0.5);}" +
        "} ";

        particles.push({ name: name, dur: dur, del: del, sx: sx, sy: sy, fs: fs });
    }

    // Inject keyframes BEFORE creating elements
    var styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // Now create the container and particles
    var container = document.createElement("div");
    container.className = "bg-particles";
    container.setAttribute("aria-hidden", "true");
    document.body.prepend(container);

    for (var j = 0; j < particles.length; j++) {
        var p = particles[j];
        var el = document.createElement("span");
        el.className = "bg-particle";
        el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        el.style.position = "absolute";
        el.style.left = p.sx + "%";
        el.style.top = p.sy + "%";
        el.style.fontSize = p.fs + "rem";
        el.style.opacity = "0";
        el.style.willChange = "transform, opacity";
        el.style.animationName = p.name;
        el.style.animationDuration = p.dur + "s";
        el.style.animationTimingFunction = "linear";
        el.style.animationDelay = p.del + "s";
        el.style.animationIterationCount = "infinite";
        container.appendChild(el);
    }
})();
