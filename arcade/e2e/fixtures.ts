import { test as base, expect } from "@playwright/test";

/** Collect errors until the page is closed; throwing in an event callback is not a test assertion. */
export const test = base.extend<{ pageSafety: void }>({
  pageSafety: [async ({ page }, use) => {
    const errors: string[] = [];
    const record = (error: Error) => { errors.push(error.message); };
    page.on("pageerror", record);
    try { await use(); }
    finally {
      if (!page.isClosed()) await page.close();
      page.off("pageerror", record);
      expect(errors, "unexpected browser exceptions during the test").toEqual([]);
    }
  }, { auto: true }],
});
export { expect };
