import { registerDoneRight, type HarnessContext, type PluginConfig } from './adapter/harness.js';

export { verify } from './verification/run.js';
export { verifyInWorker } from './worker/runner.js';
export { loadContractFromFile, normalizeContract, defaultContract } from './core/contract.js';
export { renderMarkdown } from './core/render.js';
export type * from './core/types.js';

export const name = 'doneright';
export const inject = ['tools', 'commands', 'workingDirectory'];

/**
 * DSH plugin entry point. Registers the `doneright_check` tool and the
 * `/doneright` command; all inspection logic stays in dependency-free modules.
 */
export function apply(ctx: unknown, config: PluginConfig = {}): void {
  registerDoneRight(ctx as HarnessContext, config);
}
