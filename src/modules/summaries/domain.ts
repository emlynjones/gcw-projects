/**
 * A small presentation-neutral summary contract. Domain modules map their own
 * records into sections; UI adapters can display, copy, email or later pass the
 * same document to an AI rewriter without teaching this module about projects,
 * tasks, websites or recurring services.
 */
export type SummarySection = {
  heading?: string;
  items: string[];
};

export type SummaryDocument = {
  title?: string;
  introduction?: string;
  sections: SummarySection[];
};

export function plainTextSummary(document: SummaryDocument): string {
  const blocks: string[] = [];
  if (document.title?.trim()) blocks.push(document.title.trim());
  if (document.introduction?.trim()) blocks.push(document.introduction.trim());
  for (const section of document.sections) {
    const items = section.items.map((item) => item.trim()).filter(Boolean);
    if (!items.length) continue;
    blocks.push(
      [section.heading?.trim(), ...items.map((item) => `- ${item}`)]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return blocks.join("\n\n");
}
