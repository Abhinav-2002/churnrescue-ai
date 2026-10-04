import Database from 'better-sqlite3';

const baseUrl = 'http://localhost:3000';

async function resetDb() {
  await fetch(`${baseUrl}/api/reset`, { method: 'POST' });
}

async function simulateFailure(customerId: string) {
  await fetch(`${baseUrl}/api/simulate-failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId })
  });
}

async function printOffers(customerId: string) {
  const db = new Database('data.db');
  const offers = db.prepare(`SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at ASC`).all(customerId) as any[];
  console.log(`\n  Offers for ${customerId}:`);
  for (const off of offers) {
    console.log(`    - ID: ${off.id} | Kind: ${off.kind} | Amount: ${off.amount_cents} | Status: ${off.status}`);
  }
}

async function runScenario(name: string, customerId: string, messages: string[]) {
  console.log(`\n================================`);
  console.log(`Scenario: ${name} (Customer: ${customerId})`);
  console.log(`================================`);
  
  await resetDb();
  await simulateFailure(customerId);
  
  const startRes = await fetch(`${baseUrl}/api/agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId })
  });
  const startData = await startRes.json();
  console.log(`\n[Agent Proactive] Reply: ${startData.reply}`);
  console.log(`[Agent Proactive] Next Step: ${startData.nextStep}`);
  // We can query db to know if template was used... Actually we don't have this in response. 
  // Let's assume server prints it or we can check db agent_actions? No, graph.ts prints it to console.
  await printOffers(customerId);
  
  for (const text of messages) {
    console.log(`\n[Customer] ${text}`);
    const res = await fetch(`${baseUrl}/api/agent/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, text })
    });
    const data = await res.json();
    console.log(`[Agent] Reply: ${data.reply}`);
    console.log(`[Agent] Next Step: ${data.nextStep}`);
    if (data.offerId) console.log(`[Agent] Offer ID: ${data.offerId}`);
    await printOffers(customerId);
  }
}

async function main() {
  // A (usage 5: discount -> "can you do $10?" -> "yes" -> then "make it $20")
  await runScenario('A (Usage 5): ladder negotiation', 'c_7', [
    "can i get a discount",
    "can you do $10?",
    "yes",
    "make it $20"
  ]);

  // B (usage 5: "I want to cancel, I barely use this.")
  await runScenario('B (Usage 5): cancel', 'c_7', [
    "I want to cancel, I barely use this."
  ]);

  // C (usage 95: "No thanks" -> "I want to cancel." -> "cancel my plan")
  await runScenario('C (Usage 95): decline -> cancel -> escalate', 'c_2', [
    "No thanks",
    "I want to cancel.",
    "cancel my plan"
  ]);

  // D (usage 5: "can I pause my account instead" -> confirm)
  await runScenario('D (Usage 5): pause', 'c_7', [
    "can I pause my account instead"
  ]);
  
  // Call confirm pause
  console.log(`\n[UI Action] Confirm Pause`);
  const db = new Database('data.db');
  const offer = db.prepare(`SELECT id FROM offers WHERE customer_id = 'c_7' ORDER BY created_at DESC LIMIT 1`).get() as any;
  const cpRes = await fetch(`${baseUrl}/api/agent/confirm-pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: 'c_7', offerId: offer.id })
  });
  console.log(`[Confirm Pause] OK: ${cpRes.ok}`);
  await printOffers('c_7');

  // E (usage 45: "this is a chargeback")
  // c_4 has 45% usage
  await runScenario('E (Usage 45): chargeback escalation', 'c_4', [
    "this is a chargeback"
  ]);
}

main().catch(console.error);
