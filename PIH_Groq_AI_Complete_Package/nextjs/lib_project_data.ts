import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");

export async function getProjectData(projectId: string) {
  try {
    const filePath = path.join(DATA_DIR, "projects", `${projectId}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getPortfolioData() {
  try {
    const filePath = path.join(DATA_DIR, "portfolio.json");
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
