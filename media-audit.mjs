import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const plan=JSON.parse(await readFile('plan.json','utf8'));
async function gql(query,variables={}){
 const r=await fetch('https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+process.env.BUFFER_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
 const d=await r.json();if(!r.ok||d.errors?.length)throw Error(JSON.stringify(d.errors??r.status));return d.data;
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const account=(await gql('query{account{email}}')).account;
if(hash(account.email)!==plan.accountEmailHash)throw Error('Unexpected account.');
const row=plan.posts.find(p=>p.key==='month01-tiktok-16');
const post=(await gql('query($input:PostInput!){post(input:$input){id channelId status dueAt text assets{source}}}',{input:{id:row.postId}})).post;
console.log(JSON.stringify({identity:post.id,channel:post.channelId,status:post.status,dueAt:post.dueAt,captionMatches:post.text===row.caption,slides:post.assets.length}));
for(const [i,a] of post.assets.entries()){
 const expected=row.expectedSources[i];
 if(expected===a.source){console.log(JSON.stringify({slide:i+1,unchanged:true}));continue;}
 const response=await fetch(a.source,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Image HTTP '+response.status);
 const actual=hash(Buffer.from(await response.arrayBuffer()));
 const approved=hash(await readFile('media/hook-refresh-2026-11-25/month-01-v3-16-tiktok.jpg'));
 console.log(JSON.stringify({slide:i+1,expectedSource:expected,actualSource:a.source,actualSha256:actual,approvedSha256:approved,exact:actual===approved}));
}
