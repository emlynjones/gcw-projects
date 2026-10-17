import { requireWorkUser } from "@/modules/work/access";
import { getProcessLibrary, itemFields } from "@/modules/work/processes";
import Library, { type LibraryGroup } from "./Library";
import { processRule } from "@/modules/work/process-domain";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  await requireWorkUser();
  const { templates, workTypes } = await getProcessLibrary();
  const groups: LibraryGroup[] = templates.map(template => ({
    id: template.id, archived: template.archived, editVersion: template.editVersion,
    applications: template._count.applications,
    revisions: template.revisions.map(revision => ({
      id: revision.id, templateId: template.id, editVersion: template.editVersion,
      number: revision.number, name: revision.name, description: revision.description,
      changeSummary: revision.changeSummary, published: !!revision.publishedAt,
      at: (revision.publishedAt ?? revision.createdAt).toISOString(),
      author: revision.author.name, rules: revision.rules.map(rule => processRule.parse(rule)),
      items: revision.items.map(item => ({ itemId: item.itemId, ...itemFields(item) })),
    })),
  }));
  return <Library groups={groups} workTypes={workTypes} />;
}
