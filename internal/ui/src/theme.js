export function applyTheme(dark){
 document.body.classList.toggle('dark',dark);
 document.documentElement.style.backgroundColor=dark?'#22252b':'#f5f6f7';
 document.documentElement.style.colorScheme=dark?'dark':'light';
 document.querySelector('meta[name=theme-color]')?.setAttribute('content',dark?'#22252b':'#0099ff');
 window.WeLinkAndroid?.setDarkTheme?.(dark);
 window.welinkTheme?.(dark).catch(()=>{});
}
