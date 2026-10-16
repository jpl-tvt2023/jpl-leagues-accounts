/**
 * The tournament page's upload pop-ups, in the browser: a file that fails validation pops up its
 * problems; new data saves straight away; a change to saved data is listed and needs "Save anyway".
 *
 * Run with: npm run test:e2e -- tests/league-types/cricket-upload-dialogs.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import { apiSignInSuperadmin, miniPoints, seedMiniTournament, uiSignInSuperadmin, uniqueSlug, uploadCricketSheet, pointsGrid } from "../harness";

/** A points sheet as CSV: team_code, player_name, then the fixture columns. */
function pointsCsv(rows: Array<Record<string, string | number>>, fixtureIds: number[]): string {
  const header = ["team_code", "player_name", ...fixtureIds.map(String)];
  return [header, ...rows.map((r) => header.map((h) => String(r[h] ?? "")))].map((cells) => cells.join(",")).join("\n");
}

async function uploadPoints(page: Page, name: string, csv: string): Promise<void> {
  const card = page.locator("section", { has: page.getByRole("heading", { level: 3, name: "Points" }) });
  await card.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
}

test.describe.serial("cricket: upload pop-ups", () => {
  let tournamentId = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await seedMiniTournament(request, uniqueSlug("dlg"))).id;
  });

  test("admin: a file that fails validation pops up its problems", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto(`/superadmin/cricket/${tournamentId}`);
    await uploadPoints(page, "typo.csv", pointsCsv([{ team_code: "CSK", player_name: "CSK Playr 2", 1: 5 }], [1]));

    const dialog = page.getByRole("dialog", { name: "typo.csv can't be saved" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('No CSK player called "CSK Playr 2" — did you mean CSK Player 2?');
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  test("admin: new scores save straight away; a changed score is listed and needs Save anyway", async ({ page, request }) => {
    await apiSignInSuperadmin(request);
    await uploadCricketSheet(request, tournamentId, "points", pointsGrid(miniPoints(1)));
    await uiSignInSuperadmin(page);
    await page.goto(`/superadmin/cricket/${tournamentId}`);
    const card = page.locator("section", { has: page.getByRole("heading", { level: 3, name: "Points" }) });

    // After the next game: fixture 2 is new, fixture 1 unchanged — nothing to confirm.
    const afterGame2 = pointsGrid([...miniPoints(1), ...miniPoints(2)]);
    await uploadPoints(page, "after-game-2.csv", pointsCsv(afterGame2, [1, 2]));
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).toContainText("Saved: 12 new · 0 changed · 12 unchanged, in 1 fixture(s).");

    // A fixture 1 score corrected: the change is listed before anything is saved.
    const old = afterGame2.find((r) => r["1"] !== "")!;
    const corrected = afterGame2.map((r) => (r === old ? { ...r, 1: 40 } : r));
    await uploadPoints(page, "corrected.csv", pointsCsv(corrected, [1, 2]));
    await card.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "This upload changes saved data" });
    await expect(dialog).toContainText(`${old.player_name} (${old.team_code})`);
    await expect(dialog).toContainText(`Mini Cup fixture 1: ${old["1"]} → 40`);
    await dialog.getByRole("button", { name: "Save anyway" }).click();
    await expect(card).toContainText("Saved: 0 new · 1 changed · 23 unchanged, in 1 fixture(s).");
  });
});
