/* Background hearts & flowers — unique @keyframes per particle */
(function () {
    var EMOJIS  = ["\u2764\uFE0F","\uD83D\uDC97","\uD83D\uDC96","\uD83D\uDC95","\uD83C\uDF38","\uD83C\uDF3A","\uD83C\uDF37","\uD83E\uDE77"];
    var COUNT   = 18;
    var MIN_DUR = 12;
    var MAX_DUR = 24;

    function rand(a, b) { return Math.random() * (b - a) + a; }

    var container = document.createElement("div");
    container.className = "bg-particles";
    container.setAttribute("aria-hidden", "true");
    document.body.prepend(container);

    var css = "";

    for (var i = 0; i < COUNT; i++) {
        var dx  = Math.round(rand(300, 900));
        var dy  = Math.round(rand(400, 1000));
        var rot = Math.round(rand(-120, 120));
        var dur = rand(MIN_DUR, MAX_DUR).toFixed(1);
        var del = rand(0, MAX_DUR).toFixed(1);
        var sx  = rand(-5, 30).toFixed(2);
        var sy  = rand(-5, 20).toFixed(2);
        var fs  = rand(0.9, 1.6).toFixed(2);
        var name = "p" + i;

        css += "@keyframes " + name + "{" +
            "0%{opacity:0;transform:translate(0,0) rotate(0deg) scale(.7)}" +
            "8%{opacity:.45}" +
            "80%{opacity:.3}" +
            "100%{opacity:0;transform:translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(.5)}" +
        "}";

        var el = document.createElement("span");
        el.className = "bg-particle";
        el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        el.style.cssText = "left:" + sx + "%;top:" + sy + "%;font-size:" + fs + "rem;" +
            "animation:" + name + " " + dur + "s linear " + del + "s infinite";
        container.appendChild(el);
    }

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
})();
