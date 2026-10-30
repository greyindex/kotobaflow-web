(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});
  var DAY_MS = 24 * 60 * 60 * 1000;
  var VERSION = 1;
  var DEFAULT_EASE = 2;
  var MIN_EASE = 1.3;
  var MAX_EASE = 3;
  var MAX_INTERVAL_DAYS = 365;

  function schedule(current, index, feedback, now, timezoneOffsetMinutes) {
    var previous = normalizeRecord(current);
    if (feedback === 'skip') return previous;
    if (feedback !== 'known' && feedback !== 'fuzzy' && feedback !== 'unknown') return previous;

    var reviewedAt = validDate(now) || new Date();
    var offset = normalizeOffset(timezoneOffsetMinutes, reviewedAt);
    var ease = previous ? previous.ease : DEFAULT_EASE;
    var intervalDays = previous ? previous.intervalDays : 0;
    var lapses = previous ? previous.lapses : 0;
    var reviewCount = previous ? previous.reviewCount : 0;

    if (feedback === 'unknown') {
      intervalDays = 0;
      ease = clamp(roundEase(ease - 0.2), MIN_EASE, MAX_EASE);
      lapses += 1;
    } else if (feedback === 'fuzzy') {
      intervalDays = 1;
      ease = clamp(roundEase(ease - 0.1), MIN_EASE, MAX_EASE);
    } else {
      intervalDays = reviewCount > 0 && intervalDays > 0 ? Math.round(intervalDays * ease) : 3;
      intervalDays = clamp(intervalDays, 3, MAX_INTERVAL_DAYS);
      ease = clamp(roundEase(ease + 0.05), MIN_EASE, MAX_EASE);
    }

    return {
      index: normalizeIndex(index),
      lastReviewedAt: reviewedAt.toISOString(),
      nextReviewAt:
        intervalDays === 0
          ? reviewedAt.toISOString()
          : localDayStartAfter(reviewedAt, intervalDays, offset).toISOString(),
      intervalDays: intervalDays,
      ease: ease,
      lapses: lapses,
      reviewCount: reviewCount + 1,
      lastResult: feedback,
    };
  }

  function migrateLegacy(records, statuses, referenceNow, timezoneOffsetMinutes) {
    var migrated = {};
    var normalized = normalizeRecords(records);
    for (var i = 0; i < normalized.length; i++) migrated[normalized[i].index] = normalized[i];

    var reference = validDate(referenceNow) || new Date();
    var offset = normalizeOffset(timezoneOffsetMinutes, reference);
    var legacy = statuses || {};
    addLegacyStatus(migrated, legacy.known, 'known', reference, offset);
    addLegacyStatus(migrated, legacy.fuzzy, 'fuzzy', reference, offset);
    addLegacyStatus(migrated, legacy.unknown, 'unknown', reference, offset);

    return Object.keys(migrated)
      .map(function (key) {
        return migrated[key];
      })
      .sort(function (a, b) {
        return a.index - b.index;
      });
  }

  function addLegacyStatus(target, indices, status, reference, offset) {
    if (!Array.isArray(indices)) return;
    for (var i = 0; i < indices.length; i++) {
      var index = normalizeIndex(indices[i]);
      if (index === null || target[index]) continue;
      if (status === 'known') {
        target[index] = schedule(null, index, status, reference, offset);
      } else {
        target[index] = {
          index: index,
          lastReviewedAt: reference.toISOString(),
          nextReviewAt: reference.toISOString(),
          intervalDays: status === 'fuzzy' ? 1 : 0,
          ease: status === 'fuzzy' ? 1.9 : 1.8,
          lapses: status === 'unknown' ? 1 : 0,
          reviewCount: 1,
          lastResult: status,
        };
      }
    }
  }

  function getDueIndices(records, now) {
    var at = validDate(now) || new Date();
    var due = [];
    if (!Array.isArray(records)) return due;
    for (var i = 0; i < records.length; i++) {
      var record = records[i] || {};
      var index = normalizeIndex(record.index);
      var next = validDate(record.nextReviewAt);
      if (index === null || !next || next.getTime() > at.getTime()) continue;
      due.push({ index: index, next: next.getTime() });
    }
    due.sort(function (a, b) {
      return a.next - b.next || a.index - b.index;
    });
    return due.map(function (item) {
      return item.index;
    });
  }

  function normalizeRecords(records) {
    if (!Array.isArray(records)) return [];
    var byIndex = {};
    for (var i = 0; i < records.length; i++) {
      var normalized = normalizeRecord(records[i]);
      if (normalized) byIndex[normalized.index] = normalized;
    }
    return Object.keys(byIndex)
      .map(function (key) {
        return byIndex[key];
      })
      .sort(function (a, b) {
        return a.index - b.index;
      });
  }

  function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var index = normalizeIndex(value.index);
    var reviewed = validDate(value.lastReviewedAt);
    var next = validDate(value.nextReviewAt);
    if (index === null || !reviewed || !next) return null;
    var lastResult = value.lastResult;
    if (lastResult !== 'known' && lastResult !== 'fuzzy' && lastResult !== 'unknown') return null;
    return {
      index: index,
      lastReviewedAt: reviewed.toISOString(),
      nextReviewAt: next.toISOString(),
      intervalDays: clamp(nonNegativeInteger(value.intervalDays), 0, MAX_INTERVAL_DAYS),
      ease: clamp(roundEase(finiteNumber(value.ease, DEFAULT_EASE)), MIN_EASE, MAX_EASE),
      lapses: nonNegativeInteger(value.lapses),
      reviewCount: Math.max(1, nonNegativeInteger(value.reviewCount)),
      lastResult: lastResult,
    };
  }

  function localDayStartAfter(date, days, offsetMinutes) {
    var shifted = new Date(date.getTime() - offsetMinutes * 60000);
    return new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + days) +
        offsetMinutes * 60000,
    );
  }

  function normalizeOffset(value, date) {
    var offset = Number(value);
    if (!isFinite(offset) || Math.abs(offset) > 840) offset = date.getTimezoneOffset();
    return Math.round(offset);
  }

  function normalizeIndex(value) {
    if (value === null || typeof value === 'undefined' || value === '' || typeof value === 'boolean') {
      return null;
    }
    var index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  function validDate(value) {
    if (value === null || typeof value === 'undefined' || value === '' || typeof value === 'boolean') {
      return null;
    }
    var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function nonNegativeInteger(value) {
    var number = Number(value);
    return isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function roundEase(value) {
    return Math.round(value * 100) / 100;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  app.srs = {
    VERSION: VERSION,
    schedule: schedule,
    migrateLegacy: migrateLegacy,
    getDueIndices: getDueIndices,
    normalizeRecords: normalizeRecords,
  };
})(window);
