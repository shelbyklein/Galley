import { useEffect, useState } from 'react';
import type { ProfileInfo } from '../../shared/export-ipc';

/** The status bar's note on the soft-proof profile: `Proof: Coated GRACoL 2006`, or the fallback, or none. Lane A. */
export function profileLabel(info: ProfileInfo): string {
  if (info.kind === 'press') return `Proof: ${info.name}`;
  if (info.kind === 'fallback') return `Proof: ${info.name} (default_cmyk.icc fallback)`;
  return 'Proof: no output profile (approximate colors)';
}

export function ProfileStatus() {
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  useEffect(() => {
    let live = true;
    const bridge = window.galley?.press;
    if (!bridge) return;
    void bridge.getProfileInfo().then((i) => live && setInfo(i), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!info) return null;
  return (
    <span className="gl-profile-status" data-testid="status-profile" data-profile-kind={info.kind} title={info.note ?? info.name} style={{ marginLeft: 'auto' }}>
      {profileLabel(info)}
    </span>
  );
}
