// Side-effect module (imported once from renderer/main.tsx): installs the soft-proof source into @galley/render, so every
// screen-mode page shows CMYK and spot colors through the output profile. Lane A.
import { setSoftProofSource } from '@galley/render';
import { createSoftProofSource } from './softproof';

const press = window.galley?.press;
if (press) setSoftProofSource(createSoftProofSource((inks) => press.softProof(inks)));
