import { getWorkData } from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";
import { todayLondon } from "@/modules/work/domain";
import TaskTable from "./TaskTable";

export default async function ProjectTasks({
  projectId,
}: {
  projectId: string;
}) {
  await requireWorkUser();
  const data = await getWorkData(projectId);
  return (
    <TaskTable
      data={data}
      projectId={projectId}
      today={todayLondon()}
      archived={!!data.projects.find((p) => p.id === projectId)?.archived}
    />
  );
}
