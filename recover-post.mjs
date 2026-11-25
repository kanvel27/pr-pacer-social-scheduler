import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalize} from './refill.mjs';
const plan=JSON.parse(await readFile('plan.json','utf8'));
async function gql(query,variables={}){
 const r=await fetch('https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+process.env.BUFFER_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
 const d=await r.json();if(!r.ok||d.errors?.length)throw Error(JSON.stringify(d.errors??r.status));return d.data;
}
const a=(await gql('query{account{email}}')).account;
if(createHash('sha256').update(a.email).digest('hex')!==plan.accountEmailHash)throw Error('Wrong account.');
const row=plan.posts.find(p=>p.key==='month01-tiktok-15');
if(row.postId!=='6aef85a3d11ac2aad42aa557')throw Error('Unexpected identity.');
const fields='id channelId text status dueAt schedulingType assets {source}';
const read=async()=> (await gql('query($input:PostInput!){post(input:$input){'+fields+'}}',{input:{id:row.postId}})).post;
const before=await read();
if(before.channelId!==row.channelId||normalize(before.text)!==normalize(row.caption)||JSON.stringify(before.assets.map(a=>a.source))!==JSON.stringify(row.expectedSources))throw Error('Original failed post changed.');
console.log(JSON.stringify({before}));
const type=await gql('query{__type(name:"PublishPostNowInput"){inputFields{name type{kind name ofType{kind name}}}}}');
console.log(JSON.stringify({inputSchema:type.__type}));
if(before.status!=='error')throw Error('Publication state changed. Reconcile the public profile.');
if(type.__type.inputFields.some(f=>f.type.kind==='NON_NULL'&&f.name!=='id'))throw Error('Unexpected publish input.');
const result=await gql('mutation($input:PublishPostNowInput!){publishPostNow(input:$input){__typename ... on PostActionSuccess{post{id status dueAt}} ... on MutationError{message}}}',{input:{id:row.postId}});
console.log(JSON.stringify({publishResult:result}));
console.log(JSON.stringify({after:await read()}));
