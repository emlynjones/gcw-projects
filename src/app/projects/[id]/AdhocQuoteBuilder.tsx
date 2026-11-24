"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveAdhocQuoteAction, suggestAdhocQuoteTasksAction } from "./quote-actions";

type CatalogueItem = { id: string; name: string; description: string | null; price: number; unit: string; category: string };
type SavedLine = { id: string; name: string; price: number; quantity: number; unit: string };
type QuoteTask = { title: string; estimatedHours: number };

const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);

function quoteText(clientName: string, jobTitle: string, lines: { name: string; price: number; quantity: number; unit: string }[], tasks: QuoteTask[]) {
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const hours = tasks.reduce((sum, task) => sum + task.estimatedHours, 0);
  return [
    `Hi ${clientName},`, "", `Thanks for asking us to help with ${jobTitle}.`, "",
    "The quote includes:",
    ...lines.map((line) => `- ${line.name}: ${line.quantity} × ${money(line.price)}${line.unit !== "one-off" ? `/${line.unit}` : ""} = ${money(line.price * line.quantity)}`),
    "", "We’ll complete:",
    ...tasks.map((task) => `- ${task.title} (${task.estimatedHours}h estimated)`),
    "", `Total: ${money(total)} ex-VAT`, `Estimated delivery time: ${hours} hours`, "",
    "Please reply to confirm that you’d like us to go ahead.",
  ].join("\n");
}

export default function AdhocQuoteBuilder({ projectId, jobTitle, clientName, catalogue, savedLines, savedTasks, aiConfigured }: {
  projectId: string; jobTitle: string; clientName: string; catalogue: CatalogueItem[]; savedLines: SavedLine[]; savedTasks: QuoteTask[]; aiConfigured: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState([{ serviceId: "", quantity: 1 }]);
  const [tasks, setTasks] = useState<QuoteTask[]>([{ title: jobTitle, estimatedHours: 1 }]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const selectedLines = useMemo(() => lines.flatMap((line) => {
    const item = catalogue.find((candidate) => candidate.id === line.serviceId);
    return item ? [{ ...item, quantity: line.quantity }] : [];
  }), [catalogue, lines]);
  const displayLines = savedLines.length ? savedLines : selectedLines;
  const displayTasks = savedLines.length ? savedTasks : tasks;
  const text = quoteText(clientName, jobTitle, displayLines, displayTasks);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setNotice("Quote copied to clipboard");
  };

  if (savedLines.length) return <div className="card quote-builder">
    <div className="page-head"><div><h2>Ad-hoc quote</h2><p className="muted small">Saved into invoice lines and the task list.</p></div><button type="button" className="btn btn-secondary" onClick={copy}>Copy for email</button></div>
    <pre className="quote-copy">{text}</pre>
    {notice && <p role="status">{notice}</p>}
  </div>;

  const suggest = async () => {
    const serviceIds = selectedLines.map((line) => line.id);
    if (!serviceIds.length) { setError("Choose at least one service first."); return; }
    setPending(true); setError(""); setNotice("");
    const result = await suggestAdhocQuoteTasksAction(projectId, serviceIds);
    if (result.tasks) setTasks(result.tasks);
    if (result.error) setError(result.error);
    setPending(false);
  };
  const save = async () => {
    if (!selectedLines.length) { setError("Choose at least one service."); return; }
    const reviewed = tasks.filter((task) => task.title.trim() && task.estimatedHours > 0);
    if (!reviewed.length) { setError("Add at least one estimated task."); return; }
    setPending(true); setError(""); setNotice("");
    const result = await saveAdhocQuoteAction({ projectId, lines: lines.filter((line) => line.serviceId), tasks: reviewed });
    if (result.error) setError(result.error);
    if (result.saved) { setNotice("Quote and tasks saved"); router.refresh(); }
    setPending(false);
  };

  return <div className="card quote-builder">
    <div className="page-head"><div><h2>Build ad-hoc quote</h2><p className="muted small">Catalogue prices are snapshotted when you save.</p></div></div>
    <div className="stack">
      <div><div className="report-subhead">Services and price</div>
        {lines.map((line, index) => <div className="quote-row" key={index}>
          <select value={line.serviceId} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, serviceId: event.target.value } : item))}>
            <option value="">Choose service…</option>
            {catalogue.map((item) => <option value={item.id} key={item.id}>{item.name} — {money(item.price)}{item.unit !== "one-off" ? `/${item.unit}` : ""}</option>)}
          </select>
          <input aria-label="Quantity" type="number" min="0.25" max="1000" step="0.25" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>)}
        {lines.length < 12 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((current) => [...current, { serviceId: "", quantity: 1 }])}>+ Add service</button>}
      </div>
      <div><div className="page-head"><div className="report-subhead">Tight delivery tasks</div>{aiConfigured && <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={suggest}>✨ Suggest up to 5</button>}</div>
        {tasks.map((task, index) => <div className="quote-row quote-task-row" key={index}>
          <input maxLength={200} value={task.title} aria-label={`Task ${index + 1}`} onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
          <label><input type="number" min="0.25" max="1000" step="0.25" value={task.estimatedHours} onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, estimatedHours: Number(event.target.value) } : item))} /> h</label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>)}
        {tasks.length < 6 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTasks((current) => [...current, { title: "", estimatedHours: 1 }])}>+ Add task</button>}
      </div>
      <div className="quote-total"><strong>{money(selectedLines.reduce((sum, line) => sum + line.price * line.quantity, 0))} ex-VAT</strong><span>{tasks.reduce((sum, task) => sum + (task.estimatedHours || 0), 0)} estimated hours</span></div>
      {selectedLines.length > 0 && <details><summary>Preview email copy</summary><pre className="quote-copy">{text}</pre><button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy preview</button></details>}
      <div><button type="button" className="btn" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save quote and create tasks"}</button></div>
      {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="work-warning">{error}</p>}
    </div>
  </div>;
}
