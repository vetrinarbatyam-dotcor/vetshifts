/* VetShifts — self-check של המנוע. אין framework: assert בלבד.
 * הרצה: פותחים test.html, או `node test.js`. */
(function (root) {
  'use strict';
  var S = root.VetSolver || (typeof require !== 'undefined' && require('./solver.js'));

  var results = [];
  function t(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, err: e && e.message || String(e) }); }
  }
  function eq(a, b, msg) {
    var x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error((msg || '') + ' — קיבלנו ' + x + ' במקום ' + y);
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'ציפינו לאמת'); }

  // ── בונה state לבדיקות ─────────────────────────────────────────────────────
  var P2 = [{ key: 'p1', label: 'בוקר', start: '10:00', end: '15:00' },
            { key: 'p2', label: 'אחה״צ', start: '15:00', end: '20:00' }];
  var P3 = P2.concat([{ key: 'p3', label: 'ערב', start: '20:00', end: '23:00' }]);
  var GROUPS = [{ key: 'vet', name: 'וטרינר', rank: 1 },
                { key: 'assistant', name: 'אסיסטנט', rank: 2 },
                { key: 'trainee', name: 'חפיפות', rank: 3, isTrainee: true }];

  function mkState(o) {
    o = o || {};
    var parts = o.parts || P2;
    var days = o.activeDays || [0, 1, 2, 3, 4, 5, 6];
    var dayParts = {};
    days.forEach(function (d) { dayParts[String(d)] = parts.map(function (p) { return p.key; }); });
    return {
      schemaVersion: 1,
      settings: {
        parts: parts, activeDays: days, dayParts: o.dayParts || dayParts,
        roleGroups: GROUPS, minDoubles: o.minDoubles !== false, clinicName: 'בדיקה'
      },
      employees: o.employees || [],
      prefs: o.prefs || {},
      traineeSlots: o.traineeSlots || {},
      demand: o.demand || [],
      absences: o.absences || [],
      specialists: [], weeks: o.weeks || {}, meta: { nextId: 99 }
    };
  }
  function emp(id, extra) {
    return Object.assign({ id: id, firstName: 'ע' + id, lastName: '', role: 'vet', active: true,
      allowedParts: [], hardUnavailable: [], softUnavailable: [], preferredDays: [] }, extra || {});
  }
  function pref(extra) {
    return Object.assign({ roleGroup: 'vet', targetMin: 0, targetMax: 7, prefer: 'any', maxDoubles: 7 }, extra || {});
  }
  function has(as, day, part, eid) {
    return as.some(function (a) { return a.day === day && a.part === part && a.employeeId === eid; });
  }
  var WS = '2026-08-30';   // ראשון

  // ── 1. מגבלה קשה לעולם לא נדרסת — כולל שבת (הבאג של VetClock) ─────────────
  t('מגבלה קשה חוסמת, גם ביום שבת', function () {
    var st = mkState({
      employees: [emp(1, { hardUnavailable: [[6, null]] })],
      prefs: { 1: pref() },
      demand: [{ day: 6, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 0, 'שבת חסומה — לא אמור להיות שיבוץ');
    eq(r.unfilled[0].missing, 1, 'הסלוט אמור להיספר כחסר');
  });

  t('סוג משמרת (allowedParts) חוסם גם ביום שבת', function () {
    // ב-VetClock _shift_type_blocked רץ על 6 ימים בלבד, ולכן שבת חמקה מהחסימה.
    var st = mkState({
      employees: [emp(1, { allowedParts: ['p1'] })],
      prefs: { 1: pref() },
      demand: [{ day: 6, part: 'p2', roleGroup: 'vet', count: 1 }]
    });
    eq(S.generate(st, WS).assignments.length, 0, 'עובד בוקר-בלבד לא ישובץ לאחה״צ בשבת');
  });

  t('מגבלה קשה לחצי-יום חוסמת רק את החצי הזה', function () {
    var st = mkState({
      employees: [emp(1, { hardUnavailable: [[2, 'p1']] })],
      prefs: { 1: pref() },
      demand: [{ day: 2, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 2, part: 'p2', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    ok(!has(r.assignments, 2, 'p1', 1), 'בוקר שלישי חסום');
    ok(has(r.assignments, 2, 'p2', 1), 'אחה״צ שלישי פנוי');
  });

  // ── 2. מגבלה רכה — קנס, לא חסימה ──────────────────────────────────────────
  t('מגבלה רכה נדחית כשיש חלופה', function () {
    var st = mkState({
      employees: [emp(1, { softUnavailable: [[0, 'p1']] }), emp(2)],
      prefs: { 1: pref(), 2: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    ok(has(r.assignments, 0, 'p1', 2), 'העובד בלי המגבלה הרכה נבחר');
  });

  t('מגבלה רכה נדרסת כשאין חלופה', function () {
    var st = mkState({
      employees: [emp(1, { softUnavailable: [[0, 'p1']] })],
      prefs: { 1: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    ok(has(S.generate(st, WS).assignments, 0, 'p1', 1), 'עדיף לשבץ מאשר להשאיר חור');
  });

  t('קנס −90 גדול מתקרת הבונוסים (30+14+8+5+2=59)', function () {
    // עובד 1 מקבל את כל הבונוסים האפשריים ובכל זאת מפסיד לעובד 2 הנייטרלי.
    var st = mkState({
      employees: [emp(1, { softUnavailable: [[0, 'p1']], preferredDays: [0] }), emp(2)],
      prefs: { 1: pref({ targetMin: 5, prefer: 'p1' }), 2: pref({ targetMax: 1 }) },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    ok(has(S.generate(st, WS).assignments, 0, 'p1', 2), 'המגבלה הרכה לא נדרסת ע"י ערימת בונוסים');
  });

  // ── 3-4. יעדים וכפולות ────────────────────────────────────────────────────
  t('targetMax נאכף', function () {
    var st = mkState({
      employees: [emp(1)], prefs: { 1: pref({ targetMax: 1 }) },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 1, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 2, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 1, 'מקסימום משמרת אחת');
    eq(r.unfilled.reduce(function (s, u) { return s + u.missing; }, 0), 2, 'שתי משמרות חסרות');
  });

  t('maxDoubles נאכף גם ב-3 משמרות ליום', function () {
    var st = mkState({
      parts: P3, employees: [emp(1)], prefs: { 1: pref({ maxDoubles: 1 }) },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 0, part: 'p2', roleGroup: 'vet', count: 1 },
               { day: 0, part: 'p3', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 2, 'משמרת + כפולה אחת, לא שלוש');
    eq(r.stats[0].doubles, 1, 'ספירת כפולות = מספר השיבוצים ביום פחות 1');
  });

  t('מזעור כפולות משנה את הבחירה', function () {
    function run(minDoubles) {
      var st = mkState({
        minDoubles: minDoubles,
        employees: [emp(1, { softUnavailable: [[0, 'p2']] }), emp(2)],
        prefs: { 1: pref(), 2: pref() },
        demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
                 { day: 0, part: 'p2', roleGroup: 'vet', count: 1 }]
      });
      return S.generate(st, WS);
    }
    var on = run(true), off = run(false);
    var dblOn = on.stats.reduce(function (s, r) { return s + r.doubles; }, 0);
    var dblOff = off.stats.reduce(function (s, r) { return s + r.doubles; }, 0);
    eq(dblOn, 0, 'עם מזעור כפולות — אין כפולה');
    eq(dblOff, 1, 'בלי מזעור — הכפולה עדיפה על הפרת המגבלה הרכה');
  });

  t('הניקוד מפזר משמרות בין העובדים ולא מרכז באחד', function () {
    var st = mkState({
      employees: [emp(1), emp(2)], prefs: { 1: pref(), 2: pref() },
      demand: [0, 1, 2, 3].map(function (d) { return { day: d, part: 'p1', roleGroup: 'vet', count: 1 }; })
    });
    var tot = S.generate(st, WS).stats.map(function (r) { return r.total; });
    eq(tot, [2, 2], 'חלוקה שווה — לא 4/0');
  });

  t('מי שמתחת ליעד המינימלי מקבל עדיפות', function () {
    var st = mkState({
      employees: [emp(1, { }), emp(2)],
      prefs: { 1: pref({ targetMin: 3 }), 2: pref({ targetMin: 0, targetMax: 30 }) },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    // בקרה: 2*(30-0)=60 גובר על 30+2*(7-0)=44 של עובד 1.
    eq(S.generate(st, WS).assignments[0].employeeId, 2, 'בקרה: העובד עם ה-max הגבוה מנצח');
    st.prefs[1].targetMax = 30;
    eq(S.generate(st, WS).assignments[0].employeeId, 1, 'בתנאים שווים — מי שמתחת ליעד המינימלי');
  });

  t('העדפת משמרת וימים מועדפים מטות את הבחירה', function () {
    // בשני המקרים ה-id הנמוך מנצח למרות שבתיקו ה-id הגבוה גובר — כלומר הבונוס אכן פעל.
    var byPart = mkState({
      employees: [emp(1), emp(2)],
      prefs: { 1: pref({ prefer: 'p1' }), 2: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    eq(S.generate(byPart, WS).assignments[0].employeeId, 1, 'מי שמעדיף בוקר מקבל את הבוקר');

    var byDay = mkState({
      employees: [emp(1, { preferredDays: [0] }), emp(2)],
      prefs: { 1: pref(), 2: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    eq(S.generate(byDay, WS).assignments[0].employeeId, 1, 'יום מועדף מנצח תיקו');
  });

  // ── 5. תיקו ────────────────────────────────────────────────────────────────
  t('בתיקו מנצח ה-id הגבוה (זהה לפייתון)', function () {
    var st = mkState({
      employees: [emp(1), emp(2), emp(3)],
      prefs: { 1: pref(), 2: pref(), 3: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    eq(S.generate(st, WS).assignments[0].employeeId, 3, 'תיקו → id גבוה');
  });

  // ── 6. חפיפות ─────────────────────────────────────────────────────────────
  t('חפיפות לא סוגר דרישות ומשובץ רק בסלוטים שלו', function () {
    var st = mkState({
      employees: [emp(1), emp(7, { role: 'trainee' })],
      prefs: { 1: pref(), 7: pref({ roleGroup: 'trainee' }) },
      traineeSlots: { 7: [[0, 'p1'], [3, 'p2']] },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 2 }]
    });
    var r = S.generate(st, WS);
    eq(r.traineeAdded, 2, 'שני סלוטים של חפיפות נוספו');
    ok(has(r.assignments, 0, 'p1', 7), 'חפיפות ביום ראשון בוקר');
    ok(has(r.assignments, 3, 'p2', 7), 'חפיפות ביום רביעי אחה״צ');
    eq(r.unfilled[0].missing, 1, 'החפיפות לא נספר לדרישת הווטרינרים');
    ok(!r.stats.some(function (s) { return s.id === 7; }), 'חפיפות לא מופיע בסטטיסטיקת הסולוור');
  });

  t('חפיפות כפוף למגבלות קשות ולהיעדרויות', function () {
    var st = mkState({
      employees: [emp(7, { role: 'trainee', hardUnavailable: [[0, 'p1']] })],
      prefs: { 7: pref({ roleGroup: 'trainee' }) },
      traineeSlots: { 7: [[0, 'p1'], [1, 'p1'], [2, 'p1']] },
      absences: [{ id: 1, employeeId: 7, startDate: '2026-09-01', endDate: '2026-09-01', part: 'either' }]
    });
    var r = S.generate(st, WS);   // 2026-09-01 = יום שלישי בשבוע שמתחיל 30/08
    eq(r.traineeAdded, 1, 'נשאר רק יום שני');
    ok(has(r.assignments, 1, 'p1', 7), 'רק הסלוט הפנוי');
  });

  t('חפיפות עם העדפת משמרת מדלג על הסלוטים האחרים', function () {
    var st = mkState({
      employees: [emp(7, { role: 'trainee' })],
      prefs: { 7: pref({ roleGroup: 'trainee', prefer: 'p1' }) },
      traineeSlots: { 7: [[0, 'p1'], [0, 'p2'], [1, 'p2']] }
    });
    var r = S.generate(st, WS);
    eq(r.traineeAdded, 1, 'רק הבוקר');
    eq(r.assignments[0].part, 'p1');
  });

  t('חפיפות לא משובץ למשמרת שלא קיימת ביום', function () {
    var st = mkState({
      employees: [emp(7, { role: 'trainee' })],
      prefs: { 7: pref({ roleGroup: 'trainee' }) },
      traineeSlots: { 7: [[5, 'p2']] },
      dayParts: { '0': ['p1', 'p2'], '1': ['p1', 'p2'], '2': ['p1', 'p2'],
                  '3': ['p1', 'p2'], '4': ['p1', 'p2'], '5': ['p1'], '6': [] }
    });
    eq(S.generate(st, WS).traineeAdded, 0, 'אין אחה״צ בשישי');
  });

  t('חפיפות כפוף לסוג המשמרת שלו', function () {
    var st = mkState({
      employees: [emp(7, { role: 'trainee', allowedParts: ['p1'] })],
      prefs: { 7: pref({ roleGroup: 'trainee' }) },
      traineeSlots: { 7: [[0, 'p1'], [1, 'p2']] }
    });
    var r = S.generate(st, WS);
    eq(r.traineeAdded, 1, 'רק משמרת בוקר');
    eq(r.assignments[0].part, 'p1');
  });

  // ── מיון לפי צפיפות ───────────────────────────────────────────────────────
  t('משמרת עם מועמד יחיד מאוישת לפני משמרת פתוחה', function () {
    // בלי מיון-לפי-צפיפות, עובד 2 היה נחטף לבוקר (תיקו → id גבוה) ואחה"צ היה נשאר ריק.
    var st = mkState({
      employees: [emp(1, { allowedParts: ['p1'] }), emp(2)],
      prefs: { 1: pref({ targetMax: 1 }), 2: pref({ targetMax: 1 }) },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 0, part: 'p2', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.unfilled.length, 0, 'שתי המשמרות מאוישות');
    ok(has(r.assignments, 0, 'p1', 1) && has(r.assignments, 0, 'p2', 2), 'כל אחד במקומו');
  });

  // ── 7. חוסרים ─────────────────────────────────────────────────────────────
  t('חוסר מצטבר ל-unfilled אחד', function () {
    var st = mkState({
      employees: [emp(1)], prefs: { 1: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 3 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 1, 'אותו עובד לא משובץ פעמיים לאותה משמרת');
    eq(r.unfilled.length, 1, 'שורת חוסר אחת');
    eq(r.unfilled[0].missing, 2, 'חסרים שניים');
  });

  // ── 8. ברירות מחדל ────────────────────────────────────────────────────────
  t('עובד בלי prefs מקבל ברירת מחדל ולא נעלם', function () {
    var st = mkState({
      employees: [emp(1, { role: 'manager' })], prefs: {},
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    ok(has(S.generate(st, WS).assignments, 0, 'p1', 1), 'מנהל מסווג כווטרינר ומשובץ');
  });

  t('עובד מאורכב לא משובץ', function () {
    // ה-id הגבוה מנצח בתיקו — לכן המאורכב מקבל דווקא אותו, אחרת הבדיקה ריקה.
    var st = mkState({
      employees: [emp(1), emp(9, { active: false })],
      prefs: { 1: pref(), 9: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 1);
    eq(r.assignments[0].employeeId, 1, 'המאורכב מדולג למרות id גבוה');
  });

  // ── 9. היעדרויות ──────────────────────────────────────────────────────────
  t('היעדרות יום-שלם חוסמת את כל המשמרות', function () {
    var st = mkState({
      employees: [emp(1)], prefs: { 1: pref() },
      absences: [{ id: 1, employeeId: 1, startDate: WS, endDate: WS, part: 'either' }],
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 0, part: 'p2', roleGroup: 'vet', count: 1 }]
    });
    eq(S.generate(st, WS).assignments.length, 0, 'יום שלם חסום');
  });

  t('היעדרות חצי-יום חוסמת רק את החצי שלה', function () {
    var st = mkState({
      employees: [emp(1)], prefs: { 1: pref() },
      absences: [{ id: 1, employeeId: 1, startDate: WS, endDate: WS, part: 'p1' }],
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 },
               { day: 0, part: 'p2', roleGroup: 'vet', count: 1 }]
    });
    var r = S.generate(st, WS);
    eq(r.assignments.length, 1, 'רק אחה״צ');
    eq(r.assignments[0].part, 'p2');
  });

  t('היעדרות שחוצה את גבול השבוע נחתכת נכון', function () {
    var st = mkState({
      employees: [emp(1)], prefs: { 1: pref() },
      absences: [{ id: 1, employeeId: 1, startDate: '2026-08-28', endDate: '2026-08-31', part: 'either' }]
    });
    var blocks = S.absenceBlocks(st, WS);
    eq(blocks.map(function (b) { return b.day; }).sort(), [0, 1], 'רק ראשון ושני נופלים בשבוע');
  });

  // ── 10. override שבועי לדרישות ────────────────────────────────────────────
  t('override שבועי דורס את הדרישות הגלובליות', function () {
    var st = mkState({
      employees: [emp(1), emp(2)], prefs: { 1: pref(), 2: pref() },
      demand: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 2 }],
      weeks: { '2026-08-30': { demandOverride: [{ day: 0, part: 'p1', roleGroup: 'vet', count: 1 }] } }
    });
    eq(S.generate(st, WS).assignments.length, 1, 'ה-override קובע');
  });

  // ── 11. תאריכים ───────────────────────────────────────────────────────────
  t('weekStartOf תמיד מחזיר יום ראשון', function () {
    ['2026-01-01', '2026-08-27', '2026-10-25', '2026-12-31', '2024-02-29'].forEach(function (d) {
      var ws = S.weekStartOf(d);
      eq(S.dowOf(ws), 0, 'יום ראשון עבור ' + d);
      ok(ws <= d && S.addDaysISO(ws, 6) >= d, d + ' נמצא בתוך השבוע ' + ws);
    });
  });

  t('אריתמטיקת תאריכים חוצה חודש/שנה/מעבר שעון', function () {
    eq(S.addDaysISO('2026-02-28', 1), '2026-03-01', '2026 אינה שנה מעוברת');
    eq(S.addDaysISO('2024-02-28', 1), '2024-02-29', '2024 מעוברת');
    eq(S.addDaysISO('2026-12-31', 1), '2027-01-01');
    // מעבר שעון חורף בישראל — 25/10/2026. אריתמטיקה ב-UTC אינה מושפעת.
    eq(S.addDaysISO('2026-10-24', 1), '2026-10-25');
    eq(S.addDaysISO('2026-10-25', 1), '2026-10-26');
    eq(S.dayIndexInWeek('2026-10-25', '2026-10-31'), 6);
    eq(S.dayIndexInWeek('2026-10-25', '2026-11-01'), null, 'מחוץ לשבוע');
  });

  // ── 12. קונפליקטים בהוספה ידנית ───────────────────────────────────────────
  t('manualAddConflicts מחזיר סיבות נכונות', function () {
    var st = mkState({
      employees: [emp(1, { hardUnavailable: [[0, 'p1']], allowedParts: ['p1'] }), emp(2)],
      prefs: { 1: pref(), 2: pref() },
      absences: [{ id: 1, employeeId: 2, type: 'vacation', startDate: WS, endDate: WS, part: 'either' }]
    });
    eq(S.manualAddConflicts(st, WS, 0, 'p1', 1).length, 1, 'מגבלה קשה');
    eq(S.manualAddConflicts(st, WS, 0, 'p2', 1).length, 1, 'סוג משמרת');
    eq(S.manualAddConflicts(st, WS, 1, 'p1', 1).length, 0, 'יום נקי');
    ok(/חופשה/.test(S.reasonText(S.manualAddConflicts(st, WS, 0, 'p1', 2))), 'חופשה מזוהה');
    eq(S.manualAddConflicts(st, WS, 0, 'p1', 99), [{ level: 'hard', text: 'עובד לא נמצא' }]);
  });

  t('ויתור על מגבלה רכה אינו מסומן כהפרה קשה', function () {
    // הלוח חייב להבדיל: המנוע מוותר על בקשה רכה בכוונה, וזו לא טעות שלו.
    var st = mkState({
      employees: [emp(1, { softUnavailable: [[0, 'p1']] }), emp(2, { hardUnavailable: [[0, 'p1']] })],
      prefs: { 1: pref(), 2: pref() }
    });
    var soft = S.manualAddConflicts(st, WS, 0, 'p1', 1);
    var hard = S.manualAddConflicts(st, WS, 0, 'p1', 2);
    eq(soft.length, 1); eq(S.hasHard(soft), false, 'רכה אינה קשה');
    eq(hard.length, 1); eq(S.hasHard(hard), true, 'קשה היא קשה');
    ok(S.reasonText(soft).indexOf('להימנע') !== -1, 'הטקסט מנוסח כבקשה');
  });

  t('fmtConstraintDays מייצר עברית קריאה', function () {
    var st = mkState({});
    eq(S.fmtConstraintDays([[2, 'p1'], [5, null]], st.settings), 'שלישי (בוקר), שישי');
  });

  // ── פלט ───────────────────────────────────────────────────────────────────
  var api = {
    results: results,
    passed: results.filter(function (r) { return r.ok; }).length,
    total: results.length
  };
  root.VetShiftsTests = api;

  if (typeof process !== 'undefined' && process.stdout && typeof module !== 'undefined' && require.main === module) {
    results.forEach(function (r) { console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n       ' + r.err)); });
    console.log('\n' + api.passed + '/' + api.total);
    process.exit(api.passed === api.total ? 0 : 1);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
