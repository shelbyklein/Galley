import { useShellStore } from '../shell/shellStore';
import { NewDocumentDialog } from './NewDocumentDialog';
import { SwatchDialog } from './SwatchDialog';

/** Renders the one open dialog (`shellStore.dialog`), if any. */
export function DialogHost() {
  const dialog = useShellStore((s) => s.dialog);
  const close = useShellStore((s) => s.closeDialog);
  if (!dialog) return null;
  if (dialog.kind === 'newDocument') {
    return (
      <NewDocumentDialog
        onDone={(spec) => {
          close();
          dialog.resolve(spec);
        }}
      />
    );
  }
  return <SwatchDialog swatchId={dialog.swatchId} onDone={close} />;
}
