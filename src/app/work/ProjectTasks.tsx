import { getWorkData } from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";
import { todayLondon } from "@/modules/work/domain";
import Workbench from "./Workbench";

export default async function ProjectTasks({
  projectId,
}: {
  projectId: string;
}) {
  const user = await requireWorkUser();
  return (
    <Workbench
      data={await getWorkData(projectId)}
      currentUserId={user.id}
      today={todayLondon()}
      mode="project"
      projectId={projectId}
    />
  );
}
