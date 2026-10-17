import { getWorkData } from "@/modules/work/application";
import { requireWorkUser } from "@/modules/work/access";
import { todayLondon } from "@/modules/work/domain";
import TaskTable from "./TaskTable";
import { getProjectProcesses } from "@/modules/work/processes";
import ProjectProcesses from "./processes/ProjectProcesses";

export default async function ProjectTasks({
  projectId,
}: {
  projectId: string;
}) {
  await requireWorkUser();
  const [data, processes] = await Promise.all([
    getWorkData(projectId),
    getProjectProcesses(projectId),
  ]);
  return (
    <>
      <ProjectProcesses projectId={projectId} data={processes} />
      <TaskTable
        data={data}
        projectId={projectId}
        today={todayLondon()}
        archived={!!data.projects.find((p) => p.id === projectId)?.archived}
      />
    </>
  );
}
