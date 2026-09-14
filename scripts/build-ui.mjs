import fs from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['internal/ui/src/app.js'],outfile:'internal/ui/assets/app.js',bundle:true,format:'iife',target:['chrome57'],legalComments:'none',charset:'utf8'});
await fs.writeFile('internal/ui/assets/light.css',(await fs.readFile('internal/appearance/atmosphere.css','utf8'))+'\n'+(await fs.readFile('internal/ui/src/light.css','utf8')));
console.log('WeLink UI compiled for Chromium 57+');
