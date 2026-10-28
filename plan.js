/* Spark · daily plan + notification schedule.
   Shared by the app (timeline on the Today page) and by the GitHub Action that sends the push notifications.
   Works in the browser (window.MOSPlan) and in Node (module.exports). */
(function(root){
'use strict';
const DEF={lat:24.7136,lng:46.6753,m:'uq',tz:'Asia/Riyadh',
  wake:'07:00',workStart:'09:00',workEnd:'17:00',commute:20,sleep:'23:00',
  workDays:[0,1,2,3,4],train:[0,2,4,6],off:{}};

/* ---------- time helpers (all "local" = the user's time zone) ---------- */
const toMin=s=>{const a=String(s||'0:0').split(':').map(Number);return (a[0]||0)*60+(a[1]||0);};
const fmt=m=>{m=((Math.round(m)%1440)+1440)%1440;const H=Math.floor(m/60),M=m%60;return (H%12===0?12:H%12)+':'+String(M).padStart(2,'0')+(H<12?' ص':' م');};
function partsIn(ms,tz){const f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
  const o={};f.formatToParts(new Date(ms)).forEach(p=>{if(p.type!=='literal')o[p.type]=+p.value;});if(o.hour===24)o.hour=0;return o;}
/* minutes to add to UTC to get local wall time, at instant ms */
function offsetMin(ms,tz){const p=partsIn(ms,tz);const asUTC=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);return Math.round((asUTC-Math.floor(ms/1000)*1000)/60000);}
/* epoch ms for local wall time y-m-d + minutes */
function localToMs(y,mo,d,min,tz){const guess=Date.UTC(y,mo-1,d,0,0)+min*60000;let off=offsetMin(guess,tz);let ms=guess-off*60000;const off2=offsetMin(ms,tz);if(off2!==off)ms=guess-off2*60000;return ms;}

/* ---------- prayer times (same math as the app: Umm al-Qura / Egyptian) ---------- */
const d2r=Math.PI/180,r2d=180/Math.PI;const sin=d=>Math.sin(d*d2r),cos=d=>Math.cos(d*d2r),tan=d=>Math.tan(d*d2r);
const asin=x=>r2d*Math.asin(x),acos=x=>r2d*Math.acos(Math.max(-1,Math.min(1,x))),atan2=(y,x)=>r2d*Math.atan2(y,x),acot=x=>r2d*Math.atan(1/x);
const fix=(a,b)=>{a=a-b*Math.floor(a/b);return a<0?a+b:a;};
function julian(y,m,d){if(m<=2){y-=1;m+=12;}const A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5;}
function sun(jd){const D=jd-2451545;const g=fix(357.529+0.98560028*D,360),q=fix(280.459+0.98564736*D,360);const L=fix(q+1.915*sin(g)+0.02*sin(2*g),360);const e=23.439-0.00000036*D;const RA=fix(atan2(cos(e)*sin(L),cos(L))/15,24);return{decl:asin(sin(e)*sin(L)),eqt:q/15-RA};}
function isRamadan(y,m,d){try{return parseInt(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{month:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d,12))),10)===9;}catch(e){return false;}}
const pkey=(y,m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
/* returns minutes-of-day (local) for each prayer. Uses the official times fetched from the internet when we have them. */
function prayers(y,m,d,c){const ov=c.times&&c.times[pkey(y,m,d)];if(ov&&isFinite(ov.fajr)&&isFinite(ov.isha))return Object.assign({},ov);const LAT=c.lat,LNG=c.lng;const TZ=offsetMin(localToMs(y,m,d,720,c.tz),c.tz)/60;const FA=c.m==='eg'?19.5:18.5;const jd=julian(y,m,d)-LNG/(15*24);
 const mid=t=>fix(12-sun(jd+t).eqt,24);
 const at=(a,t,ccw)=>{const s=sun(jd+t);const v=(-sin(a)-sin(s.decl)*sin(LAT))/(cos(s.decl)*cos(LAT));const T=acos(v)/15;return mid(t)+(ccw?-T:T);};
 const asr=(f,t)=>{const s=sun(jd+t);return at(-acot(f+tan(Math.abs(LAT-s.decl))),t);};
 let t={fajr:5,sunrise:6,dhuhr:12,asr:13,maghrib:18};
 for(let i=0;i<2;i++){const p={};for(const k in t)p[k]=t[k]/24;t={fajr:at(FA,p.fajr,true),sunrise:at(0.833,p.sunrise,true),dhuhr:mid(p.dhuhr),asr:asr(1,p.asr),maghrib:at(0.833,p.maghrib)};}
 const o={};for(const k in t)o[k]=t[k]+TZ-LNG/15;
 if(c.m==='eg'){const pi=t.maghrib/24;o.isha=at(17.5,pi)+TZ-LNG/15;}else o.isha=o.maghrib+(isRamadan(y,m,d)?2:1.5);
 const r={};for(const k in o)r[k]=Math.round(o[k]*60);return r;}

/* ---------- messages (rotate every day so they never feel the same) ---------- */
const PN={fajr:'الفجر',dhuhr:'الظهر',asr:'العصر',maghrib:'المغرب',isha:'العشاء'};
const M={
 fajr:["الصلاة خير من النوم. قوم صلّي الفجر", "صلاة الفجر في وقتها بتنوّر يومك كله", "ابدأ يومك مع ربنا"],
 dhuhr:["وقت الظهر. سيب اللي في إيدك 10 دقايق", "بريك مع ربنا وسط اليوم", "صلّي الظهر وارجع أهدى"],
 asr:["وقت العصر. حافظ عليها", "صلاة العصر قبل ما النهار يخلص", "قوم صلّي العصر"],
 maghrib:["وقت المغرب. وقتها قصير، بادر", "اختم نهارك بسجدة"],
 isha:["وقت العشاء. وما تنساش الوتر", "صلّي العشاء واقفل يومك صح"],
 prayer:['حيّ على الصلاة. سيب اللي في إيدك 10 دقايق ورجعله.','الصلاة في وقتها أحب الأعمال إلى الله. قوم دلوقتي.'],
 wake:["صباح الخير ☀ اشرب كوباية مية وابدأ يومك", "يوم جديد وفرصة جديدة. يلا نصحى", "صباح الفل! أول نص ساعة من غير موبايل"],
 azkar_m:["وقت أذكار الصباح. 5 دقايق بتحصّن يومك", "أذكار الصباح قبل ما تنزل"],
 train:["وقت التمرين 💪 ولو 20 دقيقة", "جسمك محتاج يتحرك. يلا تمرين", "التمرين بيحسن مزاجك. قوم"],
 walk:["امشي 10 دقايق واعمل إطالة خفيفة", "حركة خفيفة تصحّي جسمك"],
 breakfast:["وقت الفطار. كُل حاجة حلوة ومفيدة", "متنزلش من غير فطار"],
 leave:["وقت النزول للشغل. بالتوفيق النهارده", "يلا على الشغل، ويومك يبقى حلو"],
 focus:["وقت تركيز: اقفل الإشعارات واشتغل 25 دقيقة على أهم حاجة", "إيه أهم حاجة في شغلك النهارده؟ ابدأ بيها", "اكتب فكرة كريتف واحدة دلوقتي", "جلسة تركيز 25 دقيقة. إنت قدها", "خلّص مهمة واحدة كاملة قبل اللي بعدها"],
 home:["رجعت البيت. ارتاح شوية واشحن نفسك", "يوم شغل خلص. خد نفسك وارتاح"],
 azkar_e:["وقت أذكار المساء", "اقفل نهارك بأذكار المساء"],
 story:["فيه قصة جديدة مستنياك في التطبيق", "اقرا قصة النهارده، فيها عبرة حلوة"],
 read:["وقت القراية 📚 10 صفحات بس", "افتح كتابك 15 دقيقة قبل النوم"],
 review:["خد دقيقتين وراجع يومك: عملت إيه؟", "علّم اللي خلصته النهارده وشوف نسبتك"],
 wind:["قرّب وقت النوم. هدّي الإضاءة وسيب الموبايل", "اكتب 3 حاجات حلوة حصلت النهارده"],
 sleep:["وقت النوم 😴 الموبايل بعيد عن السرير", "نام بدري علشان بكرة يبقى أحلى", "تصبح على خير"],
 friday:["جمعة مباركة · اقرا الكهف وصلّي على النبي ﷺ", "بكّر للجمعة واقرا سورة الكهف"],
 moti:["افتكر إنت بتعمل كل ده ليه. كمّل", "خطوة صغيرة النهارده بتفرق بكرة", "إنت أقوى من إحساسك دلوقتي"],
 dhikr:["أستغفر الله ×100", "سبحان الله وبحمده ×100", "لا حول ولا قوة إلا بالله", "صلّي على النبي ﷺ ×10", "سبحان الله · الحمد لله · الله أكبر"],
 away:["وحشتنا! افتح التطبيق وعلّم يومك", "بقالك فترة مدخلتش. يلا نكمّل", "خطوة واحدة صغيرة النهارده تكفي"]
};
const CATS=[['prayer','🕌','الصلوات'],['wake','☀','الصحيان والنوم'],['azkar','📿','أذكار الصبح والمساء'],['body','💪','التمرين والفطار والنزول'],['focus','🎯','ركّز على هدفك'],['moti','⚡','التحفيز'],['story','📖','القصص والأحاديث'],['read','📚','القراية'],['review','◑','حساب آخر اليوم'],['dhikr','📿','استغفار وتسبيح'],['away','◌','لو غبت عن التطبيق']];
const GO={fajr:'pray',prayer:'pray',wake:'day',azkar_m:'azkar_m',train:'day',walk:'day',breakfast:'day',leave:'day',focus:'goal',home:'moti',moti:'moti',azkar_e:'azkar_e',story:'story',read:'read',review:'review',wind:'gratitude',sleep:'day',friday:'day',dhikr:'dhikr',away:'day'};
const TITLE={wake:'☀ صباح الخير',azkar_m:'📿 أذكار الصباح',train:'💪 وقت التمرين',walk:'🚶 حركة خفيفة',breakfast:'🍳 وقت الفطار',leave:'🚗 النزول للشغل',focus:'🎯 وقت التركيز',home:'🏠 رجعت البيت',moti:'✨ جرعة تحفيز',azkar_e:'📿 أذكار المساء',story:'📖 قصة النهارده',read:'📚 وقت القراية',review:'◑ راجع يومك',wind:'🌙 استعد للنوم',sleep:'😴 وقت النوم',friday:'🕌 الجمعة',dhikr:'📿 ذكر',away:'👋 وحشتنا'};
const LBL={fajr:'الفجر',dhuhr:'الظهر',asr:'العصر',maghrib:'المغرب',isha:'العشاء',wake:'الصحيان',azkar_m:'أذكار الصباح',train:'التمرين',walk:'مشي خفيف',breakfast:'الفطار',leave:'النزول للشغل',work:'الشغل',focus:'ركّز',home:'الرجوع للبيت',moti:'تحفيز',azkar_e:'أذكار المساء',story:'قصة وحديث',read:'القراية',review:'الحساب',wind:'الاستعداد للنوم',sleep:'النوم',friday:'الجمعة',dhikr:'ذكر',away:'غياب'};
const ICON={fajr:'🌅',dhuhr:'☀',asr:'🌤',maghrib:'🌇',isha:'🌙',wake:'⏰',azkar_m:'📿',train:'💪',walk:'🚶',breakfast:'🍳',leave:'🚗',work:'💼',focus:'🎯',home:'🏠',moti:'⚡',azkar_e:'📿',story:'📖',read:'📚',review:'◑',wind:'🌙',sleep:'😴',friday:'🕌',dhikr:'📿',away:'◌'};

function dayNum(y,m,d){return Math.floor(Date.UTC(y,m-1,d)/864e5);}
function rot(arr,y,m,d,salt){return arr[(dayNum(y,m,d)*3+(salt||0))%arr.length];}

/* the day's plan as a list of {min, k, cat, title, body, go, label, icon, notify} sorted by time */
function day(y,m,d,cfg){const c=Object.assign({},DEF,cfg||{});const off=c.off||{};
 const wd=new Date(Date.UTC(y,m-1,d)).getUTCDay();const work=(c.workDays||[]).indexOf(wd)>=0;const trainDay=(c.train||[]).indexOf(wd)>=0;
 const P=prayers(y,m,d,c);const wake=toMin(c.wake),ws=toMin(c.workStart),we=toMin(c.workEnd),cm=+c.commute||0,sl=toMin(c.sleep);
 const L=[];let salt=0;
 const add=(min,k,cat,extra)=>{const msgs=M[k]||M.prayer;L.push(Object.assign({min:Math.round(min),k,cat,title:TITLE[k]||'سبارك',body:rot(msgs,y,m,d,salt++),go:GO[k]||'day',label:LBL[k]||k,icon:ICON[k]||'•',notify:true},extra||{}));};
 /* prayers */
 ['fajr','dhuhr','asr','maghrib','isha'].forEach(p=>{const isF=p==='fajr';const jum=p==='dhuhr'&&wd===5;
   add(P[p],p,'prayer',{title:'🕌 '+(jum?'الجمعة':PN[p]),body:jum?'بكّر · واسمع الخطبة':rot(M[p]||M.prayer,y,m,d,salt++),go:'pray',label:jum?'الجمعة':PN[p],icon:ICON[p]});});
 /* morning */
 add(wake,'wake','wake');
 add(wake+5,'azkar_m','azkar');
 let t=wake+15;
 if(trainDay){add(t,'train','body');t+=40;}else{add(t,'walk','body');t+=20;}
 const leave=ws-cm-5;
 if(work){add(Math.min(t,leave-35),'breakfast','body');add(leave,'leave','body');
   L.push({min:ws,k:'work',cat:'body',label:'الشغل',icon:ICON.work,notify:false,end:we});}
 else add(Math.max(t,wake+60),'breakfast','body');
 if(wd===5)add(Math.max(wake+70,toMin('10:00')),'friday','azkar',{title:TITLE.friday,go:'day'});
 /* focus on your goals: 3 nudges spread across the work block (or the day off) */
 const fs=work?ws:Math.max(wake+150,toMin('11:00')),fe=work?we:toMin('18:00');
 [0.18,0.5,0.82].forEach((f,i)=>{let mm=Math.round((fs+(fe-fs)*f)/15)*15;['dhuhr','asr'].forEach(p=>{if(Math.abs(mm-P[p])<20)mm=P[p]+25;});add(mm,'focus','focus');});
 /* evening */
 const home=work?we+cm+5:null;
 if(home)add(home,'home','moti');else add(toMin('16:30'),'moti','moti');
 let ae=Math.max(P.asr+20,home?home+10:P.asr+20);if(ae>P.maghrib-8)ae=Math.max(P.asr+20,P.maghrib-30);add(ae,'azkar_e','azkar');
 add(Math.max(P.isha+25,toMin('19:45')),'story','story');
 add(Math.max(P.isha+80,toMin('20:45')),'read','read');
 add(Math.min(sl-90,toMin('21:30')),'review','review');
 add(sl-30,'wind','wake');
 add(sl,'sleep','wake');
 /* dhikr nudges: istighfar / tasbih, 3 times a day, away from other reminders */
 const free=mm=>{for(let i=0;i<6&&L.some(e=>Math.abs(e.min-mm)<15);i++)mm+=20;return mm;};
 [Math.max(wake+195,toMin('10:00')),P.dhuhr+110,P.maghrib+25].forEach(mm=>add(free(Math.round(mm/5)*5),'dhikr','dhikr'));
 /* haven't opened the app for a long time (the app syncs its last visit) */
 if(c.lastOpen){[toMin('13:30'),toMin('20:15')].forEach(mm=>{const at=localToMs(y,m,d,mm,c.tz);if(at-c.lastOpen>20*3600e3)add(free(mm),'away','away');});}
 L.sort((a,b)=>a.min-b.min);
 L.forEach(e=>{if(off[e.cat])e.notify=false;});
 return L;}

/* every notification due in [fromMs, toMs) with its exact epoch time */
function events(fromMs,toMs,cfg){const c=Object.assign({},DEF,cfg||{});const out=[];
 const p0=partsIn(fromMs-864e5,c.tz);let y=p0.year,m=p0.month,d=p0.day;
 for(let i=0;i<5;i++){const dt=new Date(Date.UTC(y,m-1,d+i));const Y=dt.getUTCFullYear(),Mo=dt.getUTCMonth()+1,D=dt.getUTCDate();
   day(Y,Mo,D,c).forEach(e=>{if(!e.notify)return;const at=localToMs(Y,Mo,D,e.min,c.tz);if(at>=fromMs&&at<toMs)out.push(Object.assign({at,date:Y+'-'+Mo+'-'+D},e));});}
 return out.sort((a,b)=>a.at-b.at);}

const api={DEF,CATS,day,events,prayers,fmt,toMin,partsIn,localToMs,offsetMin,pkey};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MOSPlan=api;
})(typeof self!=='undefined'?self:this);
