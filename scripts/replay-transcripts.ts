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
  // c_2 has 5% usage
  await runScenario('A (Usage 5): ladder negotiation', 'c_7', [
    "can i get a discount",
    "can i get 5 dollar",
    "can you do $10?",
    "yes"
  ]);

  await runScenario('B (Usage 5): cancel', 'c_7', [
    "I want to cancel, I barely use this."
  ]);

  // c_4 has 95% usage
  await runScenario('C (Usage 95): decline -> cancel', 'c_2', [
    "No thanks",
    "I want to cancel.",
    "cancel my plan"
  ]);

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
}

main().catch(console.error);
