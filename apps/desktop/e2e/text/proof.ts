import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {APP_DIR,REPO_ROOT,type GalleyApp} from '../helpers/launch';
import {getDocumentJson} from '../helpers/app-state';
export async function rawPdf({page,app}:GalleyApp,name:string) {
  const document=await getDocumentJson(page),url=pathToFileURL(path.join(APP_DIR,'out/renderer/export-page/index.html')).href;
  const bytes=await app.evaluate(async({BrowserWindow},{url,document})=>{
    const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    try {await win.loadURL(url);await win.webContents.executeJavaScript(`window.galleyExport.load(${JSON.stringify({document,links:'{"formatVersion":2,"links":{}}'})})`);return (await win.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,margins:{top:0,right:0,bottom:0,left:0},scale:1})).toString('base64');}finally{win.destroy();}
  },{url,document});
  const file=path.join(REPO_ROOT,'scripts/text/out',name+'.pdf');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(bytes,'base64'));return file;
}
export interface BaselineSpan {text:string;x:number;y:number;size:number;font:string;bbox:number[]}
export function pdfBaselines(file:string):BaselineSpan[] {
  const conda=path.join(os.homedir(),'miniconda3/bin/python3');
  const python=process.env.GALLEY_PDF_PYTHON ?? (fs.existsSync(conda)?conda:'python3');
  return JSON.parse(execFileSync(python,[path.join(REPO_ROOT,'scripts/text/pdf-baselines.py'),file],{encoding:'utf8'}));
}
/** Insert a zero-size baseline box at each independently measured native line start. No font bbox correction. */
export function screenBaselines() {
  const page=document.querySelector('.galley-page') as HTMLElement,box=page.getBoundingClientRect(),scale=box.width/parseFloat(page.style.width);
  const result:{frame:string;paragraph:number;y:number}[]=[];
  for(const frame of [...page.querySelectorAll<HTMLElement>('.galley-text')]) {
    for(const [paragraph,p] of [...frame.querySelectorAll('p')].entries()) {
      const words:{node:Text;offset:number;cy:number}[]=[];
      const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
      const font=parseFloat(getComputedStyle(p).fontSize)*(scale/(4/3));
      for(let n=walker.nextNode();n;n=walker.nextNode()) {
        const node=n as Text;if(node.parentElement?.closest('[data-drop-cap]'))continue;
        for(const m of node.data.matchAll(/\S+/g)) {
          const r=document.createRange();r.setStart(node,m.index!);r.setEnd(node,m.index!+m[0].length);
          const b=[...r.getClientRects()].filter(b=>b.width>0).at(-1);if(!b || b.height>font*1.8)continue;
          words.push({node,offset:m.index!,cy:(b.top+b.bottom)/2});
        }
      }
      const starts=words.filter((w,i)=>i===0 || Math.abs(w.cy-words[i-1]!.cy)>1);
      const probes:HTMLElement[]=[];
      for(const start of [...starts].reverse()) {
        const probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;line-height:0';
        const r=document.createRange();r.setStart(start.node,start.offset);r.collapse(true);r.insertNode(probe);probes.unshift(probe);
      }
      for(const probe of probes)result.push({frame:frame.dataset.frameId!,paragraph,y:(probe.getBoundingClientRect().top-box.top)/scale});
      for(const probe of probes)probe.remove();p.normalize();
    }
  }
  return result;
}
