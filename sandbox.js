#!/usr/bin/env node
/**
 * MCP Vikunja Sandbox
 * Interactive sandbox for manually testing MCP tools.
 *
 * Usage:
 *   node sandbox.js
 *
 * Then use the helper functions:
 *   await listTools()                          - list all available tools
 *   await call('vikunja_projects', 'list', {}) - call a tool
 *   await call('vikunja_tasks', 'list', { projectId: 1 })
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// --- Config (mirrors your MCP client config) ---
const ENV = {
  ...process.env,
  VIKUNJA_URL: 'http://privat.amhk.dk:3456/api/v1',
  VIKUNJA_API_TOKEN: 'tk_93cf0f4ccd672ccdb17d6e7e3f71f7ab36c87834',
  RATE_LIMIT_ENABLED: 'false',
};

// --- MCP client bootstrap ---
let msgId = 1;
const pending = new Map();
let serverProcess;
let buffer = '';

function startServer() {
  serverProcess = spawn('node', [path.join(__dirname, 'dist', 'index.js')], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: ENV,
  });

  serverProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (_) {}
    }
  });

  serverProcess.stderr.on('data', (d) => {
    // suppress or print server logs - comment next line to suppress
    // process.stderr.write('[server] ' + d.toString());
  });

  return sendRaw({ jsonrpc: '2.0', id: msgId++, method: 'initialize', params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'sandbox', version: '1.0.0' },
  }});
}

function sendRaw(msg) {
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    serverProcess.stdin.write(JSON.stringify(msg) + '\n');
  });
}

// --- Public helpers ---

/** List all available tools */
async function listTools() {
  const result = await sendRaw({ jsonrpc: '2.0', id: msgId++, method: 'tools/list', params: {} });
  console.log('\nAvailable tools:\n');
  for (const tool of result.tools) {
    console.log(`  ${tool.name}`);
    if (tool.description) console.log(`    ${tool.description.split('\n')[0]}`);
  }
  console.log('');
  return result.tools;
}

/**
 * Call an MCP tool.
 * @param {string} toolName  - e.g. 'vikunja_tasks'
 * @param {string} subcommand - e.g. 'list'
 * @param {object} params    - additional params (merged with subcommand)
 */
async function call(toolName, subcommand, params = {}) {
  const args = { subcommand, ...params };
  console.log(`\n→ ${toolName}(${JSON.stringify(args)})\n`);
  const result = await sendRaw({
    jsonrpc: '2.0',
    id: msgId++,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });
  const text = result?.content?.[0]?.text ?? JSON.stringify(result, null, 2);
  process.stdout.write(text + '\n');
  return; // suppress REPL echo of the full string
}

// Shortcuts for common tools
const projects = {
  list: (p = {}) => call('vikunja_projects', 'list', p),
  get: (id) => call('vikunja_projects', 'get', { id }),
  create: (p) => call('vikunja_projects', 'create', p),
  update: (p) => call('vikunja_projects', 'update', p),
  delete: (id) => call('vikunja_projects', 'delete', { id }),
};

const tasks = {
  list: (p = {}) => call('vikunja_tasks', 'list', p),
  get: (id) => call('vikunja_tasks', 'get', { id }),
  create: (p) => call('vikunja_tasks', 'create', p),
  update: (p) => call('vikunja_tasks', 'update', p),
  delete: (id) => call('vikunja_tasks', 'delete', { id }),
  comment: (id, comment) => call('vikunja_tasks', 'comment', { id, comment }),
};

const labels = {
  list: () => call('vikunja_labels', 'list', {}),
  create: (p) => call('vikunja_labels', 'create', p),
};

// --- Start REPL ---
(async () => {
  console.log('🚀 Starting MCP Vikunja sandbox...');
  try {
    await startServer();
    console.log('✅ MCP server ready!\n');
  } catch (e) {
    console.error('❌ Failed to initialise server:', e.message);
    process.exit(1);
  }

  console.log('Available globals: call, listTools, projects, tasks, labels');
  console.log('Examples:');
  console.log('  await listTools()');
  console.log('  await projects.list()');
  console.log('  await tasks.list({ projectId: 1 })');
  console.log('  await call("vikunja_tasks", "create", { projectId: 1, title: "Hello" })');
  console.log('');

  const repl = require('repl');
  const r = repl.start({ prompt: 'sandbox> ', useGlobal: true });

  // Inject helpers into REPL context
  Object.assign(r.context, { call, listTools, projects, tasks, labels });

  r.on('exit', () => {
    serverProcess.kill();
    process.exit(0);
  });
})();

