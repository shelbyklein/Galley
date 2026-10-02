import { separate, measureRegion } from '@galley/prepress/verify';
// Independent RIP acceptance for every font row. This helper runs under tsx, not the app renderer.
async function main() {
const [pdf, out, countText = '3'] = process.argv.slice(2);
const plates = await separate(pdf!, out!, 144);
for (let row = 0; row < Number(countText); row++) {
  const region = { x: 36 * 2, y: (36 + row * 200) * 2, w: 420 * 2, h: 170 * 2 };
  const ink = measureRegion(plates, region);
  if (ink.max.C !== 0 || ink.max.M !== 0 || ink.max.Y !== 0 || ink.max.K < 99) throw new Error(`Font row ${row}: expected K-only solid black, measured ${JSON.stringify(ink.max)}`);
  console.log(`Font row ${row}: C=${ink.max.C} M=${ink.max.M} Y=${ink.max.Y} K=${ink.max.K} PASS`);
}

}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
