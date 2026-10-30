/**
 * jlpt-countdown.js
 *
 * Shows a compact countdown in the top status bar.
 * Default target uses the Hong Kong/Macau N3-N5 afternoon start time.
 */
(function() {
    var TARGET_MONTHS = [6, 11]; // July, December
    var TARGET_HOUR_HKT = 14;
    var TARGET_MINUTE_HKT = 20;
    var HKT_UTC_OFFSET_HOURS = 8;
    var HOUR_MS = 60 * 60 * 1000;
    var UPDATE_INTERVAL_MS = 60 * 1000;

    function pad(num) {
        return String(num).padStart(2, '0');
    }

    function firstSundayOfMonth(year, monthIndex) {
        var firstDay = new Date(Date.UTC(year, monthIndex, 1));
        var offset = (7 - firstDay.getUTCDay()) % 7;
        return 1 + offset;
    }

    function createTarget(year, monthIndex) {
        var day = firstSundayOfMonth(year, monthIndex);
        var utcHour = TARGET_HOUR_HKT - HKT_UTC_OFFSET_HOURS;
        return {
            date: new Date(Date.UTC(year, monthIndex, day, utcHour, TARGET_MINUTE_HKT, 0, 0)),
            label: year + '-' + pad(monthIndex + 1) + '-' + pad(day) + ' ' +
                pad(TARGET_HOUR_HKT) + ':' + pad(TARGET_MINUTE_HKT) + ' HKT'
        };
    }

    function getNextTarget(now) {
        var year = now.getUTCFullYear();
        var candidates = [];

        for (var y = year; y <= year + 1; y++) {
            for (var i = 0; i < TARGET_MONTHS.length; i++) {
                candidates.push(createTarget(y, TARGET_MONTHS[i]));
            }
        }

        candidates.sort(function(a, b) {
            return a.date.getTime() - b.date.getTime();
        });

        for (var j = 0; j < candidates.length; j++) {
            if (candidates[j].date.getTime() > now.getTime()) return candidates[j];
        }

        return createTarget(year + 1, TARGET_MONTHS[0]);
    }

    function formatRemaining(ms) {
        if (ms <= 0) return '已开始';

        var totalHours = Math.ceil(ms / HOUR_MS);
        var days = Math.floor(totalHours / 24);
        var hours = totalHours % 24;

        if (days > 0) return days + '天 ' + hours + '小时';
        return hours + '小时';
    }

    function updateCountdown() {
        var valueEl = document.getElementById('jlptCountdownValue');
        var wrapEl = document.getElementById('jlptCountdown');
        if (!valueEl) return;

        var now = new Date();
        var target = getNextTarget(now);
        valueEl.textContent = formatRemaining(target.date.getTime() - now.getTime());

        if (wrapEl) {
            wrapEl.title = '目标: ' + target.label;
            wrapEl.setAttribute('aria-label', 'JLPT countdown, target ' + target.label);
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        updateCountdown();
        window.setInterval(updateCountdown, UPDATE_INTERVAL_MS);
    });
})();
