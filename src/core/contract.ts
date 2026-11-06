import { readFile } from 'node:fs/promises';
import { contractHash } from './ids.js';
import type { Contract, Requirement, RequirementKind, Severity } from './types.js';

const KINDS: RequirementKind[] = [
  'file-type',
  'page-count',
  'section',
  'heading',
  'phrase',
  'prohibited',
  'order',
];
const SEVERITIES: Severity[] = ['blocking', 'major', 'minor', 'info'];

export class ContractError extends Error {}

export function normalizeContract(raw: unknown): Contract {
  if (typeof raw !== 'object' || raw === null) throw new ContractError('contract must be an object');
  const c = raw as Partial<Contract>;
  if (c.schemaVersion !== '1.0') throw new ContractError('contract.schemaVersion must be "1.0"');
  if (!Array.isArray(c.requirements)) throw new ContractError('contract.requirements must be an array');

  const seen = new Set<string>();
  const requirements = c.requirements.map((r, i) => normalizeRequirement(r, i, seen));
  const contract: Contract = {
    schemaVersion: '1.0',
    contractId: typeof c.contractId === 'string' && c.contractId ? c.contractId : 'ctr_unnamed',
    requirements,
  };
  if (typeof c.artifactPath === 'string') contract.artifactPath = c.artifactPath;
  if (c.options && typeof c.options === 'object') contract.options = { ...c.options };
  if (Array.isArray(c.sourcePaths)) contract.sourcePaths = c.sourcePaths.filter((p): p is string => typeof p === 'string');
  return contract;
}

function normalizeRequirement(raw: unknown, index: number, seen: Set<string>): Requirement {
  if (typeof raw !== 'object' || raw === null) throw new ContractError(`requirement #${index} must be an object`);
  const r = raw as Partial<Requirement>;
  const kind = r.kind;
  if (!kind || !KINDS.includes(kind)) {
    throw new ContractError(`requirement #${index} has invalid kind: ${String(kind)}`);
  }
  const severity = SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'major';
  let id = typeof r.id === 'string' && r.id ? r.id : `req-${index + 1}`;
  if (seen.has(id)) id = `${id}-${index + 1}`;
  seen.add(id);

  const req: Requirement = {
    id,
    kind,
    severity,
    source: r.source === 'inferred' ? 'inferred' : 'user',
  };
  if (r.source !== 'inferred' || typeof r.confirmedByUser === 'boolean') {
    req.confirmedByUser = r.confirmedByUser ?? r.source !== 'inferred';
  } else {
    req.confirmedByUser = false;
  }
  if (typeof r.value === 'string') req.value = r.value;
  else if (kind !== 'page-count') throw new ContractError(`requirement ${id} (${kind}) requires "value"`);
  if (Array.isArray(r.values)) req.values = r.values.filter((v): v is string => typeof v === 'string');
  if (kind === 'order' && (!req.values || req.values.length < 2)) {
    throw new ContractError(`requirement ${id} (order) requires at least two "values"`);
  }
  if (typeof r.min === 'number') req.min = r.min;
  if (typeof r.max === 'number') req.max = r.max;
  if (kind === 'page-count' && req.min === undefined && req.max === undefined) {
    throw new ContractError(`requirement ${id} (page-count) requires "min" or "max"`);
  }
  if (typeof r.caseSensitive === 'boolean') req.caseSensitive = r.caseSensitive;
  if (Array.isArray(r.pages)) req.pages = r.pages.filter((p): p is number => typeof p === 'number');
  return req;
}

/** Used when the user supplies no contract: only format-level requirements. */
export function defaultContract(): Contract {
  return {
    schemaVersion: '1.0',
    contractId: 'ctr_default_v1',
    requirements: [
      {
        id: 'builtin.file-type',
        kind: 'file-type',
        value: 'pdf',
        severity: 'blocking',
        source: 'user',
        confirmedByUser: true,
      },
    ],
    options: { strictHeadings: false, stripRunningHeaders: true },
  };
}

export async function loadContractFromFile(path: string): Promise<Contract> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ContractError(`cannot read contract ${path}: ${(error as Error).message}`);
  }
  try {
    return normalizeContract(JSON.parse(text));
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(`contract ${path} is not valid JSON: ${(error as Error).message}`);
  }
}

export function contractConfirmed(contract: Contract): boolean {
  return contract.requirements.every((r) => r.source !== 'inferred' || r.confirmedByUser === true);
}

export function hashContract(contract: Contract): string {
  return contractHash(contract);
}

export function isBlockingRequirement(r: Requirement): boolean {
  return r.severity === 'blocking' || r.severity === 'major';
}
