import type { Metadata } from "next";
import Link from "next/link";
import { requireStrategist } from "@/lib/authorization";
import { normalizeScriptWorkflowStatus, SCRIPT_STATUS_META } from "@/lib/cellumove/script-workflow";
import type { AppUserRow, ProductRow, ScriptAssignmentRow, ScriptProjectRow } from "@/lib/database.types";
import { supabase } from "@/lib/db";
import { AssignEditorControl } from "./AssignEditorControl";

export const metadata: Metadata = { title: "Script Studio · AdFactory" };
export const dynamic = "force-dynamic";

export default async function ScriptsPage() {
  await requireStrategist();
  const [projectsRes, usersRes, productsRes, assignmentsRes] = await Promise.all([
    supabase.from("ScriptProject").select("*").order("updatedAt", { ascending: false }),
    supabase.from("AppUser").select("*").order("username"),
    supabase.from("Product").select("*").order("name"),
    supabase.from("ScriptAssignment").select("*"),
  ]);

  if (projectsRes.error) {
    const missingMigration = /ScriptProject|schema cache|relation/i.test(projectsRes.error.message);
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Script Studio</h1>
          <p className="mt-1 text-sm text-ink-500">Structured ad scripts from strategy through editor handoff.</p>
        </header>
        <div className="card border-amber-300 bg-amber-50">
          <h2 className="font-semibold text-amber-900">{missingMigration ? "Database setup required" : "Could not load scripts"}</h2>
          <p className="mt-2 text-sm text-amber-800">
            {missingMigration
              ? "Apply migrations/009_script_studio.sql to the Supabase database, then reload this page."
              : projectsRes.error.message}
          </p>
        </div>
      </div>
    );
  }

  const projects = (projectsRes.data ?? []) as ScriptProjectRow[];
  const users = (usersRes.data ?? []) as AppUserRow[];
  const products = (productsRes.data ?? []) as ProductRow[];
  const assignments = (assignmentsRes.data ?? []) as ScriptAssignmentRow[];
  const userById = new Map(users.map((user) => [user.id, user]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const assignmentByProject = new Map(assignments.map((assignment) => [assignment.projectId, assignment]));
  const editors = users.filter((user) => user.role === "editor").map((user) => ({ id: user.id, username: user.username }));
  const assigned = projects.filter((project) => Boolean(project.editorUserId)).length;
  const approved = projects.filter((project) => project.status === "approved").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Script Studio</h1>
          <p className="mt-1 text-sm text-ink-500">Build, version, and hand off modular ad scripts.</p>
        </div>
        <Link href="/scripts/new" className="btn btn-primary">+ New script</Link>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card"><div className="text-2xl font-semibold">{projects.length}</div><div className="text-xs uppercase tracking-wide text-ink-500">Total scripts</div></div>
        <div className="card"><div className="text-2xl font-semibold">{assigned}</div><div className="text-xs uppercase tracking-wide text-ink-500">With an editor</div></div>
        <div className="card"><div className="text-2xl font-semibold">{approved}</div><div className="text-xs uppercase tracking-wide text-ink-500">Approved</div></div>
      </div>

      {projects.length === 0 ? (
        <div className="card py-12 text-center">
          <h2 className="font-semibold">No scripts yet</h2>
          <p className="mt-1 text-sm text-ink-500">Create the first structured brief and script skeleton.</p>
          <Link href="/scripts/new" className="btn btn-primary mt-4">Create a script</Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr><th className="px-4 py-3">Script</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Editor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {projects.map((project) => {
                  const workflowStatus = normalizeScriptWorkflowStatus(project.status, assignmentByProject.get(project.id)?.status);
                  const statusMeta = SCRIPT_STATUS_META[workflowStatus];
                  return <tr key={project.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3"><Link href={`/scripts/${project.id}`} className="font-medium hover:underline">{project.title}</Link><div className="mt-0.5 max-w-lg truncate font-mono text-[10px] text-ink-400">{project.displayName}</div></td>
                    <td className="px-4 py-3 text-ink-600">{productById.get(project.productId)?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-600">@{userById.get(project.strategistUserId)?.username ?? "unknown"}</td>
                    <td className="px-4 py-3 text-ink-600">{project.editorUserId ? `@${userById.get(project.editorUserId)?.username ?? "unknown"}` : <AssignEditorControl projectId={project.id} editors={editors} compact />}</td>
                    <td className="px-4 py-3"><span className={statusMeta.className}>{statusMeta.label}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">{new Date(project.updatedAt).toLocaleDateString()}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
