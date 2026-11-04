/**
 * Optional live smoke against https://spockify.eu.
 *
 *   SPOCKIFY_API_KEY=sk-... npm run test:smoke
 *   SPOCKIFY_OWUI_EMAIL=… SPOCKIFY_OWUI_PASSWORD=… npm run test:smoke
 *
 * Without credentials, exits 0 after printing skip (CI-friendly).
 */
import {
  createModelTransport,
  signInOwui,
  resolveApiBackend,
} from '../src/index';

async function smokeLiteLLM(apiKey: string): Promise<void> {
  const transport = createModelTransport({
    baseUrl: process.env.SPOCKIFY_BASE_URL || 'https://spockify.eu',
    apiKey,
    provider: 'remote',
    apiBackend: 'litellm',
  });

  const health = await transport.health();
  console.log('litellm health', health, 'backend', resolveApiBackend({ apiKey }));
  if (!health.ok) {
    process.exitCode = 1;
    return;
  }

  const models = await transport.listModels();
  console.log(
    'litellm models',
    models.slice(0, 5).map((m) => m.id),
    `(${models.length} total)`,
  );

  const chat = await transport.chatCompletions({
    model: 'spockify-auto',
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    max_tokens: 8,
  });
  const text = chat.choices?.[0]?.message?.content ?? '';
  console.log('litellm chat', text.slice(0, 80));
}

async function smokeOwui(email: string, password: string): Promise<void> {
  const baseUrl = process.env.SPOCKIFY_BASE_URL || 'https://spockify.eu';
  const signed = await signInOwui(baseUrl, email, password);
  const transport = createModelTransport({
    baseUrl,
    apiKey: signed.token,
    provider: 'remote',
    apiBackend: 'owui',
  });

  console.log(
    'owui signed in',
    signed.email,
    'backend',
    resolveApiBackend({ apiKey: signed.token, apiBackend: 'owui' }),
  );

  const health = await transport.health();
  console.log('owui health', health);
  if (!health.ok) {
    process.exitCode = 1;
    return;
  }

  const models = await transport.listModels();
  console.log(
    'owui models',
    models.slice(0, 5).map((m) => m.id),
    `(${models.length} total)`,
  );

  const chat = await transport.chatCompletions({
    model: 'spockify-auto',
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    max_tokens: 8,
  });
  const text = chat.choices?.[0]?.message?.content ?? '';
  console.log('owui chat', text.slice(0, 80));
  if (!/pong/i.test(text) && !text.trim()) {
    console.error('owui chat empty');
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.SPOCKIFY_API_KEY?.trim();
  const email = process.env.SPOCKIFY_OWUI_EMAIL?.trim();
  const password = process.env.SPOCKIFY_OWUI_PASSWORD;

  if (!apiKey && !(email && password)) {
    console.log(
      'skip: set SPOCKIFY_API_KEY and/or SPOCKIFY_OWUI_EMAIL+PASSWORD',
    );
    return;
  }

  if (apiKey) {
    await smokeLiteLLM(apiKey);
  }
  if (email && password) {
    await smokeOwui(email, password);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
