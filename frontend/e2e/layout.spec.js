import { expect, test } from '@playwright/test';
import { useFakeApi } from './fakeApi.js';

// Layout checks a unit test cannot do: real CSS at real widths.
const WIDTHS = [390, 768, 1440];
const PUBLIC_PAGES = ['/', '/explore', '/places/p1', '/community', '/login', '/register'];
const PRIVATE_PAGES = ['/plan', '/trips', '/saved', '/profile', '/community/submit'];

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of PUBLIC_PAGES) {
      test(`${path} fits the screen`, async ({ page }) => {
        await useFakeApi(page);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoHorizontalScroll(page);
      });
    }

    for (const path of PRIVATE_PAGES) {
      test(`${path} fits the screen when signed in`, async ({ page }) => {
        await useFakeApi(page, { signedIn: true });
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
