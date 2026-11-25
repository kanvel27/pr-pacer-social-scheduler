import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalize} from './refill.mjs';

const plan=JSON.parse(await readFile(new URL('./plan.json',import.meta.url),'utf8'));
const changes=JSON.parse(await readFile(new URL('./hook-refresh.json',import.meta.url),'utf8'));
async function gql(query,variables={}){
  const response=await fetch('https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+process.env.BUFFER_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok||result.errors?.length)throw Error('Buffer rejected request: '+JSON.stringify(result.errors??response.status));
  return result.data;
}
const fields='id channelId channelService text status dueAt schedulingType assets { source } metadata { ... on TiktokPostMetadata { title isAiGenerated } ... on InstagramPostMetadata { type isAiGenerated } }';
const account=(await gql('query{account{email organizations{id}}}')).account;
if(createHash('sha256').update(account.email).digest('hex')!==plan.accountEmailHash)throw Error('Unexpected account.');
const post=async id=>(await gql('query($input:PostInput!){post(input:$input){'+fields+'}}',{input:{id}})).post;
const sources=p=>p.assets.map(a=>a.source);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

let org,channels;
for(const o of account.organizations){
  const cs=(await gql('query($input:ChannelsInput!){channels(input:$input){id name service isDisconnected isQueuePaused}}',{input:{organizationId:o.id}})).channels;
  if(plan.posts.every(p=>cs.some(c=>c.id===p.channelId))){org=o;channels=cs;break;}
}
if(!org||channels.some(c=>c.name!=='prpacer'||c.isDisconnected||c.isQueuePaused))throw Error('Dedicated channels unavailable.');
let all=[],after=null;
for(let page=0;page<10;page++){
  const ps=(await gql('query($input:PostsInput!,$after:String){posts(input:$input,first:100,after:$after){edges{node{'+fields+'}}pageInfo{hasNextPage endCursor}}}',{input:{organizationId:org.id,filter:{channelIds:[...new Set(plan.posts.map(p=>p.channelId))]}},after})).posts;
  all.push(...ps.edges.map(e=>e.node));
  if(!ps.pageInfo.hasNextPage)break;
  after=ps.pageInfo.endCursor;
  if(page===9)throw Error('Incomplete read.');
}
console.log(JSON.stringify({channels,states:channels.map(c=>({channelId:c.id,service:c.service,counts:all.filter(p=>p.channelId===c.id).reduce((m,p)=>(m[p.status]=(m[p.status]??0)+1,m),{})})),errors:all.filter(p=>p.status==='error').map(p=>({id:p.id,channelId:p.channelId,dueAt:p.dueAt,title:p.text.split('\n')[0]}))}));
const jobs=[];
for(const change of changes){
  const row=plan.posts.find(p=>p.key===change.planKey);
  const before=all.find(p=>p.id===row.postId);
  const updated=[change.cover,...row.expectedSources.slice(1)];
  if(!before||!['draft','scheduled'].includes(before.status)||before.channelId!==row.channelId||before.schedulingType!=='automatic'||Date.parse(row.dueAt)<Date.now()+1800000||(before.dueAt&&Date.parse(before.dueAt)!==Date.parse(row.dueAt)))throw Error(change.planKey+': state changed.');
  const already=normalize(before.text)===normalize(change.captionAfter)&&equal(sources(before),updated);
  if(!already&&(normalize(before.text)!==normalize(row.caption)||!equal(sources(before),row.expectedSources)))throw Error(change.planKey+': original content changed.');
  jobs.push({change,row,before,updated,already});
}
console.log(JSON.stringify({preflight:jobs.length}));
for(const {change,row,before,updated,already} of jobs){
  const title=before.channelService==='tiktok'?change.title:null;
  if(!already){
    const metadata=before.channelService==='instagram'?{instagram:{type:'post',shouldShareToFeed:true,isAiGenerated:before.metadata.isAiGenerated}}:{tiktok:{title,isAiGenerated:before.metadata.isAiGenerated}};
    const input={id:before.id,text:change.captionAfter,assets:updated.map((url,i)=>({image:{url,metadata:{altText:i===0?change.alt:row.altText[i]}}})),metadata,mode:'customScheduled',dueAt:row.dueAt,schedulingType:'automatic',saveToDraft:before.status==='draft'};
    const r=await gql('mutation($input:EditPostInput!){editPost(input:$input){... on PostActionSuccess{post{id}}... on MutationError{message}}}',{input});
    if(r.editPost.post?.id!==before.id)throw Error(change.planKey+': edit rejected: '+JSON.stringify(r.editPost));
  }
  const live=await post(before.id);
  if(live.status!==before.status||live.channelId!==before.channelId||live.schedulingType!=='automatic'||Date.parse(live.dueAt)!==Date.parse(row.dueAt)||normalize(live.text)!==normalize(change.captionAfter)||!equal(sources(live),updated)||(title&&live.metadata.title!==title))throw Error(change.planKey+': readback mismatch.');
  console.log(JSON.stringify({updated:row.key,id:live.id,status:live.status,dueAt:live.dueAt,sources:sources(live),caption:live.text,title:live.metadata?.title,alt:change.alt}));
}
const schema=await gql('query{__schema{mutationType{fields{name args{name type{kind name ofType{kind name}}}}}}}');
console.log(JSON.stringify({retrySchema:schema.__schema.mutationType.fields.filter(f=>/retry|publish/i.test(f.name))}));
