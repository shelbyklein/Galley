// Side-effect module: registers the canvas commands (View, Edit selection and clipboard, Object, Fitting, File > Place) on
// the app's command registry and store. The renderer entry imports it with one line: `import './canvas/register';`
import { commands } from '../commands/registry';
import { useEditorStore } from '../store';
import { registerCanvasCommands } from './commands';

registerCanvasCommands(useEditorStore, commands);
