import { redirect } from "next/navigation";

export default async function ProjectPage({ params }: { params: Promise<{ projectKey: string }> }) {
  const { projectKey } = await params;
  redirect(`/?project=${encodeURIComponent(projectKey)}`);
}
