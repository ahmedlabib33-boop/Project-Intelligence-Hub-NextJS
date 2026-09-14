/**
 * Browser persistence for the Schedule Intelligence pipeline.
 *
 * The planning library is kept per browser; the activity mapping, scenario
 * controls and manual edits are kept per project (by project short name, so a
 * new revision of the same programme picks them up). The shipped library is
 * served as static data rather than bundled into the page.
 */

import { defaultControls, type ScenarioControls, type ScenarioObjective, type ScenarioState } from "../xer/scenario";
import { normLabel, parseLibraryJson, type PlanningLibrary } from "./library";
import { MAPPING_SCHEMA, emptyMappingStore, type MappingStore } from "./mapping";

const LIBRARY_KEY = "pih.scheduleIntelligence.library.v1";
const PROJECT_PREFIX = "pih.scheduleIntelligence.project.v1.";
export const SHIPPED_LIBRARY_URL = "/data/planning-library.json";

export function readStoredLibrary(): PlanningLibrary | null {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    return raw ? parseLibraryJson(raw) : null;
  } catch {
    return null;
  }
}

export function writeStoredLibrary(library: PlanningLibrary): boolean {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredLibrary(): void {
  try {
    window.localStorage.removeItem(LIBRARY_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function loadShippedLibrary(): Promise<PlanningLibrary> {
  const response = await fetch(SHIPPED_LIBRARY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`The shipped planning library could not be loaded (${response.status}).`);
  return parseLibraryJson(await response.text());
}

/** The browser's saved library, or the shipped one when nothing is saved yet. */
export async function loadLibrary(): Promise<PlanningLibrary> {
  return readStoredLibrary() || loadShippedLibrary();
}

export type ProjectPipelineState = {
  mapping: MappingStore;
  controls: ScenarioControls;
  manual: ScenarioState;
};

export function projectKey(projectName: string): string {
  return PROJECT_PREFIX + (normLabel(projectName).replace(/ /g, "-") || "project");
}

const OBJECTIVES: ScenarioObjective[] = ["mitigation", "recovery", "revised"];

export function readProjectState(key: string): ProjectPipelineState {
  const fallback: ProjectPipelineState = { mapping: emptyMappingStore(), controls: defaultControls("recovery"), manual: { tasks: {}, links: {} } };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<ProjectPipelineState>;
    const objective = data.controls && OBJECTIVES.includes(data.controls.objective) ? data.controls.objective : "recovery";
    return {
      mapping: data.mapping && data.mapping.schema === MAPPING_SCHEMA
        ? { ...emptyMappingStore(), ...data.mapping, rules: Array.isArray(data.mapping.rules) ? data.mapping.rules : [] }
        : fallback.mapping,
      controls: { ...defaultControls(objective), ...(data.controls || {}) },
      manual: data.manual && typeof data.manual === "object"
        ? { tasks: data.manual.tasks || {}, links: data.manual.links || {} }
        : fallback.manual,
    };
  } catch {
    return fallback;
  }
}

export function writeProjectState(key: string, state: ProjectPipelineState): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
