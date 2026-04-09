/* SnuggleStream — Theme Toggle */
(function () {
    "use strict";

    var STORAGE_KEY = "snuggle-theme";

    function getPreferred() {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "dark" || stored === "default") return stored;
        return "default";
    }

    function apply(theme) {
        if (theme === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
    }

    // Apply immediately (before DOM ready) to avoid flash
    apply(getPreferred());

    document.addEventListener("DOMContentLoaded", function () {
        // Bind all toggle buttons on the page
        var buttons = document.querySelectorAll(".theme-toggle");
        buttons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var current = getPreferred();
                var next = current === "dark" ? "default" : "dark";
                localStorage.setItem(STORAGE_KEY, next);
                apply(next);
            });
        });
    });
})();
