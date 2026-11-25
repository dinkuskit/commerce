#!/usr/bin/env node
// Secret-bearing workflow triggers (api-oracle secret-bearing-workflow-trigger). A
// pull_request_target or issue_comment run can be started by anyone who opens a pull request
// or comments on one. A job in such a workflow that calls a reusable workflow (`uses:`) and
// passes it secrets must `needs:` a gate job, its `if:` must read that gate's outputs, and the
// gate must check the actor's permission (author_association limited to maintainers, or the
// collaborators permission API). Otherwise any account could reach the secrets.
//
// The workflows here are hand-written, block-style YAML, so this reads them by indentation
// instead of pulling in a YAML dependency.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const UNTRUSTED_TRIGGERS = ["pull_request_target", "issue_comment"];

// A permission gate is either the collaborators permission API or an author_association test.
const PERMISSION_CHECKS = [/collaborators\/\S*\/permission/, /author_association/];
// Admitting these associations is not a permission gate; they cover any GitHub account.
const UNTRUSTED_ASSOCIATIONS = /["'](?:CONTRIBUTOR|FIRST_TIME_CONTRIBUTOR|FIRST_TIMER|NONE|MANNEQUIN)["']/;

const indentOf = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== "" && !line.trimStart().startsWith("#");
const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

// Splits `lines` into the mapping entries found at the indentation of the first entry.
function entries(lines) {
  const first = lines.find(meaningful);
  if (!first) return [];
  const indent = indentOf(first);
  const out = [];
  for (const line of lines) {
    if (meaningful(line) && indentOf(line) === indent && !line.trimStart().startsWith("- ")) {
      const match = line.trim().match(/^("[^"]*"|'[^']*'|[^:\s][^:]*?):(?:\s+(.*))?$/);
      if (match) {
        out.push({ key: unquote(match[1]), value: (match[2] ?? "").trim(), body: [] });
        continue;
      }
    }
    if (out.length > 0 && (!meaningful(line) || indentOf(line) > indent)) out.at(-1).body.push(line);
  }
  return out;
}

function list(entry) {
  if (!entry) return [];
  const flow = entry.value.match(/^\[(.*)\]$/);
  if (flow) return flow[1].split(",").map(unquote).filter(Boolean);
  if (entry.value && !/^[|>]/.test(entry.value)) return [unquote(entry.value)];
  return entry.body
    .filter(meaningful)
    .map((line) => line.trim().match(/^-\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map(unquote);
}

const text = (entry) => (entry ? [entry.value, ...entry.body].join("\n") : "");

export function workflowTriggers(source) {
  const on = entries(source.split("\n")).find((entry) => entry.key === "on" || entry.key === "true");
  if (!on) return [];
  if (on.value) return list(on);
  return entries(on.body).map((entry) => entry.key);
}

function jobsOf(source) {
  const jobs = entries(source.split("\n")).find((entry) => entry.key === "jobs");
  if (!jobs) return new Map();
  return new Map(
    entries(jobs.body).map((job) => [job.key, new Map(entries(job.body).map((field) => [field.key, field]))]),
  );
}

const secretBearing = (fields) =>
  fields.has("uses") && (fields.has("secrets") || /\$\{\{[^}]*\bsecrets\./.test(text(fields.get("with"))));

function permissionGate(fields) {
  const body = [...fields.values()].map(text).join("\n");
  return fields.has("steps") && PERMISSION_CHECKS.some((check) => check.test(body)) && !UNTRUSTED_ASSOCIATIONS.test(body);
}

// Returns one finding per job that hands secrets to a reusable workflow without a gate.
export function auditWorkflow(name, source) {
  const triggers = workflowTriggers(source).filter((trigger) => UNTRUSTED_TRIGGERS.includes(trigger));
  if (triggers.length === 0) return [];
  const jobs = jobsOf(source);
  const findings = [];
  for (const [id, fields] of jobs) {
    if (!secretBearing(fields)) continue;
    const condition = text(fields.get("if"));
    const gates = list(fields.get("needs")).filter((need) => {
      const gate = jobs.get(need);
      return gate && !secretBearing(gate) && permissionGate(gate) && condition.includes(`needs.${need}.outputs.`);
    });
    if (gates.length === 0) {
      findings.push(
        `${name}: job ${id} passes secrets to ${unquote(fields.get("uses").value)} on ${triggers.join(", ")} ` +
          "without needing a permission-gate job whose outputs its if: checks",
      );
    }
  }
  return findings;
}

export function auditWorkflowDirectory(directory) {
  return readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .flatMap((file) => auditWorkflow(file, readFileSync(join(directory, file), "utf8")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = auditWorkflowDirectory(process.argv[2] ?? ".github/workflows");
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) process.exit(1);
  console.log("check-workflow-triggers: no secret-bearing untrusted trigger without a permission gate");
}
