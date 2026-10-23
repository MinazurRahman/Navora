import { expect, test } from '@playwright/test';
import { useFakeApi } from './fakeApi.js';

test.describe('small screens', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the menu opens, navigates and closes', async ({ page }) => {
    await useFakeApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.locator('#mobile-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(menu).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Explore places' })).toBeVisible();
  });

  test('Explore switches between list and map', async ({ page }) => {
    await useFakeApi(page);
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Map', exact: true }).first().click();
    await expect(page.getByRole('region', { name: 'Map of results' })).toBeVisible();
  });
});

test('searching from the home page opens Explore with the results', async ({ page }) => {
  await useFakeApi(page);
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search places' }).fill('ahsan');
  await page.getByRole('button', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore\?q=ahsan$/);
  await expect(page.getByRole('link', { name: 'Ahsan Manzil' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lalbagh Fort' })).toBeHidden();
});

test('a place shows unknown facts as unknown', async ({ page }) => {
  await useFakeApi(page);
  await page.goto('/places/p1');
  await expect(page.getByRole('heading', { level: 1, name: 'Lalbagh Fort' })).toBeVisible();
  await expect(page.getByText('Opening hours could not be verified')).toBeVisible();
  await expect(page.getByText('Entry fee unknown')).toBeVisible();
  const facilities = page.getByRole('region', { name: 'Facilities' });
  await expect(facilities.getByText('Not verified')).toHaveCount(2);
});

test('private pages ask visitors to sign in and remember where they were going', async ({ page }) => {
  await useFakeApi(page);
  await page.goto('/trips');
  await expect(page).toHaveURL(/\/login\?next=%2Ftrips$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});

test('keyboard users can skip to the content', async ({ page }) => {
  await useFakeApi(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});
