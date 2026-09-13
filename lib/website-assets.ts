import 'server-only';
import { createRequire } from 'node:module';
import { parseHtml } from './html-document';
import { assertPublicWebsiteUrl, fetchWebsiteBytes, type WebsiteTransport } from './website-fetch';
import { websiteBrandAccent } from './website-brand';
import type { WebsiteImage } from './website-import-model';
const postcss = createRequire(import.meta.url)('postcss') as typeof import('postcss');

/** Read bounded CSS only for image references and a reviewable brand color.
 * Never retain styles, download fonts, execute scripts, or reproduce the source layout. */
export async function discoverWebsiteAssets(pages: {url:string;html:string}[], io?:WebsiteTransport) {
  const cache=new Map<string,{url:string;text:string}>(), images=new Map<string,WebsiteImage>(), notes:string[]=[], colors:string[]=[];
  const signal=AbortSignal.timeout(45_000);
  for(const page of pages){
    const root=parseHtml(page.html), sheets=root.querySelectorAll('style').map(node=>({url:page.url,text:node.text}));
    for(const link of root.querySelectorAll('link[rel="stylesheet"][href]')){
      try{
        const href=assertPublicWebsiteUrl(new URL(link.getAttribute('href')!,page.url).toString()).toString();
        if(cache.has(href)){sheets.push(cache.get(href)!);continue;}
        if(cache.size>=16||signal.aborted){notes.push('Stylesheet discovery reached its limit; some background photos or brand colors may need manual review.');break;}
        cache.set(href,{url:href,text:''});let url=href;
        for(let hop=0;hop<4;hop++){
          const response=await fetchWebsiteBytes(url,io,signal,1024*1024);
          if([301,302,303,307,308].includes(response.status)&&response.location){url=assertPublicWebsiteUrl(new URL(response.location,url).toString()).toString();continue;}
          if(response.status!==200||response.contentType!=='text/css')throw new Error('Stylesheet unavailable');
          const sheet={url,text:Buffer.from(response.bytes).toString('utf8')};cache.set(href,sheet);sheets.push(sheet);break;
        }
      }catch{notes.push('A stylesheet could not be read; some background photos or brand colors may need manual review.');}
    }
    for(const sheet of sheets){
      colors.push(sheet.text);
      try{postcss.parse(sheet.text).walkDecls(decl=>{
        if(!/^background(?:-image)?$/i.test(decl.prop))return;
        for(const match of decl.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi))try{
          const url=assertPublicWebsiteUrl(new URL(match[2],sheet.url).toString()).toString();
          if(images.size<100&&!images.has(url))images.set(url,{url,pageUrl:page.url,alt:'',variants:[url]});
        }catch{/* Ignore unsupported references. */}
      });}catch{notes.push('A stylesheet could not be parsed; review background images manually.');}
    }
  }
  return{images:[...images.values()],brandAccent:websiteBrandAccent(colors),notes:[...new Set(notes)]};
}
