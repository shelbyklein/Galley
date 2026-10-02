// Soft proofing in the main process (P1-07): the editor asks for the on-screen RGB of CMYK inks, and which profile is in
// use for the status bar. The conversion is @galley/prepress's LittleCMS transform through the output profile.
import { createSoftProofer, selectProfiles, type ProfileSelection } from '@galley/prepress';
import type { ProfileInfo, ProofCmyk } from '../../shared/export-ipc';

type Proofer = Awaited<ReturnType<typeof createSoftProofer>>;

let selection: ProfileSelection | null = null;
let proofer: Promise<Proofer | null> | null = null;

/** The profiles in use. Looked up once per run: the environment overrides (tests) are read at first use. */
export function currentProfiles(): ProfileSelection {
  selection ??= selectProfiles();
  return selection;
}

export function currentProfileInfo(): ProfileInfo {
  const { output, note } = currentProfiles();
  if (!output) return { kind: 'none', name: '', note };
  return { kind: output.kind, name: output.name, note };
}

function getProofer(): Promise<Proofer | null> {
  proofer ??= (async () => {
    const { output, srgbPath } = currentProfiles();
    if (!output || !srgbPath) return null;
    try {
      return await createSoftProofer(output.path, srgbPath);
    } catch (error) {
      console.error('Soft proofing is unavailable', error);
      return null;
    }
  })();
  return proofer;
}

/** sRGB for each CMYK ink through the output profile, or null when there is no usable profile (the editor then shows its approximation). */
export async function softProofColors(inks: readonly ProofCmyk[]): Promise<[number, number, number][] | null> {
  const p = await getProofer();
  return p ? p.convert(inks) : null;
}
