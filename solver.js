/* VetShifts — מנוע השיבוץ.
 * פורט של vetclock-work/scheduler.py + הלוגיקה שיושבת ב-main.py (generate_schedule).
 * ללא DOM, ללא localStorage — נטען גם ב-test.html וגם ב-index.html.
 *
 * הכללות מול המקור:
 *  - משמרות הן רשימה (עד 3) ולא morning/afternoon קשיח.
 *  - "אילו משמרות קיימות ביום" נשלט ע"י settings.dayParts, לא ע"י d>=5 מקודד.
 *  - shift_type הוחלף ב-allowedParts[] ונבדק בזמן ההתאמה. זה מבטל את הבאג
 *    שבו _shift_type_blocked רץ על 6 ימים בלבד ולכן מעולם לא חסם שבת.
 *  - preferred_days (בונוס) ו-traineeSlots (שיבוץ קבוע) הם שני שדות נפרדים,
 *    במקום עמודה אחת עם שתי משמעויות ושני פורמטים.
 */
(function (root) {
  'use strict';

  var DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // ── תאריכים ────────────────────────────────────────────────────────────────
  // כלל ברזל: מפתחות שבוע הם מחרוזות 'YYYY-MM-DD'. כל אריתמטיקה ב-UTC (אין DST),
  // וכל קריאה של "היום" לפי השעון המקומי — לעולם לא toISOString() על תאריך מקומי.
  function parseISO(s) {
    var p = String(s).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function toISO(ms) {
    var d = new Date(ms), z = function (n) { return String(n).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }
  function addDaysISO(s, n) { return toISO(parseISO(s) + n * 86400000); }
  function dowOf(s) { return new Date(parseISO(s)).getUTCDay(); }      // 0 = ראשון
  function weekStartOf(s) { return addDaysISO(s, -dowOf(s)); }
  function todayISO() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  /** אינדקס היום בשבוע (0-6) של תאריך, יחסית לתחילת השבוע. null אם מחוץ לשבוע. */
  function dayIndexInWeek(weekStart, iso) {
    var n = Math.round((parseISO(iso) - parseISO(weekStart)) / 86400000);
    return n >= 0 && n <= 6 ? n : null;
  }

  // ── עזרי מגבלות ────────────────────────────────────────────────────────────
  var K = function (day, part) { return day + ':' + part; };

  /** [[day, partKey|null], ...] → Set של 'day:part'. null = יום שלם → כל המשמרות. */
  function pairsToSet(pairs, parts) {
    var s = new Set();
    (pairs || []).forEach(function (it) {
      if (!Array.isArray(it)) return;
      var d = it[0], p = it[1];
      if (typeof d !== 'number' || d < 0 || d > 6) return;
      if (p == null || p === '') parts.forEach(function (pk) { s.add(K(d, pk)); });
      else s.add(K(d, p));
    });
    return s;
  }

  /** האם המשמרת חסומה לעובד לפי סוג המשמרת שלו. ריק/חסר = הכל מותר. */
  function partAllowed(allowedParts, part) {
    return !allowedParts || !allowedParts.length || allowedParts.indexOf(part) !== -1;
  }

  // ── הסולוור ────────────────────────────────────────────────────────────────
  /**
   * @param {Object} inp
   *   employees   [{id, name, hardBlocked:Set, softBlocked:Set, preferredDays:[dayIdx], allowedParts:[]}]
   *   demand      [{day, part, roleGroup, count}]
   *   prefs       {id: {roleGroup, targetMin, targetMax, prefer, maxDoubles}}
   *   parts       ['p1','p2']            — כל מפתחות המשמרות בהגדרות
   *   minDoubles  bool
   * @returns {assignments:[{day,part,employeeId}], unfilled:[{day,part,roleGroup,missing}], stats:[]}
   */
  function solve(inp) {
    var parts = inp.parts || [];
    var prefs = inp.prefs || {};
    var minDoubles = inp.minDoubles !== false;
    var empById = {};
    inp.employees.forEach(function (e) { empById[e.id] = e; });

    var count = {}, dayCount = {}, partCount = {}, doubles = {};
    inp.employees.forEach(function (e) {
      count[e.id] = 0; doubles[e.id] = 0; dayCount[e.id] = {}; partCount[e.id] = {};
      parts.forEach(function (p) { partCount[e.id][p] = 0; });
    });

    function blockedFor(eid, day, part) {
      var e = empById[eid];
      if (!e) return true;
      if (!partAllowed(e.allowedParts, part)) return true;
      return e.hardBlocked.has(K(day, part));
    }

    function eligible(day, part, roleGroup) {
      var out = [];
      Object.keys(prefs).forEach(function (key) {
        var eid = +key, p = prefs[key];
        if (p.roleGroup !== roleGroup) return;
        if (!empById[eid]) return;
        if (blockedFor(eid, day, part)) return;
        if (count[eid] >= p.targetMax) return;
        if ((dayCount[eid][day] || 0) > 0 && doubles[eid] >= p.maxDoubles) return;
        out.push(eid);
      });
      return out;
    }

    // הרחבת הדרישות לסלוטים, ואז מיון לפי צפיפות (הכי מעט מועמדים קודם) — כמו במקור.
    var slots = [];
    (inp.demand || []).forEach(function (d) {
      for (var i = 0; i < d.count; i++) slots.push({ day: d.day, part: d.part, roleGroup: d.roleGroup });
    });
    slots.forEach(function (s) { s._tight = eligible(s.day, s.part, s.roleGroup).length; });
    slots.sort(function (a, b) { return a._tight - b._tight; });

    var assignments = [], unfilled = [];

    slots.forEach(function (slot) {
      var day = slot.day, part = slot.part;
      var already = new Set();
      assignments.forEach(function (a) {
        if (a.day === day && a.part === part) already.add(a.employeeId);
      });

      var cands = [];
      eligible(day, part, slot.roleGroup).forEach(function (eid) {
        if (already.has(eid)) return;
        var p = prefs[eid], e = empById[eid], score = 0;

        if (count[eid] < p.targetMin) score += 30;                       // מתחת ליעד המינימלי
        score += (p.targetMax - count[eid]) * 2;                         // פחות מנוצל קודם
        if (p.prefer === part) score += 8;
        else if (p.prefer && p.prefer !== 'any') score -= 4;
        if ((e.preferredDays || []).indexOf(day) !== -1) score += 5;

        // מגבלה רכה: 90 > תקרת ערימת הבונוסים (30+14+8+5+2=59) — בקשה רכה לא נדרסת ע"י בונוסים
        if (e.softBlocked.has(K(day, part))) score -= 90;

        if ((dayCount[eid][day] || 0) > 0) {
          score -= minDoubles ? 100 : 25;
          if (p.maxDoubles <= 1) score -= 30;
        }
        // בונוס גיוון: משמרת שהעובד עוד לא עשה השבוע, אלא אם הוא מעדיף משמרת אחרת
        if (partCount[eid][part] === 0 && (!p.prefer || p.prefer === 'any' || p.prefer === part)) score += 2;

        cands.push({ score: score, eid: eid });
      });

      if (!cands.length) { unfilled.push(slot); return; }
      // תיקו → id גבוה מנצח. בפייתון זה נובע ממיון ה-tuple (score, eid) בסדר יורד;
      // ב-JS זה חייב להיכתב במפורש, אחרת התוצאה לא דטרמיניסטית בין הרצות.
      cands.sort(function (a, b) { return (b.score - a.score) || (b.eid - a.eid); });

      var chosen = cands[0].eid;
      assignments.push({ day: day, part: part, employeeId: chosen });
      count[chosen]++;
      partCount[chosen][part]++;
      if ((dayCount[chosen][day] || 0) > 0) doubles[chosen]++;
      dayCount[chosen][day] = (dayCount[chosen][day] || 0) + 1;
    });

    var stats = [];
    inp.employees.forEach(function (e) {
      var p = prefs[e.id];
      if (!p) return;
      var row = {
        id: e.id, name: e.name, roleGroup: p.roleGroup, total: count[e.id],
        doubles: doubles[e.id], targetMin: p.targetMin, targetMax: p.targetMax, byPart: {}
      };
      parts.forEach(function (pk) { row.byPart[pk] = partCount[e.id][pk]; });
      stats.push(row);
    });
    stats.sort(function (a, b) { return (b.total - a.total) || a.name.localeCompare(b.name, 'he'); });

    var agg = {};
    unfilled.forEach(function (s) {
      var k = K(s.day, s.part) + ':' + s.roleGroup;
      if (!agg[k]) agg[k] = { day: s.day, part: s.part, roleGroup: s.roleGroup, missing: 0 };
      agg[k].missing++;
    });

    return { assignments: assignments, unfilled: Object.keys(agg).map(function (k) { return agg[k]; }), stats: stats };
  }

  // ── הכנת קלט מה-state ──────────────────────────────────────────────────────
  function traineeGroupKeys(settings) {
    return (settings.roleGroups || []).filter(function (g) { return g.isTrainee; })
      .map(function (g) { return g.key; });
  }

  function defaultPrefFor(emp, settings) {
    // owner/manager מסווגים כווטרינר — עקבי עם תצוגת הלוח במקור.
    var groups = settings.roleGroups || [];
    var rg = (emp.role === 'vet' || emp.role === 'owner' || emp.role === 'manager')
      ? 'vet' : (emp.role || 'assistant');
    if (!groups.some(function (g) { return g.key === rg; })) rg = groups.length ? groups[0].key : 'assistant';
    return { roleGroup: rg, targetMin: 0, targetMax: 7, prefer: 'any', maxDoubles: 7, notes: '' };
  }

  /** היעדרויות שחופפות לשבוע → [{employeeId, day, part}] ('either' = יום שלם). */
  function absenceBlocks(state, weekStart) {
    var out = [];
    (state.absences || []).forEach(function (a) {
      var start = a.startDate, end = a.endDate || a.startDate;
      if (!start) return;
      for (var i = 0; i <= 6; i++) {
        var iso = addDaysISO(weekStart, i);
        if (iso >= start && iso <= end) out.push({ employeeId: a.employeeId, day: i, part: a.part || 'either' });
      }
    });
    return out;
  }

  /**
   * מכין את כל הקלט לסולוור מתוך ה-state. כאן יושבת הלוגיקה שבמקור נמצאת
   * ב-endpoint ולא ב-scheduler.py: סינתזת prefs לעובד לא-מוגדר (בלעדיה הוא
   * פשוט נעלם מהיצירה), והרחבת טווחי ההיעדרות לאינדקסי ימים.
   */
  function prepareInputs(state, weekStart) {
    var st = state.settings, parts = (st.parts || []).map(function (p) { return p.key; });
    var week = (state.weeks || {})[weekStart] || {};
    var actives = (state.employees || []).filter(function (e) { return e.active !== false; });

    var extra = absenceBlocks(state, weekStart);
    var byReq = {};   // eid → Set('day:part')
    extra.forEach(function (b) {
      var ps = (b.part === 'either' || !b.part) ? parts : [b.part];
      if (!byReq[b.employeeId]) byReq[b.employeeId] = new Set();
      ps.forEach(function (p) { byReq[b.employeeId].add(K(b.day, p)); });
    });

    var employees = actives.map(function (e) {
      var hard = pairsToSet(e.hardUnavailable, parts);
      (byReq[e.id] || new Set()).forEach(function (k) { hard.add(k); });
      return {
        id: e.id, name: fullName(e), allowedParts: e.allowedParts || [],
        hardBlocked: hard, softBlocked: pairsToSet(e.softUnavailable, parts),
        preferredDays: e.preferredDays || []
      };
    });

    var prefs = {};
    actives.forEach(function (e) {
      var p = (state.prefs || {})[e.id];
      prefs[e.id] = p ? {
        roleGroup: p.roleGroup, targetMin: +p.targetMin || 0,
        targetMax: p.targetMax == null ? 7 : +p.targetMax,
        prefer: p.prefer || 'any', maxDoubles: p.maxDoubles == null ? 7 : +p.maxDoubles
      } : defaultPrefFor(e, st);
    });

    // דרישות: override שבועי אם קיים, אחרת גלובלי. רק משמרות שקיימות באותו יום.
    var rows = week.demandOverride || state.demand || [];
    var dayParts = st.dayParts || {};
    var demand = rows.filter(function (d) {
      if (!(d.count > 0)) return false;
      if ((st.activeDays || []).indexOf(d.day) === -1) return false;
      var dp = dayParts[String(d.day)];
      return !dp || dp.indexOf(d.part) !== -1;
    });

    var tKeys = traineeGroupKeys(st);
    var traineeIds = Object.keys(prefs).filter(function (id) {
      return tKeys.indexOf(prefs[id].roleGroup) !== -1;
    }).map(Number);

    var prefsSolve = {};
    Object.keys(prefs).forEach(function (id) {
      if (traineeIds.indexOf(+id) === -1) prefsSolve[id] = prefs[id];
    });

    return {
      parts: parts, employees: employees, prefs: prefs, prefsSolve: prefsSolve,
      demand: demand, traineeIds: traineeIds, extraBlocked: extra,
      minDoubles: st.minDoubles !== false
    };
  }

  /** חפיפות: תמיד בנוסף — משובצים בסלוטים הקבועים שלהם, בכפוף למגבלות בלבד. */
  function traineeFill(state, weekStart, inp) {
    var st = state.settings, added = [];
    var empById = {};
    inp.employees.forEach(function (e) { empById[e.id] = e; });

    inp.traineeIds.forEach(function (eid) {
      var e = empById[eid];
      if (!e) return;
      var prefer = (inp.prefs[eid] || {}).prefer || 'any';
      var slots = ((state.traineeSlots || {})[eid] || []).slice().sort(function (a, b) {
        return (a[0] - b[0]) || String(a[1]).localeCompare(String(b[1]));
      });
      slots.forEach(function (s) {
        var day = s[0], part = s[1];
        if ((st.activeDays || []).indexOf(day) === -1) return;
        var dp = (st.dayParts || {})[String(day)];
        if (dp && dp.indexOf(part) === -1) return;                 // אין משמרת כזו ביום הזה
        if (prefer !== 'any' && prefer !== part) return;
        if (!partAllowed(e.allowedParts, part)) return;
        if (e.hardBlocked.has(K(day, part))) return;               // כולל היעדרויות
        added.push({ day: day, part: part, employeeId: eid });
      });
    });
    return added;
  }

  /** יצירת שבוע שלם. לא נוגע ב-state — מחזיר תוצאה בלבד. */
  function generate(state, weekStart) {
    var inp = prepareInputs(state, weekStart);
    var res = solve({
      parts: inp.parts, employees: inp.employees, prefs: inp.prefsSolve,
      demand: inp.demand, minDoubles: inp.minDoubles
    });
    var trainees = traineeFill(state, weekStart, inp);
    return {
      assignments: res.assignments.concat(trainees),
      unfilled: res.unfilled,
      stats: res.stats,
      traineeAdded: trainees.length,
      blockedCount: inp.extraBlocked.length,
      minDoubles: inp.minDoubles
    };
  }

  // ── קונפליקטים בהוספה ידנית ────────────────────────────────────────────────
  var LEAVE_HE = { vacation: 'חופשה', sick: 'מחלה', personal: 'יום אישי', shift_assignment: 'בקשת אי-שיבוץ' };

  function partLabel(settings, key) {
    var p = (settings.parts || []).find(function (x) { return x.key === key; });
    return p ? p.label : key;
  }

  /**
   * סיבות שהוספה ידנית מפרה אילוץ. מערך ריק = נקי.
   * כל פריט: {level:'hard'|'soft', text}. ההפרדה חשובה — ויתור על מגבלה רכה
   * הוא החלטה מכוונת של המנוע, ואסור שייראה בלוח כמו הפרה של מגבלה קשה.
   */
  function manualAddConflicts(state, weekStart, day, part, empId) {
    var st = state.settings, parts = (st.parts || []).map(function (p) { return p.key; });
    var e = (state.employees || []).find(function (x) { return x.id === empId; });
    if (!e) return [{ level: 'hard', text: 'עובד לא נמצא' }];
    var out = [], dayHe = DAY_HE[day] || String(day), partHe = partLabel(st, part);
    var hard = function (t) { out.push({ level: 'hard', text: t }); };

    if (pairsToSet(e.hardUnavailable, parts).has(K(day, part)))
      hard('מגבלה קשה: חסימה ביום ' + dayHe + ' ' + partHe);
    if (!partAllowed(e.allowedParts, part))
      hard('סוג משמרת: העובד/ת משובץ/ת רק ל' +
        (e.allowedParts || []).map(function (k) { return partLabel(st, k); }).join('/'));
    if (pairsToSet(e.softUnavailable, parts).has(K(day, part)))
      out.push({ level: 'soft', text: 'ביקש/ה להימנע מיום ' + dayHe + ' ' + partHe });

    var iso = addDaysISO(weekStart, day);
    (state.absences || []).forEach(function (a) {
      if (a.employeeId !== empId) return;
      if (!(a.startDate <= iso && (a.endDate || a.startDate) >= iso)) return;
      // היעדרות לחצי-יום ספציפי לא מתנגשת עם החצי השני
      if (a.part && a.part !== 'either' && a.part !== part) return;
      hard((LEAVE_HE[a.type] || 'היעדרות') + ' בתאריך ' + (+iso.slice(8, 10)) + '.' + (+iso.slice(5, 7)));
    });
    return out;
  }

  /** האם ברשימת הסיבות יש הפרה קשה (להבדיל מוויתור על מגבלה רכה). */
  function hasHard(reasons) {
    return (reasons || []).some(function (r) { return r.level === 'hard'; });
  }
  /** טקסט הסיבות לתצוגה. */
  function reasonText(reasons) {
    return (reasons || []).map(function (r) { return r.text; }).join(' · ');
  }

  /** [[day, partKey|null], ...] → 'שלישי (בוקר), שישי' */
  function fmtConstraintDays(pairs, settings) {
    return (pairs || []).map(function (it) {
      var d = DAY_HE[it[0]] || it[0];
      return it[1] ? d + ' (' + partLabel(settings, it[1]) + ')' : d;
    }).join(', ');
  }

  function fullName(e) {
    return [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.firstName || ('#' + e.id);
  }

  root.VetSolver = {
    DAY_HE: DAY_HE,
    parseISO: parseISO, toISO: toISO, addDaysISO: addDaysISO, dowOf: dowOf,
    weekStartOf: weekStartOf, todayISO: todayISO, dayIndexInWeek: dayIndexInWeek,
    pairsToSet: pairsToSet, partAllowed: partAllowed, partLabel: partLabel, fullName: fullName,
    solve: solve, prepareInputs: prepareInputs, traineeFill: traineeFill, generate: generate,
    manualAddConflicts: manualAddConflicts, hasHard: hasHard, reasonText: reasonText,
    fmtConstraintDays: fmtConstraintDays,
    defaultPrefFor: defaultPrefFor, absenceBlocks: absenceBlocks, traineeGroupKeys: traineeGroupKeys
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.VetSolver;
