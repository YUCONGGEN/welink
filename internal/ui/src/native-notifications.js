export function createNativeNotifications({S,action,selectConversation,refresh,toast}) {
 const supported=typeof window.welinkMessageNotifications==='function'||!!window.WeLinkAndroid?.messageNotifications;
 let active=false;
 async function open(){if(!S.user)return;let raw='';try{raw=window.WeLinkAndroid?.takeMessageNotification?window.WeLinkAndroid.takeMessageNotification():await window.welinkTakeMessageNotification?.();const n=raw?JSON.parse(raw):null;if(!n||n.userId!==S.user.id||!/^[a-f0-9]{32}$/.test(n.conversationId))return;await refresh();await selectConversation(n.conversationId)}catch{toast('该聊天暂时无法打开，请在消息列表中查看')}}
 async function drainInvites(){if(!S.user)return;try{let raw,takeEvent=window.WeLinkAndroid?.takeNativeInviteEvent,takeAction=window.WeLinkAndroid?.takeNativeInviteAction||window.welinkTakeNativeInviteAction;if(takeEvent)while((raw=await takeEvent.call(window.WeLinkAndroid)))window.dispatchEvent(new CustomEvent('welink-native-invite-event',{detail:JSON.parse(raw)}));if(takeAction)while((raw=await takeAction.call(window.WeLinkAndroid||window)))window.dispatchEvent(new CustomEvent('welink-native-invite-action',{detail:JSON.parse(raw)}))}catch{}}
 async function start(){if(!supported)return;window.WeLinkAndroid?.messageNotifications(true);await action('/local/notifications',{token:S.token});active=true;await open()}
 async function stop(){if(!supported)return;active=false;window.WeLinkAndroid?.messageNotifications(false);await action('/local/notifications',{token:''})}
 window.addEventListener('welink-open-message',open);
 window.addEventListener('welink-native-invite',drainInvites);
 window.addEventListener('welink-native-invite-action',event=>{if(!event.detail)drainInvites()});
 window.addEventListener('focus',()=>{if(active){open();drainInvites()}else if(S.user)start().catch(()=>{})});
 return {start,stop,drainInvites,active:()=>active};
}
