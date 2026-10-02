import { commands } from '../../commands/registry';
import { useEditorStore } from '../../store';
commands.register({id:'view.showTextThreads',label:'Show Text Threads',category:'View',shortcut:'Mod+Alt+Y',run:()=>{const s=useEditorStore.getState();s.setView({textThreadsVisible:!s.view.textThreadsVisible});}});
commands.register({id:'view.showBaselineGrid',label:'Show Baseline Grid',category:'View',shortcut:"Mod+Alt+'",run:()=>{const s=useEditorStore.getState();s.setView({baselineGridVisible:!s.view.baselineGridVisible});}});
