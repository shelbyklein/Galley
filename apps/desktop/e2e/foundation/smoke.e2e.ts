import { test, expect } from '../helpers/fixtures';
import { expectBaseline, snap } from '../helpers/screenshot';

// P1-01: the empty shell has its four regions, laid out like the Phase 1 mockup.
test.use({ open: null });

test('empty shell shows tools, control strip, canvas and dock', async ({ galley }, testInfo) => {
  const { page } = galley;

  const box = async (region: string) => {
    const b = await page.locator(`[data-region="${region}"]`).boundingBox();
    expect(b, `region ${region} is visible`).not.toBeNull();
    return b!;
  };
  const tools = await box('tools');
  const control = await box('control-strip');
  const canvas = await box('canvas');
  const dock = await box('dock');

  // control strip spans the top; tools | canvas | dock sit side by side beneath it
  expect(control.y + control.height).toBeLessThanOrEqual(tools.y + 1);
  expect(control.width).toBeGreaterThan(1000);
  expect(tools.x + tools.width).toBeLessThanOrEqual(canvas.x + 1);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(dock.x + 1);
  expect(canvas.width).toBeGreaterThan(tools.width * 10);
  expect(dock.width).toBe(300);
  expect(tools.width).toBe(44);

  const file = await snap(page, 'shell-empty', { testInfo });
  expect(file).toMatch(/shell-empty\.png$/);
  await expectBaseline(page, 'shell-empty');
});
