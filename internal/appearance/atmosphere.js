/* CSS owns the animation; no frame loop, canvas, network, or scroll listeners. */
(()=>{
 const root=document.documentElement;
 const pause=()=>root.classList.add('snow-paused');
 const sync=()=>root.classList.toggle('snow-paused',document.hidden||!document.hasFocus());
 document.addEventListener('visibilitychange',sync);
 window.addEventListener('blur',pause);
 window.addEventListener('focus',sync);
 window.addEventListener('pagehide',pause);
 window.addEventListener('pageshow',sync);
 sync();
})();
