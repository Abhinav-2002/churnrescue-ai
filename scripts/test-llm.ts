import 'dotenv/config';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { z } from 'zod';

/**
 * Usage:
 *   npx tsx scripts/test-llm.ts                         -> uses LLM_MODEL + GOOGLE_CLOUD_LOCATION from env
 *   npx tsx scripts/test-llm.ts <model> <location>      -> single test with explicit model/location
 *   npx tsx scripts/test-llm.ts --matrix m1,m2 loc1,loc2 -> test every model x location, print a table
 *
 * No hardcoded fallback model or location: they come from args or env only.
 * Docs: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
 */

const schema = z.object({
  action: z.enum(['retry', 'partial_credit', 'downgrade', 'pause', 'escalate']).describe('The recommended action'),
  discount_percent: z.number().describe('The discount percentage if applicable, otherwise 0'),
});

interface Result {
  model: string;
  location: string;
  basic: boolean;
  structured: boolean;
  error: string;
}

function requireProject(): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    console.error('Missing GOOGLE_CLOUD_PROJECT in env');
    process.exit(1);
  }
  return project;
}

function shortError(e: any): string {
  // Only the message; never headers/config (they could carry auth data).
  return String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 160);
}

async function runOne(modelId: string, location: string, verbose: boolean): Promise<Result> {
  const result: Result = { model: modelId, location, basic: false, structured: false, error: '' };
  const model = new ChatVertexAI({
    model: modelId,
    location,
    project: requireProject(),
    // The "global" location uses the host without a region prefix.
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 0,
  } as any);

  try {
    const response = await model.invoke('Reply with exactly: ok');
    const text = String(response.content).trim().toLowerCase();
    if (verbose) {
      console.log('Reply:', response.content);
      console.log('Token Usage:', response.usage_metadata ?? 'Not provided');
    }
    result.basic = text.includes('ok');
    if (!result.basic) result.error = `unexpected reply: ${text.slice(0, 60)}`;
  } catch (e) {
    result.error = 'basic: ' + shortError(e);
    return result;
  }

  try {
    const structuredModel = model.withStructuredOutput(schema, { name: 'churn_action' });
    const out = await structuredModel.invoke('The customer is at 10% usage and is upset. We should offer a 25% discount.');
    const parsed = schema.parse(out);
    if (verbose) console.log('Structured Reply:', JSON.stringify(parsed, null, 2));
    result.structured = true;
  } catch (e) {
    result.error = 'structured: ' + shortError(e);
  }
  return result;
}

/** Runs only the structured-output call N times; reports valid parses, latency, tokens. */
async function runRepeat(modelId: string, location: string, n: number) {
  const model = new ChatVertexAI({
    model: modelId,
    location,
    project: requireProject(),
    ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
    maxRetries: 0,
  } as any);
  const structured = model.withStructuredOutput(schema, { name: 'churn_action', includeRaw: true });
  let valid = 0;
  let totalMs = 0;
  let inTok = 0;
  let outTok = 0;
  let errors = 0;
  for (let i = 1; i <= n; i++) {
    const start = Date.now();
    try {
      const res: any = await structured.invoke(
        'The customer is at 10% usage and is upset. We should offer a 25% discount.',
      );
      const ms = Date.now() - start;
      totalMs += ms;
      const u = res.raw?.usage_metadata;
      inTok += u?.input_tokens ?? 0;
      outTok += u?.output_tokens ?? 0;
      const ok = schema.safeParse(res.parsed).success;
      if (ok) valid++;
      console.log(
        `run ${i}: ${ok ? 'valid' : 'INVALID'} ${ms}ms in=${u?.input_tokens ?? '?'} out=${u?.output_tokens ?? '?'} ${ok ? JSON.stringify(res.parsed) : ''}`,
      );
    } catch (e) {
      totalMs += Date.now() - start;
      errors++;
      console.log(`run ${i}: ERROR ${shortError(e)}`);
    }
  }
  console.log(`\n${modelId} @ ${location}`);
  console.log(`valid parses: ${valid}/${n}`);
  console.log(`avg latency: ${Math.round(totalMs / n)} ms`);
  console.log(`tokens total: input=${inTok} output=${outTok} (avg in=${Math.round(inTok / n)} out=${Math.round(outTok / n)})`);
  if (errors) console.log(`errors: ${errors}`);
}

async function main() {
  const args = process.argv.slice(2);

  // --repeat N [model] [location]  (model/location default to env, no hardcoded fallback)
  if (args[0] === '--repeat') {
    const n = Number(args[1]);
    const modelId = args[2] ?? process.env.LLM_MODEL;
    const location = args[3] ?? process.env.GOOGLE_CLOUD_LOCATION;
    if (!Number.isInteger(n) || n < 1 || !modelId || !location) {
      console.error('Usage: --repeat N [model] [location]');
      process.exit(1);
    }
    await runRepeat(modelId, location, n);
    return;
  }

  if (args[0] === '--matrix') {
    const models = (args[1] ?? '').split(',').filter(Boolean);
    const locations = (args[2] ?? '').split(',').filter(Boolean);
    if (!models.length || !locations.length) {
      console.error('Usage: --matrix model1,model2 location1,location2');
      process.exit(1);
    }
    const rows: Result[] = [];
    for (const m of models) {
      for (const l of locations) {
        console.error(`testing ${m} @ ${l} ...`);
        rows.push(await runOne(m, l, false));
      }
    }
    console.table(
      rows.map((r) => ({
        model: r.model,
        location: r.location,
        'basic ok': r.basic ? 'yes' : 'NO',
        'structured ok': r.structured ? 'yes' : 'NO',
        error: r.error,
      })),
    );
    return;
  }

  const modelId = args[0] ?? process.env.LLM_MODEL;
  const location = args[1] ?? process.env.GOOGLE_CLOUD_LOCATION;
  if (!modelId || !location) {
    console.error('Provide <model> <location> args or set LLM_MODEL and GOOGLE_CLOUD_LOCATION in env');
    process.exit(1);
  }
  console.log(`--- LLM smoke test: ${modelId} @ ${location} ---`);
  const r = await runOne(modelId, location, true);
  console.log(r.basic && r.structured ? '\nSmoke test passed' : `\nSmoke test FAILED: ${r.error}`);
  process.exit(r.basic && r.structured ? 0 : 1);
}

main();
