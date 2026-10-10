import { z } from 'zod';
import { findPlan, nextLowerPlan } from '../plans';
import { extractDollarAmounts, formatDollars } from '../money';

export const ACTIONS = ['retry', 'partial_credit', 'downgrade', 'pause', 'escalate'] as const;
export type AgentAction = (typeof ACTIONS)[number];

export const PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE = 60;
export const MAX_DISCOUNT_PERCENT = 50;
export const MIN_CHARGE_CENTS = 100;
export const OFFER_TTL_MS = 30 * 60 * 1000;

export const proposalSchema = z.object({
  message_tone_notes: z.string().optional().describe('Short notes on tone for the customer message'),
  reasoning: z.string().describe('One or two sentences explaining the choice'),
});
export type Proposal = z.infer<typeof proposalSchema>;

export interface CustomerContext {
  plan_name: string;
  plan_price_cents: number;
  usage_percent: number;
}

export interface ValidatedDecision {
  action: AgentAction;
  final_amount_cents: number | null;
  discount_percent: number | null;
  target_plan: string | null;
  creates_offer: boolean;
  clamps: string[];
}

const ESCALATION_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'dispute', re: /\bdisput(e|es|ed|ing)\b/i },
  { label: 'chargeback', re: /\bcharge[\s-]?backs?\b/i },
  { label: 'legal', re: /\b(lawyers?|attorneys?|legal|lawsuits?|sue|suing|court|small claims)\b/i },
  { label: 'fraud', re: /\b(fraud|scam|scammed|stealing|theft)\b/i },
  { label: 'human', re: /\b(human|real person|live person|representative|supervisor|manager|speak to (someone|somebody|a person)|talk to (someone|somebody|a person))\b/i },
  { label: 'anger', re: /\b(furious|angry|outraged|livid|pissed|disgusted|unacceptable)\b/i },
];

export function detectEscalation(texts: string | string[]): string[] {
  const all = (Array.isArray(texts) ? texts : [texts]).join('\n');
  return ESCALATION_PATTERNS.filter((p) => p.re.test(all)).map((p) => p.label);
}

export function validateProposal(
  proposal: Partial<Proposal> | null | undefined,
  ctx: CustomerContext,
  opts: { escalationKeywords?: string[], intent?: string, pushbacks?: number, cancelCount?: number, previousAmountCents?: number } = {},
): ValidatedDecision {
  const clamps: string[] = [];
  const keywords = opts.escalationKeywords ?? [];

  if (keywords.length) {
    if (proposal?.action !== 'escalate') clamps.push(`forced escalate by keyword rule: ${keywords.join(',')}`);
    return { action: 'escalate', final_amount_cents: null, discount_percent: null, target_plan: null, creates_offer: false, clamps };
  }

  let action: AgentAction | undefined;
  
  if (opts.intent === 'cancel') {
    if (ctx.usage_percent < 60) {
      action = 'pause';
      clamps.push('cancel intent < 60 usage -> pause');
    } else {
      if ((opts.cancelCount || 0) > 1) {
        return { action: 'escalate', final_amount_cents: null, discount_percent: null, target_plan: null, creates_offer: false, clamps: ['cancel intent >= 60 usage twice -> escalate'] };
      } else {
        action = 'retry';
        clamps.push('cancel intent >= 60 usage -> retry with pause option');
      }
    }
  } else if (opts.intent === 'decline' || opts.intent === 'negotiate' || opts.intent === 'neutral' || opts.intent === 'propose') {
    if (ctx.usage_percent < 60) {
      action = 'partial_credit';
      clamps.push(`${opts.intent} intent < 60 usage -> partial_credit`);
    } else {
      action = 'retry';
      clamps.push(`${opts.intent} intent >= 60 usage -> retry`);
    }
  } else if (opts.intent === 'escalate') {
    action = 'escalate';
  } else if (opts.intent === 'downgrade') {
    action = 'downgrade';
  } else {
    action = 'retry';
  }

  if (!action || !ACTIONS.includes(action as AgentAction)) {
    clamps.push(`invalid action -> retry`);
    return retry(ctx, clamps);
  }

  switch (action) {
    case 'escalate':
      return { action: 'escalate', final_amount_cents: null, discount_percent: null, target_plan: null, creates_offer: false, clamps };
    case 'retry':
      return retry(ctx, clamps);
    case 'pause':
      return { action: 'pause', final_amount_cents: 0, discount_percent: null, target_plan: null, creates_offer: true, clamps };
    case 'partial_credit': {
      if (!(ctx.usage_percent < PARTIAL_CREDIT_MAX_USAGE_EXCLUSIVE)) {
        clamps.push(`partial_credit not allowed at usage ${ctx.usage_percent}% -> retry`);
        return retry(ctx, clamps);
      }
      const step = opts.pushbacks || 0;
      const LADDER_PERCENTS = [20, 35, 50];
      const pct = LADDER_PERCENTS[step] ?? 50;
      
      let final = Math.round((ctx.plan_price_cents * (100 - pct)) / 100);
      if (final < MIN_CHARGE_CENTS) {
        final = MIN_CHARGE_CENTS;
      }
      if (opts.previousAmountCents !== undefined) {
        final = Math.min(final, opts.previousAmountCents);
      }
      return { action: 'partial_credit', final_amount_cents: final, discount_percent: pct, target_plan: null, creates_offer: true, clamps };
    }
    case 'downgrade': {
      const requested = findPlan(proposal?.target_plan);
      let target = requested && requested.priceCents < ctx.plan_price_cents ? requested : undefined;
      if (!target) {
        const lower = nextLowerPlan(ctx.plan_price_cents);
        if (!lower) return retry(ctx, clamps);
        target = lower;
      }
      return {
        action: 'downgrade',
        final_amount_cents: Math.max(target.priceCents, MIN_CHARGE_CENTS),
        discount_percent: null,
        target_plan: target.name,
        creates_offer: true,
        clamps,
      };
    }
  }
}

function retry(ctx: CustomerContext, clamps: string[]): ValidatedDecision {
  return {
    action: 'retry',
    final_amount_cents: Math.max(ctx.plan_price_cents, MIN_CHARGE_CENTS),
    discount_percent: null,
    target_plan: null,
    creates_offer: true,
    clamps,
  };
}

export function checkMessageAmounts(
  message: string,
  requiredCents: number | null,
  allowedCents: number[],
): { ok: boolean; reason?: string } {
  if (!message.trim()) return { ok: false, reason: 'empty message' };
  const found = extractDollarAmounts(message);
  const allowed = new Set([...allowedCents, ...(requiredCents != null ? [requiredCents] : [])]);
  const bad = found.filter((c) => !allowed.has(c));
  if (bad.length) return { ok: false, reason: `unapproved amounts: ${bad.map(formatDollars).join(', ')}` };
  if (requiredCents != null && requiredCents > 0 && !found.includes(requiredCents)) {
    return { ok: false, reason: `missing required amount ${formatDollars(requiredCents)}` };
  }
  return { ok: true };
}

export function sanitizeReply(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/g, '').trim();
}
