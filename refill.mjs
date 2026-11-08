/** Buffer Free refill: schedules existing approved drafts; never creates, deletes or retries a post. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const API='https://api.buffer.com';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
export const normalize=s=>s.replace(/[\uFEFF\u200B]/g,'').replace(/\s+/g,' ').trim();
const instant=s=>new Date(s).getTime();
const FIELDS='id channelId channelService text status dueAt schedulingType assets { id source } metadata { ... on TiktokPostMetadata { title isAiGenerated } ... on InstagramPostMetadata { type isAiGenerated } }';
export function decide(rows,posts,now=Date.now()) {
 const actions=[],errors=[];
 const occupied=new Map();
 for(const p of posts.filter(p=>['scheduled','sending','sent','error'].includes(p.status)&&p.dueAt)){
  const k=p.channelId+'|'+instant(p.dueAt);occupied.set(k,[...(occupied.get(k)||[]),p]);
 }
 const active=new Map();
 for(const p of posts.filter(p=>['scheduled','sending','error','needs_approval'].includes(p.status)))active.set(p.channelId,(active.get(p.channelId)||0)+1);
 for(const row of [...rows].sort((a,b)=>instant(a.dueAt)-instant(b.dueAt))){
  const match=posts.filter(p=>p.channelId===row.channelId&&normalize(p.text)===normalize(row.caption));
  const completed=match.filter(p=>['scheduled','sending','sent'].includes(p.status));
  if(completed.length){
   if(completed.length!==1||instant(completed[0].dueAt)!==instant(row.dueAt))errors.push(`${row.key}: duplicated or differently dated accepted post`);
   continue;
  }
  if(match.some(p=>p.status==='error')){errors.push(`${row.key}: provider failure; check native profile before retry`);continue;}
  if(instant(row.dueAt)<=now+30*60*1000){errors.push(`${row.key}: missed date; no automatic catch-up publication`);continue;}
  if((active.get(row.channelId)||0)>=10)continue;
  if(match.length!==1||match[0].status!=='draft'){errors.push(`${row.key}: expected exactly one matching existing draft`);continue;}
  const p=match[0];
  if((row.postId&&p.id!==row.postId)||(row.expectedSources&&JSON.stringify(p.assets.map(a=>a.source))!==JSON.stringify(row.expectedSources))||p.assets.length!==row.slideCount){errors.push(`${row.key}: wrong image count`);continue;}
  const sameTime=occupied.get(row.channelId+'|'+instant(row.dueAt))||[];
  if(sameTime.length){errors.push(`${row.key}: date already occupied by another post`);continue;}
  actions.push({row,post:p});active.set(row.channelId,(active.get(row.channelId)||0)+1);
 }
 return {actions,errors};
}
async function main(){
 const apply=process.argv.includes('--apply');
 const key=process.env.BUFFER_API_KEY;
 if(!key)throw Error('Missing BUFFER_API_KEY; no provider action attempted.');
 async function gql(query,variables={}){
  const response=await fetch(API,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Buffer HTTP ${response.status}; no blind retry.`);
  const value=await response.json();if(value.errors?.length)throw Error('Buffer GraphQL rejected request; inspect documented schema.');return value.data;
 }
 const plan=JSON.parse(await fs.readFile(ROOT+'plan.json','utf8'));
 if(Date.now()>instant(plan.stopAfter)){console.log('Campaign ended; no further actions.');return;}
 const account=(await gql('query { account { email organizations { id } } }')).account;
 if(createHash('sha256').update(account.email).digest('hex')!==plan.accountEmailHash)throw Error('Wrong Buffer account; stopped.');
 const organizations=account.organizations;
 const channelIds=[...new Set(plan.posts.map(p=>p.channelId))];
 let organization,channels;
 for(const org of organizations){const list=(await gql('query($input:ChannelsInput!){channels(input:$input){id name service isDisconnected isQueuePaused}}',{input:{organizationId:org.id}})).channels;if(channelIds.every(id=>list.some(c=>c.id===id))){organization=org;channels=list;break;}}
 if(!organization)throw Error('Dedicated PR Pacer channel pair not found.');
 const unavailable=[];for(const id of channelIds){const c=channels.find(c=>c.id===id);if(c.name!=='prpacer')throw Error('Unexpected channel identity; stopped.');if(c.isDisconnected||c.isQueuePaused)unavailable.push(id);}
 let all=[],after=null;
 for(let page=0;page<10;page++){
  const data=(await gql(`query($input:PostsInput!,$after:String){posts(input:$input,first:100,after:$after){edges{node{${FIELDS}}}pageInfo{hasNextPage endCursor}}}`,{input:{organizationId:organization.id,filter:{channelIds}},after})).posts;
  all.push(...data.edges.map(e=>e.node));if(!data.pageInfo.hasNextPage)break;after=data.pageInfo.endCursor;if(page===9)throw Error('Pagination incomplete; stopped.');
 }
 const {actions,errors}=decide(plan.posts.filter(p=>!unavailable.includes(p.channelId)),all);for(const id of unavailable)errors.push(`Channel ${id} is disconnected or paused; independent channel continues.`);
 const missingPreparation=plan.posts.filter(row=>!all.some(p=>p.channelId===row.channelId&&normalize(p.text)===normalize(row.caption))).map(r=>r.key);
 console.log(JSON.stringify({mode:apply?'apply':'read-only',existing:all.length,missingPreparation,availableActions:actions.map(a=>({key:a.row.key,dueAt:a.row.dueAt})),attention:errors},null,2));
 for(const {row,post} of actions){
  if(!apply)continue;
  const metadata=post.channelService==='instagram'?{instagram:{type:'post',shouldShareToFeed:true,isAiGenerated:post.metadata.isAiGenerated}}:{tiktok:{title:post.metadata.title,isAiGenerated:post.metadata.isAiGenerated}};
  const input={id:post.id,text:post.text,assets:post.assets.map((a,i)=>({image:{url:a.source,metadata:{altText:row.altText[i]}}})),metadata,mode:'customScheduled',dueAt:row.dueAt,schedulingType:'automatic',saveToDraft:false};
  const response=await gql(`mutation($input:EditPostInput!){editPost(input:$input){... on PostActionSuccess{post{${FIELDS}}}... on MutationError{message}}}`,{input});
  const accepted=response.editPost.post;
  if(!accepted)throw Error(`${row.key}: Buffer rejected scheduling; stopped without retry.`);
  const read=(await gql(`query($input:PostInput!){post(input:$input){${FIELDS}}}`,{input:{id:accepted.id}})).post;
  if(read.channelId!==row.channelId||normalize(read.text)!==normalize(row.caption)||read.status!=='scheduled'||read.schedulingType!=='automatic'||instant(read.dueAt)!==instant(row.dueAt)||JSON.stringify(read.assets.map(a=>a.source))!==JSON.stringify(post.assets.map(a=>a.source)))throw Error(`${row.key}: readback mismatch; inspect before any retry.`);
  console.log(JSON.stringify({scheduled:row.key,postId:read.id,dueAt:read.dueAt,slides:read.assets.length}));
 }
 if(errors.length)process.exitCode=1;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
