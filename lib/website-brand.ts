/** Source CSS brand tokens produce a reviewable native accent, never a publisher override. */
export function websiteBrandAccent(stylesheets: string[]): string | undefined {
  const variables=new Map<string,string>();
  // Read scalar tokens even if an unrelated source rule has malformed braces.
  for(const css of stylesheets)for(const match of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g))variables.set(match[1],match[2].trim());
  const preferred=['--bde-button-primary-background-color','--e-global-color-primary','--bde-brand-primary-color','--primary-color','--accent-color',...variables.keys()].filter((key,index,all)=>all.indexOf(key)===index&&/(?:primary|accent|brand)/i.test(key)&&!/(?:hover|text|border|shadow)/i.test(key));
  for(const key of preferred){let value=variables.get(key);for(let hop=0;value&&hop<8;hop++){const reference=/^var\((--[\w-]+)\)$/.exec(value.trim());if(!reference)break;value=variables.get(reference[1]);}
    if(!value||!/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(value))continue;const color=value.length===4?'#'+Array.from(value.slice(1)).map(c=>c+c).join(''):value;const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));if(Math.max(...channels)-Math.min(...channels)>30)return color.toLowerCase();
  }
}
