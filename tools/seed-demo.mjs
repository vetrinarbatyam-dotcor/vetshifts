// זורע מרפאת דמו ומייצא תמונה — משמש לבדיקות ולצילומי השקה.
import { chromium } from 'playwright'; import fs from 'fs';
export async function seed(p) {
  if (await p.locator('#gate').isVisible()) {
    await p.fill('#gateCode', 'claudevet2026'); await p.click('#gateForm button'); await p.waitForTimeout(300);
  }
  await p.fill('#setClinic', 'מרפאה וטרינרית הרצליה');
  await p.click('#addSpec'); await p.waitForTimeout(80);
  await p.locator('#specBody tr').first().locator('input').fill('כירורגיה');
  await p.locator('#specBody tr').first().locator('.swatch').nth(4).click(); await p.waitForTimeout(80);
  await p.click('#addSpec'); await p.waitForTimeout(80);
  await p.locator('#specBody tr').nth(1).locator('input').fill('אולטרסאונד');
  await p.locator('#specBody tr').nth(1).locator('.swatch').nth(2).click(); await p.waitForTimeout(80);

  await p.click('nav button[data-tab="employees"]');
  for (const [f, l, g, bd] of [['דנה', 'לוי', 'vet', '1990-05-14'], ['אורי', 'כהן', 'vet', ''],
                               ['רות', 'מזרחי', 'vet', ''], ['מאיה', 'בר', 'assistant', ''],
                               ['יעל', 'אדרי', 'assistant', ''], ['נועם', 'שגב', 'trainee', '']]) {
    await p.click('#addEmp'); await p.fill('#eFirst', f); await p.fill('#eLast', l);
    await p.selectOption('#eGroup', g); if (bd) await p.fill('#eBirth', bd);
    if (g === 'trainee') { const c = p.locator('#eTrainee .cell:not([disabled])'); await c.nth(0).click(); await c.nth(3).click(); }
    else if (f === 'דנה') { const c = p.locator('#eAvail .cell:not([disabled])'); await c.nth(1).click(); await c.nth(1).click(); }
    await p.click('#empSave'); await p.waitForTimeout(50);
  }
  const ws = await p.evaluate(() => VetSolver.weekStartOf(VetSolver.todayISO()));
  await p.click('#addAbs'); await p.waitForTimeout(100);
  await p.selectOption('#absEmp', { label: 'מאיה בר' });
  await p.selectOption('#absType', 'sick');
  const tue = await p.evaluate(w => VetSolver.addDaysISO(w, 2), ws);
  await p.fill('#absStart', tue); await p.fill('#absEnd', tue);
  await p.click('#absDlg button[value="save"]'); await p.waitForTimeout(120);

  await p.click('nav button[data-tab="demand"]');
  const ins = p.locator('#demTable tbody input'); const n = await ins.count();
  for (let i = 0; i < n; i++) { await ins.nth(i).fill(i % 2 === 0 ? '2' : '1'); await ins.nth(i).dispatchEvent('change'); }
  await p.click('nav button[data-tab="board"]');
  await p.click('#genBtn'); await p.waitForTimeout(300);
  await p.locator('#board .notebtn').first().click(); await p.waitForTimeout(120);
  await p.fill('#dnNote', 'יום ניתוחים — לא לקבוע ביקורות רגילות');
  await p.locator('#dnSpecs .chip').first().click();
  await p.click('#dnDlg button[value="save"]'); await p.waitForTimeout(150);
  await p.locator('#board .emp .nm').first().click(); await p.waitForTimeout(120);
  if (!(await p.locator('#asgOpenerWrap').isHidden())) await p.check('#asgOpener');
  await p.fill('#asgNote', 'מגיעה ב-12'); await p.fill('#asgStart', '12:00');
  await p.click('#asgDlg button[value="save"]'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('vetshifts:v1'));
    s.meta.lastBackupAt = VetSolver.todayISO();
    localStorage.setItem('vetshifts:v1', JSON.stringify(s));
  });
  await p.reload(); await p.waitForTimeout(300);
}

