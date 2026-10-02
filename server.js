import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';

const app=express(), PORT=process.env.PORT||3000, SECRET=process.env.JWT_SECRET||'CHANGE_ME', MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest';
const FREE=Number(process.env.FREE_PAGES_PER_DAY||3), MAXP=Number(process.env.MAX_PAGES_PER_JOB||30), MAXB=Number(process.env.MAX_FILE_MB||4)*1024*1024;
app.use(express.json({limit:'2mb'})); app.use(cookieParser()); app.use(express.static('public'));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAXB,files:31}});
let db={users:[],pages:[],folders:[],referrals:[]};
const limiter=new Map();
const redis=(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN)?Redis.fromEnv():null;
const DB_KEY='medtranslate:db:v2';
async function loadDB(){
  if(!redis) return db;
  const saved=await redis.get(DB_KEY);
  if(saved) db=saved;
  return db;
}
async function save(){
  if(redis) await redis.set(DB_KEY,db);
}
await loadDB();
const uid=()=>crypto.randomUUID(), day=()=>new Date().toISOString().slice(0,10), sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function auth(req,res,next){try{await loadDB();const p=jwt.verify(req.cookies.mt_session,SECRET),u=db.users.find(x=>x.id===p.sub);if(!u)throw 0;req.user=u;next()}catch{res.status(401).json({error:'يجب تسجيل الدخول أولاً.'})}}
function rate(req,res,next){const k=req.user?.id||req.ip,t=Date.now(),a=(limiter.get(k)||[]).filter(x=>t-x<60000);if(a.length>=12)return res.status(429).json({error:'طلبات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.'});a.push(t);limiter.set(k,a);next()}
const used=u=>db.pages.filter(p=>p.userId===u.id&&p.day===day()).reduce((n,p)=>n+(p.units||1),0);
function quota(u,n){if(u.plan!=='paid'&&used(u)+n>FREE)throw Object.assign(new Error(`الخطة المجانية تسمح بـ ${FREE} صفحات يوميًا.`),{status:402})}
const SYSTEM='أنت مترجم ومدرس كتب طبية محترف. ترجم الإنجليزية الطبية إلى عربية فصحى علمية طبيعية ومفهومة وليست حرفية. لا تحذف أو تضف معلومة. حافظ على الأرقام والوحدات والأدوية والأسماء التشريحية والاختصارات. استخدم نفس المصطلح العربي كلما تكرر المصطلح الإنجليزي. المحتوى تعليمي وليس تشخيصًا أو علاجًا.';
async function gemini(parts,{json=true,system=SYSTEM}={}){const key=process.env.GEMINI_API_KEY;if(!key)throw Object.assign(new Error('GEMINI_API_KEY غير مضبوط على السيرفر.'),{status:500});const body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts}],generationConfig:{temperature:.15,maxOutputTokens:24000,...(json?{responseMimeType:'application/json'}:{})}};let last='';for(let i=0;i<3;i++){const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(r.ok){const t=d?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';if(!t)throw Object.assign(new Error('Gemini أعاد استجابة فارغة.'),{status:502});return t}last=d?.error?.message||`HTTP ${r.status}`;if(![408,429,500,502,503,504].includes(r.status))break;await new Promise(x=>setTimeout(x,700*(i+1)))}throw Object.assign(new Error('تعذر الاتصال بـ Gemini: '+last),{status:502})}
const parse=s=>{try{return JSON.parse(s)}catch{throw Object.assign(new Error('الاستجابة غير مكتملة. أعد المحاولة أو قسّم الملف إلى صفحات أقل.'),{status:502})}};

app.post('/api/auth/register',async(req,res)=>{await loadDB();const {email,password,name}=req.body||{},e=String(email||'').trim().toLowerCase();if(!e||!password||password.length<8)return res.status(400).json({error:'أدخل بريدًا صحيحًا وكلمة مرور 8 أحرف على الأقل.'});if(db.users.some(u=>u.email===e))return res.status(409).json({error:'الحساب موجود بالفعل.'});const u={id:uid(),email:e,name:String(name||'طالب').slice(0,80),password:await bcrypt.hash(password,12),plan:'free',createdAt:Date.now()};db.users.push(u);await save();res.cookie('mt_session',jwt.sign({sub:u.id},SECRET,{expiresIn:'30d'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:30*864e5});res.json({user:{id:u.id,name:u.name,email:u.email,plan:u.plan},usage:0,limit:FREE})});
app.post('/api/auth/login',async(req,res)=>{await loadDB();const e=String(req.body?.email||'').trim().toLowerCase(),u=db.users.find(x=>x.email===e);if(!u||!(await bcrypt.compare(String(req.body?.password||''),u.password)))return res.status(401).json({error:'البريد أو كلمة المرور غير صحيحة.'});res.cookie('mt_session',jwt.sign({sub:u.id},SECRET,{expiresIn:'30d'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:30*864e5});res.json({user:{id:u.id,name:u.name,email:u.email,plan:u.plan},usage:used(u),limit:FREE})});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('mt_session');res.json({ok:true})});app.get('/api/me',auth,async(req,res)=>res.json({user:{id:req.user.id,name:req.user.name,email:req.user.email,plan:req.user.plan},usage:used(req.user),limit:FREE}));

app.post('/api/translate',auth,rate,upload.array('files',31),async(req,res)=>{await loadDB();const files=req.files||[];if(!files.length)return res.status(400).json({error:'ارفع PDF أو صورة واحدة على الأقل.'});if(files.length>MAXP)return res.status(400).json({error:`الحد الأقصى ${MAXP} ملفًا في العملية.`});try{quota(req.user,files.length);const out=[];for(let i=0;i<files.length;i++){const f=files[i],h=sha(f.buffer),cached=db.pages.find(p=>p.userId===req.user.id&&p.hash===h);if(cached){out.push({...cached.result,pageIndex:i+1,id:cached.id,cached:true});continue}const prompt=`اقرأ هذه الصفحة الطبية واستخرجها قسمًا قسمًا ثم ترجمها. أعد JSON بالشكل: {"title":"","sections":[{"type":"heading|paragraph|bullet|table|caption","english":"","arabic":"","terms":[{"en":"","ar":""}]}],"keyPoints":[""],"comparison":[{"aspect":"","left":"","right":""}]}. حافظ على ترتيب الصفحة. لا تضف معلومة. إذا لا توجد مقارنة اجعلها [].`;const r=parse(await gemini([{text:prompt},{inlineData:{mimeType:f.mimetype,data:f.buffer.toString('base64')}}]));const page={id:uid(),userId:req.user.id,hash:h,day:day(),units:1,result:r,createdAt:Date.now()};db.pages.push(page);await save();out.push({...r,pageIndex:i+1,id:page.id,cached:false})}res.json({pages:out,usage:used(req.user),limit:FREE})}catch(e){res.status(e.status||500).json({error:e.message})}});

app.post('/api/explain',auth,rate,async(req,res)=>{try{res.json(parse(await gemini([{text:`اشرح للطالب بالمصري البسيط المقطع التالي، ثم أعط مثالًا إكلينيكيًا واضحًا. أعد JSON: {"explanation":"","clinicalExample":"","importantTerm":""}\nEnglish:${req.body.english}\nArabic:${req.body.arabic}`}]))) }catch(e){res.status(e.status||500).json({error:e.message})}});
app.post('/api/mcqs',auth,rate,async(req,res)=>{try{res.json(parse(await gemini([{text:`أنشئ 5 MCQs من المحتوى فقط، كل سؤال 4 اختيارات وإجابة صحيحة وشرح قصير. JSON: {"questions":[{"question":"","options":["","","",""],"answer":0,"explanation":""}]}\n${req.body.content}`}]))) }catch(e){res.status(e.status||500).json({error:e.message})}});
app.post('/api/flashcards',auth,rate,async(req,res)=>{try{res.json(parse(await gemini([{text:`حوّل المحتوى إلى 10 Flashcards للمراجعة. JSON: {"cards":[{"front":"","back":""}]}\n${req.body.content}`}]))) }catch(e){res.status(e.status||500).json({error:e.message})}});
app.post('/api/chat',auth,rate,async(req,res)=>{try{res.json({answer:await gemini([{text:`أجب اعتمادًا على محتوى الصفحة فقط. إذا لم توجد الإجابة قل ذلك. السؤال: ${req.body.question}\nالمحتوى:\n${req.body.content}`}],{json:false})})}catch(e){res.status(e.status||500).json({error:e.message})}});
app.get('/api/history',auth,async(req,res)=>res.json({pages:db.pages.filter(p=>p.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt).map(p=>({id:p.id,title:p.result.title||'صفحة طبية',createdAt:p.createdAt}))}));
app.post('/api/favorites/:id',auth,async(req,res)=>{await loadDB();const p=db.pages.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.status(404).json({error:'الصفحة غير موجودة.'});p.favorite=!p.favorite;await save();res.json({favorite:p.favorite})});
app.post('/api/notes/:id',auth,async(req,res)=>{await loadDB();const p=db.pages.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!p)return res.status(404).json({error:'الصفحة غير موجودة.'});p.note=String(req.body?.note||'').slice(0,5000);await save();res.json({ok:true})});
app.get('/api/folders',auth,async(req,res)=>res.json(db.folders.filter(x=>x.userId===req.user.id)));app.post('/api/folders',auth,async(req,res)=>{await loadDB();const f={id:uid(),userId:req.user.id,name:String(req.body?.name||'مجلد').slice(0,80),createdAt:Date.now()};db.folders.push(f);await save();res.json(f)});
app.get('/api/referral',auth,async(req,res)=>res.json({code:Buffer.from(req.user.id).toString('base64url').slice(0,10)}));
app.post('/api/payment/create',auth,(req,res)=>res.status(501).json({error:'الدفع الحقيقي يحتاج بيانات تاجر Fawry/Vodafone Cash وربط API الرسمي. الكود لا يضع أسرار الدفع في الواجهة.'}));
app.get('/api/health',async(req,res)=>{res.json({ok:true,redis:!!redis,node:process.version,model:MODEL})});
app.listen(PORT,()=>console.log(`MedTranslate V2 http://localhost:${PORT}`));
