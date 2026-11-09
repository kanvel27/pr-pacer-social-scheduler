import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalize } from './refill.mjs';

const plan = JSON.parse(await readFile(new URL('./plan.json', import.meta.url), 'utf8'));
const changes = JSON.parse(await readFile(new URL('./photo-refresh.json', import.meta.url), 'utf8'));
const token = process.env.BUFFER_API_KEY;
if (!token) throw Error('Missing Buffer credential.');

async function gql(query, variables = {}) {
  const response = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Buffer HTTP ' + response.status);
  const result = await response.json();
  if (result.errors?.length) throw Error('Buffer GraphQL rejected request.');
  return result.data;
}

const fields = 'id channelId channelService text status dueAt schedulingType assets { source } metadata { ... on TiktokPostMetadata { title isAiGenerated } ... on InstagramPostMetadata { type isAiGenerated } }';
async function read(id) {
  return (await gql('query($input:PostInput!){post(input:$input){' + fields + '}}', { input: { id } })).post;
}
const sources = post => post.assets.map(asset => asset.source);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { account } = await gql('query { account { email } }');
if (createHash('sha256').update(account.email).digest('hex') !== plan.accountEmailHash) {
  throw Error('Wrong Buffer account.');
}

const jobs = [];
for (const change of changes) {
  const row = plan.posts.find(post => post.key === change.key);
  if (!row || !row.postId || !row.expectedSources || !change.cover.startsWith('https://buffer-media-uploads.s3.amazonaws.com/')) {
    throw Error(change.key + ': missing approved identity or media.');
  }
  const before = await read(row.postId);
  const original = row.expectedSources;
  const updated = [change.cover, ...original.slice(1)];
  const validState = ['draft', 'scheduled'].includes(before?.status) && before.schedulingType === 'automatic';
  if (!validState || before.channelId !== row.channelId ||
      (before.dueAt && Date.parse(before.dueAt) !== Date.parse(row.dueAt)) ||
      Date.parse(row.dueAt) < Date.now() + 24 * 3600000) {
    throw Error(change.key + ': channel, state or date changed.');
  }
  const already = normalize(before.text) === normalize(change.caption) && equal(sources(before), updated);
  if (!already && (normalize(before.text) !== normalize(row.caption) || !equal(sources(before), original))) {
    throw Error(change.key + ': original caption or images changed.');
  }
  jobs.push({ change, row, before, updated, already });
}
console.log(JSON.stringify({ preflight: jobs.length }));
for (const { change, row, before, updated, already } of jobs) {
  if (!already) {
    const metadata = before.channelService === 'instagram'
      ? { instagram: { type: 'post', shouldShareToFeed: true, isAiGenerated: false } }
      : { tiktok: { title: before.metadata.title, isAiGenerated: false } };
    const input = {
      id: before.id,
      text: change.caption,
      assets: updated.map((url, i) => ({ image: { url, metadata: { altText: i === 0 ? change.alt : row.altText[i] } } })),
      metadata,
      mode: 'customScheduled',
      dueAt: row.dueAt,
      schedulingType: 'automatic',
      saveToDraft: before.status === 'draft',
    };
    const result = await gql('mutation($input:EditPostInput!){editPost(input:$input){... on PostActionSuccess{post{id}}... on MutationError{message}}}', { input });
    if (result.editPost.post?.id !== before.id) throw Error(change.key + ': Buffer rejected update.');
  }
  const after = await read(before.id);
  if (after.id !== before.id || after.channelId !== before.channelId || after.status !== before.status ||
      after.schedulingType !== 'automatic' || Date.parse(after.dueAt) !== Date.parse(row.dueAt) ||
      normalize(after.text) !== normalize(change.caption) || !equal(sources(after), updated) ||
      (before.channelService === 'tiktok' && after.metadata.title !== before.metadata.title) ||
      after.metadata.isAiGenerated === true) {
    throw Error(change.key + ': provider readback mismatch.');
  }
  console.log(JSON.stringify({ updated: change.key, id: after.id, status: after.status, dueAt: after.dueAt, slides: after.assets.length, cover: sources(after)[0] }));
}
