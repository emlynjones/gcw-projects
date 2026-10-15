import { getWorkData } from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";
import { todayLondon } from "@/modules/work/domain";
import Workbench from "./Workbench";

export const dynamic = "force-dynamic";
export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireWorkUser();
  const { view } = await searchParams;
  const mode =
    view === "all" || view === "planner" || view === "kanban" ? view : "mine";
  return (
    <Workbench
      key={mode}
      data={await getWorkData()}
      currentUserId={user.id}
      today={todayLondon()}
      mode={mode}
    />
  );
}
