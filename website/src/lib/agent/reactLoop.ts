/**
 * Schema 2: Agent Core (LLM Brain) <-> Tool Sandbox, driven by a
 * Thought / Action(JSON) / Observation loop until a Final Answer is reached.
 *
 * Tools are whitelisted, read-only TypeScript functions over already-loaded
 * project data -- never arbitrary code/shell/browser execution -- so the
 * "sandbox" is a closed, auditable set of project queries. That fits a
 * system whose evidence must never be fabricated: the agent can only ever
 * see what a tool actually returns, and a final answer must be traceable to
 * specific tool observations in the transcript this function returns.
 *
 * Every LLM call inside the loop goes through `askConfiguredAIJob`, so each
 * step is also recorded in the Schema 1 orchestration audit trail.
 */

import { askConfiguredAIJob } from "../orchestration/llmWorker";

export type AgentTool = {
  name: string;
  description: string;
  /** Human-readable description of expected JSON args, shown to the model. */
  argsHint: string;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type AgentStep = {
  thought: string;
  action: { tool: string; args: Record<string, unknown> } | null;
  observation?: unknown;
  observationError?: string;
};

export type AgentRunResult<TFinal> = {
  status: "completed" | "incomplete";
  finalAnswer: TFinal | null;
  steps: AgentStep[];
  message?: string;
};

type ParsedStep<TFinal> = {
  thought?: string;
  action?: { tool: string; args?: Record<string, unknown> } | null;
  final_answer?: TFinal | null;
};

function toolCatalog(tools: AgentTool[]): string {
  return tools.map((tool) => `- ${tool.name}: ${tool.description}\n  args: ${tool.argsHint}`).join("\n");
}

function renderTranscript(steps: AgentStep[]): string {
  if (!steps.length) return "(no steps yet)";
  return steps
    .map((step, index) => {
      const parts = [`Step ${index + 1} Thought: ${step.thought}`];
      if (step.action) parts.push(`Action: ${step.action.tool}(${JSON.stringify(step.action.args)})`);
      if (step.observationError) parts.push(`Observation: ERROR - ${step.observationError}`);
      else if (step.observation !== undefined) parts.push(`Observation: ${JSON.stringify(step.observation).slice(0, 2000)}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt(basePrompt: string, tools: AgentTool[]): string {
  return `${basePrompt}

You solve the goal by choosing ONE tool at a time from this sandbox, or by giving a final answer once you have enough evidence:
${toolCatalog(tools)}

Respond with ONLY a JSON object of exactly this shape:
{"thought": "your reasoning for this step", "action": {"tool": "<tool name>", "args": {}} , "final_answer": null}
or, once ready:
{"thought": "your reasoning", "action": null, "final_answer": <your final answer object>}
Rules:
- Only one of "action" / "final_answer" is non-null in a given response.
- Never state a fact, quote, clause, date, or number that no tool observation gave you.
- If the reasonable tool calls do not find what the goal needs, give a final answer that says so plainly -- do not guess.`;
}

export async function runReactAgent<TFinal = unknown>(options: {
  goal: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxSteps?: number;
}): Promise<AgentRunResult<TFinal>> {
  const { goal, systemPrompt, tools, maxSteps = 5 } = options;
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const steps: AgentStep[] = [];
  const fullSystemPrompt = buildSystemPrompt(systemPrompt, tools);

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const userPrompt = `Goal: ${goal}\n\nTranscript so far:\n${renderTranscript(steps)}\n\nWhat is your next step?`;
    const response = await askConfiguredAIJob(fullSystemPrompt, userPrompt, { json: true, maxTokens: 1200, temperature: 0 });
    if (response.status !== "success") {
      return { status: "incomplete", finalAnswer: null, steps, message: response.error || "The agent's language model did not answer." };
    }

    let parsed: ParsedStep<TFinal>;
    try {
      parsed = JSON.parse(response.answer);
    } catch {
      return { status: "incomplete", finalAnswer: null, steps, message: "The agent returned text that is not valid JSON." };
    }

    const thought = String(parsed.thought || "").slice(0, 600);

    if (parsed.final_answer !== undefined && parsed.final_answer !== null) {
      steps.push({ thought, action: null });
      return { status: "completed", finalAnswer: parsed.final_answer, steps };
    }

    if (!parsed.action || !parsed.action.tool) {
      return { status: "incomplete", finalAnswer: null, steps, message: "The agent did not choose a tool or provide a final answer." };
    }

    const args = parsed.action.args || {};
    const tool = toolsByName.get(parsed.action.tool);
    if (!tool) {
      steps.push({ thought, action: { tool: parsed.action.tool, args }, observationError: `Unknown tool '${parsed.action.tool}'.` });
      continue;
    }
    try {
      const observation = await tool.execute(args);
      steps.push({ thought, action: { tool: tool.name, args }, observation });
    } catch (error) {
      steps.push({ thought, action: { tool: tool.name, args }, observationError: error instanceof Error ? error.message : String(error) });
    }
  }

  return { status: "incomplete", finalAnswer: null, steps, message: `The agent did not reach a final answer within ${maxSteps} steps.` };
}
