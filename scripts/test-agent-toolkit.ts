import 'dotenv/config';
import { PayPalAgentToolkit, ALL_TOOLS_ENABLED } from '@paypal/agent-toolkit/langchain';

/**
 * Stage A: PayPal Agent Toolkit research script (sandbox only).
 *   npx tsx scripts/test-agent-toolkit.ts list     -> list every tool + create_order schema
 *   npx tsx scripts/test-agent-toolkit.ts create   -> call create_order for $25.00 in the sandbox
 *
 * Package: https://www.npmjs.com/package/@paypal/agent-toolkit (README documents `context.sandbox`)
 * Repo:    https://github.com/paypal/AI-Toolkit (plugin + MCP server; the npm package is a separate TS toolkit)
 * Orders API v2: https://developer.paypal.com/docs/api/orders/v2/
 * Secrets are read from .env and never printed.
 */

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env');
  process.exit(1);
}

function redact(value: unknown): string {
  let s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  for (const secret of [clientId, clientSecret]) if (secret) s = s.split(secret).join('[REDACTED]');
  // Bearer / access tokens, if any ever appear in output.
  return s.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]').replace(/("access_token"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function makeToolkit(actions: Record<string, Record<string, boolean>>) {
  return new PayPalAgentToolkit({
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    configuration: {
      actions,
      // Sandbox switch per the package README/types: Context.sandbox
      context: { sandbox: true },
    },
  });
}

async function main() {
  const mode = process.argv[2] ?? 'list';

  if (mode === 'list') {
    const toolkit = makeToolkit(ALL_TOOLS_ENABLED);
    const tools = toolkit.getTools();
    console.log(`Total tools exposed with ALL_TOOLS_ENABLED: ${tools.length}`);
    for (const t of tools) console.log(`- ${t.name}`);
    const co = tools.find((t) => t.name === 'create_order');
    if (!co) {
      console.log('\nNO create_order tool found');
      return;
    }
    console.log('\ncreate_order description:\n' + co.description);
    console.log('\ncreate_order input schema (zod shape):');
    console.log(redact(describeShape(co.schema)));
    return;
  }

  if (mode === 'create') {
    const toolkit = makeToolkit({ orders: { create: true, get: true } });
    const tools = toolkit.getTools();
    console.log('Tools enabled for this run:', tools.map((t) => t.name).join(', '));
    const createOrder = tools.find((t) => t.name === 'create_order');
    if (!createOrder) {
      console.error('create_order tool not found');
      process.exit(1);
    }
    // Fixed $25.00 test payload. Shape = toolkit's createOrderParameters:
    // { currencyCode: 'USD', items: [{ name, quantity, itemCost, itemTotal }] }
    const input = {
      currencyCode: 'USD',
      items: [{ name: 'ChurnRescue test renewal', quantity: 1, itemCost: 25, itemTotal: 25 }],
    };
    console.log('Input:', JSON.stringify(input));
    const result = await createOrder.invoke(input);
    console.log('Raw result:');
    console.log(redact(result));
    return;
  }

  if (mode === 'graph') {
    // Proves (or disproves) that the toolkit's LangChain tool works inside LangGraph.js with Gemini tool calling.
    // Docs: https://docs.langchain.com/oss/javascript/langgraph/overview
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    const { StateGraph, MessagesAnnotation, START, END } = await import('@langchain/langgraph');
    const { ToolNode } = await import('@langchain/langgraph/prebuilt');

    const modelId = process.env.LLM_MODEL;
    const location = process.env.GOOGLE_CLOUD_LOCATION;
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!modelId || !location || !project) {
      console.error('Need LLM_MODEL, GOOGLE_CLOUD_LOCATION, GOOGLE_CLOUD_PROJECT in .env');
      process.exit(1);
    }

    const toolkit = makeToolkit({ orders: { create: true } });
    const tools = toolkit.getTools();
    console.log('Tools bound:', tools.map((t) => t.name).join(', '));

    const llm = new ChatVertexAI({
      model: modelId,
      location,
      project,
      ...(location === 'global' ? { endpoint: 'aiplatform.googleapis.com' } : {}),
      maxRetries: 0,
    } as any);
    const llmWithTools = (llm as any).bindTools(tools);

    const callModel = async (state: typeof MessagesAnnotation.State) => ({
      messages: [await llmWithTools.invoke(state.messages)],
    });
    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const last: any = state.messages[state.messages.length - 1];
      return last.tool_calls?.length ? 'tools' : END;
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', new ToolNode(tools as any))
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', shouldContinue, ['tools', END])
      .addEdge('tools', 'agent')
      .compile();

    const out = await graph.invoke({
      messages: [
        {
          role: 'user',
          content:
            'Create a PayPal order in USD for exactly one item named "Starter renewal" costing 25.00 (quantity 1, itemTotal 25.00). Use the tool, then tell me the order id.',
        },
      ],
    });

    for (const m of out.messages as any[]) {
      const kind = m._getType?.() ?? m.type;
      if (kind === 'ai' && m.tool_calls?.length) {
        console.log(`[ai] tool_calls: ${redact(m.tool_calls.map((c: any) => ({ name: c.name, args: c.args })))}`);
      } else if (kind === 'tool') {
        console.log(`[tool:${m.name}] ${redact(String(m.content)).slice(0, 700)}`);
      } else {
        console.log(`[${kind}] ${redact(String(m.content)).slice(0, 400)}`);
      }
    }
    return;
  }
}

// Minimal zod-shape printer (works for zod v3 objects used by the toolkit).
function describeShape(schema: any, depth = 0): unknown {
  const def = schema?._def;
  if (!def) return String(schema);
  const t = def.typeName as string;
  const desc = schema.description ? ` // ${schema.description}` : '';
  if (t === 'ZodObject') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.shape)) out[k] = describeShape(v, depth + 1);
    return out;
  }
  if (t === 'ZodArray') return [describeShape(def.type, depth + 1)];
  if (t === 'ZodOptional') return `optional ${describeShape(def.innerType, depth + 1)}`;
  if (t === 'ZodNullable') return `nullable ${describeShape(def.innerType, depth + 1)}`;
  if (t === 'ZodDefault') return `default ${describeShape(def.innerType, depth + 1)}`;
  if (t === 'ZodEnum') return `enum(${def.values.join('|')})${desc}`;
  return `${t.replace('Zod', '').toLowerCase()}${desc}`;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', redact(e?.message ?? e));
    process.exit(1);
  });
